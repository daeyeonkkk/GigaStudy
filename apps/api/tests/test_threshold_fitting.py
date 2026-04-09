from gigastudy_api.services.calibration import CalibrationCaseResult, CalibrationRunSummary
from gigastudy_api.services.threshold_fitting import (
    build_threshold_calibration_report,
    render_threshold_calibration_markdown,
)


def _build_summary() -> CalibrationRunSummary:
    return CalibrationRunSummary(
        corpus_id="threshold-fit-test",
        description="Threshold fit coverage",
        evidence_kind="human_rating_corpus",
        run_at="2026-04-09T00:00:00Z",
        total_cases=1,
        passed_cases=1,
        failed_cases=0,
        all_passed=True,
        rated_case_count=1,
        rated_note_count=9,
        human_rating_agreement_ratio=0.8,
        cases=[
            CalibrationCaseResult(
                case_id="case-a",
                description="Case A",
                passed=True,
                failures=[],
                human_rating_summary={
                    "rated_note_count": 9,
                    "matched_axes": 7,
                    "total_axes": 9,
                    "agreement_ratio": 0.7778,
                    "note_results": [
                        {"human_acceptability_label": "in_tune", "actual_sustain_median_cents": 6.0},
                        {"human_acceptability_label": "in_tune", "actual_sustain_median_cents": 10.0},
                        {"human_acceptability_label": "in_tune", "actual_sustain_median_cents": 14.0},
                        {"human_acceptability_label": "review", "actual_sustain_median_cents": 12.0},
                        {"human_acceptability_label": "review", "actual_sustain_median_cents": 18.0},
                        {"human_acceptability_label": "review", "actual_sustain_median_cents": 22.0},
                        {"human_acceptability_label": "corrective", "actual_sustain_median_cents": 30.0},
                        {"human_acceptability_label": "corrective", "actual_sustain_median_cents": 36.0},
                        {"human_acceptability_label": "corrective", "actual_sustain_median_cents": 42.0},
                    ],
                },
            )
        ],
    )


def test_build_threshold_calibration_report_returns_tier_recommendations() -> None:
    report = build_threshold_calibration_report(_build_summary())

    assert report.usable_note_count == 9
    assert report.label_counts["in_tune"] == 3
    assert len(report.tiers) == 3
    strict = next(tier for tier in report.tiers if tier.tier == "strict")
    basic = next(tier for tier in report.tiers if tier.tier == "basic")
    beginner = next(tier for tier in report.tiers if tier.tier == "beginner")
    assert strict.in_tune_max_cents <= basic.in_tune_max_cents <= beginner.in_tune_max_cents
    assert strict.review_max_cents >= strict.in_tune_max_cents
    assert basic.exact_agreement_ratio >= 0.0
    assert beginner.rationale


def test_render_threshold_calibration_markdown_includes_tiers() -> None:
    report = build_threshold_calibration_report(_build_summary())

    markdown = render_threshold_calibration_markdown(report)

    assert "# Threshold Calibration Report: threshold-fit-test" in markdown
    assert "## Difficulty Candidates" in markdown
    assert "### strict" in markdown
    assert "### beginner" in markdown


def test_build_threshold_calibration_report_handles_empty_points() -> None:
    summary = CalibrationRunSummary(
        corpus_id="empty-threshold-fit-test",
        description="No usable notes",
        evidence_kind="human_rating_corpus",
        run_at="2026-04-09T00:00:00Z",
        total_cases=1,
        passed_cases=1,
        failed_cases=0,
        all_passed=True,
        rated_case_count=1,
        rated_note_count=1,
        human_rating_agreement_ratio=0.0,
        cases=[
            CalibrationCaseResult(
                case_id="case-a",
                description="Case A",
                passed=True,
                failures=[],
                human_rating_summary={
                    "rated_note_count": 1,
                    "matched_axes": 0,
                    "total_axes": 1,
                    "agreement_ratio": 0.0,
                    "note_results": [
                        {"human_acceptability_label": "unclear", "actual_sustain_median_cents": None}
                    ],
                },
            )
        ],
    )

    report = build_threshold_calibration_report(summary)

    assert report.usable_note_count == 0
    assert report.tiers == []
    assert report.limitations
