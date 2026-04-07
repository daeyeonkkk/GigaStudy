from datetime import datetime, timedelta, timezone
import secrets
from uuid import UUID

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.device_profiles import DeviceProfileResponse
from gigastudy_api.api.schemas.project_history import (
    ProjectVersionCreateRequest,
    ProjectVersionListResponse,
    ProjectVersionResponse,
    ShareLinkCreateRequest,
    ShareLinkListResponse,
    ShareLinkResponse,
    SharedProjectResponse,
    SnapshotSummaryResponse,
)
from gigastudy_api.api.schemas.projects import ProjectResponse
from gigastudy_api.api.schemas.studio import StudioSnapshotResponse
from gigastudy_api.db.models import (
    ProjectVersion,
    ProjectVersionSource,
    ShareAccessScope,
    ShareLink,
)
from gigastudy_api.services.arrangements import build_arrangement_response
from gigastudy_api.services.guides import build_guide_response
from gigastudy_api.services.mixdowns import build_mixdown_response
from gigastudy_api.services.projects import get_project_by_id
from gigastudy_api.services.studio import get_studio_snapshot
from gigastudy_api.services.takes import build_take_response


def _get_project_or_404(session: Session, project_id: UUID):
    project = get_project_by_id(session, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return project


def _build_studio_snapshot_response(
    session: Session,
    project_id: UUID,
    request: Request,
) -> StudioSnapshotResponse:
    snapshot = get_studio_snapshot(session, project_id)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return StudioSnapshotResponse(
        project=ProjectResponse.model_validate(snapshot.project),
        guide=build_guide_response(snapshot.guide, request) if snapshot.guide else None,
        takes=[build_take_response(track, request) for track in snapshot.takes],
        latest_device_profile=(
            DeviceProfileResponse.model_validate(snapshot.latest_device_profile)
            if snapshot.latest_device_profile
            else None
        ),
        mixdown=build_mixdown_response(snapshot.mixdown, request) if snapshot.mixdown else None,
        arrangement_generation_id=str(snapshot.arrangement_generation_id) if snapshot.arrangement_generation_id else None,
        arrangements=[build_arrangement_response(item, request) for item in snapshot.arrangements],
    )


def _build_snapshot_summary(snapshot_json: dict) -> SnapshotSummaryResponse:
    takes = snapshot_json.get("takes", []) if isinstance(snapshot_json.get("takes"), list) else []
    arrangements = (
        snapshot_json.get("arrangements", []) if isinstance(snapshot_json.get("arrangements"), list) else []
    )
    ready_take_count = sum(1 for take in takes if take.get("track_status") == "READY")

    return SnapshotSummaryResponse(
        has_guide=isinstance(snapshot_json.get("guide"), dict),
        take_count=len(takes),
        ready_take_count=ready_take_count,
        arrangement_count=len(arrangements),
        has_mixdown=isinstance(snapshot_json.get("mixdown"), dict),
    )


def _sanitize_shared_snapshot(snapshot_json: dict) -> dict:
    shared_snapshot = {
        key: value
        for key, value in snapshot_json.items()
        if key != "latest_device_profile"
    }

    def sanitize_track(track: dict | None) -> dict | None:
        if not isinstance(track, dict):
            return None

        sanitized = {**track}
        if "storage_key" in sanitized:
            sanitized["storage_key"] = None
        if "checksum" in sanitized:
            sanitized["checksum"] = None
        return sanitized

    shared_snapshot["guide"] = sanitize_track(shared_snapshot.get("guide"))
    shared_snapshot["mixdown"] = sanitize_track(shared_snapshot.get("mixdown"))
    shared_snapshot["takes"] = [
        sanitize_track(track) for track in shared_snapshot.get("takes", []) if isinstance(track, dict)
    ]
    return shared_snapshot


def _default_snapshot_label(source_type: ProjectVersionSource, now: datetime) -> str:
    prefix = "Shared snapshot" if source_type == ProjectVersionSource.SHARE_LINK else "Studio snapshot"
    return f"{prefix} {now.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"


def _build_version_response(version: ProjectVersion) -> ProjectVersionResponse:
    snapshot_json = version.snapshot_json if isinstance(version.snapshot_json, dict) else {}
    return ProjectVersionResponse(
        version_id=version.version_id,
        project_id=version.project_id,
        source_type=version.source_type.value,
        label=version.label,
        note=version.note,
        snapshot_summary=_build_snapshot_summary(snapshot_json),
        created_at=version.created_at,
        updated_at=version.updated_at,
    )


def _build_share_url(request: Request, token: str) -> str:
    return str(request.base_url.replace(path=f"shared/{token}"))


def _coerce_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _build_share_link_response(share_link: ShareLink, request: Request) -> ShareLinkResponse:
    return ShareLinkResponse(
        share_link_id=share_link.share_link_id,
        project_id=share_link.project_id,
        version_id=share_link.version_id,
        label=share_link.label,
        access_scope=share_link.access_scope.value,
        is_active=share_link.is_active,
        expires_at=share_link.expires_at,
        last_accessed_at=share_link.last_accessed_at,
        share_url=_build_share_url(request, share_link.token),
        created_at=share_link.created_at,
        updated_at=share_link.updated_at,
    )


def _generate_unique_share_token(session: Session) -> str:
    while True:
        token = secrets.token_urlsafe(18)
        existing = session.scalar(select(ShareLink).where(ShareLink.token == token))
        if existing is None:
            return token


def create_project_version(
    session: Session,
    project_id: UUID,
    payload: ProjectVersionCreateRequest,
    request: Request,
    source_type: ProjectVersionSource = ProjectVersionSource.MANUAL_SNAPSHOT,
) -> ProjectVersionResponse:
    project = _get_project_or_404(session, project_id)
    snapshot_response = _build_studio_snapshot_response(session, project.project_id, request)
    snapshot_json = snapshot_response.model_dump(mode="json")
    now = datetime.now(timezone.utc)
    version = ProjectVersion(
        project_id=project.project_id,
        source_type=source_type,
        label=payload.label or _default_snapshot_label(source_type, now),
        note=payload.note,
        snapshot_json=snapshot_json,
        created_at=now,
        updated_at=now,
    )
    session.add(version)
    session.commit()
    session.refresh(version)
    return _build_version_response(version)


def list_project_versions(session: Session, project_id: UUID) -> ProjectVersionListResponse:
    _get_project_or_404(session, project_id)
    versions = list(
        session.scalars(
            select(ProjectVersion)
            .where(ProjectVersion.project_id == project_id)
            .order_by(ProjectVersion.created_at.desc())
        ).all()
    )
    return ProjectVersionListResponse(items=[_build_version_response(version) for version in versions])


def _get_project_version_or_404(session: Session, version_id: UUID) -> ProjectVersion:
    version = session.get(ProjectVersion, version_id)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project version not found")

    return version


def create_share_link(
    session: Session,
    project_id: UUID,
    payload: ShareLinkCreateRequest,
    request: Request,
) -> ShareLinkResponse:
    project = _get_project_or_404(session, project_id)
    now = datetime.now(timezone.utc)

    if payload.version_id is not None:
        version = _get_project_version_or_404(session, payload.version_id)
        if version.project_id != project.project_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Version does not match project")
    else:
        snapshot_response = _build_studio_snapshot_response(session, project.project_id, request)
        version = ProjectVersion(
            project_id=project.project_id,
            source_type=ProjectVersionSource.SHARE_LINK,
            label=payload.label or _default_snapshot_label(ProjectVersionSource.SHARE_LINK, now),
            note="Captured automatically for a read-only share link.",
            snapshot_json=snapshot_response.model_dump(mode="json"),
            created_at=now,
            updated_at=now,
        )
        session.add(version)
        session.flush()

    share_link = ShareLink(
        project_id=project.project_id,
        version_id=version.version_id,
        token=_generate_unique_share_token(session),
        label=payload.label or version.label,
        access_scope=ShareAccessScope.READ_ONLY,
        is_active=True,
        expires_at=now + timedelta(days=payload.expires_in_days),
        created_at=now,
        updated_at=now,
    )
    session.add(share_link)
    session.commit()
    session.refresh(share_link)
    return _build_share_link_response(share_link, request)


def list_share_links(session: Session, project_id: UUID, request: Request) -> ShareLinkListResponse:
    _get_project_or_404(session, project_id)
    share_links = list(
        session.scalars(
            select(ShareLink)
            .where(ShareLink.project_id == project_id)
            .order_by(ShareLink.created_at.desc())
        ).all()
    )
    return ShareLinkListResponse(
        items=[_build_share_link_response(share_link, request) for share_link in share_links]
    )


def deactivate_share_link(session: Session, share_link_id: UUID, request: Request) -> ShareLinkResponse:
    share_link = session.get(ShareLink, share_link_id)
    if share_link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    share_link.is_active = False
    share_link.updated_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(share_link)
    return _build_share_link_response(share_link, request)


def get_shared_project_response(
    session: Session,
    token: str,
) -> SharedProjectResponse:
    share_link = session.scalar(
        select(ShareLink)
        .options(joinedload(ShareLink.version))
        .where(ShareLink.token == token)
    )
    if share_link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    if not share_link.is_active:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link is inactive")

    now = datetime.now(timezone.utc)
    expires_at = _coerce_utc_datetime(share_link.expires_at)
    if expires_at is not None and expires_at <= now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link has expired")

    share_link.last_accessed_at = now
    share_link.updated_at = now
    session.commit()
    session.refresh(share_link)

    version = share_link.version
    snapshot_json = version.snapshot_json if isinstance(version.snapshot_json, dict) else {}
    shared_snapshot = _sanitize_shared_snapshot(snapshot_json)
    return SharedProjectResponse(
        share_link_id=share_link.share_link_id,
        label=share_link.label,
        access_scope=share_link.access_scope.value,
        expires_at=share_link.expires_at,
        version_id=version.version_id,
        version_label=version.label,
        version_source_type=version.source_type.value,
        version_created_at=version.created_at,
        snapshot_summary=_build_snapshot_summary(snapshot_json),
        project=ProjectResponse.model_validate(shared_snapshot["project"]),
        guide=shared_snapshot.get("guide"),
        takes=shared_snapshot.get("takes", []),
        mixdown=shared_snapshot.get("mixdown"),
        arrangement_generation_id=shared_snapshot.get("arrangement_generation_id"),
        arrangements=shared_snapshot.get("arrangements", []),
    )
