from datetime import datetime, timezone
from collections import Counter
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from gigastudy_api.api.schemas.ops import (
    AnalysisJobSummaryResponse,
    EnvironmentValidationClaimGateResponse,
    EnvironmentValidationImportPreviewItemResponse,
    EnvironmentValidationImportPreviewResponse,
    EnvironmentValidationImportResultResponse,
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
from gigastudy_api.services.environment_validation_claim_gate import (
    evaluate_environment_validation_claim_gate,
    render_environment_validation_claim_gate_markdown,
)
from gigastudy_api.services.environment_validation_import import (
    build_environment_validation_requests,
    load_environment_validation_sheet_text,
)
from gigastudy_api.services.environment_validation_packet_builder import (
    EnvironmentValidationEvidenceItem,
    build_environment_validation_packet_from_items,
)
from gigastudy_api.services.melody import MELODY_MODEL_VERSION, PYIN_FALLBACK_MODEL_VERSION
from gigastudy_api.services.projects import get_or_create_default_user

ENVIRONMENT_VALIDATION_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[3]
    / "environment_validation"
    / "environment_validation_runs.template.csv"
)


def build_environment_validation_template_download() -> tuple[str, bytes]:
    csv_text = ENVIRONMENT_VALIDATION_TEMPLATE_PATH.read_text(encoding="utf-8")
    readme_text = """# GigaStudy 환경 검증 시작 묶음

이 묶음은 실기기 브라우저 검증을 시작할 때 바로 쓸 수 있는 기본 시트입니다.

## 쓰는 순서

1. `environment_validation_runs.template.csv`를 복사해서 이번 검증 라운드 이름으로 저장합니다.
2. 기기 한 조합마다 한 줄씩 채웁니다.
3. 결과는 `PASS`, `WARN`, `FAIL` 중 하나로 적습니다.
4. 저장한 CSV를 ops 화면의 `가져오기 입력` 영역에서 미리 보고 가져옵니다.

## 꼭 채울 항목

- 기기 이름
- 운영체제 / 브라우저
- 입력 장치 / 출력 경로
- 녹음 성공 여부
- 분석 성공 여부
- 재생 성공 여부
- warning_flags
- validated_at

## 결과 기준

- `PASS`: 녹음, 분석, 재생이 모두 자연스럽게 끝났을 때
- `WARN`: 핵심 흐름은 되지만 경고, 재생 제한, 권한 혼선이 있을 때
- `FAIL`: 녹음이나 분석이 막히거나 제품 설명과 실제 동작이 어긋날 때

## 메모

- Bluetooth, 유선 이어폰, 내장 스피커처럼 출력 경로가 다르면 줄을 따로 적는 편이 좋습니다.
- Safari / WebKit은 별도 근거가 중요하니 가능한 한 따로 기록해 주세요.
"""

    filename = "gigastudy-environment-validation-starter-pack.zip"
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, mode="w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("README.md", readme_text)
        archive.writestr("environment_validation_runs.template.csv", csv_text)

    return filename, archive_buffer.getvalue()


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


def preview_environment_validation_import(
    csv_text: str,
) -> EnvironmentValidationImportPreviewResponse:
    rows = load_environment_validation_sheet_text(csv_text)
    requests = build_environment_validation_requests(rows)
    return EnvironmentValidationImportPreviewResponse(
        item_count=len(requests),
        items=[
            EnvironmentValidationImportPreviewItemResponse.model_validate(
                request.model_dump(mode="python")
            )
            for request in requests
        ],
    )


def import_environment_validation_runs_from_text(
    session: Session,
    csv_text: str,
) -> EnvironmentValidationImportResultResponse:
    preview = preview_environment_validation_import(csv_text)
    created_items = [
        create_environment_validation_run(
            session,
            EnvironmentValidationRunCreateRequest.model_validate(item.model_dump(mode="python")),
        )
        for item in preview.items
    ]
    return EnvironmentValidationImportResultResponse(
        imported_count=len(created_items),
        items=[
            build_environment_validation_run_response(item)
            for item in created_items
        ],
    )


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
    evidence_items = [
        EnvironmentValidationEvidenceItem(
            label=run.label,
            tester=run.tester,
            device_name=run.device_name,
            os=run.os,
            browser=run.browser,
            input_device=run.input_device,
            output_route=run.output_route,
            outcome=run.outcome.value,
            secure_context=run.secure_context,
            microphone_permission_before=run.microphone_permission_before,
            microphone_permission_after=run.microphone_permission_after,
            recording_mime_type=run.recording_mime_type,
            audio_context_mode=run.audio_context_mode,
            offline_audio_context_mode=run.offline_audio_context_mode,
            actual_sample_rate=run.actual_sample_rate,
            base_latency=run.base_latency,
            output_latency=run.output_latency,
            warning_flags=list(run.warning_flags_json or []),
            take_recording_succeeded=run.take_recording_succeeded,
            analysis_succeeded=run.analysis_succeeded,
            playback_succeeded=run.playback_succeeded,
            audible_issues=run.audible_issues,
            permission_issues=run.permission_issues,
            unexpected_warnings=run.unexpected_warnings,
            follow_up=run.follow_up,
            notes=run.notes,
            validated_at=run.validated_at,
        )
        for run in validation_runs
    ]

    return build_environment_validation_packet_from_items(
        evidence_items,
        diagnostics=diagnostics,
        recent_validation_runs=validation_run_responses,
        generated_from="ops_environment_validation_packet",
    )


def render_environment_validation_release_notes(packet: EnvironmentValidationPacketResponse) -> str:
    lines = [
        "# Browser Environment Release Notes Draft",
        "",
        f"- Generated at: {packet.generated_at.isoformat()}",
        f"- Total validation runs: {packet.summary.total_validation_runs}",
        f"- PASS / WARN / FAIL: {packet.summary.pass_run_count} / {packet.summary.warn_run_count} / {packet.summary.fail_run_count}",
        f"- Native Safari runs: {packet.summary.native_safari_run_count}",
        f"- Real-hardware recording successes: {packet.summary.real_hardware_recording_success_count}",
        "",
        "## Covered Matrix Cells",
        "",
    ]

    for cell in packet.required_matrix:
        lines.append(
            f"- [{'x' if cell.covered else ' '}] {cell.label} ({cell.run_count} run{'s' if cell.run_count != 1 else ''})"
        )

    lines.extend(
        [
            "",
            "## Compatibility Notes",
            "",
        ]
    )
    for note in packet.compatibility_notes:
        lines.append(f"- {note}")

    lines.extend(
        [
            "",
            "## Claim Guardrails",
            "",
        ]
    )
    for guardrail in packet.claim_guardrails:
        lines.append(f"- {guardrail}")

    unsupported_cells = [cell.label for cell in packet.required_matrix if not cell.covered]
    lines.extend(
        [
            "",
            "## Unsupported Or Not Yet Validated Paths",
            "",
        ]
    )
    if unsupported_cells:
        for label in unsupported_cells:
            lines.append(f"- {label}")
    else:
        lines.append("- No uncovered matrix cells remain in the current required validation matrix.")

    lines.extend(
        [
            "",
            "## Recent Manual Validation Runs",
            "",
        ]
    )
    if packet.recent_validation_runs:
        for run in packet.recent_validation_runs:
            lines.append(
                f"- {run.label}: {run.browser} on {run.os} / {run.device_name} / {run.outcome}"
            )
    else:
        lines.append("- No manual validation runs are stored yet.")

    lines.append("")
    return "\n".join(lines)


def build_environment_validation_claim_gate(session: Session):
    packet = build_environment_validation_packet(session)
    return evaluate_environment_validation_claim_gate(packet)


def render_environment_validation_claim_gate(session: Session) -> str:
    result = build_environment_validation_claim_gate(session)
    return render_environment_validation_claim_gate_markdown(result)


def get_ops_overview(session: Session) -> OpsOverviewResponse:
    settings = get_settings()
    recent_limit = max(1, settings.ops_recent_limit)
    environment_claim_gate = build_environment_validation_claim_gate(session)

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
        environment_claim_gate=EnvironmentValidationClaimGateResponse.model_validate(
            environment_claim_gate
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
