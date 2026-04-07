from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.db.models import Arrangement
from gigastudy_api.db.models import DeviceProfile, Project, Track, TrackRole
from gigastudy_api.services.arrangements import list_latest_arrangements
from gigastudy_api.services.guides import get_latest_guide
from gigastudy_api.services.projects import get_or_create_default_user, get_project_by_id
from gigastudy_api.services.takes import list_take_tracks


@dataclass
class StudioSnapshot:
    project: Project
    guide: Track | None
    takes: list[Track]
    latest_device_profile: DeviceProfile | None
    mixdown: Track | None
    arrangement_generation_id: UUID | None
    arrangements: list[Arrangement]


def get_latest_device_profile(session: Session) -> DeviceProfile | None:
    user = get_or_create_default_user(session)
    return session.scalar(
        select(DeviceProfile)
        .where(DeviceProfile.user_id == user.user_id)
        .order_by(DeviceProfile.updated_at.desc())
        .limit(1)
    )


def get_latest_mixdown(session: Session, project_id: UUID) -> Track | None:
    return session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.project_id == project_id, Track.track_role == TrackRole.MIXDOWN)
        .order_by(Track.updated_at.desc())
        .limit(1)
    )


def get_studio_snapshot(session: Session, project_id: UUID) -> StudioSnapshot | None:
    project = get_project_by_id(session, project_id)
    if project is None:
        return None

    arrangement_generation_id, arrangements = list_latest_arrangements(session, project_id)

    return StudioSnapshot(
        project=project,
        guide=get_latest_guide(session, project_id),
        takes=list_take_tracks(session, project_id),
        latest_device_profile=get_latest_device_profile(session),
        mixdown=get_latest_mixdown(session, project_id),
        arrangement_generation_id=arrangement_generation_id,
        arrangements=arrangements,
    )
