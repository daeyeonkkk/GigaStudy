from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from gigastudy_api.api.schemas.melody import MelodyNoteResponse


class ArrangementPartResponse(BaseModel):
    part_name: str
    role: str
    range_label: str
    notes: list[MelodyNoteResponse] = Field(default_factory=list)


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
    constraint_json: dict | None
    parts_json: list[ArrangementPartResponse]
    midi_artifact_url: str | None = None
    created_at: datetime
    updated_at: datetime


class ArrangementGenerateRequest(BaseModel):
    melody_draft_id: UUID | None = None
    style: str = Field(default="contemporary", max_length=32)
    difficulty: str = Field(default="basic", max_length=32)
    include_percussion: bool = False
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
