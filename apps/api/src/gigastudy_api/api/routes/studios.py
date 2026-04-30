from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Request, Response
from fastapi.responses import FileResponse

from gigastudy_api.api.schemas.studios import (
    ApproveCandidateRequest,
    ApproveJobCandidatesRequest,
    CreateStudioRequest,
    DirectUploadRequest,
    DirectUploadTarget,
    GenerateTrackRequest,
    ScoreTrackRequest,
    ShiftTrackSyncRequest,
    Studio,
    StudioListItem,
    StudioSeedUploadRequest,
    SyncTrackRequest,
    UploadTrackRequest,
    VolumeTrackRequest,
)
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


@router.post("", response_model=Studio)
def create_studio(
    request: CreateStudioRequest,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.create_studio(
        title=request.title,
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


@router.get("/{studio_id}", response_model=Studio)
def get_studio(
    studio_id: str,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.get_studio(
        studio_id,
        background_tasks=background_tasks,
        owner_token=owner_token,
        enforce_owner=True,
    )


@router.get("/{studio_id}/export/pdf")
def export_studio_pdf(
    studio_id: str,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Response:
    filename, content = repository.export_score_pdf(studio_id, owner_token=owner_token)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
def get_omr_job_source_preview(
    studio_id: str,
    job_id: str,
    page_index: int = Query(default=0, ge=0, le=200),
    owner_token_query: str | None = Query(default=None, alias="owner_token"),
    owner_token_header: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Response:
    content, filename = repository.get_omr_source_preview(
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


@router.post("/{studio_id}/tracks/{slot_id}/upload", response_model=Studio)
def upload_track(
    studio_id: str,
    slot_id: int,
    request: UploadTrackRequest,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.upload_track(
        studio_id,
        slot_id,
        request,
        owner_token=owner_token,
        background_tasks=background_tasks,
    )


@router.post("/{studio_id}/tracks/{slot_id}/generate", response_model=Studio)
def generate_track(
    studio_id: str,
    slot_id: int,
    request: GenerateTrackRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.generate_track(studio_id, slot_id, request, owner_token=owner_token)


@router.patch("/{studio_id}/tracks/sync", response_model=Studio)
def shift_registered_track_syncs(
    studio_id: str,
    request: ShiftTrackSyncRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.shift_registered_syncs(studio_id, request, owner_token=owner_token)


@router.patch("/{studio_id}/tracks/{slot_id}/sync", response_model=Studio)
def update_track_sync(
    studio_id: str,
    slot_id: int,
    request: SyncTrackRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.update_sync(studio_id, slot_id, request, owner_token=owner_token)


@router.patch("/{studio_id}/tracks/{slot_id}/volume", response_model=Studio)
def update_track_volume(
    studio_id: str,
    slot_id: int,
    request: VolumeTrackRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.update_volume(studio_id, slot_id, request, owner_token=owner_token)


@router.post("/{studio_id}/candidates/{candidate_id}/approve", response_model=Studio)
def approve_candidate(
    studio_id: str,
    candidate_id: str,
    request: ApproveCandidateRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.approve_candidate(studio_id, candidate_id, request, owner_token=owner_token)


@router.post("/{studio_id}/candidates/{candidate_id}/reject", response_model=Studio)
def reject_candidate(
    studio_id: str,
    candidate_id: str,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.reject_candidate(studio_id, candidate_id, owner_token=owner_token)


@router.post("/{studio_id}/jobs/{job_id}/approve-candidates", response_model=Studio)
def approve_job_candidates(
    studio_id: str,
    job_id: str,
    request: ApproveJobCandidatesRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.approve_job_candidates(studio_id, job_id, request, owner_token=owner_token)


@router.post("/{studio_id}/jobs/{job_id}/retry", response_model=Studio)
def retry_extraction_job(
    studio_id: str,
    job_id: str,
    background_tasks: BackgroundTasks,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.retry_extraction_job(
        studio_id,
        job_id,
        owner_token=owner_token,
        background_tasks=background_tasks,
    )


@router.post("/{studio_id}/tracks/{slot_id}/score", response_model=Studio)
def score_track(
    studio_id: str,
    slot_id: int,
    request: ScoreTrackRequest,
    owner_token: str | None = Depends(studio_owner_token),
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.score_track(studio_id, slot_id, request, owner_token=owner_token)
