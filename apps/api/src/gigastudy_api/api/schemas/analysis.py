from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AnalysisFeedbackItemResponse(BaseModel):
    segment_index: int = Field(ge=0)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    pitch_score: float = Field(ge=0, le=100)
    rhythm_score: float = Field(ge=0, le=100)
    harmony_fit_score: float = Field(ge=0, le=100)
    message: str


class AnalysisJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: UUID
    project_id: UUID
    track_id: UUID
    job_type: str
    status: str
    model_version: str
    requested_at: datetime
    finished_at: datetime | None
    error_message: str | None


class TrackScoreResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    score_id: UUID
    project_id: UUID
    track_id: UUID
    pitch_score: float = Field(ge=0, le=100)
    rhythm_score: float = Field(ge=0, le=100)
    harmony_fit_score: float = Field(ge=0, le=100)
    total_score: float = Field(ge=0, le=100)
    pitch_quality_mode: str
    harmony_reference_mode: str
    feedback_json: list[AnalysisFeedbackItemResponse]
    created_at: datetime
    updated_at: datetime


class TrackAnalysisResponse(BaseModel):
    track_id: UUID
    project_id: UUID
    guide_track_id: UUID
    alignment_offset_ms: int | None
    alignment_confidence: float | None = Field(default=None, ge=0, le=1)
    latest_job: AnalysisJobResponse
    latest_score: TrackScoreResponse
