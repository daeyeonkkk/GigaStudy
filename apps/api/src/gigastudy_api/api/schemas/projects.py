from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    bpm: int | None = Field(default=None, ge=1, le=400)
    base_key: str | None = Field(default=None, max_length=24)
    time_signature: str | None = Field(default=None, max_length=24)
    mode: str | None = Field(default="practice", max_length=40)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Title must not be blank")

        return normalized


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: UUID
    title: str
    bpm: int | None
    base_key: str | None
    time_signature: str | None
    mode: str | None
    created_at: datetime
    updated_at: datetime
