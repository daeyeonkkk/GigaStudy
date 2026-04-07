from datetime import datetime, timezone
from pathlib import Path
import re
from uuid import UUID

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.mixdowns import (
    MixdownCompleteRequest,
    MixdownTrackResponse,
    MixdownUploadInitRequest,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Project, Track, TrackRole, TrackStatus
from gigastudy_api.services.processing import (
    get_track_playback_artifact,
    get_track_preview_data,
    process_uploaded_track,
)


SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _get_storage_root() -> Path:
    settings = get_settings()
    return Path(settings.storage_root).resolve()


def _sanitize_filename(filename: str | None, fallback_stem: str) -> str:
    if filename:
        cleaned = SAFE_FILENAME_RE.sub("-", filename).strip(".-")
        if cleaned:
            return cleaned

    return f"{fallback_stem}.bin"


def _get_project_or_404(session: Session, project_id: UUID) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return project


def _get_track_or_404(session: Session, track_id: UUID) -> Track:
    track = session.get(Track, track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return track
def create_mixdown_upload_session(
    session: Session,
    project_id: UUID,
    payload: MixdownUploadInitRequest,
) -> Track:
    project = _get_project_or_404(session, project_id)
    filename = _sanitize_filename(payload.filename, "mixdown")
    storage_key = f"projects/{project.project_id}/mixdowns/{filename}"
    now = datetime.now(timezone.utc)

    track = Track(
        project=project,
        track_role=TrackRole.MIXDOWN,
        track_status=TrackStatus.PENDING_UPLOAD,
        storage_key=storage_key,
        source_format=payload.content_type,
        created_at=now,
        updated_at=now,
    )
    session.add(track)
    session.commit()
    session.refresh(track)
    return track
def complete_mixdown_upload(
    session: Session,
    project_id: UUID,
    payload: MixdownCompleteRequest,
) -> Track:
    track = _get_track_or_404(session, payload.track_id)
    if track.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mixdown track does not match project")
    if track.track_role != TrackRole.MIXDOWN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track is not a mixdown")
    if payload.source_format:
        track.source_format = payload.source_format
    if payload.duration_ms is not None:
        track.duration_ms = payload.duration_ms
    if payload.actual_sample_rate is not None:
        track.actual_sample_rate = payload.actual_sample_rate
    track.updated_at = datetime.now(timezone.utc)
    session.commit()

    return process_uploaded_track(session, track.track_id)


def build_mixdown_response(track: Track, request: Request) -> MixdownTrackResponse:
    playback_artifact = get_track_playback_artifact(track)
    download_url = (
        str(request.url_for("download_track_source_audio", track_id=str(track.track_id)))
        if playback_artifact is not None
        else None
    )
    preview_data = get_track_preview_data(track)

    return MixdownTrackResponse(
        track_id=track.track_id,
        project_id=track.project_id,
        track_role=track.track_role.value,
        track_status=track.track_status.value,
        source_format=track.source_format,
        duration_ms=track.duration_ms,
        actual_sample_rate=track.actual_sample_rate,
        storage_key=track.storage_key,
        checksum=track.checksum,
        failure_message=track.failure_message,
        source_artifact_url=download_url,
        preview_data=preview_data,
        created_at=track.created_at,
        updated_at=track.updated_at,
    )
