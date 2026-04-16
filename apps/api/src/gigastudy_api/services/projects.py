from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from gigastudy_api.api.schemas.projects import (
    ProjectCreateRequest,
    ProjectLaunchSummaryResponse,
    ProjectUpdateRequest,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Project, TrackRole, TrackStatus, User


def get_or_create_default_user(session: Session) -> User:
    settings = get_settings()

    existing_user = session.scalar(
        select(User).where(User.nickname == settings.default_user_nickname)
    )
    if existing_user is not None:
        return existing_user

    user = User(nickname=settings.default_user_nickname)
    session.add(user)
    captured_error: IntegrityError | None = None
    try:
        session.flush()
        return user
    except IntegrityError as error:
        captured_error = error
        session.rollback()

    existing_user = session.scalar(
        select(User).where(User.nickname == settings.default_user_nickname)
    )
    if existing_user is None:
        raise captured_error

    return existing_user


def create_project(session: Session, payload: ProjectCreateRequest) -> Project:
    user = get_or_create_default_user(session)
    project = Project(
        user=user,
        title=payload.title,
        bpm=payload.bpm,
        base_key=payload.base_key,
        time_signature=payload.time_signature,
        mode=payload.mode,
        chord_timeline_json=(
            [item.model_dump(mode="json") for item in payload.chord_timeline_json]
            if payload.chord_timeline_json is not None
            else None
        ),
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def list_projects(session: Session) -> list[Project]:
    statement = (
        select(Project)
        .options(
            selectinload(Project.tracks),
            selectinload(Project.arrangements),
        )
        .order_by(Project.updated_at.desc(), Project.created_at.desc())
    )
    return list(session.scalars(statement))


def get_project_by_id(session: Session, project_id: UUID) -> Project | None:
    return session.get(Project, project_id)


def build_project_launch_summary(project: Project) -> ProjectLaunchSummaryResponse:
    guide_tracks = [
        track
        for track in project.tracks
        if track.track_role == TrackRole.GUIDE and track.track_status == TrackStatus.READY
    ]
    take_tracks = [track for track in project.tracks if track.track_role == TrackRole.VOCAL_TAKE]
    ready_take_tracks = [track for track in take_tracks if track.track_status == TrackStatus.READY]
    mixdown_tracks = [
        track
        for track in project.tracks
        if track.track_role == TrackRole.MIXDOWN and track.track_status == TrackStatus.READY
    ]

    return ProjectLaunchSummaryResponse(
        has_guide=bool(guide_tracks),
        take_count=len(take_tracks),
        ready_take_count=len(ready_take_tracks),
        arrangement_count=len(project.arrangements),
        has_mixdown=bool(mixdown_tracks),
    )


def update_project(session: Session, project_id: UUID, payload: ProjectUpdateRequest) -> Project | None:
    project = session.get(Project, project_id)
    if project is None:
        return None

    if payload.title is not None:
        project.title = payload.title
    if payload.bpm is not None:
        project.bpm = payload.bpm
    if payload.base_key is not None:
        project.base_key = payload.base_key
    if payload.time_signature is not None:
        project.time_signature = payload.time_signature
    if payload.mode is not None:
        project.mode = payload.mode
    if payload.chord_timeline_json is not None:
        project.chord_timeline_json = [item.model_dump(mode="json") for item in payload.chord_timeline_json]

    session.commit()
    session.refresh(project)
    return project
