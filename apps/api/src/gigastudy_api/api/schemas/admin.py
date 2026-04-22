from typing import Literal

from pydantic import BaseModel


AdminAssetKind = Literal["upload", "generated", "unknown"]


class AdminAssetSummary(BaseModel):
    asset_id: str
    studio_id: str
    kind: AdminAssetKind
    filename: str
    relative_path: str
    size_bytes: int
    updated_at: str
    referenced: bool


class AdminStudioSummary(BaseModel):
    studio_id: str
    title: str
    bpm: int
    registered_track_count: int
    report_count: int
    candidate_count: int
    job_count: int
    asset_count: int
    asset_bytes: int
    created_at: str
    updated_at: str
    assets: list[AdminAssetSummary]


class AdminStorageSummary(BaseModel):
    storage_root: str
    studio_count: int
    asset_count: int
    total_bytes: int
    metadata_bytes: int
    studios: list[AdminStudioSummary]


class AdminDeleteResult(BaseModel):
    deleted: bool
    message: str
    studio_id: str | None = None
    asset_id: str | None = None
    deleted_files: int = 0
    deleted_bytes: int = 0
