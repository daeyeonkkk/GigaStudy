from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from gigastudy_api.api.schemas.arrangements import ArrangementCandidateResponse
from gigastudy_api.api.schemas.guides import GuideTrackResponse
from gigastudy_api.api.schemas.mixdowns import MixdownTrackResponse
from gigastudy_api.api.schemas.projects import ProjectResponse
from gigastudy_api.api.schemas.tracks import TakeTrackResponse


class SnapshotSummaryResponse(BaseModel):
    has_guide: bool
    take_count: int
    ready_take_count: int
    arrangement_count: int
    has_mixdown: bool


class ProjectVersionCreateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=400)

    @field_validator("label", "note")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized = value.strip()
        return normalized or None


class ProjectVersionResponse(BaseModel):
    version_id: UUID
    project_id: UUID
    source_type: str
    label: str
    note: str | None
    snapshot_summary: SnapshotSummaryResponse
    created_at: datetime
    updated_at: datetime


class ProjectVersionListResponse(BaseModel):
    items: list[ProjectVersionResponse] = Field(default_factory=list)


ShareArtifactKey = Literal["guide", "takes", "mixdown", "arrangements"]


class ShareLinkCreateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    expires_in_days: int = Field(default=7, ge=1, le=90)
    version_id: UUID | None = None
    included_artifacts: list[ShareArtifactKey] = Field(
        default_factory=lambda: ["guide", "takes", "mixdown", "arrangements"]
    )

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized = value.strip()
        return normalized or None

    @field_validator("included_artifacts")
    @classmethod
    def normalize_included_artifacts(cls, value: list[ShareArtifactKey]) -> list[ShareArtifactKey]:
        deduped: list[ShareArtifactKey] = []
        for item in value:
            if item not in deduped:
                deduped.append(item)
        return deduped


class ShareLinkResponse(BaseModel):
    share_link_id: UUID
    project_id: UUID
    version_id: UUID
    label: str
    access_scope: str
    is_active: bool
    expires_at: datetime | None
    last_accessed_at: datetime | None
    share_url: str
    created_at: datetime
    updated_at: datetime


class ShareLinkListResponse(BaseModel):
    items: list[ShareLinkResponse] = Field(default_factory=list)


class SharedProjectResponse(BaseModel):
    share_link_id: UUID
    label: str
    access_scope: str
    expires_at: datetime | None
    version_id: UUID
    version_label: str
    version_source_type: str
    version_created_at: datetime
    snapshot_summary: SnapshotSummaryResponse
    project: ProjectResponse
    guide: GuideTrackResponse | None
    takes: list[TakeTrackResponse] = Field(default_factory=list)
    mixdown: MixdownTrackResponse | None
    arrangement_generation_id: str | None = None
    arrangements: list[ArrangementCandidateResponse] = Field(default_factory=list)
