from uuid import UUID

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.guides import GuideCompleteRequest
from gigastudy_api.api.schemas.mixdowns import MixdownCompleteRequest
from gigastudy_api.api.schemas.processing import TrackProcessingRetryResponse
from gigastudy_api.api.schemas.tracks import TakeCompleteRequest
from gigastudy_api.db.models import Track, TrackRole
from gigastudy_api.services.guides import complete_guide_upload, get_track_playback_artifact
from gigastudy_api.services.mixdowns import complete_mixdown_upload
from gigastudy_api.services.takes import complete_take_upload


def _get_track_or_404(session: Session, track_id: UUID) -> Track:
    track = session.scalar(
        select(Track)
        .options(joinedload(Track.artifacts))
        .where(Track.track_id == track_id)
    )
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return track


def retry_track_processing(session: Session, track_id: UUID) -> Track:
    track = _get_track_or_404(session, track_id)
    if not track.storage_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Track storage key is missing, so processing cannot be retried",
        )

    if track.track_role == TrackRole.GUIDE:
        return complete_guide_upload(
            session,
            track.project_id,
            GuideCompleteRequest(
                track_id=track.track_id,
                source_format=track.source_format,
                duration_ms=track.duration_ms,
                actual_sample_rate=track.actual_sample_rate,
            ),
        )

    if track.track_role == TrackRole.VOCAL_TAKE:
        return complete_take_upload(
            session,
            track.track_id,
            TakeCompleteRequest(
                source_format=track.source_format,
                duration_ms=track.duration_ms,
                actual_sample_rate=track.actual_sample_rate,
            ),
        )

    if track.track_role == TrackRole.MIXDOWN:
        return complete_mixdown_upload(
            session,
            track.project_id,
            MixdownCompleteRequest(
                track_id=track.track_id,
                source_format=track.source_format,
                duration_ms=track.duration_ms,
                actual_sample_rate=track.actual_sample_rate,
            ),
        )

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported track role")


def build_processing_retry_response(
    track: Track,
    request: Request,
) -> TrackProcessingRetryResponse:
    playback_artifact = get_track_playback_artifact(track)
    download_url = (
        str(request.url_for("download_track_source_audio", track_id=str(track.track_id)))
        if playback_artifact is not None
        else None
    )

    return TrackProcessingRetryResponse(
        track_id=track.track_id,
        project_id=track.project_id,
        track_role=track.track_role.value,
        track_status=track.track_status.value,
        source_artifact_url=download_url,
        updated_at=track.updated_at,
    )
