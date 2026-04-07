from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class OpsSummaryResponse(BaseModel):
    project_count: int = Field(ge=0)
    ready_take_count: int = Field(ge=0)
    failed_track_count: int = Field(ge=0)
    analysis_job_count: int = Field(ge=0)
    failed_analysis_job_count: int = Field(ge=0)


class OpsPolicyResponse(BaseModel):
    analysis_timeout_seconds: int = Field(ge=0)
    upload_session_expiry_minutes: int = Field(ge=0)
    recent_limit: int = Field(ge=1)


class OpsModelVersionsResponse(BaseModel):
    analysis: list[str] = Field(default_factory=list)
    melody: list[str] = Field(default_factory=list)
    arrangement_engine: list[str] = Field(default_factory=list)


class FailedTrackSummaryResponse(BaseModel):
    track_id: UUID
    project_id: UUID
    project_title: str
    track_role: str
    track_status: str
    take_no: int | None = None
    source_format: str | None = None
    failure_message: str | None = None
    updated_at: datetime


class AnalysisJobSummaryResponse(BaseModel):
    job_id: UUID
    project_id: UUID
    project_title: str
    track_id: UUID
    track_role: str
    take_no: int | None = None
    status: str
    model_version: str
    requested_at: datetime
    finished_at: datetime | None = None
    error_message: str | None = None


class OpsOverviewResponse(BaseModel):
    summary: OpsSummaryResponse
    policies: OpsPolicyResponse
    model_versions: OpsModelVersionsResponse
    failed_tracks: list[FailedTrackSummaryResponse] = Field(default_factory=list)
    recent_analysis_jobs: list[AnalysisJobSummaryResponse] = Field(default_factory=list)
