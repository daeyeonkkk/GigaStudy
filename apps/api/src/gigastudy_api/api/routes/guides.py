from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.guides import (
    GuideCompleteRequest,
    GuideLookupResponse,
    GuideTrackResponse,
    GuideUploadInitRequest,
    GuideUploadInitResponse,
)
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.guides import (
    build_guide_response,
    complete_guide_upload,
    create_guide_upload_session,
    get_latest_guide,
    get_track_canonical_path,
    get_track_source_path,
    store_track_upload,
)
from gigastudy_api.services.storage import build_storage_download_response, build_track_upload_target

router = APIRouter()


@router.post(
    "/projects/{project_id}/guide/upload-url",
    response_model=GuideUploadInitResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_guide_upload_url_endpoint(
    project_id: UUID,
    payload: GuideUploadInitRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> GuideUploadInitResponse:
    guide_track = create_guide_upload_session(session, project_id, payload)
    upload_target = build_track_upload_target(
        request,
        track_id=guide_track.track_id,
        storage_key=guide_track.storage_key or "",
        content_type=payload.content_type,
    )

    return GuideUploadInitResponse(
        track_id=guide_track.track_id,
        upload_url=upload_target.upload_url,
        method=upload_target.method,
        storage_key=upload_target.storage_key,
        upload_headers=upload_target.headers,
    )


@router.put(
    "/uploads/tracks/{track_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    name="upload_track_source_audio",
)
async def upload_track_source_audio_endpoint(
    track_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> Response:
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload body is empty")

    store_track_upload(session, track_id, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/projects/{project_id}/guide/complete", response_model=GuideTrackResponse)
def complete_guide_upload_endpoint(
    project_id: UUID,
    payload: GuideCompleteRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> GuideTrackResponse:
    guide_track = complete_guide_upload(session, project_id, payload)
    return build_guide_response(guide_track, request)


@router.get("/projects/{project_id}/guide", response_model=GuideLookupResponse)
def get_guide_endpoint(
    project_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> GuideLookupResponse:
    guide_track = get_latest_guide(session, project_id)
    if guide_track is None:
        return GuideLookupResponse(guide=None)

    return GuideLookupResponse(guide=build_guide_response(guide_track, request))


@router.get(
    "/uploads/tracks/{track_id}/source",
    name="download_track_source_audio",
)
def download_track_source_audio_endpoint(
    track_id: UUID,
    session: Session = Depends(get_db_session),
) -> Response:
    track, source_artifact = get_track_source_path(session, track_id)
    return build_storage_download_response(
        storage_key=source_artifact.storage_key,
        media_type=source_artifact.mime_type or "application/octet-stream",
        filename=track.storage_key.rsplit("/", maxsplit=1)[-1] if track.storage_key else None,
    )


@router.get(
    "/uploads/tracks/{track_id}/canonical",
    name="download_track_canonical_audio",
)
def download_track_canonical_audio_endpoint(
    track_id: UUID,
    session: Session = Depends(get_db_session),
) -> Response:
    track, canonical_artifact = get_track_canonical_path(session, track_id)

    return build_storage_download_response(
        storage_key=canonical_artifact.storage_key,
        media_type=canonical_artifact.mime_type or "audio/wav",
        filename=f"{track.track_id}.wav",
    )
