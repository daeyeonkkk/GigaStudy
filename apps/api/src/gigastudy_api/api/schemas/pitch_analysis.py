from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


FRAME_PITCH_ARTIFACT_VERSION = "librosa-pyin-frame-pitch-v1"
FRAME_PITCH_QUALITY_MODE = "FRAME_PITCH_V1"
COARSE_CONTOUR_QUALITY_MODE = "COARSE_CONTOUR_V1"
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
