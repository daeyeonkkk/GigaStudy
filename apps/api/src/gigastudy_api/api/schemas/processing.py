from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class TrackProcessingRetryResponse(BaseModel):
    track_id: UUID
    project_id: UUID
    track_role: str
    track_status: str
    failure_message: str | None
    source_artifact_url: str | None
    updated_at: datetime
