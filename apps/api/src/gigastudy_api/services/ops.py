from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.ops import (
    AnalysisJobSummaryResponse,
    FailedTrackSummaryResponse,
    OpsEnvironmentBrowserResponse,
    OpsEnvironmentDiagnosticsResponse,
    OpsEnvironmentProfileResponse,
    OpsEnvironmentSummaryResponse,
    OpsEnvironmentWarningResponse,
    OpsModelVersionsResponse,
    OpsOverviewResponse,
    OpsPolicyResponse,
    OpsSummaryResponse,
)
from gigastudy_api.config import get_settings
from gigastudy_api.db.models import (
    AnalysisJob,
    AnalysisJobStatus,
    DeviceProfile,
    MelodyDraft,
    Project,
    Track,
    TrackRole,
    TrackStatus,
)
from gigastudy_api.services.analysis import ANALYSIS_MODEL_VERSION
from gigastudy_api.services.arrangements import ARRANGEMENT_ENGINE_VERSION
from gigastudy_api.services.melody import MELODY_MODEL_VERSION


def _count_records(session: Session, statement) -> int:
    result = session.scalar(statement)
    return int(result or 0)


def _read_capability_path(capabilities: dict | None, *path: str) -> str | None:
    if not isinstance(capabilities, dict):
        return None

    current: object = capabilities
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)

    return current if isinstance(current, str) else None


def _build_environment_diagnostics(
    session: Session,
    *,
    recent_limit: int,
) -> OpsEnvironmentDiagnosticsResponse:
    device_profiles = list(
        session.scalars(
            select(DeviceProfile).order_by(DeviceProfile.updated_at.desc())
        ).all()
    )

    warning_counter: Counter[str] = Counter()
    browser_matrix: dict[tuple[str, str], OpsEnvironmentBrowserResponse] = {}
    recent_profiles: list[OpsEnvironmentProfileResponse] = []
    profiles_with_warnings = 0

    for profile in device_profiles:
        warning_flags = list(profile.diagnostic_flags_json or [])
        if warning_flags:
            profiles_with_warnings += 1
            warning_counter.update(warning_flags)

        matrix_key = (profile.browser, profile.os)
        existing_bucket = browser_matrix.get(matrix_key)
        if existing_bucket is None:
            browser_matrix[matrix_key] = OpsEnvironmentBrowserResponse(
                browser=profile.browser,
                os=profile.os,
                profile_count=1,
                warning_profile_count=1 if warning_flags else 0,
                latest_seen_at=profile.updated_at,
            )
        else:
            existing_bucket.profile_count += 1
            if warning_flags:
                existing_bucket.warning_profile_count += 1
            if profile.updated_at > existing_bucket.latest_seen_at:
                existing_bucket.latest_seen_at = profile.updated_at

        if len(recent_profiles) < recent_limit:
            recent_profiles.append(
                OpsEnvironmentProfileResponse(
                    device_profile_id=profile.device_profile_id,
                    browser=profile.browser,
                    os=profile.os,
                    browser_user_agent=profile.browser_user_agent,
                    output_route=profile.output_route,
                    actual_sample_rate=profile.actual_sample_rate,
                    base_latency=profile.base_latency,
                    output_latency=profile.output_latency,
                    microphone_permission=_read_capability_path(
                        profile.capabilities_json,
                        "permissions",
                        "microphone",
                    ),
                    recording_mime_type=_read_capability_path(
                        profile.capabilities_json,
                        "media_recorder",
                        "selected_mime_type",
                    ),
                    audio_context_mode=_read_capability_path(
                        profile.capabilities_json,
                        "web_audio",
                        "audio_context_mode",
                    ),
                    offline_audio_context_mode=_read_capability_path(
                        profile.capabilities_json,
                        "web_audio",
                        "offline_audio_context_mode",
                    ),
                    warning_flags=warning_flags,
                    updated_at=profile.updated_at,
                )
            )

    sorted_browser_matrix = sorted(
        browser_matrix.values(),
        key=lambda item: (-item.warning_profile_count, -item.profile_count, item.browser, item.os),
    )
    sorted_warning_flags = [
        OpsEnvironmentWarningResponse(flag=flag, profile_count=count)
        for flag, count in warning_counter.most_common()
    ]

    return OpsEnvironmentDiagnosticsResponse(
        summary=OpsEnvironmentSummaryResponse(
            total_device_profiles=len(device_profiles),
            profiles_with_warnings=profiles_with_warnings,
            browser_family_count=len({profile.browser for profile in device_profiles}),
            warning_flag_count=len(sorted_warning_flags),
        ),
        browser_matrix=sorted_browser_matrix,
        warning_flags=sorted_warning_flags,
        recent_profiles=recent_profiles,
    )


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
        environment_diagnostics=_build_environment_diagnostics(
            session,
            recent_limit=recent_limit,
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
