from __future__ import annotations

import csv
import html
import json
import re
import shutil
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import wave
from uuid import UUID

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.pitch_analysis import NoteEventArtifactPayload
from gigastudy_api.services.analysis import get_track_note_events_data
from gigastudy_api.db.models import Project, Track, TrackRole, TrackStatus
from gigastudy_api.services.analysis import get_latest_score
from gigastudy_api.services.calibration import AudioSourceSpec, CalibrationExpectation
from gigastudy_api.services.evidence_rounds import EvidenceRoundPaths, resolve_evidence_round_paths
from gigastudy_api.services.guides import get_latest_guide
from gigastudy_api.services.human_rating_builder import (
    HumanRatingCaseMetadata,
    HumanRatingMetadataCorpus,
    load_human_rating_metadata,
)
from gigastudy_api.services.processing import get_track_canonical_artifact
from gigastudy_api.services.storage import get_storage_backend


SAFE_CASE_ID_RE = re.compile(r"[^A-Za-z0-9._-]+")
SEEDED_TEMPLATE_CASE_ID = "replace-with-real-vocal-case"
HUMAN_RATING_SHEET_FIELDNAMES = [
    "case_id",
    "note_index",
    "rater_id",
    "attack_direction",
    "sustain_direction",
    "acceptability_label",
    "notes",
]
NOTE_REFERENCE_FIELDNAMES = [
    "case_id",
    "note_index",
    "start_ms",
    "end_ms",
    "attack_start_ms",
    "attack_end_ms",
    "sustain_start_ms",
    "sustain_end_ms",
    "release_start_ms",
    "release_end_ms",
    "target_midi",
    "target_note_label",
    "target_frequency_hz",
    "guide_clip_wav_path",
    "take_clip_wav_path",
    "guide_clip_start_ms",
    "guide_clip_end_ms",
    "take_clip_start_ms",
    "take_clip_end_ms",
]
NOTE_CLIP_PAD_BEFORE_MS = 120
NOTE_CLIP_PAD_AFTER_MS = 160


@dataclass(frozen=True)
class ExportedEvidenceRoundCase:
    round_root: Path
    case_id: str
    project_id: UUID
    guide_track_id: UUID
    take_track_id: UUID
    guide_output_path: Path
    take_output_path: Path
    metadata_path: Path
    rating_sheet_path: Path
    note_reference_json_path: Path | None
    note_reference_csv_path: Path | None
    review_packet_html_path: Path | None
    template_case_removed: bool
    template_sheet_rows_removed: int
    expectation_seeded: bool
    note_reference_written: bool
    note_clip_count: int


def _slugify_case_id(value: str) -> str:
    normalized = SAFE_CASE_ID_RE.sub("-", value).strip(".-")
    if not normalized:
        raise ValueError("case_id must contain at least one letter or number after normalization.")
    return normalized


def _load_track_for_export(session: Session, track_id: UUID) -> Track | None:
    return session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts), joinedload(Track.scores))
        .where(Track.track_id == track_id)
    )


def _ensure_round_ready(paths: EvidenceRoundPaths) -> None:
    if not paths.root.exists():
        raise FileNotFoundError(
            f"Evidence round does not exist: {paths.root}. Create it first with create_evidence_round.py."
        )
    if not paths.human_rating_cases_path.exists():
        raise FileNotFoundError(
            f"Human-rating metadata file is missing: {paths.human_rating_cases_path}. "
            "Start from a scaffolded evidence round."
        )


def _default_case_id(project: Project, take_track: Track) -> str:
    take_label = f"take-{take_track.take_no}" if take_track.take_no is not None else f"track-{take_track.track_id.hex[:8]}"
    project_label = project.title or f"project-{project.project_id.hex[:8]}"
    return _slugify_case_id(f"{project_label}-{take_label}")


def _build_metadata_corpus(
    metadata_path: Path,
    *,
    round_name: str,
) -> tuple[HumanRatingMetadataCorpus, bool]:
    metadata = load_human_rating_metadata(metadata_path)
    seeded_template_removed = any(case.case_id == SEEDED_TEMPLATE_CASE_ID for case in metadata.cases)
    retained_cases = [case for case in metadata.cases if case.case_id != SEEDED_TEMPLATE_CASE_ID]

    if metadata.corpus_id == "human-rating-corpus-template":
        corpus_id = f"human-rating-{round_name}"
        description = (
            f"Human-rating metadata for evidence round {round_name}. "
            "Generated cases are intended to be paired with real singer guide and take audio."
        )
    else:
        corpus_id = metadata.corpus_id
        description = metadata.description

    return (
        HumanRatingMetadataCorpus(
            corpus_id=corpus_id,
            description=description,
            evidence_kind="human_rating_corpus",
            cases=retained_cases,
        ),
        seeded_template_removed,
    )


def _write_metadata_corpus(metadata_path: Path, metadata: HumanRatingMetadataCorpus) -> None:
    metadata_path.write_text(
        json.dumps(metadata.model_dump(mode="json"), indent=2),
        encoding="utf-8",
    )


def _strip_template_sheet_rows(sheet_path: Path) -> int:
    if not sheet_path.exists():
        with sheet_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=HUMAN_RATING_SHEET_FIELDNAMES)
            writer.writeheader()
        return 0

    with sheet_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)

    retained_rows = [row for row in rows if str(row.get("case_id") or "").strip() != SEEDED_TEMPLATE_CASE_ID]
    removed_count = len(rows) - len(retained_rows)

    with sheet_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HUMAN_RATING_SHEET_FIELDNAMES)
        writer.writeheader()
        writer.writerows(retained_rows)

    return removed_count


def _build_expectation_from_score(track: Track) -> CalibrationExpectation | None:
    latest_score = get_latest_score(track)
    if latest_score is None:
        return None

    return CalibrationExpectation(
        note_index=0,
        expected_pitch_quality_mode=latest_score.pitch_quality_mode,
        expected_harmony_reference_mode=latest_score.harmony_reference_mode,
    )


def _midi_to_note_label(midi_value: int) -> str:
    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    octave = (midi_value // 12) - 1
    return f"{note_names[midi_value % 12]}{octave}"


def _read_canonical_wav_samples(track: Track) -> tuple[np.ndarray, int]:
    canonical_artifact = get_track_canonical_artifact(track)
    if canonical_artifact is None:
        raise ValueError(f"Track {track.track_id} does not have canonical audio yet.")

    payload = get_storage_backend().read_bytes(canonical_artifact.storage_key)
    with wave.open(BytesIO(payload), "rb") as wav_file:
        frames = wav_file.readframes(wav_file.getnframes())
        sample_rate = wav_file.getframerate()
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32767.0
    return samples, sample_rate


def _build_wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = np.round(pcm * np.int16(32767)).astype(np.int16)

    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _extract_clip(
    samples: np.ndarray,
    sample_rate: int,
    *,
    start_ms: int,
    end_ms: int,
) -> np.ndarray:
    start_index = max(0, round((start_ms / 1000) * sample_rate))
    end_index = min(samples.shape[0], round((end_ms / 1000) * sample_rate))
    if end_index <= start_index:
        return np.zeros(0, dtype=np.float32)
    return samples[start_index:end_index]


def _write_note_reference_files(
    paths: EvidenceRoundPaths,
    *,
    case_id: str,
    note_payload: NoteEventArtifactPayload,
    guide_track: Track,
    take_track: Track,
) -> tuple[Path, Path, int]:
    reference_json_path = paths.human_rating_references_dir / f"{case_id}-note-reference.json"
    reference_csv_path = paths.human_rating_references_dir / f"{case_id}-note-reference.csv"
    reference_clips_root = paths.human_rating_references_dir / "clips" / case_id
    reference_clips_root.mkdir(parents=True, exist_ok=True)
    guide_samples, guide_sample_rate = _read_canonical_wav_samples(guide_track)
    take_samples, take_sample_rate = _read_canonical_wav_samples(take_track)
    take_alignment_offset_ms = int(take_track.alignment_offset_ms or note_payload.alignment_offset_ms or 0)

    neutral_reference = {
        "case_id": case_id,
        "quality_mode": note_payload.quality_mode,
        "alignment_offset_ms": note_payload.alignment_offset_ms,
        "note_count": note_payload.note_count,
        "notes": [
            {
                "case_id": case_id,
                "note_index": note.note_index,
                "start_ms": note.start_ms,
                "end_ms": note.end_ms,
                "attack_start_ms": note.attack_start_ms,
                "attack_end_ms": note.attack_end_ms,
                "sustain_start_ms": note.sustain_start_ms,
                "sustain_end_ms": note.sustain_end_ms,
                "release_start_ms": note.release_start_ms,
                "release_end_ms": note.release_end_ms,
                "target_midi": note.target_midi,
                "target_note_label": _midi_to_note_label(note.target_midi),
                "target_frequency_hz": note.target_frequency_hz,
                "guide_clip_wav_path": None,
                "take_clip_wav_path": None,
                "guide_clip_start_ms": None,
                "guide_clip_end_ms": None,
                "take_clip_start_ms": None,
                "take_clip_end_ms": None,
            }
            for note in note_payload.notes
        ],
    }

    clip_count = 0
    for note in neutral_reference["notes"]:
        guide_clip_start_ms = max(0, int(note["start_ms"]) - NOTE_CLIP_PAD_BEFORE_MS)
        guide_clip_end_ms = max(guide_clip_start_ms + 1, int(note["end_ms"]) + NOTE_CLIP_PAD_AFTER_MS)
        take_clip_start_ms = max(
            0,
            int(note["start_ms"]) - take_alignment_offset_ms - NOTE_CLIP_PAD_BEFORE_MS,
        )
        take_clip_end_ms = max(
            take_clip_start_ms + 1,
            int(note["end_ms"]) - take_alignment_offset_ms + NOTE_CLIP_PAD_AFTER_MS,
        )

        guide_clip = _extract_clip(
            guide_samples,
            guide_sample_rate,
            start_ms=guide_clip_start_ms,
            end_ms=guide_clip_end_ms,
        )
        take_clip = _extract_clip(
            take_samples,
            take_sample_rate,
            start_ms=take_clip_start_ms,
            end_ms=take_clip_end_ms,
        )
        if guide_clip.size == 0 or take_clip.size == 0:
            continue

        guide_clip_path = reference_clips_root / f"note-{int(note['note_index']):03d}-guide.wav"
        take_clip_path = reference_clips_root / f"note-{int(note['note_index']):03d}-take.wav"
        guide_clip_path.write_bytes(_build_wav_bytes(guide_clip, guide_sample_rate))
        take_clip_path.write_bytes(_build_wav_bytes(take_clip, take_sample_rate))
        note["guide_clip_wav_path"] = guide_clip_path.relative_to(paths.human_rating_dir).as_posix()
        note["take_clip_wav_path"] = take_clip_path.relative_to(paths.human_rating_dir).as_posix()
        note["guide_clip_start_ms"] = guide_clip_start_ms
        note["guide_clip_end_ms"] = guide_clip_end_ms
        note["take_clip_start_ms"] = take_clip_start_ms
        note["take_clip_end_ms"] = take_clip_end_ms
        clip_count += 2

    reference_json_path.parent.mkdir(parents=True, exist_ok=True)
    reference_json_path.write_text(json.dumps(neutral_reference, indent=2), encoding="utf-8")
    with reference_csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=NOTE_REFERENCE_FIELDNAMES)
        writer.writeheader()
        for note in neutral_reference["notes"]:
            writer.writerow(note)

    return reference_json_path, reference_csv_path, clip_count


def _clear_note_reference_files(paths: EvidenceRoundPaths, *, case_id: str) -> None:
    for suffix in ("json", "csv"):
        candidate = paths.human_rating_references_dir / f"{case_id}-note-reference.{suffix}"
        if candidate.exists():
            candidate.unlink()
    clips_root = paths.human_rating_references_dir / "clips" / case_id
    if clips_root.exists():
        shutil.rmtree(clips_root)
    review_packet_path = paths.human_rating_review_packets_dir / f"{case_id}-review-packet.html"
    if review_packet_path.exists():
        review_packet_path.unlink()


def _copy_canonical_wav(track: Track, output_path: Path, *, overwrite: bool) -> None:
    canonical_artifact = get_track_canonical_artifact(track)
    if canonical_artifact is None:
        raise ValueError(f"Track {track.track_id} does not have canonical audio yet.")
    if output_path.exists() and not overwrite:
        raise FileExistsError(
            f"Refusing to overwrite existing evidence audio without --overwrite: {output_path}"
        )

    payload = get_storage_backend().read_bytes(canonical_artifact.storage_key)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(payload)


def _render_review_packet_html(
    *,
    paths: EvidenceRoundPaths,
    case_id: str,
    project: Project,
    guide_output_path: Path,
    take_output_path: Path,
    note_reference_json_path: Path,
) -> str:
    packet_dir = paths.human_rating_review_packets_dir
    relative_guide_path = Path(
        guide_output_path.relative_to(packet_dir).as_posix()
        if guide_output_path.is_relative_to(packet_dir)
        else Path("..") / guide_output_path.relative_to(paths.human_rating_dir)
    )
    relative_take_path = Path(
        take_output_path.relative_to(packet_dir).as_posix()
        if take_output_path.is_relative_to(packet_dir)
        else Path("..") / take_output_path.relative_to(paths.human_rating_dir)
    )
    note_reference = json.loads(note_reference_json_path.read_text(encoding="utf-8"))
    note_rows: list[str] = []
    for note in note_reference["notes"]:
        guide_clip_html = ""
        if note.get("guide_clip_wav_path"):
            guide_clip_rel = Path("..") / Path(str(note["guide_clip_wav_path"]))
            guide_clip_html = (
                f'<audio controls preload="none" src="{html.escape(guide_clip_rel.as_posix())}"></audio>'
            )
        take_clip_html = ""
        if note.get("take_clip_wav_path"):
            take_clip_rel = Path("..") / Path(str(note["take_clip_wav_path"]))
            take_clip_html = (
                f'<audio controls preload="none" src="{html.escape(take_clip_rel.as_posix())}"></audio>'
            )
        note_rows.append(
            "".join(
                [
                    "<tr>",
                    f"<td>{int(note['note_index'])}</td>",
                    f"<td>{html.escape(str(note['target_note_label']))}</td>",
                    f"<td>{int(note['start_ms'])} - {int(note['end_ms'])} ms</td>",
                    f"<td>{guide_clip_html}</td>",
                    f"<td>{take_clip_html}</td>",
                    "<td>attack / sustain / acceptability / notes</td>",
                    "</tr>",
                ]
            )
        )

    return "\n".join(
        [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '  <meta charset="utf-8" />',
            f"  <title>{html.escape(case_id)} review packet</title>",
            "  <style>",
            "    body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }",
            "    h1, h2 { margin-bottom: 8px; }",
            "    p, li { line-height: 1.5; }",
            "    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }",
            "    .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; background: #f9fafb; }",
            "    table { width: 100%; border-collapse: collapse; margin-top: 20px; }",
            "    th, td { border: 1px solid #d1d5db; padding: 10px; vertical-align: top; }",
            "    th { background: #f3f4f6; text-align: left; }",
            "    audio { width: 100%; min-width: 220px; }",
            "    .hint { color: #4b5563; font-size: 14px; }",
            "  </style>",
            "</head>",
            "<body>",
            f"  <h1>Human Rating Review Packet: {html.escape(case_id)}</h1>",
            f"  <p><strong>Project:</strong> {html.escape(project.title)}</p>",
            "  <p class=\"hint\">Use this packet with the round rating sheet. The packet is intentionally neutral: it provides note indices, target pitches, and audio references, but it does not show the scorer's sharp/flat verdict text.</p>",
            "  <div class=\"pair\">",
            "    <div class=\"card\">",
            "      <h2>Full Guide</h2>",
            f"      <audio controls preload=\"none\" src=\"{html.escape(relative_guide_path.as_posix())}\"></audio>",
            "    </div>",
            "    <div class=\"card\">",
            "      <h2>Full Take</h2>",
            f"      <audio controls preload=\"none\" src=\"{html.escape(relative_take_path.as_posix())}\"></audio>",
            "    </div>",
            "  </div>",
            "  <h2>Per-Note Review</h2>",
            "  <p class=\"hint\">Listen to the full take first, then use the note clips for precise per-note review.</p>",
            "  <table>",
            "    <thead>",
            "      <tr>",
            "        <th>Note</th>",
            "        <th>Target</th>",
            "        <th>Window</th>",
            "        <th>Guide clip</th>",
            "        <th>Take clip</th>",
            "        <th>Fill in on sheet</th>",
            "      </tr>",
            "    </thead>",
            "    <tbody>",
            *note_rows,
            "    </tbody>",
            "  </table>",
            "</body>",
            "</html>",
        ]
    )


def _write_review_packet_html(
    *,
    paths: EvidenceRoundPaths,
    case_id: str,
    project: Project,
    guide_output_path: Path,
    take_output_path: Path,
    note_reference_json_path: Path,
) -> Path:
    packet_path = paths.human_rating_review_packets_dir / f"{case_id}-review-packet.html"
    packet_path.parent.mkdir(parents=True, exist_ok=True)
    packet_path.write_text(
        _render_review_packet_html(
            paths=paths,
            case_id=case_id,
            project=project,
            guide_output_path=guide_output_path,
            take_output_path=take_output_path,
            note_reference_json_path=note_reference_json_path,
        ),
        encoding="utf-8",
    )
    return packet_path


def export_project_take_to_evidence_round(
    session: Session,
    *,
    round_root: Path,
    project_id: UUID,
    take_track_id: UUID,
    case_id: str | None = None,
    overwrite: bool = False,
) -> ExportedEvidenceRoundCase:
    paths = resolve_evidence_round_paths(round_root)
    _ensure_round_ready(paths)

    project = session.get(Project, project_id)
    if project is None:
        raise ValueError(f"Project not found: {project_id}")

    guide_track = get_latest_guide(session, project_id)
    if guide_track is None:
        raise ValueError(f"Project {project_id} does not have a guide track yet.")
    if guide_track.track_status != TrackStatus.READY:
        raise ValueError(f"Guide track {guide_track.track_id} is not ready for export.")

    take_track = _load_track_for_export(session, take_track_id)
    if take_track is None:
        raise ValueError(f"Take track not found: {take_track_id}")
    if take_track.project_id != project_id:
        raise ValueError(f"Take track {take_track_id} does not belong to project {project_id}.")
    if take_track.track_role != TrackRole.VOCAL_TAKE:
        raise ValueError(f"Track {take_track_id} is not a vocal take.")
    if take_track.track_status != TrackStatus.READY:
        raise ValueError(f"Take track {take_track_id} is not ready for export.")

    normalized_case_id = _slugify_case_id(case_id or _default_case_id(project, take_track))
    metadata, template_case_removed = _build_metadata_corpus(
        paths.human_rating_cases_path,
        round_name=paths.root.name,
    )
    existing_case_ids = {case.case_id for case in metadata.cases}
    if normalized_case_id in existing_case_ids and not overwrite:
        raise FileExistsError(
            f"Case id already exists in this evidence round: {normalized_case_id}. "
            "Use --overwrite to replace its metadata and audio."
        )

    guide_output_path = paths.human_rating_audio_guides_dir / f"{normalized_case_id}-guide.wav"
    take_output_path = paths.human_rating_audio_takes_dir / f"{normalized_case_id}-take.wav"

    _copy_canonical_wav(guide_track, guide_output_path, overwrite=overwrite)
    _copy_canonical_wav(take_track, take_output_path, overwrite=overwrite)

    relative_guide_path = guide_output_path.relative_to(paths.human_rating_dir).as_posix()
    relative_take_path = take_output_path.relative_to(paths.human_rating_dir).as_posix()
    expectation = _build_expectation_from_score(take_track)
    note_payload = get_track_note_events_data(take_track)

    exported_case = HumanRatingCaseMetadata(
        case_id=normalized_case_id,
        description=f"{project.title} - take {take_track.take_no or take_track.track_id.hex[:8]}",
        project_title=project.title,
        base_key=project.base_key or "C",
        bpm=project.bpm or 90,
        chord_timeline_json=project.chord_timeline_json if isinstance(project.chord_timeline_json, list) else None,
        guide_source=AudioSourceSpec(
            source_kind="wav_path",
            wav_path=relative_guide_path,
            filename=guide_output_path.name,
            content_type="audio/wav",
        ),
        take_source=AudioSourceSpec(
            source_kind="wav_path",
            wav_path=relative_take_path,
            filename=take_output_path.name,
            content_type="audio/wav",
        ),
        expectation=expectation,
        minimum_human_agreement_ratio=0.67,
    )

    retained_cases = [case for case in metadata.cases if case.case_id != normalized_case_id]
    retained_cases.append(exported_case)
    updated_metadata = HumanRatingMetadataCorpus(
        corpus_id=metadata.corpus_id,
        description=metadata.description,
        evidence_kind=metadata.evidence_kind,
        cases=retained_cases,
    )
    _write_metadata_corpus(paths.human_rating_cases_path, updated_metadata)
    removed_template_rows = _strip_template_sheet_rows(paths.human_rating_sheet_path)
    note_reference_json_path: Path | None = None
    note_reference_csv_path: Path | None = None
    review_packet_html_path: Path | None = None
    note_clip_count = 0
    _clear_note_reference_files(paths, case_id=normalized_case_id)
    if note_payload is not None:
        note_reference_json_path, note_reference_csv_path, note_clip_count = _write_note_reference_files(
            paths,
            case_id=normalized_case_id,
            note_payload=note_payload,
            guide_track=guide_track,
            take_track=take_track,
        )
        review_packet_html_path = _write_review_packet_html(
            paths=paths,
            case_id=normalized_case_id,
            project=project,
            guide_output_path=guide_output_path,
            take_output_path=take_output_path,
            note_reference_json_path=note_reference_json_path,
        )

    return ExportedEvidenceRoundCase(
        round_root=paths.root,
        case_id=normalized_case_id,
        project_id=project.project_id,
        guide_track_id=guide_track.track_id,
        take_track_id=take_track.track_id,
        guide_output_path=guide_output_path,
        take_output_path=take_output_path,
        metadata_path=paths.human_rating_cases_path,
        rating_sheet_path=paths.human_rating_sheet_path,
        note_reference_json_path=note_reference_json_path,
        note_reference_csv_path=note_reference_csv_path,
        review_packet_html_path=review_packet_html_path,
        template_case_removed=template_case_removed,
        template_sheet_rows_removed=removed_template_rows,
        expectation_seeded=expectation is not None,
        note_reference_written=note_reference_json_path is not None and note_reference_csv_path is not None,
        note_clip_count=note_clip_count,
    )
