from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChordTimelineItem(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=1)
    label: str | None = Field(default=None, max_length=48)
    root: str | None = Field(default=None, max_length=8)
    quality: str | None = Field(default=None, max_length=24)
    pitch_classes: list[int] | None = Field(default=None)

    @field_validator("pitch_classes")
    @classmethod
    def validate_pitch_classes(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        normalized: list[int] = []
        for item in value:
            if item < 0 or item > 11:
                raise ValueError("pitch_classes must be between 0 and 11")
            normalized.append(int(item))
        return normalized


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    bpm: int | None = Field(default=None, ge=1, le=400)
    base_key: str | None = Field(default=None, max_length=24)
    time_signature: str | None = Field(default=None, max_length=24)
    mode: str | None = Field(default="practice", max_length=40)
    chord_timeline_json: list[ChordTimelineItem] | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Title must not be blank")

        return normalized


class ProjectUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    bpm: int | None = Field(default=None, ge=1, le=400)
    base_key: str | None = Field(default=None, max_length=24)
    time_signature: str | None = Field(default=None, max_length=24)
    mode: str | None = Field(default=None, max_length=40)
    chord_timeline_json: list[ChordTimelineItem] | None = None

    @field_validator("title")
    @classmethod
    def normalize_optional_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
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
    chord_timeline_json: list[ChordTimelineItem] | None = None
    created_at: datetime
    updated_at: datetime
