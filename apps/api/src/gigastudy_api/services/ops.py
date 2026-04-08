from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.ops import (
    AnalysisJobSummaryResponse,
    EnvironmentValidationRunCreateRequest,
    EnvironmentValidationRunResponse,
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
    EnvironmentValidationRun,
    MelodyDraft,
    Project,
    Track,
    TrackRole,
    TrackStatus,
    ValidationOutcome,
)
from gigastudy_api.services.analysis import ANALYSIS_MODEL_VERSION
from gigastudy_api.services.arrangements import ARRANGEMENT_ENGINE_VERSION
from gigastudy_api.services.melody import MELODY_MODEL_VERSION, PYIN_FALLBACK_MODEL_VERSION
from gigastudy_api.services.projects import get_or_create_default_user


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


def list_environment_validation_runs(
    session: Session,
    *,
    limit: int,
) -> list[EnvironmentValidationRun]:
    user = get_or_create_default_user(session)
    recent_limit = max(1, limit)
    return list(
        session.scalars(
            select(EnvironmentValidationRun)
            .where(EnvironmentValidationRun.user_id == user.user_id)
            .order_by(EnvironmentValidationRun.validated_at.desc(), EnvironmentValidationRun.created_at.desc())
            .limit(recent_limit)
        ).all()
    )


def create_environment_validation_run(
    session: Session,
    payload: EnvironmentValidationRunCreateRequest,
) -> EnvironmentValidationRun:
    user = get_or_create_default_user(session)
    validation_run = EnvironmentValidationRun(
        user=user,
        label=payload.label,
        tester=payload.tester,
        device_name=payload.device_name,
        os=payload.os,
        browser=payload.browser,
        input_device=payload.input_device,
        output_route=payload.output_route,
        outcome=ValidationOutcome(payload.outcome),
        secure_context=payload.secure_context,
        microphone_permission_before=payload.microphone_permission_before,
        microphone_permission_after=payload.microphone_permission_after,
        recording_mime_type=payload.recording_mime_type,
        audio_context_mode=payload.audio_context_mode,
        offline_audio_context_mode=payload.offline_audio_context_mode,
        actual_sample_rate=payload.actual_sample_rate,
        base_latency=payload.base_latency,
        output_latency=payload.output_latency,
        warning_flags_json=payload.warning_flags,
        take_recording_succeeded=payload.take_recording_succeeded,
        analysis_succeeded=payload.analysis_succeeded,
        playback_succeeded=payload.playback_succeeded,
        audible_issues=payload.audible_issues,
        permission_issues=payload.permission_issues,
        unexpected_warnings=payload.unexpected_warnings,
        follow_up=payload.follow_up,
        notes=payload.notes,
        validated_at=payload.validated_at,
    )
    session.add(validation_run)
    session.commit()
    session.refresh(validation_run)
    return validation_run


def build_environment_validation_run_response(
    validation_run: EnvironmentValidationRun,
) -> EnvironmentValidationRunResponse:
    return EnvironmentValidationRunResponse(
        validation_run_id=validation_run.validation_run_id,
        label=validation_run.label,
        tester=validation_run.tester,
        device_name=validation_run.device_name,
        os=validation_run.os,
        browser=validation_run.browser,
        input_device=validation_run.input_device,
        output_route=validation_run.output_route,
        outcome=validation_run.outcome.value,
        secure_context=validation_run.secure_context,
        microphone_permission_before=validation_run.microphone_permission_before,
        microphone_permission_after=validation_run.microphone_permission_after,
        recording_mime_type=validation_run.recording_mime_type,
        audio_context_mode=validation_run.audio_context_mode,
        offline_audio_context_mode=validation_run.offline_audio_context_mode,
        actual_sample_rate=validation_run.actual_sample_rate,
        base_latency=validation_run.base_latency,
        output_latency=validation_run.output_latency,
        warning_flags=list(validation_run.warning_flags_json or []),
        take_recording_succeeded=validation_run.take_recording_succeeded,
        analysis_succeeded=validation_run.analysis_succeeded,
        playback_succeeded=validation_run.playback_succeeded,
        audible_issues=validation_run.audible_issues,
        permission_issues=validation_run.permission_issues,
        unexpected_warnings=validation_run.unexpected_warnings,
        follow_up=validation_run.follow_up,
        notes=validation_run.notes,
        validated_at=validation_run.validated_at,
        created_at=validation_run.created_at,
        updated_at=validation_run.updated_at,
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
    recent_validation_runs = list_environment_validation_runs(session, limit=recent_limit)

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
            PYIN_FALLBACK_MODEL_VERSION,
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
        recent_environment_validation_runs=[
            build_environment_validation_run_response(validation_run)
            for validation_run in recent_validation_runs
        ],
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
