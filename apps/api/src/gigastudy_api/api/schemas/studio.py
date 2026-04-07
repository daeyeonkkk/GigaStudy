from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from gigastudy_api.api.schemas.device_profiles import DeviceProfileResponse
from gigastudy_api.api.schemas.guides import GuideTrackResponse
from gigastudy_api.api.schemas.projects import ProjectResponse
from gigastudy_api.api.schemas.tracks import TakeTrackResponse


class StudioMixdownSummary(BaseModel):
    track_id: UUID
    track_status: str
    updated_at: datetime


class StudioSnapshotResponse(BaseModel):
    project: ProjectResponse
    guide: GuideTrackResponse | None
    takes: list[TakeTrackResponse]
    latest_device_profile: DeviceProfileResponse | None
    mixdown: StudioMixdownSummary | None
