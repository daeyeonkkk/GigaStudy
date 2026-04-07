from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from gigastudy_api.api.schemas.projects import ProjectCreateRequest
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Project, User


def get_or_create_default_user(session: Session) -> User:
    settings = get_settings()

    existing_user = session.scalar(
        select(User).where(User.nickname == settings.default_user_nickname)
    )
    if existing_user is not None:
        return existing_user

    user = User(nickname=settings.default_user_nickname)
    session.add(user)
    session.flush()
    return user


def create_project(session: Session, payload: ProjectCreateRequest) -> Project:
    user = get_or_create_default_user(session)
    project = Project(
        user=user,
        title=payload.title,
        bpm=payload.bpm,
        base_key=payload.base_key,
        time_signature=payload.time_signature,
        mode=payload.mode,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def get_project_by_id(session: Session, project_id: UUID) -> Project | None:
    return session.get(Project, project_id)
