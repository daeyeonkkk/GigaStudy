from datetime import datetime, timezone
from pathlib import Path
import re
from uuid import UUID

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.guides import (
    GuideCompleteRequest,
    GuideTrackResponse,
    GuideUploadInitRequest,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Artifact, Project, Track, TrackRole, TrackStatus
from gigastudy_api.services.processing import (
    get_track_canonical_artifact,
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
def create_guide_upload_session(
    session: Session,
    project_id: UUID,
    payload: GuideUploadInitRequest,
) -> Track:
    project = _get_project_or_404(session, project_id)
    filename = _sanitize_filename(payload.filename, "guide")
    storage_key = f"projects/{project.project_id}/guides/{filename}"
    now = datetime.now(timezone.utc)

    track = Track(
        project=project,
        track_role=TrackRole.GUIDE,
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


def store_track_upload(session: Session, track_id: UUID, payload: bytes) -> Track:
    track = _get_track_or_404(session, track_id)
    if not track.storage_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track storage key is missing")

    storage_root = _get_storage_root()
    file_path = storage_root / track.storage_key
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(payload)

    track.track_status = TrackStatus.UPLOADING
    track.updated_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(track)
    return track
def complete_guide_upload(
    session: Session,
    project_id: UUID,
    payload: GuideCompleteRequest,
) -> Track:
    track = _get_track_or_404(session, payload.track_id)
    if track.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Guide track does not match project")
    if track.track_role != TrackRole.GUIDE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track is not a guide")
    if payload.source_format:
        track.source_format = payload.source_format
    if payload.duration_ms is not None:
        track.duration_ms = payload.duration_ms
    if payload.actual_sample_rate is not None:
        track.actual_sample_rate = payload.actual_sample_rate
    track.updated_at = datetime.now(timezone.utc)
    session.commit()

    return process_uploaded_track(session, track.track_id)


def get_latest_guide(session: Session, project_id: UUID) -> Track | None:
    _get_project_or_404(session, project_id)

    return session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.project_id == project_id, Track.track_role == TrackRole.GUIDE)
        .order_by(Track.updated_at.desc())
        .limit(1)
    )


def build_guide_response(track: Track, request: Request) -> GuideTrackResponse:
    source_artifact = get_track_playback_artifact(track)
    canonical_artifact = get_track_canonical_artifact(track)
    download_url = (
        str(request.url_for("download_track_source_audio", track_id=str(track.track_id)))
        if source_artifact is not None
        else None
    )
    canonical_download_url = (
        str(request.url_for("download_track_canonical_audio", track_id=str(track.track_id)))
        if canonical_artifact is not None
        else None
    )
    preview_data = get_track_preview_data(track)

    return GuideTrackResponse(
        track_id=track.track_id,
        project_id=track.project_id,
        track_role=track.track_role.value,
        track_status=track.track_status.value,
        source_format=track.source_format,
        duration_ms=track.duration_ms,
        actual_sample_rate=track.actual_sample_rate,
        storage_key=track.storage_key,
        checksum=track.checksum,
        source_artifact_url=download_url,
        guide_wav_artifact_url=canonical_download_url,
        preview_data=preview_data,
        created_at=track.created_at,
        updated_at=track.updated_at,
    )


def get_track_source_path(session: Session, track_id: UUID) -> tuple[Track, Artifact]:
    track = session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.track_id == track_id)
    )
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    source_artifact = get_track_playback_artifact(track)
    if source_artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playable audio not found")

    source_path = Path(source_artifact.storage_key)
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file not found")

    return track, source_artifact


def get_track_canonical_path(session: Session, track_id: UUID) -> tuple[Track, Artifact]:
    track = session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.track_id == track_id)
    )
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    canonical_artifact = get_track_canonical_artifact(track)
    if canonical_artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canonical WAV not found")

    canonical_path = Path(canonical_artifact.storage_key)
    if not canonical_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored WAV file not found")

    return track, canonical_artifact
