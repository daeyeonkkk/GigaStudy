from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
import wave
from uuid import UUID

import numpy as np
from note_seq import midi_io
from note_seq.protobuf import music_pb2
from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.melody import MelodyDraftResponse, MelodyDraftUpdateRequest
from gigastudy_api.db.models import Artifact, ArtifactType, MelodyDraft, Project, Track, TrackRole, TrackStatus
from gigastudy_api.services.audio_features import PitchFrame, extract_pitch_frames
from gigastudy_api.services.storage import (
    build_project_storage_key,
    get_storage_backend,
)


MELODY_MODEL_VERSION = "librosa-pyin-melody-v2"
MIN_NOTE_MS = 80
REST_SPLIT_BEATS = 1.0
GRID_DIVISION = "1/16"
PPQN = 480
NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_INTERVALS = {0, 2, 4, 5, 7, 9, 11}
MINOR_INTERVALS = {0, 2, 3, 5, 7, 8, 10}


@dataclass
class MelodyNote:
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

def _get_project_or_404(session: Session, project_id: UUID) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return project


def _get_track_with_melody(session: Session, track_id: UUID) -> Track | None:
    result = session.execute(
        select(Track)
        .execution_options(populate_existing=True)
        .options(
            joinedload(Track.artifacts),
            joinedload(Track.melody_drafts),
        )
        .where(Track.track_id == track_id)
    )
    return result.unique().scalars().first()


def _get_track_or_404(session: Session, track_id: UUID) -> Track:
    track = _get_track_with_melody(session, track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return track


def _get_melody_draft_or_404(session: Session, melody_draft_id: UUID) -> MelodyDraft:
    draft = session.scalar(select(MelodyDraft).where(MelodyDraft.melody_draft_id == melody_draft_id))
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Melody draft not found")

    return draft


def _get_track_artifact(track: Track, artifact_type: ArtifactType) -> Artifact | None:
    for artifact in track.artifacts:
        if artifact.artifact_type == artifact_type:
            return artifact

    return None


def _read_canonical_samples(track: Track) -> tuple[np.ndarray, int]:
    canonical_artifact = _get_track_artifact(track, ArtifactType.CANONICAL_AUDIO)
    if canonical_artifact is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Canonical track audio is missing. Re-run upload processing first.",
        )

    try:
        canonical_bytes = get_storage_backend().read_bytes(canonical_artifact.storage_key)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Canonical track audio file is missing from storage.",
        )

    with wave.open(BytesIO(canonical_bytes), "rb") as wav_file:
        raw_frames = wav_file.readframes(wav_file.getnframes())
        sample_rate = wav_file.getframerate()
        samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32767.0

    return samples, sample_rate


def _extract_pitch_frames(samples: np.ndarray, sample_rate: int) -> list[PitchFrame]:
    return _smooth_pitch_frames(extract_pitch_frames(samples, sample_rate))


def _smooth_pitch_frames(frames: list[PitchFrame]) -> list[PitchFrame]:
    if len(frames) < 3:
        return frames

    smoothed = list(frames)
    for index in range(1, len(frames) - 1):
        prev_pitch = frames[index - 1].pitch_midi
        current_pitch = frames[index].pitch_midi
        next_pitch = frames[index + 1].pitch_midi

        if prev_pitch is not None and prev_pitch == next_pitch and current_pitch != prev_pitch:
            smoothed[index] = PitchFrame(
                start_ms=frames[index].start_ms,
                end_ms=frames[index].end_ms,
                frequency_hz=frames[index].frequency_hz,
                pitch_midi=prev_pitch,
            )

    return smoothed


def _merge_frame_notes(frames: list[PitchFrame]) -> list[MelodyNote]:
    notes: list[MelodyNote] = []
    current_pitch: int | None = None
    current_start_ms = 0
    current_end_ms = 0
    gap_frames = 0

    for frame in frames:
        if frame.pitch_midi is None:
            if current_pitch is not None:
                gap_frames += 1
                current_end_ms = frame.end_ms
            continue

        if current_pitch is None:
            current_pitch = frame.pitch_midi
            current_start_ms = frame.start_ms
            current_end_ms = frame.end_ms
            gap_frames = 0
            continue

        if frame.pitch_midi == current_pitch and gap_frames <= 1:
            current_end_ms = frame.end_ms
            gap_frames = 0
            continue

        if current_end_ms - current_start_ms >= MIN_NOTE_MS:
            notes.append(
                MelodyNote(
                    pitch_midi=current_pitch,
                    start_ms=current_start_ms,
                    end_ms=current_end_ms,
                    phrase_index=0,
                )
            )

        current_pitch = frame.pitch_midi
        current_start_ms = frame.start_ms
        current_end_ms = frame.end_ms
        gap_frames = 0

    if current_pitch is not None and current_end_ms - current_start_ms >= MIN_NOTE_MS:
        notes.append(
            MelodyNote(
                pitch_midi=current_pitch,
                start_ms=current_start_ms,
                end_ms=current_end_ms,
                phrase_index=0,
            )
        )

    return notes


def _quantize_notes(notes: list[MelodyNote], bpm: int) -> list[MelodyNote]:
    if not notes:
        return []

    beat_ms = 60000 / max(1, bpm)
    grid_ms = max(1, round(beat_ms / 4))
    quantized: list[MelodyNote] = []

    for note in notes:
        start_ms = round(note.start_ms / grid_ms) * grid_ms
        end_ms = max(start_ms + grid_ms, round(note.end_ms / grid_ms) * grid_ms)
        quantized.append(
            MelodyNote(
                pitch_midi=note.pitch_midi,
                start_ms=int(start_ms),
                end_ms=int(end_ms),
                phrase_index=0,
                velocity=note.velocity,
            )
        )

    merged: list[MelodyNote] = []
    for note in sorted(quantized, key=lambda item: (item.start_ms, item.pitch_midi)):
        if not merged:
            merged.append(note)
            continue

        previous = merged[-1]
        if previous.pitch_midi == note.pitch_midi and note.start_ms <= previous.end_ms + grid_ms:
            merged[-1] = MelodyNote(
                pitch_midi=previous.pitch_midi,
                start_ms=previous.start_ms,
                end_ms=max(previous.end_ms, note.end_ms),
                phrase_index=0,
                velocity=previous.velocity,
            )
            continue

        merged.append(note)

    return merged


def _assign_phrase_indexes(notes: list[MelodyNote], bpm: int) -> list[MelodyNote]:
    if not notes:
        return []

    beat_ms = 60000 / max(1, bpm)
    phrase_break_ms = beat_ms * REST_SPLIT_BEATS
    phrase_index = 0
    assigned: list[MelodyNote] = []
    previous_note: MelodyNote | None = None

    for note in notes:
        if previous_note and note.start_ms - previous_note.end_ms >= phrase_break_ms:
            phrase_index += 1

        assigned.append(
            MelodyNote(
                pitch_midi=note.pitch_midi,
                start_ms=note.start_ms,
                end_ms=note.end_ms,
                phrase_index=phrase_index,
                velocity=note.velocity,
            )
        )
        previous_note = note

    return assigned


def _note_payloads_to_objects(notes_payload: list[dict]) -> list[MelodyNote]:
    notes: list[MelodyNote] = []
    for item in notes_payload:
        notes.append(
            MelodyNote(
                pitch_midi=int(item["pitch_midi"]),
                start_ms=int(item["start_ms"]),
                end_ms=int(item["end_ms"]),
                phrase_index=int(item["phrase_index"]),
                velocity=int(item.get("velocity", 84)),
            )
        )

    return notes


def _estimate_key(notes: list[MelodyNote]) -> str | None:
    if not notes:
        return None

    pitch_class_weights = {index: 0 for index in range(12)}
    for note in notes:
        pitch_class_weights[note.pitch_midi % 12] += note.duration_ms

    best_name = None
    best_score = -1.0
    for pitch_class, name in enumerate(NOTE_NAMES_SHARP):
        major_score = sum(
            weight
            for candidate_pitch_class, weight in pitch_class_weights.items()
            if ((candidate_pitch_class - pitch_class) % 12) in MAJOR_INTERVALS
        )
        minor_score = sum(
            weight
            for candidate_pitch_class, weight in pitch_class_weights.items()
            if ((candidate_pitch_class - pitch_class) % 12) in MINOR_INTERVALS
        )

        if major_score > best_score:
            best_name = f"{name} major"
            best_score = float(major_score)
        if minor_score > best_score:
            best_name = f"{name} minor"
            best_score = float(minor_score)

    return best_name


def _build_note_sequence(notes: list[MelodyNote], bpm: int) -> music_pb2.NoteSequence:
    sequence = music_pb2.NoteSequence()
    sequence.ticks_per_quarter = PPQN
    sequence.tempos.add(qpm=float(max(1, bpm)), time=0.0)
    sequence.time_signatures.add(numerator=4, denominator=4, time=0.0)
    for note in notes:
        sequence.notes.add(
            pitch=int(note.pitch_midi),
            start_time=float(note.start_ms / 1000),
            end_time=float(note.end_ms / 1000),
            velocity=int(note.velocity),
            instrument=0,
            program=0,
        )
    sequence.total_time = max((float(note.end_ms / 1000) for note in notes), default=0.0)
    return sequence


def _build_midi_bytes(notes: list[MelodyNote], bpm: int) -> bytes:
    sequence = _build_note_sequence(notes, bpm)
    temp_path: Path | None = None
    try:
        with NamedTemporaryFile(delete=False, suffix=".mid") as temp_file:
            temp_path = Path(temp_file.name)
        midi_io.note_sequence_to_midi_file(sequence, temp_path.as_posix())
        return temp_path.read_bytes()
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def _store_midi_file(storage_key: str, notes: list[MelodyNote], bpm: int) -> tuple[str, int]:
    midi_bytes = _build_midi_bytes(notes, bpm)
    stored_object = get_storage_backend().write_bytes(storage_key, midi_bytes, content_type="audio/midi")
    return stored_object.storage_key, stored_object.byte_size


def _build_notes_from_update(payload: MelodyDraftUpdateRequest) -> list[MelodyNote]:
    notes = [
        MelodyNote(
            pitch_midi=note.pitch_midi,
            start_ms=note.start_ms,
            end_ms=note.end_ms,
            phrase_index=note.phrase_index,
            velocity=note.velocity,
        )
        for note in payload.notes
    ]
    return sorted(notes, key=lambda item: (item.start_ms, item.pitch_midi))


def get_latest_melody_draft(track: Track) -> MelodyDraft | None:
    if not track.melody_drafts:
        return None

    return max(track.melody_drafts, key=lambda item: item.updated_at)


def build_melody_draft_response(draft: MelodyDraft, request: Request) -> MelodyDraftResponse:
    midi_artifact_url = (
        str(request.url_for("download_melody_midi", melody_draft_id=str(draft.melody_draft_id)))
        if draft.midi_storage_key
        else None
    )
    notes_payload = draft.notes_json if isinstance(draft.notes_json, list) else []

    return MelodyDraftResponse(
        melody_draft_id=draft.melody_draft_id,
        project_id=draft.project_id,
        track_id=draft.track_id,
        model_version=draft.model_version,
        key_estimate=draft.key_estimate,
        bpm=draft.bpm,
        grid_division=draft.grid_division,
        phrase_count=draft.phrase_count,
        note_count=draft.note_count,
        notes_json=notes_payload,
        midi_artifact_url=midi_artifact_url,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def extract_melody_draft(session: Session, project_id: UUID, track_id: UUID) -> MelodyDraft:
    project = _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project.project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")
    if track.track_role != TrackRole.VOCAL_TAKE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only vocal takes can be converted to melody drafts")
    if track.track_status != TrackStatus.READY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track must be READY before melody extraction")

    samples, sample_rate = _read_canonical_samples(track)
    frame_notes = _merge_frame_notes(_extract_pitch_frames(samples, sample_rate))
    bpm = project.bpm or 90
    quantized_notes = _assign_phrase_indexes(_quantize_notes(frame_notes, bpm), bpm)
    key_estimate = _estimate_key(quantized_notes) or project.base_key

    now = datetime.now(timezone.utc)
    draft = MelodyDraft(
        project_id=project.project_id,
        track_id=track.track_id,
        model_version=MELODY_MODEL_VERSION,
        key_estimate=key_estimate,
        bpm=bpm,
        grid_division=GRID_DIVISION,
        phrase_count=(max((note.phrase_index for note in quantized_notes), default=-1) + 1),
        note_count=len(quantized_notes),
        notes_json=[note.to_payload() for note in quantized_notes],
        created_at=now,
        updated_at=now,
    )
    session.add(draft)
    session.flush()

    midi_storage_key, midi_byte_size = _store_midi_file(
        build_project_storage_key(project.project_id, "derived", "melody", f"{draft.melody_draft_id}.mid"),
        quantized_notes,
        bpm,
    )
    draft.midi_storage_key = midi_storage_key
    draft.midi_byte_size = midi_byte_size

    session.commit()
    session.refresh(draft)
    return draft


def get_track_melody_draft(session: Session, project_id: UUID, track_id: UUID) -> MelodyDraft:
    _get_project_or_404(session, project_id)
    track = _get_track_or_404(session, track_id)
    if track.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track does not match project")

    draft = get_latest_melody_draft(track)
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Melody draft has not been created yet.")

    return draft


def update_melody_draft(session: Session, melody_draft_id: UUID, payload: MelodyDraftUpdateRequest) -> MelodyDraft:
    draft = _get_melody_draft_or_404(session, melody_draft_id)
    notes = _build_notes_from_update(payload)
    bpm = draft.bpm or 90
    notes = _assign_phrase_indexes(_quantize_notes(notes, bpm), bpm)
    key_estimate = payload.key_estimate or _estimate_key(notes) or draft.key_estimate

    midi_storage_key, midi_byte_size = _store_midi_file(
        draft.midi_storage_key
        or build_project_storage_key(draft.project_id, "derived", "melody", f"{draft.melody_draft_id}.mid"),
        notes,
        bpm,
    )

    draft.key_estimate = key_estimate
    draft.note_count = len(notes)
    draft.phrase_count = max((note.phrase_index for note in notes), default=-1) + 1
    draft.notes_json = [note.to_payload() for note in notes]
    draft.midi_storage_key = midi_storage_key
    draft.midi_byte_size = midi_byte_size
    draft.updated_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(draft)
    return draft


def get_melody_midi_path(session: Session, melody_draft_id: UUID) -> MelodyDraft:
    draft = _get_melody_draft_or_404(session, melody_draft_id)
    if not draft.midi_storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Melody draft MIDI is missing")

    if not get_storage_backend().exists(draft.midi_storage_key):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Melody draft MIDI file not found")

    return draft
