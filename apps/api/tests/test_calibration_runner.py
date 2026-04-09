from pathlib import Path

from gigastudy_api.services.calibration import (
    AudioSourceSpec,
    CalibrationCase,
    CalibrationCorpus,
    HumanRatingNote,
    load_calibration_corpus,
    render_calibration_summary_markdown,
    run_calibration_corpus,
)


def test_run_synthetic_vocal_baseline_corpus() -> None:
    manifest_path = Path("calibration/synthetic_vocal_baseline.json").resolve()
    corpus = load_calibration_corpus(manifest_path)

    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)

    assert summary.corpus_id == "synthetic-vocal-baseline-v1"
    assert summary.evidence_kind == "synthetic_vocal_baseline"
    assert summary.total_cases == 4
    assert summary.failed_cases == 0
    assert summary.all_passed is True
    assert all(case.pitch_quality_mode == "NOTE_EVENT_V1" for case in summary.cases)


def test_render_calibration_summary_markdown_includes_case_details() -> None:
    manifest_path = Path("calibration/synthetic_vocal_baseline.json").resolve()
    corpus = load_calibration_corpus(manifest_path)

    summary = run_calibration_corpus(corpus, manifest_path=manifest_path)
    markdown = render_calibration_summary_markdown(summary)

    assert "# Calibration Run: synthetic-vocal-baseline-v1" in markdown
    assert "sharp-attack" in markdown
    assert "PASS" in markdown
    assert "Pitch quality mode: NOTE_EVENT_V1" in markdown


def test_run_calibration_corpus_reports_human_rating_agreement() -> None:
    corpus = CalibrationCorpus(
        corpus_id="human-rating-workflow-test",
        description="Agreement workflow test",
        evidence_kind="human_rating_workflow",
        cases=[
            CalibrationCase(
                case_id="overshoot-human-rating",
                description="Human rating agreement for overshoot and settle behavior",
                project_title="Human rating workflow",
                guide_source=AudioSourceSpec(
                    source_kind="named_fixture",
                    fixture_name="guide_centered_vocalish",
                ),
                take_source=AudioSourceSpec(
                    source_kind="named_fixture",
                    fixture_name="take_overshoot_then_settle_vocalish",
                ),
                minimum_human_agreement_ratio=0.66,
                human_ratings=[
                    HumanRatingNote(
                        note_index=0,
                        attack_direction="sharp",
                        sustain_direction="centered",
                        acceptability_label="in_tune",
                        rater_count=3,
                        notes="Consensus: attack overshoots but settles by sustain.",
                    )
                ],
            )
        ],
    )

    summary = run_calibration_corpus(corpus)

    assert summary.total_cases == 1
    assert summary.passed_cases == 1
    assert summary.rated_case_count == 1
    assert summary.rated_note_count == 1
    assert summary.human_rating_agreement_ratio is not None
    assert summary.human_rating_agreement_ratio >= 0.66
    assert summary.cases[0].human_rating_summary is not None
    assert summary.cases[0].human_rating_summary["agreement_ratio"] >= 0.66


def test_render_calibration_summary_markdown_includes_human_rating_summary() -> None:
    corpus = CalibrationCorpus(
        corpus_id="human-rating-markdown-test",
        description="Human rating markdown coverage",
        evidence_kind="human_rating_workflow",
        cases=[
            CalibrationCase(
                case_id="sharp-attack-human-rating",
                description="Human rating markdown sample",
                project_title="Human rating markdown sample",
                guide_source=AudioSourceSpec(
                    source_kind="named_fixture",
                    fixture_name="guide_centered_vocalish",
                ),
                take_source=AudioSourceSpec(
                    source_kind="named_fixture",
                    fixture_name="take_sharp_attack_vocalish",
                ),
                human_ratings=[
                    HumanRatingNote(
                        note_index=0,
                        attack_direction="sharp",
                        sustain_direction="centered",
                        acceptability_label="review",
                        rater_count=2,
                    )
                ],
            )
        ],
    )

    summary = run_calibration_corpus(corpus)
    markdown = render_calibration_summary_markdown(summary)

    assert "Human-rating agreement:" in markdown
    assert "rated notes" in markdown
