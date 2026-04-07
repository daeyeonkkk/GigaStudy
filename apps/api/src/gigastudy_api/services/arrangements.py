from dataclasses import dataclass
from datetime import datetime, timezone
from math import log2
from pathlib import Path
import struct
from uuid import UUID, uuid4

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.arrangements import (
    ArrangementCandidateResponse,
    ArrangementGenerateRequest,
    ArrangementGenerateResponse,
    ArrangementListResponse,
    ArrangementPartResponse,
    ArrangementUpdateRequest,
)
from gigastudy_api.api.schemas.melody import MelodyNoteResponse
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Arrangement, MelodyDraft, Project


PPQN = 480
NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
KEY_MAP = {
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
MAJOR_INTERVALS = {0, 2, 4, 5, 7, 9, 11}
MINOR_INTERVALS = {0, 2, 3, 5, 7, 8, 10}
MAX_LEAP_BY_DIFFICULTY = {
    "beginner": 7,
    "basic": 9,
    "strict": 5,
}


@dataclass(frozen=True)
class ArrangementNote:
    pitch_midi: int
    start_ms: int
    end_ms: int
    phrase_index: int
    velocity: int = 84

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms

    @property
    def pitch_name(self) -> str:
        octave = (self.pitch_midi // 12) - 1
        return f"{NOTE_NAMES_SHARP[self.pitch_midi % 12]}{octave}"

    def to_payload(self) -> dict[str, int | str]:
        return {
            "pitch_midi": self.pitch_midi,
            "pitch_name": self.pitch_name,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "duration_ms": self.duration_ms,
            "phrase_index": self.phrase_index,
            "velocity": self.velocity,
        }


@dataclass(frozen=True)
class VoiceSpec:
    part_name: str
    role: str
    range_label: str
    min_pitch: int
    max_pitch: int
    preferred_offsets: tuple[int, ...]
    is_melody: bool = False
    is_percussion: bool = False


@dataclass(frozen=True)
class CandidateSpec:
    candidate_code: str
    title: str
    voice_mode: str
    voices: tuple[VoiceSpec, ...]


CANDIDATE_SPECS = (
    CandidateSpec(
        candidate_code="A",
        title="Close Stack",
        voice_mode="FOUR_PART_CLOSE",
        voices=(
            VoiceSpec("Lead Melody", "MELODY", "Source melody", 36, 96, (0,), is_melody=True),
            VoiceSpec("High Harmony", "HARMONY", "G3-E5", 55, 76, (-3, -4, -5, -7)),
            VoiceSpec("Mid Harmony", "HARMONY", "C3-C5", 48, 72, (-7, -8, -9, -12)),
            VoiceSpec("Bass", "BASS", "E2-C4", 40, 60, (-12, -15, -17, -19, -24)),
        ),
    ),
    CandidateSpec(
        candidate_code="B",
        title="Open Stack",
        voice_mode="FOUR_PART_OPEN",
        voices=(
            VoiceSpec("Lead Melody", "MELODY", "Source melody", 36, 96, (0,), is_melody=True),
            VoiceSpec("High Harmony", "HARMONY", "G3-E5", 55, 76, (-5, -7, -8, -10)),
            VoiceSpec("Low Harmony", "HARMONY", "A2-A4", 45, 69, (-10, -12, -14, -17)),
            VoiceSpec("Bass", "BASS", "E2-C4", 40, 60, (-17, -19, -24)),
        ),
    ),
    CandidateSpec(
        candidate_code="C",
        title="Five-Part Lift",
        voice_mode="FIVE_PART_STACK",
        voices=(
            VoiceSpec("Lead Melody", "MELODY", "Source melody", 36, 96, (0,), is_melody=True),
            VoiceSpec("Top Harmony", "HARMONY", "A3-F5", 57, 77, (-3, -4, -5)),
            VoiceSpec("Mid Harmony", "HARMONY", "F3-D5", 53, 74, (-6, -7, -8, -9)),
            VoiceSpec("Low Harmony", "HARMONY", "C3-A4", 48, 69, (-10, -12, -14)),
            VoiceSpec("Bass", "BASS", "E2-C4", 40, 60, (-17, -19, -24)),
        ),
    ),
)


def _get_storage_root() -> Path:
    settings = get_settings()
    return Path(settings.storage_root).resolve()


def _get_project_or_404(session: Session, project_id: UUID) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return project


def _get_melody_draft_or_404(session: Session, melody_draft_id: UUID) -> MelodyDraft:
    draft = session.get(MelodyDraft, melody_draft_id)
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Melody draft not found")

    return draft


def _get_arrangement_or_404(session: Session, arrangement_id: UUID) -> Arrangement:
    arrangement = session.get(Arrangement, arrangement_id)
    if arrangement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arrangement not found")

    return arrangement


def _normalize_key_name(value: str | None) -> tuple[int | None, set[int]]:
    if not value:
        return None, MAJOR_INTERVALS

    cleaned = value.strip().upper().replace(" ", "")
    is_minor = "MINOR" in cleaned
    cleaned = cleaned.replace("MAJOR", "").replace("MINOR", "")
    tonic = None
    if len(cleaned) >= 2 and cleaned[:2] in KEY_MAP:
        tonic = KEY_MAP[cleaned[:2]]
    elif cleaned[:1] in KEY_MAP:
        tonic = KEY_MAP[cleaned[:1]]

    return tonic, MINOR_INTERVALS if is_minor else MAJOR_INTERVALS


def _note_is_in_key(pitch_midi: int, tonic: int | None, scale_intervals: set[int]) -> bool:
    if tonic is None:
        return True

    return ((pitch_midi - tonic) % 12) in scale_intervals


def _sign(value: int) -> int:
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _build_note_objects(notes_json: list[dict] | dict) -> list[ArrangementNote]:
    if not isinstance(notes_json, list):
        return []

    notes: list[ArrangementNote] = []
    for item in notes_json:
        notes.append(
            ArrangementNote(
                pitch_midi=int(item["pitch_midi"]),
                start_ms=int(item["start_ms"]),
                end_ms=int(item["end_ms"]),
                phrase_index=int(item.get("phrase_index", 0)),
                velocity=int(item.get("velocity", 84)),
            )
        )

    return sorted(notes, key=lambda note: (note.start_ms, note.pitch_midi))


def _candidate_pitches(spec: VoiceSpec, melody_pitch: int, upper_pitch: int | None) -> list[int]:
    pitches: set[int] = set()
    for offset in spec.preferred_offsets:
        base_pitch = melody_pitch + offset
        for octave_shift in (-24, -12, 0, 12):
            pitch = base_pitch + octave_shift
            if spec.min_pitch <= pitch <= spec.max_pitch:
                if upper_pitch is not None and pitch >= upper_pitch:
                    continue
                pitches.add(pitch)

    if not pitches:
        fallback = min(spec.max_pitch, melody_pitch - 2 if upper_pitch is None else upper_pitch - 2)
        fallback = max(spec.min_pitch, fallback)
        pitches.add(fallback)

    return sorted(pitches)


def _score_candidate_pitch(
    pitch: int,
    melody_pitch: int,
    previous_pitch: int | None,
    previous_melody_pitch: int | None,
    tonic: int | None,
    scale_intervals: set[int],
    max_leap: int,
) -> float:
    score = abs(melody_pitch - pitch) * 0.08
    if previous_pitch is not None:
        leap = abs(pitch - previous_pitch)
        score += leap * 0.2
        if leap > max_leap:
            score += (leap - max_leap) * 3.5

    if not _note_is_in_key(pitch, tonic, scale_intervals):
        score += 2.5

    if previous_pitch is not None and previous_melody_pitch is not None:
        previous_interval = abs(previous_melody_pitch - previous_pitch) % 12
        current_interval = abs(melody_pitch - pitch) % 12
        melody_motion = _sign(melody_pitch - previous_melody_pitch)
        part_motion = _sign(pitch - previous_pitch)
        if melody_motion == part_motion != 0 and previous_interval in {0, 7} and current_interval == previous_interval:
            score += 18

    return score


def _generate_support_part(
    melody_notes: list[ArrangementNote],
    spec: VoiceSpec,
    upper_part_notes: list[ArrangementNote] | None,
    tonic: int | None,
    scale_intervals: set[int],
    max_leap: int,
) -> list[ArrangementNote]:
    generated: list[ArrangementNote] = []

    for index, melody_note in enumerate(melody_notes):
        upper_pitch = upper_part_notes[index].pitch_midi if upper_part_notes else None
        candidate_pitches = _candidate_pitches(spec, melody_note.pitch_midi, upper_pitch)
        previous_pitch = generated[-1].pitch_midi if generated else None
        previous_melody_pitch = melody_notes[index - 1].pitch_midi if index > 0 else None
        best_pitch = min(
            candidate_pitches,
            key=lambda pitch: _score_candidate_pitch(
                pitch,
                melody_note.pitch_midi,
                previous_pitch,
                previous_melody_pitch,
                tonic,
                scale_intervals,
                max_leap,
            ),
        )
        generated.append(
            ArrangementNote(
                pitch_midi=best_pitch,
                start_ms=melody_note.start_ms,
                end_ms=melody_note.end_ms,
                phrase_index=melody_note.phrase_index,
                velocity=80,
            )
        )

    return generated


def _generate_percussion_part(melody_notes: list[ArrangementNote], bpm: int) -> list[ArrangementNote]:
    if not melody_notes:
        return []

    beat_ms = max(200, round(60000 / max(1, bpm)))
    end_ms = melody_notes[-1].end_ms
    notes: list[ArrangementNote] = []
    current_start = 0
    beat_index = 0
    while current_start < end_ms:
        pitch = 36 if beat_index % 4 in {0, 2} else 38
        note_end = min(end_ms, current_start + max(90, beat_ms // 2))
        notes.append(
            ArrangementNote(
                pitch_midi=pitch,
                start_ms=current_start,
                end_ms=note_end,
                phrase_index=0,
                velocity=96,
            )
        )
        current_start += beat_ms
        beat_index += 1

    return notes


def _build_candidate_parts(
    melody_notes: list[ArrangementNote],
    candidate_spec: CandidateSpec,
    include_percussion: bool,
    bpm: int,
    tonic: int | None,
    scale_intervals: set[int],
    max_leap: int,
) -> list[dict]:
    parts: list[dict] = []
    upper_part_notes: list[ArrangementNote] | None = None

    for spec in candidate_spec.voices:
        if spec.is_melody:
            current_part_notes = melody_notes
        else:
            current_part_notes = _generate_support_part(
                melody_notes,
                spec,
                upper_part_notes,
                tonic,
                scale_intervals,
                max_leap,
            )

        parts.append(
            {
                "part_name": spec.part_name,
                "role": spec.role,
                "range_label": spec.range_label,
                "notes": [note.to_payload() for note in current_part_notes],
            }
        )
        upper_part_notes = current_part_notes

    if include_percussion:
        parts.append(
            {
                "part_name": "Beatbox Template",
                "role": "PERCUSSION",
                "range_label": "Kick / snare pulse",
                "notes": [note.to_payload() for note in _generate_percussion_part(melody_notes, bpm)],
            }
        )

    return parts


def _encode_variable_length(value: int) -> bytes:
    buffer = [value & 0x7F]
    value >>= 7
    while value:
        buffer.insert(0, (value & 0x7F) | 0x80)
        value >>= 7

    return bytes(buffer)


def _build_midi_bytes(parts_json: list[dict], bpm: int) -> bytes:
    microseconds_per_quarter = max(1, round(60_000_000 / max(1, bpm)))
    beat_ms = 60000 / max(1, bpm)
    events: list[tuple[int, int, bytes]] = [
        (0, 0, bytes([0xFF, 0x51, 0x03]) + microseconds_per_quarter.to_bytes(3, "big"))
    ]

    for channel, part in enumerate(parts_json):
        notes = part.get("notes", [])
        midi_channel = channel % 16
        for item in notes:
            pitch_midi = int(item["pitch_midi"])
            start_tick = int(round((int(item["start_ms"]) / beat_ms) * PPQN))
            end_tick = max(start_tick + 1, int(round((int(item["end_ms"]) / beat_ms) * PPQN)))
            velocity = int(item.get("velocity", 84))
            events.append((start_tick, 1, bytes([0x90 | midi_channel, pitch_midi, velocity])))
            events.append((end_tick, 0, bytes([0x80 | midi_channel, pitch_midi, 0x00])))

    events.sort(key=lambda item: (item[0], item[1]))
    track_data = bytearray()
    previous_tick = 0
    for tick, _, payload in events:
        track_data.extend(_encode_variable_length(max(0, tick - previous_tick)))
        track_data.extend(payload)
        previous_tick = tick

    track_data.extend(_encode_variable_length(0))
    track_data.extend(b"\xFF\x2F\x00")

    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQN)
    track_chunk = b"MTrk" + struct.pack(">I", len(track_data)) + bytes(track_data)
    return header + track_chunk


def _write_arrangement_midi(path: Path, parts_json: list[dict], bpm: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    midi_bytes = _build_midi_bytes(parts_json, bpm)
    path.write_bytes(midi_bytes)
    return len(midi_bytes)


def _build_arrangement_response(arrangement: Arrangement, request: Request) -> ArrangementCandidateResponse:
    midi_artifact_url = (
        str(request.url_for("download_arrangement_midi", arrangement_id=str(arrangement.arrangement_id)))
        if arrangement.midi_storage_key
        else None
    )
    parts_json = arrangement.parts_json if isinstance(arrangement.parts_json, list) else []

    return ArrangementCandidateResponse(
        arrangement_id=arrangement.arrangement_id,
        generation_id=arrangement.generation_id,
        project_id=arrangement.project_id,
        melody_draft_id=arrangement.melody_draft_id,
        candidate_code=arrangement.candidate_code,
        title=arrangement.title,
        input_source_type=arrangement.input_source_type,
        style=arrangement.style,
        difficulty=arrangement.difficulty,
        voice_mode=arrangement.voice_mode,
        part_count=arrangement.part_count,
        constraint_json=arrangement.constraint_json,
        parts_json=parts_json,
        midi_artifact_url=midi_artifact_url,
        created_at=arrangement.created_at,
        updated_at=arrangement.updated_at,
    )


def build_arrangement_response(arrangement: Arrangement, request: Request) -> ArrangementCandidateResponse:
    return _build_arrangement_response(arrangement, request)


def _get_latest_generation_id(session: Session, project_id: UUID) -> UUID | None:
    latest_arrangement = session.scalar(
        select(Arrangement)
        .where(Arrangement.project_id == project_id)
        .order_by(Arrangement.updated_at.desc())
        .limit(1)
    )
    return latest_arrangement.generation_id if latest_arrangement else None


def list_latest_arrangements(session: Session, project_id: UUID) -> tuple[UUID | None, list[Arrangement]]:
    generation_id = _get_latest_generation_id(session, project_id)
    if generation_id is None:
        return None, []

    items = list(
        session.scalars(
            select(Arrangement)
            .where(Arrangement.project_id == project_id, Arrangement.generation_id == generation_id)
            .order_by(Arrangement.candidate_code.asc())
        ).all()
    )
    return generation_id, items


def list_arrangements_response(session: Session, project_id: UUID, request: Request) -> ArrangementListResponse:
    _get_project_or_404(session, project_id)
    generation_id, items = list_latest_arrangements(session, project_id)
    return ArrangementListResponse(
        generation_id=generation_id,
        items=[build_arrangement_response(item, request) for item in items],
    )


def generate_arrangements(
    session: Session,
    project_id: UUID,
    payload: ArrangementGenerateRequest,
    request: Request,
) -> ArrangementGenerateResponse:
    project = _get_project_or_404(session, project_id)
    melody_draft_id = payload.melody_draft_id
    if melody_draft_id is None:
        latest_draft = session.scalar(
            select(MelodyDraft)
            .where(MelodyDraft.project_id == project.project_id)
            .order_by(MelodyDraft.updated_at.desc())
            .limit(1)
        )
        if latest_draft is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Generate a melody draft before creating arrangements.",
            )
        melody_draft_id = latest_draft.melody_draft_id

    melody_draft = _get_melody_draft_or_404(session, melody_draft_id)
    if melody_draft.project_id != project.project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Melody draft does not match project")

    melody_notes = _build_note_objects(melody_draft.notes_json)
    if not melody_notes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Melody draft does not contain notes")

    generation_id = uuid4()
    difficulty_key = payload.difficulty.lower()
    max_leap = MAX_LEAP_BY_DIFFICULTY.get(difficulty_key, MAX_LEAP_BY_DIFFICULTY["basic"])
    tonic, scale_intervals = _normalize_key_name(melody_draft.key_estimate or project.base_key)
    bpm = melody_draft.bpm or project.bpm or 90
    now = datetime.now(timezone.utc)
    created_items: list[Arrangement] = []

    for candidate_spec in CANDIDATE_SPECS[: payload.candidate_count]:
        parts_json = _build_candidate_parts(
            melody_notes,
            candidate_spec,
            payload.include_percussion,
            bpm,
            tonic,
            scale_intervals,
            max_leap,
        )
        arrangement = Arrangement(
            generation_id=generation_id,
            project_id=project.project_id,
            melody_draft_id=melody_draft.melody_draft_id,
            candidate_code=candidate_spec.candidate_code,
            title=f"{candidate_spec.candidate_code} • {candidate_spec.title}",
            input_source_type="MELODY_DRAFT",
            style=payload.style,
            difficulty=payload.difficulty,
            voice_mode=candidate_spec.voice_mode,
            part_count=len(parts_json),
            constraint_json={
                "include_percussion": payload.include_percussion,
                "max_leap": max_leap,
                "parallel_avoidance": True,
                "source_key": melody_draft.key_estimate or project.base_key,
            },
            parts_json=parts_json,
            created_at=now,
            updated_at=now,
        )
        session.add(arrangement)
        session.flush()

        midi_path = (
            _get_storage_root()
            / "projects"
            / str(project.project_id)
            / "derived"
            / "arrangements"
            / f"{arrangement.arrangement_id}.mid"
        )
        arrangement.midi_storage_key = str(midi_path)
        arrangement.midi_byte_size = _write_arrangement_midi(midi_path, parts_json, bpm)
        created_items.append(arrangement)

    session.commit()
    return ArrangementGenerateResponse(
        generation_id=generation_id,
        items=[build_arrangement_response(item, request) for item in created_items],
    )


def update_arrangement(
    session: Session,
    arrangement_id: UUID,
    payload: ArrangementUpdateRequest,
    request: Request,
) -> ArrangementCandidateResponse:
    arrangement = _get_arrangement_or_404(session, arrangement_id)
    parts_json = [
        {
            "part_name": part.part_name,
            "role": part.role,
            "range_label": part.range_label,
            "notes": [
                {
                    "pitch_midi": note.pitch_midi,
                    "pitch_name": note.pitch_name,
                    "start_ms": note.start_ms,
                    "end_ms": note.end_ms,
                    "duration_ms": note.duration_ms,
                    "phrase_index": note.phrase_index,
                    "velocity": note.velocity,
                }
                for note in part.notes
            ],
        }
        for part in payload.parts_json
    ]
    if not parts_json:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="parts_json cannot be empty")

    arrangement.parts_json = parts_json
    arrangement.part_count = len(parts_json)
    arrangement.title = payload.title or arrangement.title
    arrangement.updated_at = datetime.now(timezone.utc)
    if arrangement.midi_storage_key:
        arrangement.midi_byte_size = _write_arrangement_midi(
            Path(arrangement.midi_storage_key),
            parts_json,
            arrangement.melody_draft.bpm or 90,
        )

    session.commit()
    session.refresh(arrangement)
    return build_arrangement_response(arrangement, request)


def get_arrangement_midi_path(session: Session, arrangement_id: UUID) -> Arrangement:
    arrangement = _get_arrangement_or_404(session, arrangement_id)
    if not arrangement.midi_storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arrangement MIDI is missing")

    midi_path = Path(arrangement.midi_storage_key)
    if not midi_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arrangement MIDI file not found")

    return arrangement
