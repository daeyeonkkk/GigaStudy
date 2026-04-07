from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.processing import TrackProcessingRetryResponse
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.processing import (
    build_processing_retry_response,
    retry_track_processing,
)

router = APIRouter()


@router.post("/tracks/{track_id}/retry-processing", response_model=TrackProcessingRetryResponse)
def retry_track_processing_endpoint(
    track_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> TrackProcessingRetryResponse:
    track = retry_track_processing(session, track_id)
    return build_processing_retry_response(track, request)
