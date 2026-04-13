from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil


ROUND_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True)
class EvidenceRoundPaths:
    root: Path
    readme: Path
    audit_json_path: Path
    audit_markdown_path: Path
    human_rating_dir: Path
    human_rating_audio_guides_dir: Path
    human_rating_audio_takes_dir: Path
    human_rating_references_dir: Path
    human_rating_review_packets_dir: Path
    human_rating_cases_path: Path
    human_rating_sheet_path: Path
    human_rating_reference_corpus_path: Path
    human_rating_generated_corpus_path: Path
    human_rating_reports_dir: Path
    human_rating_calibration_json_path: Path
    human_rating_calibration_markdown_path: Path
    human_rating_threshold_json_path: Path
    human_rating_threshold_markdown_path: Path
    human_rating_claim_gate_json_path: Path
    human_rating_claim_gate_markdown_path: Path
    human_rating_evidence_output_dir: Path
    environment_validation_dir: Path
    environment_validation_sheet_path: Path
    environment_validation_generated_requests_path: Path
    environment_validation_packet_json_path: Path
    environment_validation_claim_gate_json_path: Path
    environment_validation_claim_gate_markdown_path: Path


def resolve_project_root(service_path: Path | None = None) -> Path:
    current = service_path or Path(__file__).resolve()
    return current.parents[5]


def resolve_api_root(project_root: Path | None = None) -> Path:
    resolved_project_root = project_root or resolve_project_root()
    return resolved_project_root / "apps" / "api"


def default_evidence_rounds_root(project_root: Path | None = None) -> Path:
    resolved_project_root = project_root or resolve_project_root()
    dreamcatcher_root = resolved_project_root.parent / "DreamCatcher"

    if dreamcatcher_root.exists():
        return dreamcatcher_root / "GigaStudyEvidenceRounds"

    return resolved_project_root / "apps" / "api" / "output" / "evidence_rounds"


def validate_round_id(round_id: str) -> str:
    normalized = round_id.strip()

    if not normalized:
        raise ValueError("round_id must not be empty.")

    if not ROUND_ID_PATTERN.fullmatch(normalized):
        raise ValueError("round_id may contain only letters, numbers, dots, underscores, and dashes.")

    return normalized


def resolve_evidence_round_paths(round_root: Path) -> EvidenceRoundPaths:
    resolved_root = round_root.resolve()
    human_rating_dir = resolved_root / "human-rating"
    human_rating_audio_guides_dir = human_rating_dir / "audio" / "guides"
    human_rating_audio_takes_dir = human_rating_dir / "audio" / "takes"
    human_rating_references_dir = human_rating_dir / "references"
    human_rating_review_packets_dir = human_rating_dir / "review-packets"
    environment_validation_dir = resolved_root / "environment-validation"
    human_rating_reports_dir = human_rating_dir / "reports"
    human_rating_evidence_output_dir = human_rating_dir / "evidence-bundle"

    return EvidenceRoundPaths(
        root=resolved_root,
        readme=resolved_root / "README.md",
        audit_json_path=resolved_root / "round-audit.json",
        audit_markdown_path=resolved_root / "round-audit.md",
        human_rating_dir=human_rating_dir,
        human_rating_audio_guides_dir=human_rating_audio_guides_dir,
        human_rating_audio_takes_dir=human_rating_audio_takes_dir,
        human_rating_references_dir=human_rating_references_dir,
        human_rating_review_packets_dir=human_rating_review_packets_dir,
        human_rating_cases_path=human_rating_dir / "human_rating_cases.json",
        human_rating_sheet_path=human_rating_dir / "human_rating_sheet.csv",
        human_rating_reference_corpus_path=human_rating_dir / "human_rating_corpus.reference.json",
        human_rating_generated_corpus_path=human_rating_dir / "human_rating_corpus.generated.json",
        human_rating_reports_dir=human_rating_reports_dir,
        human_rating_calibration_json_path=human_rating_reports_dir / "calibration-summary.json",
        human_rating_calibration_markdown_path=human_rating_reports_dir / "calibration-summary.md",
        human_rating_threshold_json_path=human_rating_reports_dir / "threshold-report.json",
        human_rating_threshold_markdown_path=human_rating_reports_dir / "threshold-report.md",
        human_rating_claim_gate_json_path=human_rating_reports_dir / "claim-gate.json",
        human_rating_claim_gate_markdown_path=human_rating_reports_dir / "claim-gate.md",
        human_rating_evidence_output_dir=human_rating_evidence_output_dir,
        environment_validation_dir=environment_validation_dir,
        environment_validation_sheet_path=environment_validation_dir / "environment_validation_runs.csv",
        environment_validation_generated_requests_path=environment_validation_dir
        / "environment_validation_runs.generated.json",
        environment_validation_packet_json_path=environment_validation_dir
        / "environment_validation_packet.preview.json",
        environment_validation_claim_gate_json_path=environment_validation_dir
        / "environment_validation_claim_gate.preview.json",
        environment_validation_claim_gate_markdown_path=environment_validation_dir
        / "environment_validation_claim_gate.preview.md",
    )


def render_evidence_round_readme(
    *,
    round_id: str,
    repo_root: Path,
    uses_dreamcatcher_root: bool,
) -> str:
    storage_note = (
        "This round is scaffolded under DreamCatcher by default so real-world collection files stay "
        "out of the repository and out of PROJECT_FOUNDATION."
        if uses_dreamcatcher_root
        else "This round is scaffolded under the repo fallback output path because no DreamCatcher root "
        "was found in the current workspace."
    )

    return "\n".join(
        [
            f"# GigaStudy Evidence Round: {round_id}",
            "",
            storage_note,
            "",
            "## Human Rating",
            "",
            "- Put real guide WAV files under `human-rating/audio/guides/`.",
            "- Put real take WAV files under `human-rating/audio/takes/`.",
            "- Keep neutral note-reference exports under `human-rating/references/` so raters can align note indices without reading system verdict text.",
            "- When available, note-level guide/take clip WAVs should live under `human-rating/references/clips/<case-id>/` for faster rater review.",
            "- Review-ready HTML packets should live under `human-rating/review-packets/` so raters can open one file and listen through the case.",
            "- The rating sheet may use Korean labels such as `높음 / 정확 / 낮음 / 판단 어려움` and `양호 / 검토 / 교정 필요`; the builder normalizes those to canonical calibration values.",
            "- Prefer exporting a real GigaStudy guide/take pair into the round before editing metadata by hand.",
            "- Update `human-rating/human_rating_cases.json` so each case points to the real WAV paths.",
            "- Fill `human-rating/human_rating_sheet.csv` with per-rater note labels.",
            "- Use `human-rating/human_rating_corpus.reference.json` only as a final-shape reference.",
            "",
            "Recommended commands:",
            "",
            "```bash",
            f"cd {repo_root / 'apps' / 'api'}",
            "uv run python scripts/export_project_case_to_evidence_round.py --round-root <round> --project-id <project-id> --take-track-id <take-track-id>",
            "uv run python scripts/refresh_evidence_round.py --round-root <round>",
            "uv run python scripts/inspect_evidence_round.py --round-root <round>",
            "uv run python scripts/inspect_human_rating_corpus.py --round-root <round>",
            "uv run python scripts/build_human_rating_corpus.py --round-root <round>",
            "uv run python scripts/run_intonation_calibration.py --round-root <round>",
            "uv run python scripts/fit_human_rating_thresholds.py --round-root <round>",
            "uv run python scripts/evaluate_human_rating_claim_gate.py --round-root <round>",
            "uv run python scripts/build_human_rating_evidence_bundle.py --round-root <round>",
            "```",
            "",
            "Foundation workflow reference:",
            f"- `{repo_root / 'PROJECT_FOUNDATION' / 'QUALITY' / 'HUMAN_RATING_CALIBRATION_WORKFLOW.md'}`",
            "",
            "## Browser And Hardware Validation",
            "",
            "- Fill `environment-validation/environment_validation_runs.csv` with native browser and hardware validation results.",
            "- Prefer importing those rows through the ops UI preview/import panel when the app is running.",
            "- Use the CLI importer when the round is easier to normalize offline first.",
            "- Before ops import, use the round refresh path to regenerate a round-local packet and claim-gate preview from the CSV.",
            "",
            "Recommended command:",
            "",
            "```bash",
            f"cd {repo_root / 'apps' / 'api'}",
            "uv run python scripts/refresh_evidence_round.py --round-root <round>",
            "uv run python scripts/inspect_evidence_round.py --round-root <round>",
            "uv run python scripts/import_environment_validation_runs.py --round-root <round>",
            "```",
            "",
            "Foundation workflow reference:",
            f"- `{repo_root / 'PROJECT_FOUNDATION' / 'OPERATIONS' / 'BROWSER_ENVIRONMENT_VALIDATION.md'}`",
            "",
            "## Round Closeout",
            "",
            "- Keep generated evidence bundles, manually collected WAVs, and spreadsheet artifacts in this round folder.",
            "- Do not copy those files into `PROJECT_FOUNDATION`.",
            "- Only promote summary conclusions into the foundation docs after review.",
        ]
    )


def create_evidence_round_scaffold(
    *,
    round_id: str,
    output_root: Path | None = None,
    project_root: Path | None = None,
    api_root: Path | None = None,
    overwrite: bool = False,
) -> EvidenceRoundPaths:
    normalized_round_id = validate_round_id(round_id)
    resolved_project_root = project_root or resolve_project_root()
    resolved_api_root = api_root or resolve_api_root(resolved_project_root)
    resolved_output_root = (output_root or default_evidence_rounds_root(resolved_project_root)).resolve()
    round_root = resolved_output_root / normalized_round_id

    if round_root.exists() and not overwrite:
        raise FileExistsError(f"Evidence round already exists: {round_root}")

    round_root.mkdir(parents=True, exist_ok=True)

    scaffold_paths = resolve_evidence_round_paths(round_root)

    for directory in (
        scaffold_paths.human_rating_dir,
        scaffold_paths.human_rating_audio_guides_dir,
        scaffold_paths.human_rating_audio_takes_dir,
        scaffold_paths.human_rating_references_dir,
        scaffold_paths.human_rating_review_packets_dir,
        scaffold_paths.environment_validation_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    shutil.copy2(
        resolved_api_root / "calibration" / "human_rating_cases.template.json",
        scaffold_paths.human_rating_cases_path,
    )
    shutil.copy2(
        resolved_api_root / "calibration" / "human_rating_sheet.template.csv",
        scaffold_paths.human_rating_sheet_path,
    )
    shutil.copy2(
        resolved_api_root / "calibration" / "human_rating_corpus.template.json",
        scaffold_paths.human_rating_reference_corpus_path,
    )
    shutil.copy2(
        resolved_api_root / "environment_validation" / "environment_validation_runs.template.csv",
        scaffold_paths.environment_validation_sheet_path,
    )

    uses_dreamcatcher_root = (
        resolved_project_root.parent / "DreamCatcher"
    ).exists() and resolved_output_root.is_relative_to((resolved_project_root.parent / "DreamCatcher").resolve())
    scaffold_paths.readme.write_text(
        render_evidence_round_readme(
            round_id=normalized_round_id,
            repo_root=resolved_project_root,
            uses_dreamcatcher_root=uses_dreamcatcher_root,
        ),
        encoding="utf-8",
    )

    return scaffold_paths
