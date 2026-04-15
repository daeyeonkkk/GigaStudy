from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.runtime_events import RuntimeEventCreateRequest, RuntimeEventResponse
from gigastudy_api.db.models import Project, RuntimeEvent, Track
from gigastudy_api.services.projects import get_or_create_default_user


def _resolve_project_id(session: Session, project_id: UUID | None) -> UUID | None:
    if project_id is None:
        return None
    return project_id if session.get(Project, project_id) is not None else None


def _resolve_track_id(session: Session, track_id: UUID | None) -> UUID | None:
    if track_id is None:
        return None
    return track_id if session.get(Track, track_id) is not None else None


def create_runtime_event(
    session: Session,
    payload: RuntimeEventCreateRequest,
    *,
    request_id: str | None = None,
) -> RuntimeEvent:
    user = get_or_create_default_user(session)
    item = RuntimeEvent(
        user_id=user.user_id,
        project_id=_resolve_project_id(session, payload.project_id),
        track_id=_resolve_track_id(session, payload.track_id),
        request_id=request_id or payload.request_id,
        source=payload.source,
        severity=payload.severity,
        event_type=payload.event_type.strip(),
        surface=payload.surface.strip() if payload.surface else None,
        route_path=payload.route_path.strip() if payload.route_path else None,
        request_method=payload.request_method.strip().upper() if payload.request_method else None,
        request_path=payload.request_path.strip() if payload.request_path else None,
        status_code=payload.status_code,
        message=payload.message.strip(),
        user_agent=payload.user_agent.strip() if payload.user_agent else None,
        details_json=payload.details,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def build_runtime_event_response(item: RuntimeEvent) -> RuntimeEventResponse:
    return RuntimeEventResponse(
        runtime_event_id=item.runtime_event_id,
        source=item.source,
        severity=item.severity,
        event_type=item.event_type,
        message=item.message,
        project_id=item.project_id,
        track_id=item.track_id,
        surface=item.surface,
        route_path=item.route_path,
        request_id=item.request_id,
        request_method=item.request_method,
        request_path=item.request_path,
        status_code=item.status_code,
        user_agent=item.user_agent,
        details=item.details_json,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def list_recent_runtime_events(session: Session, *, limit: int) -> list[RuntimeEvent]:
    return list(
        session.scalars(
            select(RuntimeEvent).order_by(RuntimeEvent.created_at.desc()).limit(max(1, limit))
        ).all()
    )
