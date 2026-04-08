from dataclasses import dataclass
from datetime import datetime, timezone
from math import log2
from pathlib import Path
from time import perf_counter
import wave
from uuid import UUID

import numpy as np
from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.analysis import (
    AnalysisFeedbackItemResponse,
    AnalysisJobResponse,
    TrackAnalysisResponse,
    TrackScoreResponse,
)
from gigastudy_api.api.schemas.pitch_analysis import (
    COARSE_CONTOUR_QUALITY_MODE,
    FRAME_PITCH_QUALITY_MODE,
    HARMONY_REFERENCE_MODE_KEY_ONLY,
    NOTE_EVENT_ARTIFACT_VERSION,
    NOTE_EVENT_QUALITY_MODE,
    NoteEventArtifactPayload,
    NoteFeedbackItemResponse,
    TrackFramePitchResponse,
    TrackNoteEventsResponse,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import (
    AnalysisJob,
    AnalysisJobStatus,
    AnalysisJobType,
    Artifact,
    ArtifactType,
    Project,
    Score,
    Track,
    TrackRole,
    TrackStatus,
)
from gigastudy_api.services.audio_features import ONSET_HOP_LENGTH, build_onset_envelope
from gigastudy_api.services.processing import (
    get_track_frame_pitch_artifact,
    get_track_frame_pitch_data,
    get_track_preview_data,
)


ANALYSIS_MODEL_VERSION = "librosa-pyin-note-events-v3"
MAX_ALIGNMENT_MS = 2000
MIN_ALIGNMENT_OVERLAP_FRAMES = 24
SEGMENT_COUNT = 4
NOTE_GAP_MS = 120
NOTE_SPLIT_CENTS = 90
MIN_NOTE_DURATION_MS = 80
DEFAULT_IN_TUNE_CENTS = 20
ATTACK_SCORE_SCALE_CENTS = 40
SUSTAIN_SCORE_SCALE_CENTS = 30
STABILITY_SCORE_SCALE_CENTS = 28
TIMING_SCORE_SCALE_MS = 90

NOTE_TO_PITCH_CLASS = {
    "C": 0,
    "B#": 0,
    "C#": 1,
    "DB": 1,
    "D": 2,
    "D#": 3,
    "EB": 3,
    "E": 4,
    "FB": 4,
    "F": 5,
    "E#": 5,
    "F#": 6,
    "GB": 6,
    "G": 7,
    "G#": 8,
    "AB": 8,
    "A": 9,
    "A#": 10,
    "BB": 10,
    "B": 11,
    "CB": 11,
}
MAJOR_SCALE_INTERVALS = {0, 2, 4, 5, 7, 9, 11}


@dataclass
class AlignmentSlices:
    guide_start: int
    take_start: int
    overlap: int


@dataclass
class AnalysisComputation:
    alignment_offset_ms: int
    alignment_confidence: float
    pitch_score: float
    rhythm_score: float
    harmony_fit_score: float
    total_score: float
    pitch_quality_mode: str
    harmony_reference_mode: str
    feedback_items: list[dict[str, object]]
    note_feedback_items: list[NoteFeedbackItemResponse]
    note_event_payload: NoteEventArtifactPayload | None


@dataclass
class ReferenceNote:
    note_index: int
    start_ms: int
    end_ms: int
    target_midi: int
    target_frequency_hz: float
    attack_start_ms: int
    attack_end_ms: int
    settle_start_ms: int | None
    settle_end_ms: int | None
    sustain_start_ms: int | None
    sustain_end_ms: int | None
    release_start_ms: int | None
    release_end_ms: int | None


@dataclass
class ShiftedPitchFrame:
    start_ms: int
    end_ms: int
    frequency_hz: float
    pitch_midi: int | None
    voiced_prob: float | None
    rms: float | None


def _get_track_artifact(track: Track, artifact_type: ArtifactType) -> Artifact | None:
    for artifact in track.artifacts:
        if artifact.artifact_type == artifact_type:
            return artifact

    return None


def _get_storage_root() -> Path:
    settings = get_settings()
    return Path(settings.storage_root).resolve()


def get_track_note_events_artifact(track: Track) -> Artifact | None:
    return _get_track_artifact(track, ArtifactType.NOTE_EVENTS)


def get_track_note_events_data(track: Track) -> NoteEventArtifactPayload | None:
    artifact = get_track_note_events_artifact(track)
    if artifact is None:
        return None

    artifact_path = Path(artifact.storage_key)
    if artifact_path.exists():
        try:
            return NoteEventArtifactPayload.model_validate_json(artifact_path.read_text(encoding="utf-8"))
        except (OSError, ValidationError, ValueError):
            pass

    if not isinstance(artifact.meta_json, dict):
        return None

    payload = artifact.meta_json.get("note_event_data")
    if not isinstance(payload, dict):
        return None

    try:
        return NoteEventArtifactPayload.model_validate(payload)
    except ValidationError:
        return None


def _read_canonical_samples(track: Track) -> tuple[np.ndarray, int]:
    canonical_artifact = _get_track_artifact(track, ArtifactType.CANONICAL_AUDIO)
    if canonical_artifact is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Track canonical audio is missing. Re-run upload processing first.",
        )

    canonical_path = Path(canonical_artifact.storage_key)
    if not canonical_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Track canonical audio file is missing on disk.",
        )

    with wave.open(canonical_path.as_posix(), "rb") as wav_file:
        raw_frames = wav_file.readframes(wav_file.getnframes())
        sample_rate = wav_file.getframerate()
        samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32767.0

    return samples, sample_rate


def _get_overlap_slices(guide_length: int, take_length: int, shift: int) -> AlignmentSlices | None:
    guide_start = max(0, shift)
    take_start = max(0, -shift)
    overlap = min(guide_length - guide_start, take_length - take_start)
    if overlap <= 0:
        return None

    return AlignmentSlices(
        guide_start=guide_start,
        take_start=take_start,
        overlap=overlap,
    )


def _calculate_alignment(
    guide_envelope: np.ndarray,
    take_envelope: np.ndarray,
    frame_ms: int,
) -> tuple[int, float]:
    if guide_envelope.size == 0 or take_envelope.size == 0:
        return 0, 0.0

    max_shift_frames = max(1, MAX_ALIGNMENT_MS // max(1, frame_ms))
    best_shift = 0
    best_score = -1.0
    best_coverage = 0.0

    for shift in range(-max_shift_frames, max_shift_frames + 1):
        overlap_slices = _get_overlap_slices(len(guide_envelope), len(take_envelope), shift)
        if overlap_slices is None or overlap_slices.overlap < MIN_ALIGNMENT_OVERLAP_FRAMES:
            continue

        guide_slice = guide_envelope[
            overlap_slices.guide_start : overlap_slices.guide_start + overlap_slices.overlap
        ]
        take_slice = take_envelope[
            overlap_slices.take_start : overlap_slices.take_start + overlap_slices.overlap
        ]
        centered_guide = guide_slice - np.mean(guide_slice)
        centered_take = take_slice - np.mean(take_slice)
        denominator = float(np.linalg.norm(centered_guide) * np.linalg.norm(centered_take))
        if denominator <= 1e-9:
            continue

        similarity = float(np.dot(centered_guide, centered_take) / denominator)
        coverage = overlap_slices.overlap / max(len(guide_envelope), len(take_envelope))
        weighted_similarity = similarity * coverage
        if weighted_similarity > best_score:
            best_score = weighted_similarity
            best_shift = shift
            best_coverage = coverage

    if best_score < 0:
        return 0, 0.0

    confidence = float(np.clip(best_score * (0.6 + (0.4 * best_coverage)), 0.0, 1.0))
    return best_shift * frame_ms, round(confidence, 4)


def _align_numeric_arrays(
    guide_values: np.ndarray,
    take_values: np.ndarray,
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
) -> tuple[np.ndarray, np.ndarray]:
    guide_length = len(guide_values)
    take_length = len(take_values)
    if guide_length == 0 or take_length == 0:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    guide_step_ms = max(1.0, guide_duration_ms / guide_length)
    take_step_ms = max(1.0, take_duration_ms / take_length)
    shift = int(round(offset_ms / min(guide_step_ms, take_step_ms)))
    overlap_slices = _get_overlap_slices(guide_length, take_length, shift)
    if overlap_slices is None:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    return (
        guide_values[overlap_slices.guide_start : overlap_slices.guide_start + overlap_slices.overlap],
        take_values[overlap_slices.take_start : overlap_slices.take_start + overlap_slices.overlap],
    )


def _align_pitch_sequences(
    guide_sequence: list[float | None],
    take_sequence: list[float | None],
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
) -> list[tuple[float, float]]:
    guide_values = np.array([value if value is not None else np.nan for value in guide_sequence], dtype=np.float32)
    take_values = np.array([value if value is not None else np.nan for value in take_sequence], dtype=np.float32)
    aligned_guide, aligned_take = _align_numeric_arrays(
        guide_values,
        take_values,
        offset_ms,
        guide_duration_ms,
        take_duration_ms,
    )
    if aligned_guide.size == 0 or aligned_take.size == 0:
        return []

    pairs: list[tuple[float, float]] = []
    for guide_value, take_value in zip(aligned_guide, aligned_take, strict=False):
        if np.isnan(guide_value) or np.isnan(take_value):
            continue
        if guide_value <= 0 or take_value <= 0:
            continue
        pairs.append((float(guide_value), float(take_value)))

    return pairs


def _frame_pitch_sequence(track: Track) -> list[float | None] | None:
    payload = get_track_frame_pitch_data(track)
    if payload is None:
        return None

    return [frame.frequency_hz for frame in payload.frames]


def _cents_delta(frequency_hz: float, target_frequency_hz: float) -> float:
    return 1200 * log2(frequency_hz / target_frequency_hz)


def _pitch_score_curve(cents: float | None, scale_cents: float) -> float:
    if cents is None:
        return 0.0
    return float(np.exp(-((abs(cents) / scale_cents) ** 2)) * 100)


def _timing_score_curve(offset_ms: int | None) -> float:
    if offset_ms is None:
        return 0.0
    return float(np.exp(-((abs(offset_ms) / TIMING_SCORE_SCALE_MS) ** 2)) * 100)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    return float(np.median(np.asarray(values, dtype=np.float32)))


def _mad(values: list[float], center: float | None) -> float | None:
    if not values or center is None:
        return None
    deviations = np.abs(np.asarray(values, dtype=np.float32) - float(center))
    return float(np.median(deviations))


def _round_or_none(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _build_note_windows(start_ms: int, end_ms: int) -> tuple[int, int, int | None, int | None, int | None, int | None]:
    duration_ms = max(1, end_ms - start_ms)
    attack_duration_ms = max(1, min(120, round(duration_ms * 0.25)))
    attack_end_ms = min(end_ms, start_ms + attack_duration_ms)

    release_duration_ms = max(1, min(80, round(duration_ms * 0.15)))
    release_start_ms = max(attack_end_ms, end_ms - release_duration_ms)

    middle_span_ms = max(0, release_start_ms - attack_end_ms)
    settle_duration_ms = min(middle_span_ms, 160)
    if settle_duration_ms > 0:
        settle_start_ms = attack_end_ms
        settle_end_ms = attack_end_ms + settle_duration_ms
    else:
        settle_start_ms = None
        settle_end_ms = None

    sustain_start_ms = settle_end_ms if settle_end_ms is not None and settle_end_ms < release_start_ms else None
    sustain_end_ms = release_start_ms if sustain_start_ms is not None else None
    release_start_value = release_start_ms if release_start_ms < end_ms else None
    release_end_value = end_ms if release_start_value is not None else None

    return (
        attack_end_ms,
        release_start_ms,
        settle_start_ms,
        settle_end_ms,
        sustain_start_ms,
        sustain_end_ms,
    )


def _flush_reference_note(
    notes: list[ReferenceNote],
    voiced_frames: list[object],
) -> None:
    if not voiced_frames:
        return

    start_ms = int(voiced_frames[0].start_ms)
    end_ms = int(voiced_frames[-1].end_ms)
    if end_ms - start_ms < MIN_NOTE_DURATION_MS:
        return

    frequencies = [float(frame.frequency_hz) for frame in voiced_frames if frame.frequency_hz is not None]
    if not frequencies:
        return

    target_frequency_hz = float(np.median(np.asarray(frequencies, dtype=np.float32)))
    midi_values = [int(frame.pitch_midi) for frame in voiced_frames if frame.pitch_midi is not None]
    target_midi = int(round(float(np.median(np.asarray(midi_values, dtype=np.float32))))) if midi_values else int(
        round(69 + (12 * log2(target_frequency_hz / 440.0)))
    )
    attack_end_ms, release_start_ms, settle_start_ms, settle_end_ms, sustain_start_ms, sustain_end_ms = _build_note_windows(
        start_ms,
        end_ms,
    )
    notes.append(
        ReferenceNote(
            note_index=len(notes),
            start_ms=start_ms,
            end_ms=end_ms,
            target_midi=target_midi,
            target_frequency_hz=round(target_frequency_hz, 3),
            attack_start_ms=start_ms,
            attack_end_ms=attack_end_ms,
            settle_start_ms=settle_start_ms,
            settle_end_ms=settle_end_ms,
            sustain_start_ms=sustain_start_ms,
            sustain_end_ms=sustain_end_ms,
            release_start_ms=(release_start_ms if release_start_ms < end_ms else None),
            release_end_ms=(end_ms if release_start_ms < end_ms else None),
        )
    )


def _segment_reference_notes(track: Track) -> list[ReferenceNote]:
    payload = get_track_frame_pitch_data(track)
    if payload is None:
        return []

    notes: list[ReferenceNote] = []
    current_frames: list[object] = []
    previous_end_ms: int | None = None

    for frame in payload.frames:
        if not frame.voiced or frame.frequency_hz is None:
            if current_frames and previous_end_ms is not None and frame.start_ms - previous_end_ms > NOTE_GAP_MS:
                _flush_reference_note(notes, current_frames)
                current_frames = []
                previous_end_ms = None
            continue

        if not current_frames:
            current_frames = [frame]
            previous_end_ms = frame.end_ms
            continue

        current_frequencies = [
            float(item.frequency_hz)
            for item in current_frames
            if getattr(item, "frequency_hz", None) is not None
        ]
        current_target = float(np.median(np.asarray(current_frequencies, dtype=np.float32))) if current_frequencies else float(frame.frequency_hz)
        cents_distance = abs(_cents_delta(float(frame.frequency_hz), current_target))
        gap_ms = frame.start_ms - (previous_end_ms or frame.start_ms)

        if gap_ms > NOTE_GAP_MS or cents_distance > NOTE_SPLIT_CENTS:
            _flush_reference_note(notes, current_frames)
            current_frames = [frame]
        else:
            current_frames.append(frame)

        previous_end_ms = frame.end_ms

    _flush_reference_note(notes, current_frames)
    return notes


def _collect_shifted_take_frames(track: Track, offset_ms: int) -> list[ShiftedPitchFrame]:
    payload = get_track_frame_pitch_data(track)
    if payload is None:
        return []

    shifted_frames: list[ShiftedPitchFrame] = []
    for frame in payload.frames:
        if not frame.voiced or frame.frequency_hz is None:
            continue

        shifted_frames.append(
            ShiftedPitchFrame(
                start_ms=frame.start_ms + offset_ms,
                end_ms=frame.end_ms + offset_ms,
                frequency_hz=float(frame.frequency_hz),
                pitch_midi=frame.pitch_midi,
                voiced_prob=frame.voiced_prob,
                rms=frame.rms,
            )
        )

    return shifted_frames


def _frames_in_window(
    frames: list[ShiftedPitchFrame],
    start_ms: int | None,
    end_ms: int | None,
) -> list[ShiftedPitchFrame]:
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        return []

    return [
        frame
        for frame in frames
        if frame.end_ms > start_ms and frame.start_ms < end_ms
    ]


def _build_note_message(
    attack_signed_cents: float | None,
    sustain_median_cents: float | None,
    sustain_mad_cents: float | None,
    timing_offset_ms: int | None,
    note_score: float,
) -> str:
    if attack_signed_cents is None and sustain_median_cents is None:
        return "Stable voiced pitch was not detected clearly for this note."
    if attack_signed_cents is not None and abs(attack_signed_cents) >= 25 and sustain_median_cents is not None and abs(sustain_median_cents) <= 12:
        return (
            "Started sharp but settled near center."
            if attack_signed_cents > 0
            else "Started flat but settled near center."
        )
    if sustain_median_cents is not None and sustain_median_cents >= 20:
        return "Sustain stays sharp of the target center."
    if sustain_median_cents is not None and sustain_median_cents <= -20:
        return "Sustain stays flat of the target center."
    if sustain_mad_cents is not None and sustain_mad_cents >= 18:
        return "Pitch center is close, but the sustain wobbles too widely."
    if timing_offset_ms is not None and timing_offset_ms >= 80:
        return "Pitch is close, but the note enters late."
    if timing_offset_ms is not None and timing_offset_ms <= -80:
        return "Pitch is close, but the note enters early."
    if note_score >= 85:
        return "Attack and sustain stay close to the target."
    return "This note is close overall, but the center can settle more cleanly."


def _build_note_feedback_items(
    guide_track: Track,
    take_track: Track,
    offset_ms: int,
) -> list[NoteFeedbackItemResponse]:
    reference_notes = _segment_reference_notes(guide_track)
    take_frames = _collect_shifted_take_frames(take_track, offset_ms)
    if not reference_notes or not take_frames:
        return []

    note_feedback_items: list[NoteFeedbackItemResponse] = []

    for note in reference_notes:
        note_frames = _frames_in_window(take_frames, note.start_ms, note.end_ms)
        attack_frames = _frames_in_window(take_frames, note.attack_start_ms, note.attack_end_ms)
        sustain_frames = _frames_in_window(take_frames, note.sustain_start_ms, note.sustain_end_ms)
        if not sustain_frames:
            sustain_frames = note_frames

        all_deltas = [_cents_delta(frame.frequency_hz, note.target_frequency_hz) for frame in note_frames]
        attack_deltas = [_cents_delta(frame.frequency_hz, note.target_frequency_hz) for frame in attack_frames]
        sustain_deltas = [_cents_delta(frame.frequency_hz, note.target_frequency_hz) for frame in sustain_frames]

        attack_signed_cents = _median(attack_deltas) or _median(all_deltas)
        sustain_median_cents = _median(sustain_deltas) or _median(all_deltas)
        sustain_mad_cents = _mad(sustain_deltas, sustain_median_cents)
        max_sharp_cents = max((delta for delta in all_deltas if delta > 0), default=None)
        max_flat_cents = min((delta for delta in all_deltas if delta < 0), default=None)
        in_tune_ratio = (
            sum(1 for delta in all_deltas if abs(delta) <= DEFAULT_IN_TUNE_CENTS) / len(all_deltas)
            if all_deltas
            else None
        )
        first_take_frame = min(note_frames, key=lambda frame: frame.start_ms, default=None)
        timing_offset_ms = (
            int(first_take_frame.start_ms - note.start_ms)
            if first_take_frame is not None
            else None
        )
        voiced_probs = [frame.voiced_prob for frame in note_frames if frame.voiced_prob is not None]
        confidence = float(
            np.clip(
                (float(np.mean(voiced_probs)) if voiced_probs else 0.0)
                * (len(note_frames) / max(1, len(_frames_in_window(take_frames, note.start_ms - NOTE_GAP_MS, note.end_ms + NOTE_GAP_MS)))),
                0.0,
                1.0,
            )
        ) if note_frames else 0.0

        attack_score = _pitch_score_curve(attack_signed_cents, ATTACK_SCORE_SCALE_CENTS)
        sustain_score = _pitch_score_curve(sustain_median_cents, SUSTAIN_SCORE_SCALE_CENTS)
        stability_base = 100.0 if sustain_mad_cents is None else max(
            0.0,
            (1 - min(sustain_mad_cents / STABILITY_SCORE_SCALE_CENTS, 1.0)) * 100,
        )
        in_tune_component = (in_tune_ratio * 100) if in_tune_ratio is not None else 0.0
        stability_score = (stability_base * 0.5) + (in_tune_component * 0.5)
        timing_score = _timing_score_curve(timing_offset_ms)
        note_score = (
            (attack_score * 0.25)
            + (sustain_score * 0.55)
            + (stability_score * 0.10)
            + (timing_score * 0.10)
        )
        message = _build_note_message(
            attack_signed_cents,
            sustain_median_cents,
            sustain_mad_cents,
            timing_offset_ms,
            note_score,
        )

        note_feedback_items.append(
            NoteFeedbackItemResponse(
                note_index=note.note_index,
                start_ms=note.start_ms,
                end_ms=note.end_ms,
                target_midi=note.target_midi,
                target_frequency_hz=note.target_frequency_hz,
                attack_start_ms=note.attack_start_ms,
                attack_end_ms=note.attack_end_ms,
                settle_start_ms=note.settle_start_ms,
                settle_end_ms=note.settle_end_ms,
                sustain_start_ms=note.sustain_start_ms,
                sustain_end_ms=note.sustain_end_ms,
                release_start_ms=note.release_start_ms,
                release_end_ms=note.release_end_ms,
                timing_offset_ms=timing_offset_ms,
                attack_signed_cents=_round_or_none(attack_signed_cents),
                sustain_median_cents=_round_or_none(sustain_median_cents),
                sustain_mad_cents=_round_or_none(sustain_mad_cents),
                max_sharp_cents=_round_or_none(max_sharp_cents),
                max_flat_cents=_round_or_none(max_flat_cents),
                in_tune_ratio=_round_or_none(in_tune_ratio, 4),
                confidence=round(confidence, 4),
                attack_score=round(attack_score, 2),
                sustain_score=round(sustain_score, 2),
                stability_score=round(stability_score, 2),
                timing_score=round(timing_score, 2),
                note_score=round(note_score, 2),
                message=message,
            )
        )

    return note_feedback_items


def _calculate_note_pitch_score(note_feedback_items: list[NoteFeedbackItemResponse]) -> float:
    if not note_feedback_items:
        return 0.0

    weighted_scores = []
    total_weight = 0.0
    for item in note_feedback_items:
        duration_weight = max(1, item.end_ms - item.start_ms)
        confidence_weight = max(0.25, item.confidence)
        weight = duration_weight * confidence_weight
        weighted_scores.append(item.note_score * weight)
        total_weight += weight

    if total_weight <= 0:
        return round(float(np.mean([item.note_score for item in note_feedback_items])), 2)

    return round(float(sum(weighted_scores) / total_weight), 2)


def _build_note_event_payload(
    note_feedback_items: list[NoteFeedbackItemResponse],
    alignment_offset_ms: int,
) -> NoteEventArtifactPayload:
    return NoteEventArtifactPayload(
        version=NOTE_EVENT_ARTIFACT_VERSION,
        quality_mode=NOTE_EVENT_QUALITY_MODE,
        alignment_offset_ms=alignment_offset_ms,
        note_count=len(note_feedback_items),
        notes=note_feedback_items,
    )


def _write_model_json(path: Path, payload: NoteEventArtifactPayload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        payload.model_dump_json(indent=2),
        encoding="utf-8",
    )


def _score_pitch_pairs(pairs: list[tuple[float, float]]) -> float:
    if not pairs:
        return 0.0

    scores: list[float] = []
    for guide_frequency, take_frequency in pairs:
        cents_difference = abs(1200 * log2(take_frequency / guide_frequency))
        scores.append(float(np.exp(-((cents_difference / 70) ** 2)) * 100))

    return round(float(np.mean(scores)), 2)


def _score_rhythm(
    guide_envelope: np.ndarray,
    take_envelope: np.ndarray,
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
) -> float:
    aligned_guide, aligned_take = _align_numeric_arrays(
        guide_envelope,
        take_envelope,
        offset_ms,
        guide_duration_ms,
        take_duration_ms,
    )
    if aligned_guide.size == 0 or aligned_take.size == 0:
        return 0.0

    mean_difference = float(np.mean(np.abs(aligned_guide - aligned_take)))
    return round(float(np.clip((1 - mean_difference) * 100, 0, 100)), 2)


def _normalize_key_name(value: str | None) -> str | None:
    if not value:
        return None

    cleaned = value.strip().upper().replace(" ", "")
    if not cleaned:
        return None

    if len(cleaned) >= 2 and cleaned[1] in {"B", "#"}:
        return cleaned[:2]

    return cleaned[:1]


def _score_harmony_fit(project: Project, take_contour: list[float | None]) -> float:
    key_name = _normalize_key_name(project.base_key)
    if key_name is None or key_name not in NOTE_TO_PITCH_CLASS:
        return 0.0

    tonic_pitch_class = NOTE_TO_PITCH_CLASS[key_name]
    voiced_pitch_classes: list[int] = []
    for frequency in take_contour:
        if frequency is None or frequency <= 0:
            continue

        midi_value = int(round(69 + (12 * log2(frequency / 440.0))))
        voiced_pitch_classes.append(midi_value % 12)

    if not voiced_pitch_classes:
        return 0.0

    in_key_count = sum(
        1
        for pitch_class in voiced_pitch_classes
        if ((pitch_class - tonic_pitch_class) % 12) in MAJOR_SCALE_INTERVALS
    )
    return round((in_key_count / len(voiced_pitch_classes)) * 100, 2)


def _blend_harmony_score(project: Project, raw_harmony_score: float, pitch_score: float, rhythm_score: float) -> float:
    if raw_harmony_score > 0:
        return raw_harmony_score

    return round(((pitch_score * 0.65) + (rhythm_score * 0.35)), 2)


def _score_segment_message(pitch_score: float, rhythm_score: float, harmony_score: float) -> str:
    if pitch_score < 55 and rhythm_score < 55:
        return "Pitch center and timing both drift in this phrase. Re-enter from the guide count and narrow the note target."
    if pitch_score < 60:
        return "Pitch wanders away from the guide here. Hold the center tone longer before moving to the next note."
    if rhythm_score < 60:
        return "Timing slips in this phrase. Aim the consonant and note attack closer to the guide pulse."
    if harmony_score < 60:
        return "The line leaves the project key here. Check the target note before the next entrance."

    return "This phrase stays close to the guide in pitch and timing."


def _build_feedback_items(
    pitch_pairs: list[tuple[float, float]],
    guide_envelope: np.ndarray,
    take_envelope: np.ndarray,
    take_contour: list[float | None],
    project: Project,
    offset_ms: int,
    guide_duration_ms: int,
    take_duration_ms: int,
    alignment_confidence: float,
) -> list[dict[str, object]]:
    aligned_guide_envelope, aligned_take_envelope = _align_numeric_arrays(
        guide_envelope,
        take_envelope,
        offset_ms,
        guide_duration_ms,
        take_duration_ms,
    )
    segment_length = max(1, len(aligned_guide_envelope) // SEGMENT_COUNT) if aligned_guide_envelope.size else 1
    segment_duration_ms = max(1, take_duration_ms // SEGMENT_COUNT)
    feedback_items: list[dict[str, object]] = []

    guide_contour = [pair[0] for pair in pitch_pairs]
    take_contour_aligned = [pair[1] for pair in pitch_pairs]
    pitch_segment_length = max(1, len(pitch_pairs) // SEGMENT_COUNT) if pitch_pairs else 1

    for segment_index in range(SEGMENT_COUNT):
        pitch_start = segment_index * pitch_segment_length
        pitch_end = len(pitch_pairs) if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * pitch_segment_length
        segment_pitch_pairs = list(zip(guide_contour[pitch_start:pitch_end], take_contour_aligned[pitch_start:pitch_end], strict=False))
        segment_pitch_score = _score_pitch_pairs(segment_pitch_pairs)

        envelope_start = segment_index * segment_length
        envelope_end = len(aligned_guide_envelope) if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * segment_length
        segment_rhythm_score = _score_rhythm(
            aligned_guide_envelope[envelope_start:envelope_end],
            aligned_take_envelope[envelope_start:envelope_end],
            0,
            guide_duration_ms,
            take_duration_ms,
        )

        contour_start = segment_index * max(1, len(take_contour) // SEGMENT_COUNT)
        contour_end = len(take_contour) if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * max(1, len(take_contour) // SEGMENT_COUNT)
        segment_harmony_raw = _score_harmony_fit(project, take_contour[contour_start:contour_end])
        segment_harmony_score = _blend_harmony_score(
            project,
            segment_harmony_raw,
            segment_pitch_score,
            segment_rhythm_score,
        )

        message = _score_segment_message(segment_pitch_score, segment_rhythm_score, segment_harmony_score)
        if segment_index == 0 and alignment_confidence < 0.45:
            message = "Alignment confidence is low, so treat this phrase as a coarse guide and verify the attack timing manually."

        feedback_items.append(
            {
                "segment_index": segment_index,
                "start_ms": segment_index * segment_duration_ms,
                "end_ms": take_duration_ms if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * segment_duration_ms,
                "pitch_score": round(segment_pitch_score, 2),
                "rhythm_score": round(segment_rhythm_score, 2),
                "harmony_fit_score": round(segment_harmony_score, 2),
                "message": message,
            }
        )

    return feedback_items


def _build_feedback_items_from_notes(
    note_feedback_items: list[NoteFeedbackItemResponse],
    take_duration_ms: int,
    harmony_fit_score: float,
    alignment_confidence: float,
) -> list[dict[str, object]]:
    if not note_feedback_items:
        return []

    segment_duration_ms = max(1, take_duration_ms // SEGMENT_COUNT)
    feedback_items: list[dict[str, object]] = []

    for segment_index in range(SEGMENT_COUNT):
        segment_start = segment_index * segment_duration_ms
        segment_end = take_duration_ms if segment_index == SEGMENT_COUNT - 1 else (segment_index + 1) * segment_duration_ms
        segment_notes = [
            item
            for item in note_feedback_items
            if item.end_ms > segment_start and item.start_ms < segment_end
        ]

        if not segment_notes:
            message = (
                "Alignment confidence is low, so treat this phrase as a coarse guide and verify the attack timing manually."
                if segment_index == 0 and alignment_confidence < 0.45
                else "No stable note event was detected clearly in this phrase."
            )
            feedback_items.append(
                {
                    "segment_index": segment_index,
                    "start_ms": segment_start,
                    "end_ms": segment_end,
                    "pitch_score": 0.0,
                    "rhythm_score": 0.0,
                    "harmony_fit_score": round(harmony_fit_score, 2),
                    "message": message,
                }
            )
            continue

        pitch_score = round(float(np.mean([item.note_score for item in segment_notes])), 2)
        rhythm_score = round(float(np.mean([item.timing_score for item in segment_notes])), 2)
        lowest_note = min(segment_notes, key=lambda item: item.note_score)
        message = lowest_note.message
        if segment_index == 0 and alignment_confidence < 0.45:
            message = "Alignment confidence is low, so treat this phrase as a coarse guide and verify the attack timing manually."

        feedback_items.append(
            {
                "segment_index": segment_index,
                "start_ms": segment_start,
                "end_ms": segment_end,
                "pitch_score": pitch_score,
                "rhythm_score": rhythm_score,
                "harmony_fit_score": round(harmony_fit_score, 2),
                "message": message,
            }
        )

    return feedback_items


def _calculate_total_score(pitch_score: float, rhythm_score: float, harmony_fit_score: float) -> float:
    total = (pitch_score * 0.45) + (rhythm_score * 0.35) + (harmony_fit_score * 0.20)
    return round(total, 2)


def _compute_analysis(project: Project, guide_track: Track, take_track: Track) -> AnalysisComputation:
    guide_preview = get_track_preview_data(guide_track)
    take_preview = get_track_preview_data(take_track)
    if guide_preview is None or take_preview is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Guide and take previews must exist before running analysis.",
        )

    guide_samples, guide_sample_rate = _read_canonical_samples(guide_track)
    take_samples, take_sample_rate = _read_canonical_samples(take_track)
    guide_envelope = build_onset_envelope(guide_samples, guide_sample_rate, hop_length=ONSET_HOP_LENGTH)
    take_envelope = build_onset_envelope(take_samples, take_sample_rate, hop_length=ONSET_HOP_LENGTH)
    frame_ms = max(1, round((ONSET_HOP_LENGTH / max(1, guide_sample_rate)) * 1000))
    alignment_offset_ms, alignment_confidence = _calculate_alignment(
        guide_envelope,
        take_envelope,
        frame_ms,
    )

    note_feedback_items = _build_note_feedback_items(
        guide_track,
        take_track,
        alignment_offset_ms,
    )
    guide_frame_pitch_sequence = _frame_pitch_sequence(guide_track)
    take_frame_pitch_sequence = _frame_pitch_sequence(take_track)
    guide_pitch_sequence = guide_frame_pitch_sequence
    take_pitch_sequence = take_frame_pitch_sequence
    if guide_pitch_sequence is None:
        guide_pitch_sequence = guide_preview.contour
    if take_pitch_sequence is None:
        take_pitch_sequence = take_preview.contour
    if note_feedback_items:
        pitch_quality_mode = NOTE_EVENT_QUALITY_MODE
    elif guide_frame_pitch_sequence is not None and take_frame_pitch_sequence is not None:
        pitch_quality_mode = FRAME_PITCH_QUALITY_MODE
    else:
        guide_pitch_sequence = guide_preview.contour
        take_pitch_sequence = take_preview.contour
        pitch_quality_mode = COARSE_CONTOUR_QUALITY_MODE

    if note_feedback_items:
        pitch_pairs: list[tuple[float, float]] = []
        pitch_score = _calculate_note_pitch_score(note_feedback_items)
    else:
        pitch_pairs = _align_pitch_sequences(
            guide_pitch_sequence,
            take_pitch_sequence,
            alignment_offset_ms,
            guide_preview.duration_ms or guide_track.duration_ms or 0,
            take_preview.duration_ms or take_track.duration_ms or 0,
        )
        pitch_score = _score_pitch_pairs(pitch_pairs)
    rhythm_score = _score_rhythm(
        guide_envelope,
        take_envelope,
        alignment_offset_ms,
        guide_preview.duration_ms or guide_track.duration_ms or 0,
        take_preview.duration_ms or take_track.duration_ms or 0,
    )
    harmony_reference_mode = HARMONY_REFERENCE_MODE_KEY_ONLY
    harmony_raw = _score_harmony_fit(project, take_pitch_sequence)
    harmony_fit_score = _blend_harmony_score(project, harmony_raw, pitch_score, rhythm_score)
    feedback_items = (
        _build_feedback_items_from_notes(
            note_feedback_items,
            take_preview.duration_ms or take_track.duration_ms or 0,
            harmony_fit_score,
            alignment_confidence,
        )
        if note_feedback_items
        else _build_feedback_items(
            pitch_pairs,
            guide_envelope,
            take_envelope,
            take_pitch_sequence,
            project,
            alignment_offset_ms,
            guide_preview.duration_ms or guide_track.duration_ms or 0,
            take_preview.duration_ms or take_track.duration_ms or 0,
            alignment_confidence,
        )
    )
    note_event_payload = (
        _build_note_event_payload(note_feedback_items, alignment_offset_ms)
        if note_feedback_items
        else None
    )

    return AnalysisComputation(
        alignment_offset_ms=alignment_offset_ms,
        alignment_confidence=alignment_confidence,
        pitch_score=pitch_score,
        rhythm_score=rhythm_score,
        harmony_fit_score=harmony_fit_score,
        total_score=_calculate_total_score(pitch_score, rhythm_score, harmony_fit_score),
        pitch_quality_mode=pitch_quality_mode,
        harmony_reference_mode=harmony_reference_mode,
        feedback_items=feedback_items,
        note_feedback_items=note_feedback_items,
        note_event_payload=note_event_payload,
    )


def _get_track_with_analysis(session: Session, track_id: UUID) -> Track | None:
    result = session.execute(
        select(Track)
        .execution_options(populate_existing=True)
        .options(
            joinedload(Track.artifacts),
            joinedload(Track.analysis_jobs),
            joinedload(Track.scores),
        )
        .where(Track.track_id == track_id)
    )
    return result.unique().scalars().first()


def _get_project_or_404(session: Session, project_id: UUID) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return project


def _get_track_or_404(session: Session, track_id: UUID) -> Track:
    track = _get_track_with_analysis(session, track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return track


def _get_analysis_job_or_404(session: Session, job_id: UUID) -> AnalysisJob:
    job = session.get(AnalysisJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis job not found")

    return job


def _get_latest_guide_track(session: Session, project_id: UUID) -> Track:
    guide_track = (
        session.execute(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(
            Track.project_id == project_id,
            Track.track_role == TrackRole.GUIDE,
            Track.track_status == TrackStatus.READY,
        )
        .order_by(Track.updated_at.desc())
        .limit(1)
        )
        .unique()
        .scalars()
        .first()
    )
    if guide_track is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A READY guide track is required before analysis can run.",
        )

    return guide_track


def get_latest_analysis_job(track: Track) -> AnalysisJob | None:
    if not track.analysis_jobs:
        return None

    return max(track.analysis_jobs, key=lambda item: item.requested_at)


def get_latest_score(track: Track) -> Score | None:
    if not track.scores:
        return None

    return max(track.scores, key=lambda item: item.created_at)


def build_analysis_job_response(job: AnalysisJob) -> AnalysisJobResponse:
    return AnalysisJobResponse(
        job_id=job.job_id,
        project_id=job.project_id,
        track_id=job.track_id,
        job_type=job.job_type.value,
        status=job.status.value,
        model_version=job.model_version,
        requested_at=job.requested_at,
        finished_at=job.finished_at,
        error_message=job.error_message,
    )


def build_track_score_response(score: Score, track: Track | None = None) -> TrackScoreResponse:
    raw_feedback = score.feedback_json if isinstance(score.feedback_json, list) else []
    feedback_items = [AnalysisFeedbackItemResponse.model_validate(item) for item in raw_feedback]
    note_feedback_items = []
    if track is not None:
        note_payload = get_track_note_events_data(track)
        if note_payload is not None:
            note_feedback_items = list(note_payload.notes)

    return TrackScoreResponse(
        score_id=score.score_id,
        project_id=score.project_id,
        track_id=score.track_id,
        pitch_score=round(score.pitch_score, 2),
        rhythm_score=round(score.rhythm_score, 2),
        harmony_fit_score=round(score.harmony_fit_score, 2),
        total_score=round(score.total_score, 2),
        pitch_quality_mode=score.pitch_quality_mode,
        harmony_reference_mode=score.harmony_reference_mode,
        feedback_json=feedback_items,
        note_feedback_json=note_feedback_items,
        created_at=score.created_at,
        updated_at=score.updated_at,
    )


def build_track_frame_pitch_response(track: Track) -> TrackFramePitchResponse:
    artifact = get_track_frame_pitch_artifact(track)
    payload = get_track_frame_pitch_data(track)
    if artifact is None or payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track frame-pitch artifact has not been created yet.",
        )

    return TrackFramePitchResponse(
        artifact_id=artifact.artifact_id,
        track_id=track.track_id,
        project_id=track.project_id,
        artifact_type=artifact.artifact_type.value,
        payload=payload,
        created_at=artifact.created_at,
        updated_at=artifact.updated_at,
    )


def build_track_note_events_response(track: Track) -> TrackNoteEventsResponse:
    artifact = get_track_note_events_artifact(track)
    payload = get_track_note_events_data(track)
    if artifact is None or payload is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track note-events artifact has not been created yet.",
        )

    return TrackNoteEventsResponse(
        artifact_id=artifact.artifact_id,
        track_id=track.track_id,
        project_id=track.project_id,
        artifact_type=artifact.artifact_type.value,
        payload=payload,
        created_at=artifact.created_at,
        updated_at=artifact.updated_at,
    )


def build_track_analysis_response(track: Track, guide_track_id: UUID) -> TrackAnalysisResponse:
    latest_job = get_latest_analysis_job(track)
    latest_score = get_latest_score(track)
    if latest_job is None or latest_score is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track analysis has not been created yet.",
        )

    return TrackAnalysisResponse(
        track_id=track.track_id,
        project_id=track.project_id,
        guide_track_id=guide_track_id,
        alignment_offset_ms=track.alignment_offset_ms,
        alignment_confidence=track.alignment_confidence,
        latest_job=build_analysis_job_response(latest_job),
        latest_score=build_track_score_response(latest_score, track),
    )


def run_track_analysis(session: Session, project_id: UUID, track_id: UUID) -> TrackAnalysisResponse:
    settings = get_settings()
    project = _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project.project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")
    if track.track_role != TrackRole.VOCAL_TAKE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only vocal takes can be analyzed")
    if track.track_status != TrackStatus.READY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track must be READY before analysis")

    guide_track = _get_latest_guide_track(session, project_id)
    requested_at = datetime.now(timezone.utc)
    job = AnalysisJob(
        project_id=project.project_id,
        track_id=track.track_id,
        job_type=AnalysisJobType.POST_RECORDING_SCORE,
        status=AnalysisJobStatus.RUNNING,
        model_version=ANALYSIS_MODEL_VERSION,
        requested_at=requested_at,
    )
    session.add(job)
    session.commit()

    try:
        started_at = perf_counter()
        track = _get_track_or_404(session, track_id)
        guide_track = _get_latest_guide_track(session, project_id)
        computation = _compute_analysis(project, guide_track, track)
        if settings.analysis_timeout_seconds > 0:
            elapsed_seconds = perf_counter() - started_at
            if elapsed_seconds > settings.analysis_timeout_seconds:
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail=(
                        "Analysis exceeded the timeout policy. Retry the job or reduce the input length."
                    ),
                )
        finished_at = datetime.now(timezone.utc)

        track.alignment_offset_ms = computation.alignment_offset_ms
        track.alignment_confidence = computation.alignment_confidence
        track.updated_at = finished_at

        note_events_artifact = get_track_note_events_artifact(track)
        if computation.note_event_payload is not None:
            derived_root = _get_storage_root() / "projects" / str(track.project_id) / "derived"
            note_events_path = derived_root / f"{track.track_id}-note-events.json"
            _write_model_json(note_events_path, computation.note_event_payload)

            if note_events_artifact is None:
                note_events_artifact = Artifact(
                    project_id=track.project_id,
                    track=track,
                    artifact_type=ArtifactType.NOTE_EVENTS,
                    storage_key=str(note_events_path),
                    created_at=finished_at,
                    updated_at=finished_at,
                )
                session.add(note_events_artifact)

            note_events_artifact.storage_key = str(note_events_path)
            note_events_artifact.mime_type = "application/json"
            note_events_artifact.byte_size = note_events_path.stat().st_size
            note_events_artifact.updated_at = finished_at
            note_events_artifact.meta_json = {
                "artifact_version": computation.note_event_payload.version,
                "quality_mode": computation.note_event_payload.quality_mode,
                "alignment_offset_ms": computation.note_event_payload.alignment_offset_ms,
                "note_count": computation.note_event_payload.note_count,
            }
        elif note_events_artifact is not None:
            session.delete(note_events_artifact)

        score = Score(
            project_id=track.project_id,
            track_id=track.track_id,
            pitch_score=computation.pitch_score,
            rhythm_score=computation.rhythm_score,
            harmony_fit_score=computation.harmony_fit_score,
            total_score=computation.total_score,
            pitch_quality_mode=computation.pitch_quality_mode,
            harmony_reference_mode=computation.harmony_reference_mode,
            feedback_json=computation.feedback_items,
            created_at=finished_at,
            updated_at=finished_at,
        )
        session.add(score)

        job = session.get(AnalysisJob, job.job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Analysis job was lost")

        job.status = AnalysisJobStatus.SUCCEEDED
        job.finished_at = finished_at
        job.error_message = None

        session.commit()
    except HTTPException as error:
        failed_job = session.get(AnalysisJob, job.job_id)
        if failed_job is not None:
            failed_job.status = AnalysisJobStatus.FAILED
            failed_job.finished_at = datetime.now(timezone.utc)
            failed_job.error_message = error.detail if isinstance(error.detail, str) else "Analysis failed"
            session.commit()
        raise
    except Exception as error:
        failed_job = session.get(AnalysisJob, job.job_id)
        if failed_job is not None:
            failed_job.status = AnalysisJobStatus.FAILED
            failed_job.finished_at = datetime.now(timezone.utc)
            failed_job.error_message = str(error)
            session.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected analysis failure",
        ) from error

    refreshed_track = _get_track_or_404(session, track_id)
    return build_track_analysis_response(refreshed_track, guide_track.track_id)


def get_track_analysis(session: Session, project_id: UUID, track_id: UUID) -> TrackAnalysisResponse:
    _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")

    guide_track = _get_latest_guide_track(session, project_id)
    return build_track_analysis_response(track, guide_track.track_id)


def get_track_frame_pitch(session: Session, project_id: UUID, track_id: UUID) -> TrackFramePitchResponse:
    _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")

    return build_track_frame_pitch_response(track)


def get_track_note_events(session: Session, project_id: UUID, track_id: UUID) -> TrackNoteEventsResponse:
    _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")

    return build_track_note_events_response(track)


def retry_analysis_job(session: Session, job_id: UUID) -> TrackAnalysisResponse:
    job = _get_analysis_job_or_404(session, job_id)
    if job.status != AnalysisJobStatus.FAILED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only FAILED analysis jobs can be retried.",
        )

    return run_track_analysis(session, job.project_id, job.track_id)
