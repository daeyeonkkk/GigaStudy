from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.melody import MelodyDraftResponse, MelodyDraftUpdateRequest
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.melody import (
    build_melody_draft_response,
    extract_melody_draft,
    get_melody_midi_path,
    get_track_melody_draft,
    update_melody_draft,
)


router = APIRouter()


@router.post(
    "/projects/{project_id}/tracks/{track_id}/melody",
    response_model=MelodyDraftResponse,
    status_code=status.HTTP_200_OK,
)
def extract_melody_draft_endpoint(
    project_id: UUID,
    track_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> MelodyDraftResponse:
    draft = extract_melody_draft(session, project_id, track_id)
    return build_melody_draft_response(draft, request)


@router.get(
    "/projects/{project_id}/tracks/{track_id}/melody",
    response_model=MelodyDraftResponse,
)
def get_track_melody_draft_endpoint(
    project_id: UUID,
    track_id: UUID,
    request: Request,
    session: Session = Depends(get_db_session),
) -> MelodyDraftResponse:
    draft = get_track_melody_draft(session, project_id, track_id)
    return build_melody_draft_response(draft, request)


@router.patch(
    "/melody-drafts/{melody_draft_id}",
    response_model=MelodyDraftResponse,
)
def update_melody_draft_endpoint(
    melody_draft_id: UUID,
    payload: MelodyDraftUpdateRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> MelodyDraftResponse:
    draft = update_melody_draft(session, melody_draft_id, payload)
    return build_melody_draft_response(draft, request)


@router.get(
    "/melody-drafts/{melody_draft_id}/midi",
    name="download_melody_midi",
)
def download_melody_midi_endpoint(
    melody_draft_id: UUID,
    session: Session = Depends(get_db_session),
) -> FileResponse:
    draft = get_melody_midi_path(session, melody_draft_id)

    return FileResponse(
        path=draft.midi_storage_key,
        media_type="audio/midi",
        filename=f"{draft.melody_draft_id}.mid",
    )
