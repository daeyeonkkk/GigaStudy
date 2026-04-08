from pathlib import Path

from gigastudy_api.services.calibration import (
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
