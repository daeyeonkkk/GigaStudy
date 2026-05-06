from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Request, Response
from fastapi.responses import FileResponse
from typing import Literal

from gigastudy_api.api.schemas.studios import (
    ApproveCandidateRequest,
    ApproveJobCandidatesRequest,
    ApproveJobTempoRequest,
    CopyRegionRequest,
    CreateStudioRequest,
    DirectUploadRequest,
    DirectUploadTarget,
    GenerateTrackRequest,
    ScoreTrackRequest,
    SaveRegionRevisionRequest,
    ShiftTrackSyncRequest,
    Studio,
    StudioActivityResponse,
    StudioListItem,
    StudioResponse,
    StudioSeedUploadRequest,
    SplitRegionRequest,
    SyncTrackRequest,
    UploadTrackRequest,
    UpdatePitchEventRequest,
    UpdateRegionRequest,
    VolumeTrackRequest,
    TrackVolumeMinimalResponse,
    build_studio_activity_response,
    build_studio_response,
    build_track_volume_minimal_response,
)
from gigastudy_api.services.admin_auth import optional_admin_bypass
from gigastudy_api.services.studio_repository import StudioRepository, get_studio_repository

router = APIRouter()


def studio_owner_token(
    x_gigastudy_owner_token: str | None = Header(default=None),
) -> str | None:
    return x_gigastudy_owner_token


@router.get("", response_model=list[StudioListItem])
def list_studios(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> list[StudioListItem]:
    return repository.list_accessible_studios(limit=limit, offset=offset, owner_token=owner_token)


def _studio_response(studio: Studio) -> StudioResponse:
    return build_studio_response(studio)


@router.post("", response_model=StudioResponse)
def create_studio(
    request: CreateStudioRequest,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.create_studio(
            title=request.title,
            client_request_id=request.client_request_id,
            bpm=request.bpm,
            start_mode=request.start_mode,
            time_signature_numerator=request.time_signature_numerator,
            time_signature_denominator=request.time_signature_denominator,
            source_kind=request.source_kind,
            source_filename=request.source_filename,
            source_content_base64=request.source_content_base64,
            source_asset_path=request.source_asset_path,
            owner_token=owner_token,
            background_tasks=background_tasks,
        )
    )


@router.get("/{studio_id}", response_model=StudioResponse)
def get_studio(
    studio_id: str,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    admin_bypass: bool = Depends(optional_admin_bypass),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.get_studio(
            studio_id,
            background_tasks=background_tasks,
            owner_token=owner_token,
            enforce_owner=True,
            admin_bypass=admin_bypass,
        )
    )


@router.get("/{studio_id}/activity", response_model=StudioActivityResponse)
def get_studio_activity(
    studio_id: str,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    admin_bypass: bool = Depends(optional_admin_bypass),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioActivityResponse:
    return build_studio_activity_response(
        repository.get_studio_activity(
            studio_id,
            background_tasks=background_tasks,
            owner_token=owner_token,
            enforce_owner=True,
            admin_bypass=admin_bypass,
        )
    )


@router.delete("/{studio_id}", response_model=StudioResponse)
def deactivate_studio(
    studio_id: str,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(repository.deactivate_studio(studio_id, owner_token=owner_token))


@router.get("/{studio_id}/tracks/{slot_id}/audio")
def get_track_audio(
    studio_id: str,
    slot_id: int,
    owner_token_query: str | None = Query(default=None, alias="owner_token"),
    owner_token_header: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> FileResponse:
    path, media_type, filename = repository.get_track_audio(
        studio_id,
        slot_id,
        owner_token=owner_token_header or owner_token_query,
    )
    return FileResponse(path, media_type=media_type, filename=filename)


@router.get("/{studio_id}/jobs/{job_id}/source-preview")
def get_document_job_source_preview(
    studio_id: str,
    job_id: str,
    page_index: int = Query(default=0, ge=0, le=200),
    owner_token_query: str | None = Query(default=None, alias="owner_token"),
    owner_token_header: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Response:
    content, filename = repository.get_document_source_preview(
        studio_id,
        job_id,
        page_index=page_index,
        owner_token=owner_token_header or owner_token_query,
    )
    return Response(
        content=content,
        media_type="image/png",
        headers={
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )


@router.post("/{studio_id}/jobs/{job_id}/approve-tempo", response_model=StudioResponse)
def approve_job_tempo(
    studio_id: str,
    job_id: str,
    request: ApproveJobTempoRequest,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.approve_job_tempo(
            studio_id,
            job_id,
            request,
            owner_token=owner_token,
            background_tasks=background_tasks,
        )
    )


@router.get("/{studio_id}/exports/midi")
def export_studio_midi(
    studio_id: str,
    owner_token_query: str | None = Query(default=None, alias="owner_token"),
    owner_token_header: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Response:
    content, filename = repository.export_studio_midi(
        studio_id,
        owner_token=owner_token_header or owner_token_query,
    )
    return Response(
        content=content,
        media_type="audio/midi",
        headers={
            "Cache-Control": "private, max-age=60",
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.put("/direct-uploads/{asset_id}")
async def put_direct_upload(
    asset_id: str,
    request: Request,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> dict[str, int | str]:
    content = await request.body()
    return repository.write_direct_upload_content(asset_id, content, owner_token=owner_token)


@router.post("/upload-target", response_model=DirectUploadTarget)
def create_studio_upload_target(
    request: StudioSeedUploadRequest,
    http_request: Request,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> DirectUploadTarget:
    target = repository.create_studio_upload_target(request, owner_token=owner_token)
    if not target.upload_url:
        target = target.model_copy(
            update={
                "upload_url": str(http_request.url_for("put_direct_upload", asset_id=target.asset_id)),
            }
        )
    return target


@router.post("/{studio_id}/tracks/{slot_id}/upload-target", response_model=DirectUploadTarget)
def create_track_upload_target(
    studio_id: str,
    slot_id: int,
    request: DirectUploadRequest,
    http_request: Request,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> DirectUploadTarget:
    target = repository.create_track_upload_target(studio_id, slot_id, request, owner_token=owner_token)
    if not target.upload_url:
        target = target.model_copy(
            update={
                "upload_url": str(http_request.url_for("put_direct_upload", asset_id=target.asset_id)),
            }
        )
    return target


@router.post("/{studio_id}/tracks/{slot_id}/scoring-upload-target", response_model=DirectUploadTarget)
def create_scoring_upload_target(
    studio_id: str,
    slot_id: int,
    request: DirectUploadRequest,
    http_request: Request,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> DirectUploadTarget:
    target = repository.create_scoring_upload_target(studio_id, slot_id, request, owner_token=owner_token)
    if not target.upload_url:
        target = target.model_copy(
            update={
                "upload_url": str(http_request.url_for("put_direct_upload", asset_id=target.asset_id)),
            }
        )
    return target


@router.post("/{studio_id}/tracks/{slot_id}/upload", response_model=StudioResponse)
def upload_track(
    studio_id: str,
    slot_id: int,
    request: UploadTrackRequest,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.upload_track(
            studio_id,
            slot_id,
            request,
            owner_token=owner_token,
            background_tasks=background_tasks,
        )
    )


@router.post("/{studio_id}/tracks/{slot_id}/generate", response_model=StudioResponse)
def generate_track(
    studio_id: str,
    slot_id: int,
    request: GenerateTrackRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.generate_track(studio_id, slot_id, request, owner_token=owner_token)
    )


@router.patch("/{studio_id}/tracks/sync", response_model=StudioResponse)
def shift_registered_track_syncs(
    studio_id: str,
    request: ShiftTrackSyncRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.shift_registered_syncs(studio_id, request, owner_token=owner_token)
    )


@router.patch("/{studio_id}/tracks/{slot_id}/sync", response_model=StudioResponse)
def update_track_sync(
    studio_id: str,
    slot_id: int,
    request: SyncTrackRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.update_sync(studio_id, slot_id, request, owner_token=owner_token)
    )


@router.patch(
    "/{studio_id}/tracks/{slot_id}/volume",
    response_model=StudioResponse | TrackVolumeMinimalResponse,
)
def update_track_volume(
    studio_id: str,
    slot_id: int,
    request: VolumeTrackRequest,
    response: Literal["full", "minimal"] = Query(default="full"),
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse | TrackVolumeMinimalResponse:
    studio = repository.update_volume(studio_id, slot_id, request, owner_token=owner_token)
    if response == "minimal":
        return build_track_volume_minimal_response(studio, slot_id)
    return _studio_response(studio)


@router.patch("/{studio_id}/regions/{region_id}", response_model=StudioResponse)
def update_region(
    studio_id: str,
    region_id: str,
    request: UpdateRegionRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.update_region(studio_id, region_id, request, owner_token=owner_token)
    )


@router.patch("/{studio_id}/regions/{region_id}/revision", response_model=StudioResponse)
def save_region_revision(
    studio_id: str,
    region_id: str,
    request: SaveRegionRevisionRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.save_region_revision(studio_id, region_id, request, owner_token=owner_token)
    )


@router.post("/{studio_id}/regions/{region_id}/revision-history/{revision_id}/restore", response_model=StudioResponse)
def restore_region_revision(
    studio_id: str,
    region_id: str,
    revision_id: str,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.restore_region_revision(
            studio_id,
            region_id,
            revision_id,
            owner_token=owner_token,
        )
    )


@router.post("/{studio_id}/track-archives/{archive_id}/restore", response_model=StudioResponse)
def restore_track_archive(
    studio_id: str,
    archive_id: str,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.restore_track_archive(
            studio_id,
            archive_id,
            owner_token=owner_token,
        )
    )


@router.post("/{studio_id}/regions/{region_id}/copy", response_model=StudioResponse)
def copy_region(
    studio_id: str,
    region_id: str,
    request: CopyRegionRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.copy_region(studio_id, region_id, request, owner_token=owner_token)
    )


@router.post("/{studio_id}/regions/{region_id}/split", response_model=StudioResponse)
def split_region(
    studio_id: str,
    region_id: str,
    request: SplitRegionRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.split_region(studio_id, region_id, request, owner_token=owner_token)
    )


@router.delete("/{studio_id}/regions/{region_id}", response_model=StudioResponse)
def delete_region(
    studio_id: str,
    region_id: str,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.delete_region(studio_id, region_id, owner_token=owner_token)
    )


@router.patch("/{studio_id}/regions/{region_id}/events/{event_id}", response_model=StudioResponse)
def update_pitch_event(
    studio_id: str,
    region_id: str,
    event_id: str,
    request: UpdatePitchEventRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.update_pitch_event(studio_id, region_id, event_id, request, owner_token=owner_token)
    )


@router.post("/{studio_id}/candidates/{candidate_id}/approve", response_model=StudioResponse)
def approve_candidate(
    studio_id: str,
    candidate_id: str,
    request: ApproveCandidateRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.approve_candidate(studio_id, candidate_id, request, owner_token=owner_token)
    )


@router.post("/{studio_id}/candidates/{candidate_id}/reject", response_model=StudioResponse)
def reject_candidate(
    studio_id: str,
    candidate_id: str,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.reject_candidate(studio_id, candidate_id, owner_token=owner_token)
    )


@router.post("/{studio_id}/jobs/{job_id}/approve-candidates", response_model=StudioResponse)
def approve_job_candidates(
    studio_id: str,
    job_id: str,
    request: ApproveJobCandidatesRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.approve_job_candidates(studio_id, job_id, request, owner_token=owner_token)
    )


@router.post("/{studio_id}/jobs/{job_id}/retry", response_model=StudioResponse)
def retry_extraction_job(
    studio_id: str,
    job_id: str,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.retry_extraction_job(
            studio_id,
            job_id,
            owner_token=owner_token,
            background_tasks=background_tasks,
        )
    )


@router.post("/{studio_id}/tracks/{slot_id}/score", response_model=StudioResponse)
def score_track(
    studio_id: str,
    slot_id: int,
    request: ScoreTrackRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> StudioResponse:
    return _studio_response(
        repository.score_track(studio_id, slot_id, request, owner_token=owner_token)
    )
