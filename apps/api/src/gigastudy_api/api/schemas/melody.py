from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MelodyNoteResponse(BaseModel):
    pitch_midi: int = Field(ge=0, le=127)
    pitch_name: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    duration_ms: int = Field(gt=0)
    phrase_index: int = Field(ge=0)
    velocity: int = Field(ge=1, le=127)


class MelodyDraftResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    melody_draft_id: UUID
    project_id: UUID
    track_id: UUID
    model_version: str
    key_estimate: str | None
    bpm: int | None
    grid_division: str
    phrase_count: int
    note_count: int
    notes_json: list[MelodyNoteResponse]
    midi_artifact_url: str | None = None
    created_at: datetime
    updated_at: datetime


class MelodyDraftUpdateRequest(BaseModel):
    key_estimate: str | None = Field(default=None, max_length=32)
    notes: list[MelodyNoteResponse] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_note_ranges(self) -> "MelodyDraftUpdateRequest":
        for note in self.notes:
            if note.end_ms <= note.start_ms:
                raise ValueError("Each note end_ms must be greater than start_ms")

        return self
