from gigastudy_api.services.calibration import CalibrationCaseResult, CalibrationRunSummary
from gigastudy_api.services.calibration_evidence import (
    build_evidence_bundle_slug,
    build_human_rating_evidence_bundle,
    render_human_rating_evidence_markdown,
)
from gigastudy_api.services.threshold_fitting import build_threshold_calibration_report


def _build_summary() -> CalibrationRunSummary:
    return CalibrationRunSummary(
        corpus_id="Human Rating Bundle Test",
        description="Evidence bundle coverage",
        evidence_kind="human_rating_corpus",
        run_at="2026-04-09T00:00:00Z",
        total_cases=1,
        passed_cases=1,
        failed_cases=0,
        all_passed=True,
        rated_case_count=1,
        rated_note_count=4,
        human_rating_agreement_ratio=0.75,
        cases=[
            CalibrationCaseResult(
                case_id="case-a",
                description="Case A",
                passed=True,
                failures=[],
                human_rating_summary={
                    "rated_note_count": 4,
                    "matched_axes": 3,
                    "total_axes": 4,
                    "agreement_ratio": 0.75,
                    "note_results": [
                        {"human_acceptability_label": "in_tune", "actual_sustain_median_cents": 7.0},
                        {"human_acceptability_label": "review", "actual_sustain_median_cents": 15.0},
                        {"human_acceptability_label": "review", "actual_sustain_median_cents": 21.0},
                        {"human_acceptability_label": "corrective", "actual_sustain_median_cents": 30.0},
                    ],
                },
            )
        ],
    )


def test_build_human_rating_evidence_bundle_includes_guardrails_and_overview() -> None:
    summary = _build_summary()
    report = build_threshold_calibration_report(summary)

    bundle = build_human_rating_evidence_bundle(summary, report)

    assert bundle.bundle_id == "human-rating-bundle-test-bundle"
    assert bundle.overview.rated_note_count == 4
    assert bundle.overview.usable_threshold_fit_note_count == 4
    assert bundle.claim_guardrails
    assert any("automatic checklist closer" in guardrail for guardrail in bundle.claim_guardrails)
    assert bundle.next_actions


def test_render_human_rating_evidence_markdown_includes_recommendations() -> None:
    summary = _build_summary()
    report = build_threshold_calibration_report(summary)
    bundle = build_human_rating_evidence_bundle(summary, report)

    markdown = render_human_rating_evidence_markdown(bundle)

    assert "# Human Rating Evidence Bundle: Human Rating Bundle Test" in markdown
    assert "## Difficulty Tier Recommendations" in markdown
    assert "## Claim Guardrails" in markdown
    assert "## Next Actions" in markdown


def test_build_evidence_bundle_slug_normalizes_strings() -> None:
    assert build_evidence_bundle_slug(" Human Rating Bundle Test ") == "human-rating-bundle-test"
