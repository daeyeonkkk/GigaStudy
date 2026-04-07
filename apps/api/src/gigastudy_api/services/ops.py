from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.ops import (
    AnalysisJobSummaryResponse,
    FailedTrackSummaryResponse,
    OpsModelVersionsResponse,
    OpsOverviewResponse,
    OpsPolicyResponse,
    OpsSummaryResponse,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import AnalysisJob, AnalysisJobStatus, MelodyDraft, Project, Track, TrackRole, TrackStatus
from gigastudy_api.services.analysis import ANALYSIS_MODEL_VERSION
from gigastudy_api.services.arrangements import ARRANGEMENT_ENGINE_VERSION
from gigastudy_api.services.melody import MELODY_MODEL_VERSION


def _count_records(session: Session, statement) -> int:
    result = session.scalar(statement)
    return int(result or 0)


def get_ops_overview(session: Session) -> OpsOverviewResponse:
    settings = get_settings()
    recent_limit = max(1, settings.ops_recent_limit)

    summary = OpsSummaryResponse(
        project_count=_count_records(
            session,
            select(func.count()).select_from(Project),
        ),
        ready_take_count=_count_records(
            session,
            select(func.count())
            .select_from(Track)
            .where(Track.track_role == TrackRole.VOCAL_TAKE, Track.track_status == TrackStatus.READY),
        ),
        failed_track_count=_count_records(
            session,
            select(func.count()).select_from(Track).where(Track.track_status == TrackStatus.FAILED),
        ),
        analysis_job_count=_count_records(
            session,
            select(func.count()).select_from(AnalysisJob),
        ),
        failed_analysis_job_count=_count_records(
            session,
            select(func.count())
            .select_from(AnalysisJob)
            .where(AnalysisJob.status == AnalysisJobStatus.FAILED),
        ),
    )

    failed_tracks = list(
        session.scalars(
            select(Track)
            .options(joinedload(Track.project))
            .where(Track.track_status == TrackStatus.FAILED)
            .order_by(Track.updated_at.desc())
            .limit(recent_limit)
        ).all()
    )
    recent_jobs = list(
        session.scalars(
            select(AnalysisJob)
            .options(joinedload(AnalysisJob.project), joinedload(AnalysisJob.track))
            .order_by(AnalysisJob.requested_at.desc())
            .limit(recent_limit)
        ).all()
    )

    analysis_versions = sorted(
        {
            ANALYSIS_MODEL_VERSION,
            *[
                value
                for value in session.scalars(select(AnalysisJob.model_version).distinct()).all()
                if value
            ],
        }
    )
    melody_versions = sorted(
        {
            MELODY_MODEL_VERSION,
            *[
                value
                for value in session.scalars(select(MelodyDraft.model_version).distinct()).all()
                if value
            ],
        }
    )

    return OpsOverviewResponse(
        summary=summary,
        policies=OpsPolicyResponse(
            analysis_timeout_seconds=settings.analysis_timeout_seconds,
            upload_session_expiry_minutes=settings.upload_session_expiry_minutes,
            recent_limit=recent_limit,
        ),
        model_versions=OpsModelVersionsResponse(
            analysis=analysis_versions,
            melody=melody_versions,
            arrangement_engine=[ARRANGEMENT_ENGINE_VERSION],
        ),
        failed_tracks=[
            FailedTrackSummaryResponse(
                track_id=track.track_id,
                project_id=track.project_id,
                project_title=track.project.title,
                track_role=track.track_role.value,
                track_status=track.track_status.value,
                take_no=track.take_no,
                source_format=track.source_format,
                failure_message=track.failure_message,
                updated_at=track.updated_at,
            )
            for track in failed_tracks
        ],
        recent_analysis_jobs=[
            AnalysisJobSummaryResponse(
                job_id=job.job_id,
                project_id=job.project_id,
                project_title=job.project.title,
                track_id=job.track_id,
                track_role=job.track.track_role.value,
                take_no=job.track.take_no,
                status=job.status.value,
                model_version=job.model_version,
                requested_at=job.requested_at,
                finished_at=job.finished_at,
                error_message=job.error_message,
            )
            for job in recent_jobs
        ],
    )
