from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field

from gigastudy_api.api.schemas.ops import (
    EnvironmentValidationMatrixCellResponse,
    EnvironmentValidationPacketResponse,
    EnvironmentValidationPacketSummaryResponse,
    EnvironmentValidationRunResponse,
    OpsEnvironmentBrowserResponse,
    OpsEnvironmentDiagnosticsResponse,
    OpsEnvironmentProfileResponse,
    OpsEnvironmentSummaryResponse,
    OpsEnvironmentWarningResponse,
)


class EnvironmentValidationEvidenceItem(BaseModel):
    label: str
    tester: str | None = None
    device_name: str
    os: str
    browser: str
    input_device: str | None = None
    output_route: str | None = None
    outcome: str = Field(pattern="^(PASS|WARN|FAIL)$")
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


ESSENTIAL_MATRIX_LABELS = [
    "Windows + Chrome + USB microphone + wired headphones",
    "macOS + Safari + built-in microphone + built-in speakers",
    "macOS + Safari + Bluetooth output",
]


def build_empty_environment_diagnostics() -> OpsEnvironmentDiagnosticsResponse:
    return OpsEnvironmentDiagnosticsResponse(
        summary=OpsEnvironmentSummaryResponse(
            total_device_profiles=0,
            profiles_with_warnings=0,
            browser_family_count=0,
            warning_flag_count=0,
        ),
        browser_matrix=[],
        warning_flags=[],
        recent_profiles=[],
    )


def build_environment_validation_packet_from_items(
    items: list[EnvironmentValidationEvidenceItem],
    *,
    diagnostics: OpsEnvironmentDiagnosticsResponse | None = None,
    recent_validation_runs: list[EnvironmentValidationRunResponse] | None = None,
    generated_from: str,
) -> EnvironmentValidationPacketResponse:
    diagnostics = diagnostics or build_empty_environment_diagnostics()
    recent_validation_runs = recent_validation_runs or []

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
            covered=(match_count := sum(1 for item in items if matcher(item))) > 0,
            run_count=match_count,
        )
        for label, matcher in matrix_labels
    ]

    pass_runs = sum(1 for item in items if item.outcome == "PASS")
    warn_runs = sum(1 for item in items if item.outcome == "WARN")
    fail_runs = sum(1 for item in items if item.outcome == "FAIL")
    native_safari_runs = sum(1 for item in items if _is_native_safari_like(item))
    real_hardware_recording_successes = sum(
        1 for item in items if item.take_recording_succeeded is True and _looks_like_real_hardware_run(item)
    )
    environments_with_warning_flags = (
        diagnostics.summary.profiles_with_warnings
        if diagnostics.summary.total_device_profiles > 0
        else sum(1 for item in items if item.warning_flags)
    )

    return EnvironmentValidationPacketResponse(
        generated_at=datetime.now(timezone.utc),
        generated_from=generated_from,
        summary=EnvironmentValidationPacketSummaryResponse(
            total_validation_runs=len(items),
            pass_run_count=pass_runs,
            warn_run_count=warn_runs,
            fail_run_count=fail_runs,
            native_safari_run_count=native_safari_runs,
            real_hardware_recording_success_count=real_hardware_recording_successes,
            environments_with_warning_flags=environments_with_warning_flags,
        ),
        required_matrix=required_matrix,
        environment_diagnostics=diagnostics,
        recent_validation_runs=recent_validation_runs,
        claim_guardrails=_build_environment_claim_guardrails(
            items=items,
            diagnostics=diagnostics,
            required_matrix=required_matrix,
        ),
        compatibility_notes=_build_environment_compatibility_notes(
            items=items,
            diagnostics=diagnostics,
        ),
    )


def _normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def _contains_any(value: str | None, needles: tuple[str, ...]) -> bool:
    normalized = _normalize_text(value)
    return any(needle in normalized for needle in needles)


def _matches_windows_chrome_usb_headphones(item: EnvironmentValidationEvidenceItem) -> bool:
    return (
        _contains_any(item.os, ("windows",))
        and _contains_any(item.browser, ("chrome",))
        and _contains_any(item.input_device, ("usb",))
        and _contains_any(item.output_route, ("wired", "headphone"))
    )


def _matches_windows_firefox_builtin(item: EnvironmentValidationEvidenceItem) -> bool:
    return (
        _contains_any(item.os, ("windows",))
        and _contains_any(item.browser, ("firefox",))
        and _contains_any(item.input_device, ("built-in", "builtin"))
        and _contains_any(item.output_route, ("speaker", "built-in", "builtin"))
    )


def _matches_macos_safari_builtin(item: EnvironmentValidationEvidenceItem) -> bool:
    return (
        _contains_any(item.os, ("macos", "mac os"))
        and _is_native_safari_like(item)
        and _contains_any(item.input_device, ("built-in", "builtin"))
        and _contains_any(item.output_route, ("speaker", "built-in", "builtin"))
    )


def _matches_macos_safari_bluetooth(item: EnvironmentValidationEvidenceItem) -> bool:
    return (
        _contains_any(item.os, ("macos", "mac os"))
        and _is_native_safari_like(item)
        and _contains_any(item.output_route, ("bluetooth", "airpods"))
    )


def _matches_macos_chrome_wired(item: EnvironmentValidationEvidenceItem) -> bool:
    return (
        _contains_any(item.os, ("macos", "mac os"))
        and _contains_any(item.browser, ("chrome",))
        and _contains_any(item.output_route, ("wired", "headphone"))
    )


def _matches_mobile_safari(item: EnvironmentValidationEvidenceItem) -> bool:
    return _contains_any(item.os, ("ios", "ipados")) and _is_native_safari_like(item)


def _is_native_safari_like(item: EnvironmentValidationEvidenceItem) -> bool:
    return _contains_any(item.browser, ("safari",)) and not _contains_any(item.browser, ("chrome", "chromium"))


def _looks_like_real_hardware_run(item: EnvironmentValidationEvidenceItem) -> bool:
    return bool(_normalize_text(item.device_name)) and not _contains_any(item.device_name, ("playwright", "fixture"))


def _build_environment_claim_guardrails(
    *,
    items: list[EnvironmentValidationEvidenceItem],
    diagnostics: OpsEnvironmentDiagnosticsResponse,
    required_matrix: list[EnvironmentValidationMatrixCellResponse],
) -> list[str]:
    guardrails = [
        "This packet summarizes current browser and hardware evidence; it does not close the native Safari or real-hardware checklist items by itself.",
        "Release notes should distinguish seeded automation coverage from native hardware validation coverage.",
    ]

    if not any(cell.covered for cell in required_matrix if "Safari" in cell.label):
        guardrails.append(
            "No native Safari or Safari-like validation run is logged in the required matrix, so Safari support claims should stay conservative."
        )
    if not any(item.take_recording_succeeded is True for item in items):
        guardrails.append(
            "No successful real validation recording run is logged yet, so recorder reliability claims should stay open."
        )
    if diagnostics.summary.profiles_with_warnings > 0 or any(item.warning_flags for item in items):
        guardrails.append(
            "Warning flags still exist in captured environments, so release notes should mention known browser-audio caveats where relevant."
        )
    if any(item.outcome == "FAIL" for item in items):
        guardrails.append(
            "At least one validation run is marked FAIL, so unresolved environment blockers remain."
        )

    return guardrails


def _build_environment_compatibility_notes(
    *,
    items: list[EnvironmentValidationEvidenceItem],
    diagnostics: OpsEnvironmentDiagnosticsResponse,
) -> list[str]:
    notes: list[str] = []

    warning_flags = {flag.flag for flag in diagnostics.warning_flags}
    warning_flags.update(flag for item in items for flag in item.warning_flags)

    if "missing_offline_audio_context" in warning_flags:
        notes.append(
            "Some environments still report missing offline rendering support, so playback or local mixdown capability may be degraded."
        )
    if "legacy_webkit_audio_context_only" in warning_flags:
        notes.append(
            "Safari-family fallback paths still matter in current field data because legacy WebKit audio contexts are present in saved profiles or round evidence."
        )
    if any(item.playback_succeeded is False for item in items):
        notes.append(
            "At least one validation run reports playback failure or degradation, so playback support should be described by environment rather than as universal."
        )
    if any(item.microphone_permission_after == "denied" for item in items):
        notes.append(
            "Permission recovery remains a compatibility concern in some environments and should be called out in support notes."
        )
    if not notes:
        notes.append(
            "No additional compatibility warnings were inferred from the current validation rows and diagnostics snapshot."
        )

    return notes
