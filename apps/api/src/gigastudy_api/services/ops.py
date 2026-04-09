from datetime import datetime, timezone
from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.ops import (
    AnalysisJobSummaryResponse,
    EnvironmentValidationRunCreateRequest,
    EnvironmentValidationMatrixCellResponse,
    EnvironmentValidationPacketResponse,
    EnvironmentValidationPacketSummaryResponse,
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


def build_environment_validation_packet(session: Session) -> EnvironmentValidationPacketResponse:
    settings = get_settings()
    recent_limit = max(1, settings.ops_recent_limit)
    diagnostics = _build_environment_diagnostics(session, recent_limit=recent_limit)
    validation_runs = list_environment_validation_runs(session, limit=max(recent_limit, 50))
    validation_run_responses = [
        build_environment_validation_run_response(validation_run)
        for validation_run in validation_runs
    ]

    matrix_labels = (
        ("Windows + Chrome + USB microphone + wired headphones", _matches_windows_chrome_usb_headphones),
        ("Windows + Firefox + built-in microphone + built-in speakers", _matches_windows_firefox_builtin),
        ("macOS + Safari + built-in microphone + built-in speakers", _matches_macos_safari_builtin),
        ("macOS + Safari + Bluetooth output", _matches_macos_safari_bluetooth),
        ("macOS + Chrome + wired headphones", _matches_macos_chrome_wired),
        ("iPadOS or iOS Safari", _matches_mobile_safari),
    )

    required_matrix = [
        EnvironmentValidationMatrixCellResponse(
            label=label,
            covered=(match_count := sum(1 for run in validation_runs if matcher(run))) > 0,
            run_count=match_count,
        )
        for label, matcher in matrix_labels
    ]

    pass_runs = sum(1 for run in validation_runs if run.outcome == ValidationOutcome.PASS)
    warn_runs = sum(1 for run in validation_runs if run.outcome == ValidationOutcome.WARN)
    fail_runs = sum(1 for run in validation_runs if run.outcome == ValidationOutcome.FAIL)
    native_safari_runs = sum(1 for run in validation_runs if _is_native_safari_like(run))
    real_hardware_recording_successes = sum(
        1
        for run in validation_runs
        if run.take_recording_succeeded is True and _looks_like_real_hardware_run(run)
    )

    claim_guardrails = _build_environment_claim_guardrails(
        validation_runs=validation_runs,
        diagnostics=diagnostics,
        required_matrix=required_matrix,
    )
    compatibility_notes = _build_environment_compatibility_notes(
        validation_runs=validation_runs,
        diagnostics=diagnostics,
    )

    return EnvironmentValidationPacketResponse(
        generated_at=datetime.now(timezone.utc),
        summary=EnvironmentValidationPacketSummaryResponse(
            total_validation_runs=len(validation_runs),
            pass_run_count=pass_runs,
            warn_run_count=warn_runs,
            fail_run_count=fail_runs,
            native_safari_run_count=native_safari_runs,
            real_hardware_recording_success_count=real_hardware_recording_successes,
            environments_with_warning_flags=diagnostics.summary.profiles_with_warnings,
        ),
        required_matrix=required_matrix,
        environment_diagnostics=diagnostics,
        recent_validation_runs=validation_run_responses,
        claim_guardrails=claim_guardrails,
        compatibility_notes=compatibility_notes,
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


def _normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def _contains_any(value: str | None, needles: tuple[str, ...]) -> bool:
    normalized = _normalize_text(value)
    return any(needle in normalized for needle in needles)


def _matches_windows_chrome_usb_headphones(run: EnvironmentValidationRun) -> bool:
    return (
        _contains_any(run.os, ("windows",))
        and _contains_any(run.browser, ("chrome",))
        and _contains_any(run.input_device, ("usb",))
        and _contains_any(run.output_route, ("wired", "headphone"))
    )


def _matches_windows_firefox_builtin(run: EnvironmentValidationRun) -> bool:
    return (
        _contains_any(run.os, ("windows",))
        and _contains_any(run.browser, ("firefox",))
        and _contains_any(run.input_device, ("built-in", "builtin"))
        and _contains_any(run.output_route, ("speaker", "built-in", "builtin"))
    )


def _matches_macos_safari_builtin(run: EnvironmentValidationRun) -> bool:
    return (
        _contains_any(run.os, ("macos", "mac os"))
        and _is_native_safari_like(run)
        and _contains_any(run.input_device, ("built-in", "builtin"))
        and _contains_any(run.output_route, ("speaker", "built-in", "builtin"))
    )


def _matches_macos_safari_bluetooth(run: EnvironmentValidationRun) -> bool:
    return (
        _contains_any(run.os, ("macos", "mac os"))
        and _is_native_safari_like(run)
        and _contains_any(run.output_route, ("bluetooth", "airpods"))
    )


def _matches_macos_chrome_wired(run: EnvironmentValidationRun) -> bool:
    return (
        _contains_any(run.os, ("macos", "mac os"))
        and _contains_any(run.browser, ("chrome",))
        and _contains_any(run.output_route, ("wired", "headphone"))
    )


def _matches_mobile_safari(run: EnvironmentValidationRun) -> bool:
    return (
        _contains_any(run.os, ("ios", "ipados"))
        and _is_native_safari_like(run)
    )


def _is_native_safari_like(run: EnvironmentValidationRun) -> bool:
    return _contains_any(run.browser, ("safari",)) and not _contains_any(run.browser, ("chrome", "chromium"))


def _looks_like_real_hardware_run(run: EnvironmentValidationRun) -> bool:
    return bool(_normalize_text(run.device_name)) and not _contains_any(run.device_name, ("playwright", "fixture"))


def _build_environment_claim_guardrails(
    *,
    validation_runs: list[EnvironmentValidationRun],
    diagnostics: OpsEnvironmentDiagnosticsResponse,
    required_matrix: list[EnvironmentValidationMatrixCellResponse],
) -> list[str]:
    guardrails = [
        "This packet summarizes current browser and hardware evidence; it does not close the native Safari or real-hardware checklist items by itself.",
        "Release notes should distinguish seeded automation coverage from native hardware validation coverage.",
    ]

    if not any(run.covered for run in required_matrix if "Safari" in run.label):
        guardrails.append(
            "No native Safari or Safari-like validation run is logged in the required matrix, so Safari support claims should stay conservative."
        )
    if not any(run.take_recording_succeeded is True for run in validation_runs):
        guardrails.append(
            "No successful real validation recording run is logged yet, so recorder reliability claims should stay open."
        )
    if diagnostics.summary.profiles_with_warnings > 0:
        guardrails.append(
            "Warning flags still exist in captured environments, so release notes should mention known browser-audio caveats where relevant."
        )
    if any(run.outcome == ValidationOutcome.FAIL for run in validation_runs):
        guardrails.append(
            "At least one validation run is marked FAIL, so unresolved environment blockers remain."
        )

    return guardrails


def _build_environment_compatibility_notes(
    *,
    validation_runs: list[EnvironmentValidationRun],
    diagnostics: OpsEnvironmentDiagnosticsResponse,
) -> list[str]:
    notes: list[str] = []

    if any(
        flag.flag == "missing_offline_audio_context"
        for flag in diagnostics.warning_flags
    ):
        notes.append(
            "Some environments still report missing offline rendering support, so playback or local mixdown capability may be degraded."
        )
    if any(
        flag.flag == "legacy_webkit_audio_context_only"
        for flag in diagnostics.warning_flags
    ):
        notes.append(
            "Safari-family fallback paths still matter in current field data because legacy WebKit audio contexts are present in saved profiles."
        )
    if any(run.playback_succeeded is False for run in validation_runs):
        notes.append(
            "At least one manual validation run reports playback failure or degradation, so playback support should be described by environment rather than as universal."
        )
    if any(run.microphone_permission_after == "denied" for run in validation_runs):
        notes.append(
            "Permission recovery remains a compatibility concern in some environments and should be called out in support notes."
        )
    if not notes:
        notes.append(
            "No additional compatibility warnings were inferred from the stored validation runs and diagnostics snapshot."
        )

    return notes
