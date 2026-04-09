from __future__ import annotations

from collections import Counter
from math import inf

from pydantic import BaseModel

from gigastudy_api.services.calibration import CalibrationRunSummary


TARGET_LABELS = ("in_tune", "review", "corrective")


class ThresholdFitPoint(BaseModel):
    abs_sustain_cents: float
    human_acceptability_label: str


class ThresholdTierRecommendation(BaseModel):
    tier: str
    in_tune_max_cents: float
    review_max_cents: float
    exact_agreement_ratio: float
    in_tune_precision: float | None = None
    in_tune_recall: float | None = None
    rationale: str


class ThresholdCalibrationReport(BaseModel):
    corpus_id: str
    description: str
    rated_note_count: int
    usable_note_count: int
    label_counts: dict[str, int]
    overall_best_in_tune_max_cents: float
    overall_best_review_max_cents: float
    overall_best_exact_agreement_ratio: float
    tiers: list[ThresholdTierRecommendation]
    limitations: list[str]


def _extract_fit_points(summary: CalibrationRunSummary) -> list[ThresholdFitPoint]:
    points: list[ThresholdFitPoint] = []
    for case_result in summary.cases:
        human_summary = case_result.human_rating_summary
        if not isinstance(human_summary, dict):
            continue
        note_results = human_summary.get("note_results")
        if not isinstance(note_results, list):
            continue
        for note_result in note_results:
            if not isinstance(note_result, dict):
                continue
            label = note_result.get("human_acceptability_label")
            sustain_cents = note_result.get("actual_sustain_median_cents")
            if label not in TARGET_LABELS or sustain_cents is None:
                continue
            points.append(
                ThresholdFitPoint(
                    abs_sustain_cents=abs(float(sustain_cents)),
                    human_acceptability_label=str(label),
                )
            )
    return points


def _candidate_thresholds(points: list[ThresholdFitPoint]) -> list[float]:
    seeded = {4.0, 6.0, 8.0, 10.0, 12.0, 15.0, 18.0, 20.0, 22.0, 25.0, 30.0, 35.0, 40.0}
    observed = {round(point.abs_sustain_cents, 1) for point in points}
    max_observed = max(observed) if observed else 20.0
    upper_bound = max(25.0, round(max_observed + 10.0, 1))
    return sorted(value for value in (seeded | observed) if value <= upper_bound)


def _predict_acceptability(abs_cents: float, in_tune_max: float, review_max: float) -> str:
    if abs_cents <= in_tune_max:
        return "in_tune"
    if abs_cents <= review_max:
        return "review"
    return "corrective"


def _exact_agreement_ratio(points: list[ThresholdFitPoint], in_tune_max: float, review_max: float) -> float:
    if not points:
        return 0.0
    matches = sum(
        1
        for point in points
        if _predict_acceptability(point.abs_sustain_cents, in_tune_max, review_max) == point.human_acceptability_label
    )
    return round(matches / len(points), 4)


def _binary_metrics(points: list[ThresholdFitPoint], in_tune_max: float) -> tuple[float | None, float | None, float]:
    true_positive = 0
    false_positive = 0
    false_negative = 0
    for point in points:
        predicted_positive = point.abs_sustain_cents <= in_tune_max
        actual_positive = point.human_acceptability_label == "in_tune"
        if predicted_positive and actual_positive:
            true_positive += 1
        elif predicted_positive and not actual_positive:
            false_positive += 1
        elif (not predicted_positive) and actual_positive:
            false_negative += 1

    precision = (
        round(true_positive / (true_positive + false_positive), 4)
        if (true_positive + false_positive)
        else None
    )
    recall = (
        round(true_positive / (true_positive + false_negative), 4)
        if (true_positive + false_negative)
        else None
    )
    f1 = 0.0
    if precision is not None and recall is not None and precision + recall > 0:
        f1 = round((2 * precision * recall) / (precision + recall), 4)
    return precision, recall, f1


def _fit_review_threshold(points: list[ThresholdFitPoint], in_tune_max: float, candidates: list[float]) -> tuple[float, float]:
    review_candidates = [candidate for candidate in candidates if candidate > in_tune_max]
    if not review_candidates:
        fallback = round(in_tune_max + 5.0, 1)
        return fallback, _exact_agreement_ratio(points, in_tune_max, fallback)

    best_review = review_candidates[0]
    best_agreement = -inf
    for review_max in review_candidates:
        agreement = _exact_agreement_ratio(points, in_tune_max, review_max)
        if agreement > best_agreement or (agreement == best_agreement and review_max < best_review):
            best_review = review_max
            best_agreement = agreement
    return best_review, round(float(best_agreement), 4)


def _select_strict_in_tune_threshold(points: list[ThresholdFitPoint], candidates: list[float]) -> float:
    viable: list[tuple[float, float, float]] = []
    best_fallback: tuple[float, float, float] | None = None
    for candidate in candidates:
        precision, recall, _ = _binary_metrics(points, candidate)
        precision_value = precision if precision is not None else 0.0
        recall_value = recall if recall is not None else 0.0
        if precision_value >= 0.9:
            viable.append((candidate, precision_value, recall_value))
        if best_fallback is None or precision_value > best_fallback[1] or (
            precision_value == best_fallback[1] and recall_value > best_fallback[2]
        ):
            best_fallback = (candidate, precision_value, recall_value)

    if viable:
        viable.sort(key=lambda item: (-item[2], item[0]))
        return viable[0][0]
    assert best_fallback is not None
    return best_fallback[0]


def _select_basic_in_tune_threshold(points: list[ThresholdFitPoint], candidates: list[float]) -> float:
    best_candidate = candidates[0]
    best_f1 = -inf
    best_precision = -inf
    for candidate in candidates:
        precision, _, f1 = _binary_metrics(points, candidate)
        precision_value = precision if precision is not None else 0.0
        if f1 > best_f1 or (f1 == best_f1 and precision_value > best_precision):
            best_candidate = candidate
            best_f1 = f1
            best_precision = precision_value
    return best_candidate


def _select_beginner_in_tune_threshold(points: list[ThresholdFitPoint], candidates: list[float]) -> float:
    viable: list[tuple[float, float, float]] = []
    best_fallback: tuple[float, float, float] | None = None
    for candidate in candidates:
        precision, recall, _ = _binary_metrics(points, candidate)
        precision_value = precision if precision is not None else 0.0
        recall_value = recall if recall is not None else 0.0
        if recall_value >= 0.9:
            viable.append((candidate, precision_value, recall_value))
        if best_fallback is None or recall_value > best_fallback[2] or (
            recall_value == best_fallback[2] and precision_value > best_fallback[1]
        ):
            best_fallback = (candidate, precision_value, recall_value)

    if viable:
        viable.sort(key=lambda item: (-item[2], -item[1], item[0]))
        return viable[0][0]
    assert best_fallback is not None
    return best_fallback[0]


def build_threshold_calibration_report(summary: CalibrationRunSummary) -> ThresholdCalibrationReport:
    points = _extract_fit_points(summary)
    label_counts = dict(Counter(point.human_acceptability_label for point in points))

    if not points:
        return ThresholdCalibrationReport(
            corpus_id=summary.corpus_id,
            description=summary.description,
            rated_note_count=summary.rated_note_count,
            usable_note_count=0,
            label_counts=label_counts,
            overall_best_in_tune_max_cents=0.0,
            overall_best_review_max_cents=0.0,
            overall_best_exact_agreement_ratio=0.0,
            tiers=[],
            limitations=[
                "No usable human-rated acceptability points were available for threshold fitting.",
                "Run this report only after real or trusted human-rated note labels have been added.",
            ],
        )

    candidates = _candidate_thresholds(points)

    overall_best_in_tune = candidates[0]
    overall_best_review = candidates[-1]
    overall_best_agreement = -inf
    for in_tune_max in candidates:
        review_max, agreement = _fit_review_threshold(points, in_tune_max, candidates)
        if agreement > overall_best_agreement or (
            agreement == overall_best_agreement and in_tune_max < overall_best_in_tune
        ):
            overall_best_in_tune = in_tune_max
            overall_best_review = review_max
            overall_best_agreement = agreement

    tier_selections = [
        ("strict", _select_strict_in_tune_threshold(points, candidates), "Precision-oriented in-tune threshold."),
        ("basic", _select_basic_in_tune_threshold(points, candidates), "Balanced threshold based on F1 for in-tune labels."),
        ("beginner", _select_beginner_in_tune_threshold(points, candidates), "Recall-oriented in-tune threshold."),
    ]

    tiers: list[ThresholdTierRecommendation] = []
    for tier_name, in_tune_max, rationale in tier_selections:
        review_max, agreement = _fit_review_threshold(points, in_tune_max, candidates)
        precision, recall, _ = _binary_metrics(points, in_tune_max)
        tiers.append(
            ThresholdTierRecommendation(
                tier=tier_name,
                in_tune_max_cents=in_tune_max,
                review_max_cents=review_max,
                exact_agreement_ratio=agreement,
                in_tune_precision=precision,
                in_tune_recall=recall,
                rationale=rationale,
            )
        )

    tiers.sort(key=lambda tier: tier.in_tune_max_cents)
    tier_order = {"strict": 0, "basic": 1, "beginner": 2}
    tiers.sort(key=lambda tier: tier_order.get(tier.tier, 99))

    return ThresholdCalibrationReport(
        corpus_id=summary.corpus_id,
        description=summary.description,
        rated_note_count=summary.rated_note_count,
        usable_note_count=len(points),
        label_counts=label_counts,
        overall_best_in_tune_max_cents=overall_best_in_tune,
        overall_best_review_max_cents=overall_best_review,
        overall_best_exact_agreement_ratio=round(float(overall_best_agreement), 4),
        tiers=tiers,
        limitations=[
            "These thresholds are recommendations derived from current human labels, not an automatic claim gate.",
            "Difficulty-tier checklist items should remain open until the corpus is real, reviewed, and broad enough for release evidence.",
        ],
    )


def render_threshold_calibration_markdown(report: ThresholdCalibrationReport) -> str:
    lines = [
        f"# Threshold Calibration Report: {report.corpus_id}",
        "",
        f"- Description: {report.description}",
        f"- Rated notes: {report.rated_note_count}",
        f"- Usable notes: {report.usable_note_count}",
        f"- Label counts: {report.label_counts}",
        f"- Overall best in-tune max: {report.overall_best_in_tune_max_cents}",
        f"- Overall best review max: {report.overall_best_review_max_cents}",
        f"- Overall exact agreement: {report.overall_best_exact_agreement_ratio}",
        "",
        "## Difficulty Candidates",
        "",
    ]

    for tier in report.tiers:
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

    lines.append("## Limitations")
    lines.append("")
    for limitation in report.limitations:
        lines.append(f"- {limitation}")
    lines.append("")
    return "\n".join(lines)
