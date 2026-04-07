from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.arrangements import (
    ArrangementCandidateResponse,
    ArrangementGenerateRequest,
    ArrangementGenerateResponse,
    ArrangementListResponse,
    ArrangementUpdateRequest,
)
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.arrangements import (
    generate_arrangements,
    get_arrangement_midi_path,
    list_arrangements_response,
    update_arrangement,
)


router = APIRouter()


@router.post(
    "/projects/{project_id}/arrangements/generate",
    response_model=ArrangementGenerateResponse,
    status_code=status.HTTP_200_OK,
)
def generate_arrangements_endpoint(
    project_id: UUID,
    payload: ArrangementGenerateRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> ArrangementGenerateResponse:
    return generate_arrangements(session, project_id, payload, request)


@router.get(
    "/projects/{project_id}/arrangements",
    response_model=ArrangementListResponse,
)
def list_latest_arrangements_endpoint(
    project_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> ArrangementListResponse:
    return list_arrangements_response(session, project_id, request)


@router.patch(
    "/arrangements/{arrangement_id}",
    response_model=ArrangementCandidateResponse,
)
def update_arrangement_endpoint(
    arrangement_id: UUID,
    payload: ArrangementUpdateRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> ArrangementCandidateResponse:
    return update_arrangement(session, arrangement_id, payload, request)


@router.get(
    "/arrangements/{arrangement_id}/midi",
    name="download_arrangement_midi",
)
def download_arrangement_midi_endpoint(
    arrangement_id: UUID,
    session: Session = Depends(get_db_session),
) -> FileResponse:
    arrangement = get_arrangement_midi_path(session, arrangement_id)

    return FileResponse(
        path=arrangement.midi_storage_key,
        media_type="audio/midi",
        filename=f"{arrangement.arrangement_id}.mid",
    )
