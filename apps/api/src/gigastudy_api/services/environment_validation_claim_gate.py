from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field

from gigastudy_api.api.schemas.ops import (
    EnvironmentValidationClaimGateCheckResponse,
    EnvironmentValidationClaimGatePolicyResponse,
    EnvironmentValidationClaimGateResponse,
    EnvironmentValidationPacketResponse,
)


ESSENTIAL_MATRIX_LABELS = [
    "Windows + Chrome + USB microphone + wired headphones",
    "macOS + Safari + built-in microphone + built-in speakers",
    "macOS + Safari + Bluetooth output",
]


class EnvironmentValidationClaimGatePolicy(BaseModel):
    minimum_total_validation_runs: int = Field(default=3, ge=1)
    minimum_native_safari_run_count: int = Field(default=1, ge=0)
    minimum_real_hardware_recording_success_count: int = Field(default=2, ge=0)
    minimum_covered_matrix_cells: int = Field(default=3, ge=0)
    maximum_fail_run_count: int = Field(default=0, ge=0)
    required_matrix_labels: list[str] = Field(default_factory=lambda: list(ESSENTIAL_MATRIX_LABELS))


def evaluate_environment_validation_claim_gate(
    packet: EnvironmentValidationPacketResponse,
    *,
    policy: EnvironmentValidationClaimGatePolicy | None = None,
) -> EnvironmentValidationClaimGateResponse:
    policy = policy or EnvironmentValidationClaimGatePolicy()

    covered_labels = {cell.label for cell in packet.required_matrix if cell.covered}
    missing_required_labels = [
        label for label in policy.required_matrix_labels if label not in covered_labels
    ]
    covered_matrix_count = sum(1 for cell in packet.required_matrix if cell.covered)

    checks = [
        EnvironmentValidationClaimGateCheckResponse(
            key="total_validation_runs",
            passed=packet.summary.total_validation_runs >= policy.minimum_total_validation_runs,
            actual=str(packet.summary.total_validation_runs),
            expected=f">= {policy.minimum_total_validation_runs}",
            message="Enough validation runs exist to begin a release-claim review."
            if packet.summary.total_validation_runs >= policy.minimum_total_validation_runs
            else "More validation runs are needed before browser-support claim review is credible.",
        ),
        EnvironmentValidationClaimGateCheckResponse(
            key="native_safari_run_count",
            passed=packet.summary.native_safari_run_count >= policy.minimum_native_safari_run_count,
            actual=str(packet.summary.native_safari_run_count),
            expected=f">= {policy.minimum_native_safari_run_count}",
            message="Native Safari evidence is present."
            if packet.summary.native_safari_run_count >= policy.minimum_native_safari_run_count
            else "At least one native Safari or Safari-like run is required before claim review.",
        ),
        EnvironmentValidationClaimGateCheckResponse(
            key="real_hardware_recording_success_count",
            passed=(
                packet.summary.real_hardware_recording_success_count
                >= policy.minimum_real_hardware_recording_success_count
            ),
            actual=str(packet.summary.real_hardware_recording_success_count),
            expected=f">= {policy.minimum_real_hardware_recording_success_count}",
            message="Enough real-hardware recording successes are present."
            if (
                packet.summary.real_hardware_recording_success_count
                >= policy.minimum_real_hardware_recording_success_count
            )
            else "More successful real-hardware recording runs are needed before claim review.",
        ),
        EnvironmentValidationClaimGateCheckResponse(
            key="covered_matrix_cells",
            passed=covered_matrix_count >= policy.minimum_covered_matrix_cells,
            actual=str(covered_matrix_count),
            expected=f">= {policy.minimum_covered_matrix_cells}",
            message="The validation matrix has enough covered cells to support a review."
            if covered_matrix_count >= policy.minimum_covered_matrix_cells
            else "Too few matrix cells are covered to support a release-claim review.",
        ),
        EnvironmentValidationClaimGateCheckResponse(
            key="required_matrix_labels",
            passed=not missing_required_labels,
            actual=", ".join(missing_required_labels) if missing_required_labels else "all required cells covered",
            expected=", ".join(policy.required_matrix_labels),
            message="The essential real-hardware matrix cells are covered."
            if not missing_required_labels
            else "Some essential real-hardware matrix cells are still missing.",
        ),
        EnvironmentValidationClaimGateCheckResponse(
            key="fail_run_count",
            passed=packet.summary.fail_run_count <= policy.maximum_fail_run_count,
            actual=str(packet.summary.fail_run_count),
            expected=f"<= {policy.maximum_fail_run_count}",
            message="No blocking FAIL runs remain in the current evidence set."
            if packet.summary.fail_run_count <= policy.maximum_fail_run_count
            else "FAIL validation runs still exist and should block claim review.",
        ),
    ]

    release_claim_ready = all(check.passed for check in checks)
    if release_claim_ready:
        summary_message = (
            "The current browser and hardware evidence is strong enough to begin a release-claim review. "
            "This is a review gate, not an automatic permission to broaden support claims."
        )
        next_actions = [
            "Review the covered matrix cells, warning flags, and recent runs with the release owner.",
            "If support claims change, update compatibility notes and packet-linked release notes together.",
            "Re-run the claim gate whenever materially new browser or hardware evidence is added.",
        ]
    else:
        summary_message = (
            "The current browser and hardware evidence is not yet strong enough to begin a release-claim review."
        )
        next_actions = [check.message for check in checks if not check.passed]
        next_actions.append(
            "Keep the native Safari and real-hardware checklist items open until these checks pass and the team reviews the evidence."
        )

    return EnvironmentValidationClaimGateResponse(
        evaluated_at=datetime.now(timezone.utc),
        release_claim_ready=release_claim_ready,
        summary_message=summary_message,
        policy=EnvironmentValidationClaimGatePolicyResponse(
            minimum_total_validation_runs=policy.minimum_total_validation_runs,
            minimum_native_safari_run_count=policy.minimum_native_safari_run_count,
            minimum_real_hardware_recording_success_count=policy.minimum_real_hardware_recording_success_count,
            minimum_covered_matrix_cells=policy.minimum_covered_matrix_cells,
            maximum_fail_run_count=policy.maximum_fail_run_count,
            required_matrix_labels=list(policy.required_matrix_labels),
        ),
        packet_summary=packet.summary,
        covered_matrix_count=covered_matrix_count,
        total_required_matrix_cells=len(packet.required_matrix),
        checks=checks,
        next_actions=next_actions,
    )


def render_environment_validation_claim_gate_markdown(
    result: EnvironmentValidationClaimGateResponse,
) -> str:
    lines = [
        "# Browser Environment Claim Gate",
        "",
        f"- Evaluated at: {result.evaluated_at.isoformat()}",
        f"- Release claim ready: {'yes' if result.release_claim_ready else 'no'}",
        f"- Summary: {result.summary_message}",
        f"- Validation runs: {result.packet_summary.total_validation_runs}",
        f"- Native Safari runs: {result.packet_summary.native_safari_run_count}",
        f"- Real-hardware recording successes: {result.packet_summary.real_hardware_recording_success_count}",
        f"- Covered matrix cells: {result.covered_matrix_count}/{result.total_required_matrix_cells}",
        "",
        "## Checks",
        "",
    ]

    for check in result.checks:
        lines.extend(
            [
                f"### {check.key}",
                f"- Passed: {'yes' if check.passed else 'no'}",
                f"- Actual: {check.actual}",
                f"- Expected: {check.expected}",
                f"- Message: {check.message}",
                "",
            ]
        )

    lines.extend(["## Next Actions", ""])
    for action in result.next_actions:
        lines.append(f"- {action}")
    lines.append("")
    return "\n".join(lines)
