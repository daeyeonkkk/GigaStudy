from typing import Literal

from pydantic import BaseModel, Field


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
    is_active: bool = True
    deactivated_at: str | None = None
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


class AdminLimitSummary(BaseModel):
    studio_soft_limit: int
    studio_hard_limit: int
    asset_warning_bytes: int
    asset_hard_bytes: int
    max_upload_bytes: int
    max_active_engine_jobs: int
    studio_warning: bool
    studio_limit_reached: bool
    asset_warning: bool
    asset_limit_reached: bool
    warnings: list[str]


class AdminStorageSummary(BaseModel):
    storage_root: str
    studio_count: int
    active_studio_count: int = 0
    inactive_studio_count: int = 0
    studio_status: Literal["active", "inactive", "all"] = "active"
    listed_studio_count: int = 0
    studio_limit: int = 50
    studio_offset: int = 0
    has_more_studios: bool = False
    asset_limit: int = 25
    asset_offset: int = 0
    asset_count: int
    listed_asset_count: int = 0
    total_asset_bytes: int = 0
    total_bytes: int
    metadata_bytes: int
    limits: AdminLimitSummary
    studios: list[AdminStudioSummary]


class AdminDeleteResult(BaseModel):
    deleted: bool
    message: str
    studio_id: str | None = None
    asset_id: str | None = None
    deleted_files: int = 0
    deleted_bytes: int = 0
    cleanup_queued: bool = False


class AdminEngineDrainResult(BaseModel):
    processed_jobs: int
    remaining_runnable: bool
    max_jobs: int
    messages: list[str]


class PlaybackInstrumentConfig(BaseModel):
    has_custom_file: bool = False
    filename: str | None = None
    root_midi: int = 69
    audio_url: str | None = None
    updated_at: str | None = None


class UpdatePlaybackInstrumentRequest(BaseModel):
    filename: str
    content_base64: str
    root_midi: int = Field(default=69, ge=21, le=108)
