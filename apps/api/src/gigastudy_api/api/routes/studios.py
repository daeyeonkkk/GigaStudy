from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response
from fastapi.responses import FileResponse

from gigastudy_api.api.schemas.studios import (
    ApproveCandidateRequest,
    ApproveJobCandidatesRequest,
    CreateStudioRequest,
    DirectUploadRequest,
    DirectUploadTarget,
    GenerateTrackRequest,
    ScoreTrackRequest,
    Studio,
    StudioListItem,
    SyncTrackRequest,
    UploadTrackRequest,
)
from gigastudy_api.services.studio_repository import StudioRepository, get_studio_repository

router = APIRouter()


@router.get("", response_model=list[StudioListItem])
def list_studios(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    repository: StudioRepository = Depends(get_studio_repository),
) -> list[StudioListItem]:
    return repository.list_studios(limit=limit, offset=offset)


@router.post("", response_model=Studio)
def create_studio(
    request: CreateStudioRequest,
    background_tasks: BackgroundTasks,
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
        background_tasks=background_tasks,
    )


@router.get("/{studio_id}", response_model=Studio)
def get_studio(
    studio_id: str,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.get_studio(studio_id)


@router.get("/{studio_id}/export/pdf")
def export_studio_pdf(
    studio_id: str,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Response:
    filename, content = repository.export_score_pdf(studio_id)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{studio_id}/tracks/{slot_id}/audio")
def get_track_audio(
    studio_id: str,
    slot_id: int,
    repository: StudioRepository = Depends(get_studio_repository),
) -> FileResponse:
    path, media_type, filename = repository.get_track_audio(studio_id, slot_id)
    return FileResponse(path, media_type=media_type, filename=filename)


@router.put("/direct-uploads/{asset_id}")
async def put_direct_upload(
    asset_id: str,
    request: Request,
    repository: StudioRepository = Depends(get_studio_repository),
) -> dict[str, int | str]:
    content = await request.body()
    return repository.write_direct_upload_content(asset_id, content)


@router.post("/{studio_id}/tracks/{slot_id}/upload-target", response_model=DirectUploadTarget)
def create_track_upload_target(
    studio_id: str,
    slot_id: int,
    request: DirectUploadRequest,
    http_request: Request,
    repository: StudioRepository = Depends(get_studio_repository),
) -> DirectUploadTarget:
    target = repository.create_track_upload_target(studio_id, slot_id, request)
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
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.upload_track(studio_id, slot_id, request, background_tasks=background_tasks)


@router.post("/{studio_id}/tracks/{slot_id}/generate", response_model=Studio)
def generate_track(
    studio_id: str,
    slot_id: int,
    request: GenerateTrackRequest,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.generate_track(studio_id, slot_id, request)


@router.patch("/{studio_id}/tracks/{slot_id}/sync", response_model=Studio)
def update_track_sync(
    studio_id: str,
    slot_id: int,
    request: SyncTrackRequest,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.update_sync(studio_id, slot_id, request)


@router.post("/{studio_id}/candidates/{candidate_id}/approve", response_model=Studio)
def approve_candidate(
    studio_id: str,
    candidate_id: str,
    request: ApproveCandidateRequest,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.approve_candidate(studio_id, candidate_id, request)


@router.post("/{studio_id}/candidates/{candidate_id}/reject", response_model=Studio)
def reject_candidate(
    studio_id: str,
    candidate_id: str,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.reject_candidate(studio_id, candidate_id)


@router.post("/{studio_id}/jobs/{job_id}/approve-candidates", response_model=Studio)
def approve_job_candidates(
    studio_id: str,
    job_id: str,
    request: ApproveJobCandidatesRequest,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.approve_job_candidates(studio_id, job_id, request)


@router.post("/{studio_id}/tracks/{slot_id}/score", response_model=Studio)
def score_track(
    studio_id: str,
    slot_id: int,
    request: ScoreTrackRequest,
    repository: StudioRepository = Depends(get_studio_repository),
) -> Studio:
    return repository.score_track(studio_id, slot_id, request)
