from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.runtime_events import RuntimeEventCreateRequest, RuntimeEventResponse
from gigastudy_api.db.session import get_db_session
from gigastudy_api.services.runtime_events import build_runtime_event_response, create_runtime_event


router = APIRouter()


@router.post("/runtime-events", response_model=RuntimeEventResponse, status_code=status.HTTP_201_CREATED)
def create_runtime_event_endpoint(
    payload: RuntimeEventCreateRequest,
    request: Request,
    session: Session = Depends(get_db_session),
) -> RuntimeEventResponse:
    item = create_runtime_event(
        session,
        payload,
        request_id=request.headers.get("X-Request-ID") or payload.request_id,
    )
    return build_runtime_event_response(item)
