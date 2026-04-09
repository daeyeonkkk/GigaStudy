from __future__ import annotations

from datetime import datetime, timezone
import re
from pathlib import Path

from pydantic import BaseModel

from gigastudy_api.services.calibration import CalibrationRunSummary
from gigastudy_api.services.threshold_fitting import ThresholdCalibrationReport


class HumanRatingEvidenceOverview(BaseModel):
    total_cases: int
    passed_cases: int
    failed_cases: int
    rated_case_count: int
    rated_note_count: int
    human_rating_agreement_ratio: float | None = None
    usable_threshold_fit_note_count: int
    overall_best_in_tune_max_cents: float
    overall_best_review_max_cents: float
    overall_best_exact_agreement_ratio: float


class HumanRatingEvidenceBundle(BaseModel):
    bundle_id: str
    corpus_id: str
    description: str
    manifest_path: str | None = None
    evidence_kind: str
    generated_at: datetime
    overview: HumanRatingEvidenceOverview
    calibration_summary: CalibrationRunSummary
    threshold_report: ThresholdCalibrationReport
    claim_guardrails: list[str]
    next_actions: list[str]


def build_evidence_bundle_slug(corpus_id: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", corpus_id.strip().lower())
    normalized = normalized.strip("-._")
    return normalized or "human-rating-evidence"


def build_human_rating_evidence_bundle(
    summary: CalibrationRunSummary,
    report: ThresholdCalibrationReport,
    *,
    manifest_path: Path | None = None,
) -> HumanRatingEvidenceBundle:
    claim_guardrails = _build_claim_guardrails(summary, report)
    next_actions = _build_next_actions(summary, report)

    return HumanRatingEvidenceBundle(
        bundle_id=f"{build_evidence_bundle_slug(summary.corpus_id)}-bundle",
        corpus_id=summary.corpus_id,
        description=summary.description,
        manifest_path=str(manifest_path) if manifest_path is not None else summary.manifest_path,
        evidence_kind=summary.evidence_kind,
        generated_at=datetime.now(timezone.utc),
        overview=HumanRatingEvidenceOverview(
            total_cases=summary.total_cases,
            passed_cases=summary.passed_cases,
            failed_cases=summary.failed_cases,
            rated_case_count=summary.rated_case_count,
            rated_note_count=summary.rated_note_count,
            human_rating_agreement_ratio=summary.human_rating_agreement_ratio,
            usable_threshold_fit_note_count=report.usable_note_count,
            overall_best_in_tune_max_cents=report.overall_best_in_tune_max_cents,
            overall_best_review_max_cents=report.overall_best_review_max_cents,
            overall_best_exact_agreement_ratio=report.overall_best_exact_agreement_ratio,
        ),
        calibration_summary=summary,
        threshold_report=report,
        claim_guardrails=claim_guardrails,
        next_actions=next_actions,
    )


def render_human_rating_evidence_markdown(bundle: HumanRatingEvidenceBundle) -> str:
    lines = [
        f"# Human Rating Evidence Bundle: {bundle.corpus_id}",
        "",
        f"- Description: {bundle.description}",
        f"- Evidence kind: {bundle.evidence_kind}",
        f"- Generated at: {bundle.generated_at.isoformat()}",
        f"- Manifest: {bundle.manifest_path or 'inline'}",
        f"- Case result: {bundle.overview.passed_cases}/{bundle.overview.total_cases} passed",
        f"- Rated cases: {bundle.overview.rated_case_count}",
        f"- Rated notes: {bundle.overview.rated_note_count}",
        f"- Human-rating agreement: {bundle.overview.human_rating_agreement_ratio}",
        f"- Threshold-fit usable notes: {bundle.overview.usable_threshold_fit_note_count}",
        f"- Best in-tune max: {bundle.overview.overall_best_in_tune_max_cents}",
        f"- Best review max: {bundle.overview.overall_best_review_max_cents}",
        "",
        "## Difficulty Tier Recommendations",
        "",
    ]

    for tier in bundle.threshold_report.tiers:
        lines.extend(
            [
                f"### {tier.tier}",
                f"- In-tune max cents: {tier.in_tune_max_cents}",
                f"- Review max cents: {tier.review_max_cents}",
                f"- Exact agreement: {tier.exact_agreement_ratio}",
                f"- In-tune precision: {tier.in_tune_precision}",
                f"- In-tune recall: {tier.in_tune_recall}",
                f"- Rationale: {tier.rationale}",
                "",
            ]
        )

    lines.extend(
        [
            "## Claim Guardrails",
            "",
        ]
    )
    for guardrail in bundle.claim_guardrails:
        lines.append(f"- {guardrail}")

    lines.extend(
        [
            "",
            "## Next Actions",
            "",
        ]
    )
    for action in bundle.next_actions:
        lines.append(f"- {action}")

    lines.append("")
    return "\n".join(lines)


def _build_claim_guardrails(
    summary: CalibrationRunSummary,
    report: ThresholdCalibrationReport,
) -> list[str]:
    guardrails = [
        "This bundle is release-support evidence, not an automatic checklist closer by itself.",
        "Threshold candidates remain recommendations until human raters review the corpus and accept the resulting bands.",
    ]

    evidence_kind = summary.evidence_kind.lower()
    if "synthetic" in evidence_kind or "template" in evidence_kind:
        guardrails.append(
            "The current manifest is synthetic or template-oriented, so it cannot close the real-human evidence checklist items."
        )
    else:
        guardrails.append(
            "Even with human-rated cases present, the remaining checklist items should stay open until the team reviews breadth, rater quality, and release relevance."
        )

    if summary.failed_cases > 0:
        guardrails.append("One or more calibration cases failed, so the scorer is not ready for a release-quality claim review.")
    if summary.rated_note_count == 0:
        guardrails.append("No rated notes were available, so this bundle is workflow proof rather than human-evidence proof.")
    if report.usable_note_count == 0:
        guardrails.append("Threshold fitting had no usable note labels, so tier recommendations are not yet evidence-backed.")

    return guardrails


def _build_next_actions(
    summary: CalibrationRunSummary,
    report: ThresholdCalibrationReport,
) -> list[str]:
    actions: list[str] = []

    if summary.rated_note_count == 0:
        actions.append("Collect real singer guide/take pairs and build a human-rated corpus before using this bundle in release review.")
    if summary.failed_cases > 0:
        actions.append("Resolve failed calibration cases before treating the scorer as stable enough for threshold review.")
    if report.usable_note_count > 0:
        actions.append(
            "Review the strict/basic/beginner recommendations with raters and keep the checklist open until the agreed thresholds are documented."
        )
    else:
        actions.append("Add usable human acceptability labels so threshold fitting can produce evidence-backed tier recommendations.")

    actions.append(
        "Store generated bundle outputs outside PROJECT_FOUNDATION root and reference them from release review notes rather than promoting them into canonical docs."
    )
    return actions
