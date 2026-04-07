from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GuideUploadInitRequest(BaseModel):
    filename: str | None = Field(default=None, max_length=255)
    content_type: str | None = Field(default=None, max_length=128)


class GuideUploadInitResponse(BaseModel):
    track_id: UUID
    upload_url: str
    method: str = "PUT"
    storage_key: str


class GuideCompleteRequest(BaseModel):
    track_id: UUID
    source_format: str | None = Field(default=None, max_length=64)
    duration_ms: int | None = Field(default=None, ge=0)
    actual_sample_rate: int | None = Field(default=None, ge=1)


class GuideTrackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    track_id: UUID
    project_id: UUID
    track_role: str
    track_status: str
    source_format: str | None
    duration_ms: int | None
    actual_sample_rate: int | None
    storage_key: str | None
    checksum: str | None
    source_artifact_url: str | None = None
    created_at: datetime
    updated_at: datetime


class GuideLookupResponse(BaseModel):
    guide: GuideTrackResponse | None
