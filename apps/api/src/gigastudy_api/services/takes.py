from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import mimetypes
import re
from uuid import UUID

from fastapi import HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.tracks import (
    TakeCompleteRequest,
    TakeCreateRequest,
    TakeTrackResponse,
    TakeUploadInitRequest,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import Artifact, ArtifactType, Project, Track, TrackRole, TrackStatus


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


def _get_track_source_artifact(track: Track) -> Artifact | None:
    for artifact in track.artifacts:
        if artifact.artifact_type == ArtifactType.SOURCE_AUDIO:
            return artifact

    return None


def _probe_stored_upload(track: Track) -> tuple[Path, int, str]:
    if not track.storage_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track storage key is missing")

    file_path = _get_storage_root() / track.storage_key
    if not file_path.exists():
        track.track_status = TrackStatus.FAILED
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file not found")

    file_bytes = file_path.read_bytes()
    if not file_bytes:
        track.track_status = TrackStatus.FAILED
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    return file_path, len(file_bytes), sha256(file_bytes).hexdigest()


def _get_next_take_no(session: Session, project_id: UUID) -> int:
    current_max = session.scalar(
        select(func.max(Track.take_no)).where(
            Track.project_id == project_id,
            Track.track_role == TrackRole.VOCAL_TAKE,
        )
    )
    return 1 if current_max is None else int(current_max) + 1


def create_take_track(
    session: Session,
    project_id: UUID,
    payload: TakeCreateRequest,
) -> Track:
    project = _get_project_or_404(session, project_id)
    now = datetime.now(timezone.utc)

    track = Track(
        project=project,
        track_role=TrackRole.VOCAL_TAKE,
        track_status=TrackStatus.PENDING_UPLOAD,
        part_type=payload.part_type,
        take_no=_get_next_take_no(session, project_id),
        recording_started_at=payload.recording_started_at,
        recording_finished_at=payload.recording_finished_at,
        created_at=now,
        updated_at=now,
    )
    session.add(track)
    session.commit()
    session.refresh(track)
    return track


def create_take_upload_session(
    session: Session,
    track_id: UUID,
    payload: TakeUploadInitRequest,
) -> Track:
    track = _get_track_or_404(session, track_id)
    if track.track_role != TrackRole.VOCAL_TAKE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track is not a vocal take")

    filename = _sanitize_filename(payload.filename, f"take-{track.take_no or 'x'}")
    track.storage_key = f"projects/{track.project_id}/takes/take-{track.take_no or 'x'}-{filename}"
    track.source_format = payload.content_type
    track.track_status = TrackStatus.PENDING_UPLOAD
    track.updated_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(track)
    return track


def complete_take_upload(
    session: Session,
    track_id: UUID,
    payload: TakeCompleteRequest,
) -> Track:
    track = _get_track_or_404(session, track_id)
    if track.track_role != TrackRole.VOCAL_TAKE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Track is not a vocal take")

    try:
        file_path, byte_size, checksum = _probe_stored_upload(track)
    except HTTPException:
        track.updated_at = datetime.now(timezone.utc)
        session.commit()
        raise

    source_format = payload.source_format or track.source_format or mimetypes.guess_type(file_path.name)[0]
    track.track_status = TrackStatus.READY
    track.source_format = source_format
    track.duration_ms = payload.duration_ms
    track.actual_sample_rate = payload.actual_sample_rate
    track.checksum = checksum
    track.updated_at = datetime.now(timezone.utc)

    source_artifact = _get_track_source_artifact(track)
    if source_artifact is None:
        source_artifact = Artifact(
            project_id=track.project_id,
            track=track,
            artifact_type=ArtifactType.SOURCE_AUDIO,
            storage_key=str(file_path),
            created_at=track.updated_at,
            updated_at=track.updated_at,
        )
        session.add(source_artifact)

    source_artifact.storage_key = str(file_path)
    source_artifact.mime_type = source_format
    source_artifact.byte_size = byte_size
    source_artifact.updated_at = track.updated_at
    source_artifact.meta_json = {
        "project_storage_key": track.storage_key,
        "checksum": checksum,
        "take_no": track.take_no,
    }

    session.commit()

    refreshed_track = session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.track_id == track.track_id)
    )
    assert refreshed_track is not None
    return refreshed_track


def list_take_tracks(session: Session, project_id: UUID) -> list[Track]:
    _get_project_or_404(session, project_id)

    query = (
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.project_id == project_id, Track.track_role == TrackRole.VOCAL_TAKE)
        .order_by(Track.take_no.desc(), Track.created_at.desc())
    )

    return list(session.execute(query).unique().scalars().all())


def build_take_response(track: Track, request: Request) -> TakeTrackResponse:
    source_artifact = _get_track_source_artifact(track)
    download_url = (
        str(request.url_for("download_track_source_audio", track_id=str(track.track_id)))
        if source_artifact is not None
        else None
    )

    return TakeTrackResponse(
        track_id=track.track_id,
        project_id=track.project_id,
        track_role=track.track_role.value,
        track_status=track.track_status.value,
        take_no=track.take_no,
        part_type=track.part_type,
        source_format=track.source_format,
        duration_ms=track.duration_ms,
        actual_sample_rate=track.actual_sample_rate,
        storage_key=track.storage_key,
        checksum=track.checksum,
        recording_started_at=track.recording_started_at,
        recording_finished_at=track.recording_finished_at,
        source_artifact_url=download_url,
        created_at=track.created_at,
        updated_at=track.updated_at,
    )
