from __future__ import annotations

from datetime import datetime, timezone

from gigastudy_api.services.calibration import CalibrationCaseResult, CalibrationRunSummary
from gigastudy_api.services.calibration_claim_gate import (
    ClaimGatePolicy,
    evaluate_calibration_claim_gate,
    render_calibration_claim_gate_markdown,
)
from gigastudy_api.services.threshold_fitting import ThresholdCalibrationReport, ThresholdTierRecommendation


def _build_report(*, usable_note_count: int = 40, agreement_ratio: float = 0.75) -> ThresholdCalibrationReport:
    return ThresholdCalibrationReport(
        corpus_id="claim-gate-test",
        description="Claim gate coverage",
        rated_note_count=usable_note_count,
        usable_note_count=usable_note_count,
        label_counts={"in_tune": 20, "review": 10, "corrective": 10},
        overall_best_in_tune_max_cents=8.0,
        overall_best_review_max_cents=20.0,
        overall_best_exact_agreement_ratio=agreement_ratio,
        tiers=[
            ThresholdTierRecommendation(
                tier="strict",
                in_tune_max_cents=6.0,
                review_max_cents=16.0,
                exact_agreement_ratio=agreement_ratio,
                in_tune_precision=0.91,
                in_tune_recall=0.7,
                rationale="Strict gate",
            )
        ],
        limitations=["Test only."],
    )


def _build_summary(
    *,
    evidence_kind: str = "human_rating_corpus",
    rated_case_count: int = 6,
    rated_note_count: int = 40,
    failed_cases: int = 0,
    agreement_ratio: float | None = 0.8,
) -> CalibrationRunSummary:
    total_cases = max(rated_case_count, 1)
    passed_cases = total_cases - failed_cases
    return CalibrationRunSummary(
        corpus_id="claim-gate-test",
        description="Claim gate coverage",
        evidence_kind=evidence_kind,
        manifest_path="calibration/human_rating_corpus.generated.json",
        run_at=datetime.now(timezone.utc),
        total_cases=total_cases,
        passed_cases=passed_cases,
        failed_cases=failed_cases,
        all_passed=failed_cases == 0,
        cases=[
            CalibrationCaseResult(
                case_id="case-a",
                description="Case A",
                passed=failed_cases == 0,
                failures=[] if failed_cases == 0 else ["failed"],
            )
        ],
        rated_case_count=rated_case_count,
        rated_note_count=rated_note_count,
        human_rating_agreement_ratio=agreement_ratio,
    )


def test_evaluate_calibration_claim_gate_blocks_synthetic_or_thin_evidence() -> None:
    summary = _build_summary(evidence_kind="synthetic_vocal_baseline", rated_case_count=1, rated_note_count=4, agreement_ratio=0.5)
    report = _build_report(usable_note_count=4, agreement_ratio=0.5)

    result = evaluate_calibration_claim_gate(summary, report)

    assert result.release_claim_ready is False
    failed_keys = {check.key for check in result.checks if not check.passed}
    assert "non_synthetic_evidence" in failed_keys
    assert "rated_case_count" in failed_keys
    assert "rated_note_count" in failed_keys
    rendered = render_calibration_claim_gate_markdown(result)
    assert "Release claim ready: no" in rendered


def test_evaluate_calibration_claim_gate_can_mark_review_ready_when_policy_is_met() -> None:
    summary = _build_summary()
    report = _build_report()

    result = evaluate_calibration_claim_gate(summary, report)

    assert result.release_claim_ready is True
    assert all(check.passed for check in result.checks)
    assert "review" in result.summary_message.lower()


def test_evaluate_calibration_claim_gate_respects_custom_policy() -> None:
    summary = _build_summary(rated_case_count=3, rated_note_count=12, agreement_ratio=0.66)
    report = _build_report(usable_note_count=12, agreement_ratio=0.64)
    policy = ClaimGatePolicy(
        minimum_rated_case_count=3,
        minimum_rated_note_count=12,
        minimum_human_rating_agreement_ratio=0.65,
        minimum_threshold_exact_agreement_ratio=0.64,
        minimum_usable_threshold_fit_note_count=12,
    )

    result = evaluate_calibration_claim_gate(summary, report, policy=policy)

    assert result.release_claim_ready is True
