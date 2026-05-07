from fastapi import APIRouter, BackgroundTasks, Depends, Query

from gigastudy_api.api.schemas.admin import (
    AdminDeleteResult,
    AdminEngineDrainResult,
    AdminStorageSummary,
    PlaybackInstrumentConfig,
    UpdatePlaybackInstrumentRequest,
)
from gigastudy_api.services.admin_auth import require_admin_credentials
from gigastudy_api.services.playback_instrument import (
    PlaybackInstrumentService,
    get_playback_instrument_service,
)
from gigastudy_api.services.studio_repository import StudioRepository, get_studio_repository

router = APIRouter()


@router.get("/storage", response_model=AdminStorageSummary)
def get_admin_storage_summary(
    studio_limit: int = Query(default=50, ge=1, le=100),
    studio_offset: int = Query(default=0, ge=0),
    asset_limit: int = Query(default=25, ge=0, le=100),
    asset_offset: int = Query(default=0, ge=0),
    sync_missing_assets: bool = Query(default=False),
    studio_status: str = Query(default="active", pattern="^(active|inactive|all)$"),
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminStorageSummary:
    return repository.get_admin_storage_summary(
        studio_limit=studio_limit,
        studio_offset=studio_offset,
        asset_limit=asset_limit,
        asset_offset=asset_offset,
        sync_missing_assets=sync_missing_assets,
        studio_status=studio_status,
    )


@router.post("/studios/{studio_id}/deactivate", response_model=AdminDeleteResult)
def deactivate_admin_studio(
    studio_id: str,
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.deactivate_admin_studio(studio_id)


@router.delete("/studios/{studio_id}", response_model=AdminDeleteResult)
def delete_admin_studio(
    studio_id: str,
    background_tasks: BackgroundTasks,
    background: bool = Query(default=False),
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_studio(
        studio_id,
        background_tasks=background_tasks if background else None,
    )


@router.delete("/inactive-studios", response_model=AdminDeleteResult)
def delete_admin_inactive_studios(
    background_tasks: BackgroundTasks,
    background: bool = Query(default=False),
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_inactive_studios(
        background_tasks=background_tasks if background else None,
    )


@router.put("/playback-instrument", response_model=PlaybackInstrumentConfig)
def update_admin_playback_instrument(
    request: UpdatePlaybackInstrumentRequest,
    _: None = Depends(require_admin_credentials),
    service: PlaybackInstrumentService = Depends(get_playback_instrument_service),
) -> PlaybackInstrumentConfig:
    return service.update(
        filename=request.filename,
        content_base64=request.content_base64,
        root_midi=request.root_midi,
    )


@router.delete("/playback-instrument", response_model=PlaybackInstrumentConfig)
def reset_admin_playback_instrument(
    _: None = Depends(require_admin_credentials),
    service: PlaybackInstrumentService = Depends(get_playback_instrument_service),
) -> PlaybackInstrumentConfig:
    return service.reset()


@router.delete("/studios/{studio_id}/assets", response_model=AdminDeleteResult)
def delete_admin_studio_assets(
    studio_id: str,
    background_tasks: BackgroundTasks,
    background: bool = Query(default=False),
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_studio_assets(
        studio_id,
        background_tasks=background_tasks if background else None,
    )


@router.delete("/staged-assets", response_model=AdminDeleteResult)
def delete_admin_staged_assets(
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_staged_assets()


@router.delete("/expired-staged-assets", response_model=AdminDeleteResult)
def delete_admin_expired_staged_assets(
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_expired_staged_assets()


@router.post("/maintenance/cleanup", response_model=AdminDeleteResult)
def run_admin_maintenance_cleanup(
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.run_admin_maintenance_cleanup()


@router.delete("/assets/{asset_id}", response_model=AdminDeleteResult)
def delete_admin_asset(
    asset_id: str,
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminDeleteResult:
    return repository.delete_admin_asset(asset_id)


@router.post("/engine/drain", response_model=AdminEngineDrainResult)
def drain_engine_queue(
    max_jobs: int = Query(default=3, ge=1, le=20),
    _: None = Depends(require_admin_credentials),
    repository: StudioRepository = Depends(get_studio_repository),
) -> AdminEngineDrainResult:
    return repository.drain_engine_queue(max_jobs=max_jobs)
