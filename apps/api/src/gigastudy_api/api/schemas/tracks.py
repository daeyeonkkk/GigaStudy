from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from gigastudy_api.api.schemas.analysis import AnalysisJobResponse, TrackScoreResponse
from gigastudy_api.api.schemas.audio_preview import AudioPreviewResponse
from gigastudy_api.api.schemas.melody import MelodyDraftResponse


class TakeCreateRequest(BaseModel):
    part_type: str | None = Field(default="LEAD", max_length=32)
    recording_started_at: datetime | None = None
    recording_finished_at: datetime | None = None

    @model_validator(mode="after")
    def validate_recording_range(self) -> "TakeCreateRequest":
        if (
            self.recording_started_at is not None
            and self.recording_finished_at is not None
            and self.recording_finished_at < self.recording_started_at
        ):
            raise ValueError("recording_finished_at must be after recording_started_at")

        return self


class TakeUploadInitRequest(BaseModel):
    filename: str | None = Field(default=None, max_length=255)
    content_type: str | None = Field(default=None, max_length=128)


class TakeUploadInitResponse(BaseModel):
    track_id: UUID
    upload_url: str
    method: str = "PUT"
    storage_key: str


class TakeCompleteRequest(BaseModel):
    source_format: str | None = Field(default=None, max_length=64)
    duration_ms: int | None = Field(default=None, ge=0)
    actual_sample_rate: int | None = Field(default=None, ge=1)


class TakeTrackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    track_id: UUID
    project_id: UUID
    track_role: str
    track_status: str
    take_no: int | None
    part_type: str | None
    source_format: str | None
    duration_ms: int | None
    actual_sample_rate: int | None
    storage_key: str | None
    checksum: str | None
    failure_message: str | None
    alignment_offset_ms: int | None
    alignment_confidence: float | None
    recording_started_at: datetime | None
    recording_finished_at: datetime | None
    source_artifact_url: str | None = None
    preview_data: AudioPreviewResponse | None = None
    latest_score: TrackScoreResponse | None = None
    latest_analysis_job: AnalysisJobResponse | None = None
    latest_melody: MelodyDraftResponse | None = None
    created_at: datetime
    updated_at: datetime


class TakeTrackListResponse(BaseModel):
    items: list[TakeTrackResponse]
