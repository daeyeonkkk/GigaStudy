from pathlib import Path

import pytest

from gigastudy_api.services.evidence_rounds import (
    create_evidence_round_scaffold,
    default_evidence_rounds_root,
    resolve_evidence_round_paths,
    validate_round_id,
)


def test_default_evidence_rounds_root_prefers_dreamcatcher(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    project_root.mkdir()
    (tmp_path / "DreamCatcher").mkdir()

    result = default_evidence_rounds_root(project_root)

    assert result == tmp_path / "DreamCatcher" / "GigaStudyEvidenceRounds"


def test_default_evidence_rounds_root_falls_back_to_repo_output(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    project_root.mkdir(parents=True)

    result = default_evidence_rounds_root(project_root)

    assert result == project_root / "apps" / "api" / "output" / "evidence_rounds"


def test_create_evidence_round_scaffold_copies_templates_and_writes_readme(tmp_path: Path) -> None:
    project_root = tmp_path / "GigaStudy"
    api_root = project_root / "apps" / "api"
    calibration_root = api_root / "calibration"
    environment_root = api_root / "environment_validation"
    calibration_root.mkdir(parents=True)
    environment_root.mkdir(parents=True)

    (calibration_root / "human_rating_cases.template.json").write_text("{}", encoding="utf-8")
    (calibration_root / "human_rating_sheet.template.csv").write_text("case_id\n", encoding="utf-8")
    (calibration_root / "human_rating_corpus.template.json").write_text("[]", encoding="utf-8")
    (environment_root / "environment_validation_runs.template.csv").write_text(
        "label\n",
        encoding="utf-8",
    )

    scaffold = create_evidence_round_scaffold(
        round_id="round-001",
        output_root=tmp_path / "rounds",
        project_root=project_root,
        api_root=api_root,
    )

    assert scaffold.root == (tmp_path / "rounds" / "round-001").resolve()
    assert scaffold.human_rating_audio_guides_dir.is_dir()
    assert scaffold.human_rating_audio_takes_dir.is_dir()
    assert scaffold.human_rating_references_dir.is_dir()
    assert scaffold.human_rating_review_packets_dir.is_dir()
    assert scaffold.human_rating_cases_path.read_text(encoding="utf-8") == "{}"
    assert scaffold.environment_validation_sheet_path.read_text(encoding="utf-8") == "label\n"
    readme = scaffold.readme.read_text(encoding="utf-8")
    assert "Human Rating" in readme
    assert "Browser And Hardware Validation" in readme
    assert "--round-root <round>" in readme
    assert "export_project_case_to_evidence_round.py" in readme
    assert "human-rating/references/" in readme
    assert "human-rating/references/clips/" in readme
    assert "human-rating/review-packets/" in readme


def test_resolve_evidence_round_paths_exposes_generated_output_locations(tmp_path: Path) -> None:
    round_root = tmp_path / "round-001"

    paths = resolve_evidence_round_paths(round_root)

    assert paths.root == round_root.resolve()
    assert paths.human_rating_generated_corpus_path == round_root.resolve() / "human-rating" / "human_rating_corpus.generated.json"
    assert paths.human_rating_calibration_json_path == round_root.resolve() / "human-rating" / "reports" / "calibration-summary.json"
    assert paths.human_rating_threshold_markdown_path == round_root.resolve() / "human-rating" / "reports" / "threshold-report.md"
    assert paths.human_rating_claim_gate_markdown_path == round_root.resolve() / "human-rating" / "reports" / "claim-gate.md"
    assert paths.human_rating_evidence_output_dir == round_root.resolve() / "human-rating" / "evidence-bundle"
    assert (
        paths.environment_validation_generated_requests_path
        == round_root.resolve() / "environment-validation" / "environment_validation_runs.generated.json"
    )


def test_validate_round_id_rejects_path_separators() -> None:
    with pytest.raises(ValueError, match="letters, numbers, dots, underscores, and dashes"):
        validate_round_id("../bad-round")
