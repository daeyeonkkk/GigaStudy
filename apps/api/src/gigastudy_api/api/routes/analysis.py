from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.analysis import TrackAnalysisResponse
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.analysis import get_track_analysis, run_track_analysis


router = APIRouter(prefix="/projects")


@router.post(
    "/{project_id}/tracks/{track_id}/analysis",
    response_model=TrackAnalysisResponse,
    status_code=status.HTTP_200_OK,
)
def run_track_analysis_endpoint(
    project_id: UUID,
    track_id: UUID,
    session: Session = Depends(get_db_session),
) -> TrackAnalysisResponse:
    return run_track_analysis(session, project_id, track_id)


@router.get(
    "/{project_id}/tracks/{track_id}/analysis",
    response_model=TrackAnalysisResponse,
)
def get_track_analysis_endpoint(
    project_id: UUID,
    track_id: UUID,
    session: Session = Depends(get_db_session),
) -> TrackAnalysisResponse:
    return get_track_analysis(session, project_id, track_id)
