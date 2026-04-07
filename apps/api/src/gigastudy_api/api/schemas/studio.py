from pydantic import BaseModel, Field

from gigastudy_api.api.schemas.arrangements import ArrangementCandidateResponse
from gigastudy_api.api.schemas.device_profiles import DeviceProfileResponse
from gigastudy_api.api.schemas.guides import GuideTrackResponse
from gigastudy_api.api.schemas.mixdowns import MixdownTrackResponse
from gigastudy_api.api.schemas.projects import ProjectResponse
from gigastudy_api.api.schemas.tracks import TakeTrackResponse


class StudioSnapshotResponse(BaseModel):
    project: ProjectResponse
    guide: GuideTrackResponse | None
    takes: list[TakeTrackResponse]
    latest_device_profile: DeviceProfileResponse | None
    mixdown: MixdownTrackResponse | None
    arrangement_generation_id: str | None = None
    arrangements: list[ArrangementCandidateResponse] = Field(default_factory=list)
