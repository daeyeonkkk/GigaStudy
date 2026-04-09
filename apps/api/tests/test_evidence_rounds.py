from pathlib import Path

import pytest

from gigastudy_api.services.evidence_rounds import (
    create_evidence_round_scaffold,
    default_evidence_rounds_root,
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
    assert scaffold.human_rating_cases_path.read_text(encoding="utf-8") == "{}"
    assert scaffold.environment_validation_sheet_path.read_text(encoding="utf-8") == "label\n"
    readme = scaffold.readme.read_text(encoding="utf-8")
    assert "Human Rating" in readme
    assert "Browser And Hardware Validation" in readme


def test_validate_round_id_rejects_path_separators() -> None:
    with pytest.raises(ValueError, match="letters, numbers, dots, underscores, and dashes"):
        validate_round_id("../bad-round")
