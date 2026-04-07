from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.tracks import (
    TakeCompleteRequest,
    TakeCreateRequest,
    TakeTrackListResponse,
    TakeTrackResponse,
    TakeUploadInitRequest,
    TakeUploadInitResponse,
)
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.takes import (
    build_take_response,
    complete_take_upload,
    create_take_track,
    create_take_upload_session,
    list_take_tracks,
)

router = APIRouter()


@router.post(
    "/projects/{project_id}/tracks",
    response_model=TakeTrackResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_take_track_endpoint(
    project_id: UUID,
    payload: TakeCreateRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> TakeTrackResponse:
    track = create_take_track(session, project_id, payload)
    return build_take_response(track, request)


@router.get("/projects/{project_id}/tracks", response_model=TakeTrackListResponse)
def list_take_tracks_endpoint(
    project_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> TakeTrackListResponse:
    tracks = list_take_tracks(session, project_id)
    return TakeTrackListResponse(
        items=[build_take_response(track, request) for track in tracks]
    )


@router.post(
    "/tracks/{track_id}/upload-url",
    response_model=TakeUploadInitResponse,
)
def create_take_upload_url_endpoint(
    track_id: UUID,
    payload: TakeUploadInitRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> TakeUploadInitResponse:
    track = create_take_upload_session(session, track_id, payload)
    upload_url = str(request.url_for("upload_track_source_audio", track_id=str(track.track_id)))

    return TakeUploadInitResponse(
        track_id=track.track_id,
        upload_url=upload_url,
        storage_key=track.storage_key or "",
    )


@router.post("/tracks/{track_id}/complete", response_model=TakeTrackResponse)
def complete_take_upload_endpoint(
    track_id: UUID,
    payload: TakeCompleteRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> TakeTrackResponse:
    track = complete_take_upload(session, track_id, payload)
    return build_take_response(track, request)
