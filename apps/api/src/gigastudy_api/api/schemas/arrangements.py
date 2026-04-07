from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from gigastudy_api.api.schemas.melody import MelodyNoteResponse


class ArrangementPartResponse(BaseModel):
    part_name: str
    role: str
    range_label: str
    notes: list[MelodyNoteResponse] = Field(default_factory=list)


class ArrangementComparisonSummaryResponse(BaseModel):
    lead_range_fit_percent: float
    support_max_leap: int
    parallel_motion_alerts: int
    support_part_count: int
    beatbox_note_count: int


class ArrangementCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    arrangement_id: UUID
    generation_id: UUID
    project_id: UUID
    melody_draft_id: UUID
    candidate_code: str
    title: str
    input_source_type: str
    style: str
    difficulty: str
    voice_mode: str
    part_count: int
    voice_range_preset: str | None = None
    beatbox_template: str | None = None
    constraint_json: dict | None
    comparison_summary: ArrangementComparisonSummaryResponse | None = None
    parts_json: list[ArrangementPartResponse]
    midi_artifact_url: str | None = None
    musicxml_artifact_url: str | None = None
    created_at: datetime
    updated_at: datetime


class ArrangementGenerateRequest(BaseModel):
    melody_draft_id: UUID | None = None
    style: str = Field(default="contemporary", max_length=32)
    difficulty: str = Field(default="basic", max_length=32)
    include_percussion: bool = False
    voice_range_preset: str = Field(default="alto", max_length=32)
    beatbox_template: str | None = Field(default=None, max_length=32)
    candidate_count: int = Field(default=3, ge=1, le=3)


class ArrangementGenerateResponse(BaseModel):
    generation_id: UUID
    items: list[ArrangementCandidateResponse]


class ArrangementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    parts_json: list[ArrangementPartResponse] = Field(default_factory=list)


class ArrangementListResponse(BaseModel):
    generation_id: UUID | None = None
    items: list[ArrangementCandidateResponse]
