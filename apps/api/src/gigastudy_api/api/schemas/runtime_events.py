from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RuntimeEventCreateRequest(BaseModel):
    source: str = Field(pattern="^(client|server)$")
    severity: str = Field(pattern="^(info|warn|error)$")
    event_type: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2000)
    project_id: UUID | None = None
    track_id: UUID | None = None
    surface: str | None = Field(default=None, max_length=64)
    route_path: str | None = Field(default=None, max_length=256)
    request_id: str | None = Field(default=None, max_length=64)
    request_method: str | None = Field(default=None, max_length=16)
    request_path: str | None = Field(default=None, max_length=512)
    status_code: int | None = Field(default=None, ge=100, le=599)
    user_agent: str | None = Field(default=None, max_length=1024)
    details: dict | list | None = None


class RuntimeEventResponse(BaseModel):
    runtime_event_id: UUID
    source: str
    severity: str
    event_type: str
    message: str
    project_id: UUID | None = None
    track_id: UUID | None = None
    surface: str | None = None
    route_path: str | None = None
    request_id: str | None = None
    request_method: str | None = None
    request_path: str | None = None
    status_code: int | None = None
    user_agent: str | None = None
    details: dict | list | None = None
    created_at: datetime
    updated_at: datetime
