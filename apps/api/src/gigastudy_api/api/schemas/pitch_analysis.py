from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


FRAME_PITCH_ARTIFACT_VERSION = "librosa-pyin-frame-pitch-v1"
FRAME_PITCH_QUALITY_MODE = "FRAME_PITCH_V1"
COARSE_CONTOUR_QUALITY_MODE = "COARSE_CONTOUR_V1"
NOTE_EVENT_ARTIFACT_VERSION = "librosa-pyin-note-events-v1"
NOTE_EVENT_QUALITY_MODE = "NOTE_EVENT_V1"
HARMONY_REFERENCE_MODE_KEY_ONLY = "KEY_ONLY"
HARMONY_REFERENCE_MODE_CHORD_AWARE = "CHORD_AWARE"


class PitchFrameArtifactFrame(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=1)
    frequency_hz: float | None = Field(default=None, gt=0)
    pitch_midi: int | None = None
    voiced: bool
    voiced_prob: float | None = Field(default=None, ge=0, le=1)
    rms: float | None = Field(default=None, ge=0)


class FramePitchArtifactPayload(BaseModel):
    version: str
    quality_mode: str
    sample_rate: int = Field(ge=1)
    frame_length: int = Field(ge=1)
    hop_length: int = Field(ge=1)
    frame_count: int = Field(ge=0)
    voiced_frame_count: int = Field(ge=0)
    mean_voiced_prob: float | None = Field(default=None, ge=0, le=1)
    mean_rms: float | None = Field(default=None, ge=0)
    frames: list[PitchFrameArtifactFrame] = Field(default_factory=list)


class TrackFramePitchResponse(BaseModel):
    artifact_id: UUID
    track_id: UUID
    project_id: UUID
    artifact_type: str
    payload: FramePitchArtifactPayload
    created_at: datetime
    updated_at: datetime


class NoteFeedbackItemResponse(BaseModel):
    note_index: int = Field(ge=0)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=1)
    target_midi: int
    target_frequency_hz: float = Field(gt=0)
    attack_start_ms: int = Field(ge=0)
    attack_end_ms: int = Field(ge=1)
    settle_start_ms: int | None = Field(default=None, ge=0)
    settle_end_ms: int | None = Field(default=None, ge=1)
    sustain_start_ms: int | None = Field(default=None, ge=0)
    sustain_end_ms: int | None = Field(default=None, ge=1)
    release_start_ms: int | None = Field(default=None, ge=0)
    release_end_ms: int | None = Field(default=None, ge=1)
    timing_offset_ms: int | None = None
    attack_signed_cents: float | None = None
    sustain_median_cents: float | None = None
    sustain_mad_cents: float | None = Field(default=None, ge=0)
    max_sharp_cents: float | None = None
    max_flat_cents: float | None = None
    in_tune_ratio: float | None = Field(default=None, ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    attack_score: float = Field(ge=0, le=100)
    sustain_score: float = Field(ge=0, le=100)
    stability_score: float = Field(ge=0, le=100)
    timing_score: float = Field(ge=0, le=100)
    note_score: float = Field(ge=0, le=100)
    message: str


class NoteEventArtifactPayload(BaseModel):
    version: str
    quality_mode: str
    alignment_offset_ms: int
    note_count: int = Field(ge=0)
    notes: list[NoteFeedbackItemResponse] = Field(default_factory=list)


class TrackNoteEventsResponse(BaseModel):
    artifact_id: UUID
    track_id: UUID
    project_id: UUID
    artifact_type: str
    payload: NoteEventArtifactPayload
    created_at: datetime
    updated_at: datetime
