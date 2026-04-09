from __future__ import annotations

from pydantic import BaseModel, Field

from gigastudy_api.services.calibration import CalibrationRunSummary
from gigastudy_api.services.threshold_fitting import ThresholdCalibrationReport


class ClaimGatePolicy(BaseModel):
    minimum_rated_case_count: int = Field(default=6, ge=1)
    minimum_rated_note_count: int = Field(default=30, ge=1)
    minimum_human_rating_agreement_ratio: float = Field(default=0.72, ge=0.0, le=1.0)
    minimum_threshold_exact_agreement_ratio: float = Field(default=0.68, ge=0.0, le=1.0)
    minimum_usable_threshold_fit_note_count: int = Field(default=24, ge=1)
    require_zero_failed_cases: bool = True
    require_non_synthetic_evidence: bool = True


class ClaimGateCheck(BaseModel):
    key: str
    passed: bool
    actual: str
    expected: str
    message: str


class CalibrationClaimGateResult(BaseModel):
    corpus_id: str
    description: str
    evidence_kind: str
    release_claim_ready: bool
    checks: list[ClaimGateCheck]
    summary_message: str
    next_actions: list[str]
    policy: ClaimGatePolicy


def evaluate_calibration_claim_gate(
    summary: CalibrationRunSummary,
    report: ThresholdCalibrationReport,
    *,
    policy: ClaimGatePolicy | None = None,
) -> CalibrationClaimGateResult:
    policy = policy or ClaimGatePolicy()
    evidence_kind = summary.evidence_kind.lower()

    checks = [
        ClaimGateCheck(
            key="non_synthetic_evidence",
            passed=(not policy.require_non_synthetic_evidence) or ("synthetic" not in evidence_kind and "template" not in evidence_kind),
            actual=summary.evidence_kind,
            expected="non-synthetic, non-template evidence kind",
            message="Real human evidence is required before the checklist can be considered for closure."
            if policy.require_non_synthetic_evidence
            else "Synthetic evidence is allowed by the current policy.",
        ),
        ClaimGateCheck(
            key="rated_case_count",
            passed=summary.rated_case_count >= policy.minimum_rated_case_count,
            actual=str(summary.rated_case_count),
            expected=f">= {policy.minimum_rated_case_count}",
            message="Enough rated cases exist to discuss threshold closure."
            if summary.rated_case_count >= policy.minimum_rated_case_count
            else "More distinct rated cases are needed before threshold claims are reviewable.",
        ),
        ClaimGateCheck(
            key="rated_note_count",
            passed=summary.rated_note_count >= policy.minimum_rated_note_count,
            actual=str(summary.rated_note_count),
            expected=f">= {policy.minimum_rated_note_count}",
            message="Rated note volume is sufficient for release-review discussion."
            if summary.rated_note_count >= policy.minimum_rated_note_count
            else "More human-rated notes are needed before threshold claims are reviewable.",
        ),
        ClaimGateCheck(
            key="human_rating_agreement_ratio",
            passed=(summary.human_rating_agreement_ratio or 0.0) >= policy.minimum_human_rating_agreement_ratio,
            actual=str(summary.human_rating_agreement_ratio),
            expected=f">= {policy.minimum_human_rating_agreement_ratio}",
            message="System-vs-human agreement is strong enough for checklist review."
            if (summary.human_rating_agreement_ratio or 0.0) >= policy.minimum_human_rating_agreement_ratio
            else "Agreement against human ratings is still below the policy floor.",
        ),
        ClaimGateCheck(
            key="failed_cases",
            passed=(not policy.require_zero_failed_cases) or summary.failed_cases == 0,
            actual=str(summary.failed_cases),
            expected="0 failed cases",
            message="No failing calibration cases remain in the reviewed corpus."
            if summary.failed_cases == 0
            else "Calibration failures remain and should block claim closure.",
        ),
        ClaimGateCheck(
            key="usable_threshold_fit_note_count",
            passed=report.usable_note_count >= policy.minimum_usable_threshold_fit_note_count,
            actual=str(report.usable_note_count),
            expected=f">= {policy.minimum_usable_threshold_fit_note_count}",
            message="Threshold fitting is backed by enough usable note labels."
            if report.usable_note_count >= policy.minimum_usable_threshold_fit_note_count
            else "Threshold fitting still lacks enough usable note labels.",
        ),
        ClaimGateCheck(
            key="threshold_exact_agreement_ratio",
            passed=report.overall_best_exact_agreement_ratio >= policy.minimum_threshold_exact_agreement_ratio,
            actual=str(report.overall_best_exact_agreement_ratio),
            expected=f">= {policy.minimum_threshold_exact_agreement_ratio}",
            message="Current threshold recommendations are aligned enough with human labels for review."
            if report.overall_best_exact_agreement_ratio >= policy.minimum_threshold_exact_agreement_ratio
            else "Threshold recommendations are not yet aligned enough with human labels.",
        ),
    ]

    release_claim_ready = all(check.passed for check in checks)
    if release_claim_ready:
        summary_message = (
            "The current corpus meets the policy thresholds for a human-rating threshold closure review. "
            "This is still a review gate, not an automatic permission to change product claims."
        )
        next_actions = [
            "Review the proposed strict/basic/beginner bands with human raters and product owners.",
            "If the review agrees, record the decision in PROJECT_FOUNDATION and release-review notes together.",
            "Keep the claim language scoped to the evidence set and revisit when the corpus changes materially.",
        ]
    else:
        summary_message = (
            "The current corpus does not yet meet the policy thresholds for closing the human-rating threshold checklist item."
        )
        next_actions = [check.message for check in checks if not check.passed]
        next_actions.append(
            "Keep the checklist items for real-vocal evidence and human-trustworthy threshold validation open until these checks pass and the team reviews the corpus."
        )

    return CalibrationClaimGateResult(
        corpus_id=summary.corpus_id,
        description=summary.description,
        evidence_kind=summary.evidence_kind,
        release_claim_ready=release_claim_ready,
        checks=checks,
        summary_message=summary_message,
        next_actions=next_actions,
        policy=policy,
    )


def render_calibration_claim_gate_markdown(result: CalibrationClaimGateResult) -> str:
    lines = [
        f"# Calibration Claim Gate: {result.corpus_id}",
        "",
        f"- Description: {result.description}",
        f"- Evidence kind: {result.evidence_kind}",
        f"- Release claim ready: {'yes' if result.release_claim_ready else 'no'}",
        f"- Summary: {result.summary_message}",
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
