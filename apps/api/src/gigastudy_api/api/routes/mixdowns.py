from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.mixdowns import (
    MixdownCompleteRequest,
    MixdownTrackResponse,
    MixdownUploadInitRequest,
    MixdownUploadInitResponse,
)
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.mixdowns import (
    build_mixdown_response,
    complete_mixdown_upload,
    create_mixdown_upload_session,
)

router = APIRouter(prefix="/projects")


@router.post(
    "/{project_id}/mixdown/upload-url",
    response_model=MixdownUploadInitResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_mixdown_upload_url_endpoint(
    project_id: UUID,
    payload: MixdownUploadInitRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> MixdownUploadInitResponse:
    mixdown_track = create_mixdown_upload_session(session, project_id, payload)
    upload_url = str(
        request.url_for("upload_track_source_audio", track_id=str(mixdown_track.track_id))
    )

    return MixdownUploadInitResponse(
        track_id=mixdown_track.track_id,
        upload_url=upload_url,
        storage_key=mixdown_track.storage_key or "",
    )


@router.post("/{project_id}/mixdown/complete", response_model=MixdownTrackResponse)
def complete_mixdown_upload_endpoint(
    project_id: UUID,
    payload: MixdownCompleteRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> MixdownTrackResponse:
    mixdown_track = complete_mixdown_upload(session, project_id, payload)
    return build_mixdown_response(mixdown_track, request)
