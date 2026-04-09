from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class OpsSummaryResponse(BaseModel):
    project_count: int = Field(ge=0)
    ready_take_count: int = Field(ge=0)
    failed_track_count: int = Field(ge=0)
    analysis_job_count: int = Field(ge=0)
    failed_analysis_job_count: int = Field(ge=0)


class OpsPolicyResponse(BaseModel):
    analysis_timeout_seconds: int = Field(ge=0)
    upload_session_expiry_minutes: int = Field(ge=0)
    recent_limit: int = Field(ge=1)


class OpsModelVersionsResponse(BaseModel):
    analysis: list[str] = Field(default_factory=list)
    melody: list[str] = Field(default_factory=list)
    arrangement_engine: list[str] = Field(default_factory=list)


class OpsEnvironmentSummaryResponse(BaseModel):
    total_device_profiles: int = Field(ge=0)
    profiles_with_warnings: int = Field(ge=0)
    browser_family_count: int = Field(ge=0)
    warning_flag_count: int = Field(ge=0)


class OpsEnvironmentBrowserResponse(BaseModel):
    browser: str
    os: str
    profile_count: int = Field(ge=0)
    warning_profile_count: int = Field(ge=0)
    latest_seen_at: datetime


class OpsEnvironmentWarningResponse(BaseModel):
    flag: str
    profile_count: int = Field(ge=0)


class OpsEnvironmentProfileResponse(BaseModel):
    device_profile_id: UUID
    browser: str
    os: str
    browser_user_agent: str | None = None
    output_route: str
    actual_sample_rate: int | None = None
    base_latency: float | None = None
    output_latency: float | None = None
    microphone_permission: str | None = None
    recording_mime_type: str | None = None
    audio_context_mode: str | None = None
    offline_audio_context_mode: str | None = None
    warning_flags: list[str] = Field(default_factory=list)
    updated_at: datetime


class OpsEnvironmentDiagnosticsResponse(BaseModel):
    summary: OpsEnvironmentSummaryResponse
    browser_matrix: list[OpsEnvironmentBrowserResponse] = Field(default_factory=list)
    warning_flags: list[OpsEnvironmentWarningResponse] = Field(default_factory=list)
    recent_profiles: list[OpsEnvironmentProfileResponse] = Field(default_factory=list)


class EnvironmentValidationMatrixCellResponse(BaseModel):
    label: str
    covered: bool
    run_count: int = Field(ge=0)


class EnvironmentValidationPacketSummaryResponse(BaseModel):
    total_validation_runs: int = Field(ge=0)
    pass_run_count: int = Field(ge=0)
    warn_run_count: int = Field(ge=0)
    fail_run_count: int = Field(ge=0)
    native_safari_run_count: int = Field(ge=0)
    real_hardware_recording_success_count: int = Field(ge=0)
    environments_with_warning_flags: int = Field(ge=0)


class EnvironmentValidationPacketResponse(BaseModel):
    generated_at: datetime
    generated_from: str = "ops_environment_validation_packet"
    summary: EnvironmentValidationPacketSummaryResponse
    required_matrix: list[EnvironmentValidationMatrixCellResponse] = Field(default_factory=list)
    environment_diagnostics: OpsEnvironmentDiagnosticsResponse
    recent_validation_runs: list["EnvironmentValidationRunResponse"] = Field(default_factory=list)
    claim_guardrails: list[str] = Field(default_factory=list)
    compatibility_notes: list[str] = Field(default_factory=list)


class EnvironmentValidationClaimGatePolicyResponse(BaseModel):
    minimum_total_validation_runs: int = Field(ge=1)
    minimum_native_safari_run_count: int = Field(ge=0)
    minimum_real_hardware_recording_success_count: int = Field(ge=0)
    minimum_covered_matrix_cells: int = Field(ge=0)
    maximum_fail_run_count: int = Field(ge=0)
    required_matrix_labels: list[str] = Field(default_factory=list)


class EnvironmentValidationClaimGateCheckResponse(BaseModel):
    key: str
    passed: bool
    actual: str
    expected: str
    message: str


class EnvironmentValidationClaimGateResponse(BaseModel):
    evaluated_at: datetime
    generated_from: str = "ops_environment_validation_claim_gate"
    release_claim_ready: bool
    summary_message: str
    policy: EnvironmentValidationClaimGatePolicyResponse
    packet_summary: EnvironmentValidationPacketSummaryResponse
    covered_matrix_count: int = Field(ge=0)
    total_required_matrix_cells: int = Field(ge=0)
    checks: list[EnvironmentValidationClaimGateCheckResponse] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)


class EnvironmentValidationRunCreateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    tester: str | None = Field(default=None, max_length=120)
    device_name: str = Field(min_length=1, max_length=160)
    os: str = Field(min_length=1, max_length=80)
    browser: str = Field(min_length=1, max_length=80)
    input_device: str | None = Field(default=None, max_length=160)
    output_route: str | None = Field(default=None, max_length=160)
    outcome: str = Field(pattern="^(PASS|WARN|FAIL)$")
    secure_context: bool | None = None
    microphone_permission_before: str | None = Field(default=None, max_length=32)
    microphone_permission_after: str | None = Field(default=None, max_length=32)
    recording_mime_type: str | None = Field(default=None, max_length=64)
    audio_context_mode: str | None = Field(default=None, max_length=32)
    offline_audio_context_mode: str | None = Field(default=None, max_length=32)
    actual_sample_rate: int | None = Field(default=None, ge=1)
    base_latency: float | None = None
    output_latency: float | None = None
    warning_flags: list[str] = Field(default_factory=list)
    take_recording_succeeded: bool | None = None
    analysis_succeeded: bool | None = None
    playback_succeeded: bool | None = None
    audible_issues: str | None = Field(default=None, max_length=2000)
    permission_issues: str | None = Field(default=None, max_length=2000)
    unexpected_warnings: str | None = Field(default=None, max_length=2000)
    follow_up: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    validated_at: datetime


class EnvironmentValidationRunResponse(BaseModel):
    validation_run_id: UUID
    label: str
    tester: str | None = None
    device_name: str
    os: str
    browser: str
    input_device: str | None = None
    output_route: str | None = None
    outcome: str
    secure_context: bool | None = None
    microphone_permission_before: str | None = None
    microphone_permission_after: str | None = None
    recording_mime_type: str | None = None
    audio_context_mode: str | None = None
    offline_audio_context_mode: str | None = None
    actual_sample_rate: int | None = None
    base_latency: float | None = None
    output_latency: float | None = None
    warning_flags: list[str] = Field(default_factory=list)
    take_recording_succeeded: bool | None = None
    analysis_succeeded: bool | None = None
    playback_succeeded: bool | None = None
    audible_issues: str | None = None
    permission_issues: str | None = None
    unexpected_warnings: str | None = None
    follow_up: str | None = None
    notes: str | None = None
    validated_at: datetime
    created_at: datetime
    updated_at: datetime


class EnvironmentValidationRunListResponse(BaseModel):
    items: list[EnvironmentValidationRunResponse] = Field(default_factory=list)


class FailedTrackSummaryResponse(BaseModel):
    track_id: UUID
    project_id: UUID
    project_title: str
    track_role: str
    track_status: str
    take_no: int | None = None
    source_format: str | None = None
    failure_message: str | None = None
    updated_at: datetime


class AnalysisJobSummaryResponse(BaseModel):
    job_id: UUID
    project_id: UUID
    project_title: str
    track_id: UUID
    track_role: str
    take_no: int | None = None
    status: str
    model_version: str
    requested_at: datetime
    finished_at: datetime | None = None
    error_message: str | None = None


class OpsOverviewResponse(BaseModel):
    summary: OpsSummaryResponse
    policies: OpsPolicyResponse
    model_versions: OpsModelVersionsResponse
    environment_diagnostics: OpsEnvironmentDiagnosticsResponse
    environment_claim_gate: EnvironmentValidationClaimGateResponse
    recent_environment_validation_runs: list[EnvironmentValidationRunResponse] = Field(default_factory=list)
    failed_tracks: list[FailedTrackSummaryResponse] = Field(default_factory=list)
    recent_analysis_jobs: list[AnalysisJobSummaryResponse] = Field(default_factory=list)
