from __future__ import annotations

from collections import Counter
from pathlib import Path

from pydantic import BaseModel, Field

from gigastudy_api.api.schemas.ops import EnvironmentValidationPacketSummaryResponse
from gigastudy_api.services.calibration import load_calibration_corpus
from gigastudy_api.services.environment_validation_claim_gate import ESSENTIAL_MATRIX_LABELS
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths
from gigastudy_api.services.environment_validation_import import load_environment_validation_sheet
from gigastudy_api.services.environment_validation_round_preview import (
    build_round_environment_validation_preview,
)
from gigastudy_api.services.human_rating_builder import load_human_rating_metadata
from gigastudy_api.services.real_vocal_corpus import (
    CorpusInventoryReport,
    inspect_calibration_corpus,
    inspect_human_rating_metadata,
)


class EvidenceRoundArtifactStatus(BaseModel):
    label: str
    path: str
    exists: bool


class HumanRatingRoundAudit(BaseModel):
    metadata_present: bool
    rating_sheet_present: bool
    generated_corpus_present: bool
    rating_sheet_row_count: int = Field(ge=0)
    note_reference_csv_count: int = Field(ge=0)
    note_reference_json_count: int = Field(ge=0)
    note_clip_file_count: int = Field(ge=0)
    metadata_inventory: CorpusInventoryReport | None = None
    generated_corpus_inventory: CorpusInventoryReport | None = None
    artifacts: list[EvidenceRoundArtifactStatus]
    error: str | None = None


class EnvironmentValidationRoundAudit(BaseModel):
    sheet_present: bool
    generated_requests_present: bool
    packet_present: bool
    claim_gate_json_present: bool
    claim_gate_markdown_present: bool
    row_count: int = Field(ge=0)
    outcome_counts: dict[str, int]
    browsers: list[str]
    operating_systems: list[str]
    preview_packet_summary: EnvironmentValidationPacketSummaryResponse | None = None
    release_claim_ready: bool | None = None
    covered_matrix_count: int | None = Field(default=None, ge=0)
    total_required_matrix_cells: int | None = Field(default=None, ge=0)
    missing_required_matrix_labels: list[str] = Field(default_factory=list)
    artifacts: list[EvidenceRoundArtifactStatus] = Field(default_factory=list)
    error: str | None = None


class EvidenceRoundAuditReport(BaseModel):
    round_id: str
    round_root: str
    human_rating: HumanRatingRoundAudit
    environment_validation: EnvironmentValidationRoundAudit
    next_actions: list[str]


def _artifact_status(label: str, path: Path) -> EvidenceRoundArtifactStatus:
    return EvidenceRoundArtifactStatus(label=label, path=str(path), exists=path.exists())


def _inspect_human_rating_round(round_root: Path) -> HumanRatingRoundAudit:
    paths = resolve_evidence_round_paths(round_root)
    note_reference_csv_count = len(list(paths.human_rating_references_dir.glob("*.csv")))
    note_reference_json_count = len(list(paths.human_rating_references_dir.glob("*.json")))
    note_clip_file_count = len(list((paths.human_rating_references_dir / "clips").glob("**/*.wav")))
    artifacts = [
        _artifact_status("note_references_dir", paths.human_rating_references_dir),
        _artifact_status("calibration_json", paths.human_rating_calibration_json_path),
        _artifact_status("calibration_markdown", paths.human_rating_calibration_markdown_path),
        _artifact_status("threshold_json", paths.human_rating_threshold_json_path),
        _artifact_status("threshold_markdown", paths.human_rating_threshold_markdown_path),
        _artifact_status("claim_gate_json", paths.human_rating_claim_gate_json_path),
        _artifact_status("claim_gate_markdown", paths.human_rating_claim_gate_markdown_path),
        _artifact_status("evidence_bundle_dir", paths.human_rating_evidence_output_dir),
    ]

    metadata_inventory: CorpusInventoryReport | None = None
    generated_corpus_inventory: CorpusInventoryReport | None = None
    rating_sheet_row_count = 0
    errors: list[str] = []

    if paths.human_rating_cases_path.exists():
        try:
            metadata = load_human_rating_metadata(paths.human_rating_cases_path)
            metadata_inventory = inspect_human_rating_metadata(metadata, metadata_path=paths.human_rating_cases_path)
        except Exception as exc:  # pragma: no cover - defensive path
            errors.append(f"metadata:{exc}")

    if paths.human_rating_sheet_path.exists():
        try:
            rating_sheet_row_count = sum(
                1
                for raw_line in paths.human_rating_sheet_path.read_text(encoding="utf-8-sig").splitlines()[1:]
                if raw_line.strip()
            )
        except Exception as exc:  # pragma: no cover - defensive path
            errors.append(f"rating_sheet:{exc}")

    if paths.human_rating_generated_corpus_path.exists():
        try:
            corpus = load_calibration_corpus(paths.human_rating_generated_corpus_path)
            generated_corpus_inventory = inspect_calibration_corpus(
                corpus,
                manifest_path=paths.human_rating_generated_corpus_path,
            )
        except Exception as exc:  # pragma: no cover - defensive path
            errors.append(f"generated_corpus:{exc}")

    return HumanRatingRoundAudit(
        metadata_present=paths.human_rating_cases_path.exists(),
        rating_sheet_present=paths.human_rating_sheet_path.exists(),
        generated_corpus_present=paths.human_rating_generated_corpus_path.exists(),
        rating_sheet_row_count=rating_sheet_row_count,
        note_reference_csv_count=note_reference_csv_count,
        note_reference_json_count=note_reference_json_count,
        note_clip_file_count=note_clip_file_count,
        metadata_inventory=metadata_inventory,
        generated_corpus_inventory=generated_corpus_inventory,
        artifacts=artifacts,
        error="; ".join(errors) if errors else None,
    )


def _inspect_environment_validation_round(round_root: Path) -> EnvironmentValidationRoundAudit:
    paths = resolve_evidence_round_paths(round_root)
    outcome_counts: Counter[str] = Counter()
    browsers: set[str] = set()
    operating_systems: set[str] = set()
    row_count = 0
    preview_packet_summary: EnvironmentValidationPacketSummaryResponse | None = None
    release_claim_ready: bool | None = None
    covered_matrix_count: int | None = None
    total_required_matrix_cells: int | None = None
    missing_required_matrix_labels: list[str] = []
    error: str | None = None
    artifacts = [
        _artifact_status("generated_requests_json", paths.environment_validation_generated_requests_path),
        _artifact_status("packet_json", paths.environment_validation_packet_json_path),
        _artifact_status("claim_gate_json", paths.environment_validation_claim_gate_json_path),
        _artifact_status("claim_gate_markdown", paths.environment_validation_claim_gate_markdown_path),
    ]

    if paths.environment_validation_sheet_path.exists():
        try:
            rows = load_environment_validation_sheet(paths.environment_validation_sheet_path)
            row_count = len(rows)
            outcome_counts.update(row.outcome for row in rows)
            browsers.update(row.browser for row in rows)
            operating_systems.update(row.os for row in rows)
            preview = build_round_environment_validation_preview(paths.root)
            preview_packet_summary = preview.packet.summary
            release_claim_ready = preview.claim_gate.release_claim_ready
            covered_matrix_count = preview.claim_gate.covered_matrix_count
            total_required_matrix_cells = preview.claim_gate.total_required_matrix_cells
            covered_required_labels = {
                cell.label for cell in preview.packet.required_matrix if cell.covered
            }
            missing_required_matrix_labels = [
                label for label in ESSENTIAL_MATRIX_LABELS if label not in covered_required_labels
            ]
        except Exception as exc:  # pragma: no cover - defensive path
            error = str(exc)

    return EnvironmentValidationRoundAudit(
        sheet_present=paths.environment_validation_sheet_path.exists(),
        generated_requests_present=paths.environment_validation_generated_requests_path.exists(),
        packet_present=paths.environment_validation_packet_json_path.exists(),
        claim_gate_json_present=paths.environment_validation_claim_gate_json_path.exists(),
        claim_gate_markdown_present=paths.environment_validation_claim_gate_markdown_path.exists(),
        row_count=row_count,
        outcome_counts=dict(sorted(outcome_counts.items())),
        browsers=sorted(browser for browser in browsers if browser),
        operating_systems=sorted(os_name for os_name in operating_systems if os_name),
        preview_packet_summary=preview_packet_summary,
        release_claim_ready=release_claim_ready,
        covered_matrix_count=covered_matrix_count,
        total_required_matrix_cells=total_required_matrix_cells,
        missing_required_matrix_labels=missing_required_matrix_labels,
        artifacts=artifacts,
        error=error,
    )


def inspect_evidence_round(round_root: Path) -> EvidenceRoundAuditReport:
    paths = resolve_evidence_round_paths(round_root)
    human_rating = _inspect_human_rating_round(paths.root)
    environment_validation = _inspect_environment_validation_round(paths.root)
    next_actions: list[str] = []

    if not human_rating.metadata_present:
        next_actions.append("Seed or restore the human-rating metadata file for this round.")
    elif human_rating.metadata_inventory and not human_rating.metadata_inventory.summary.all_sources_resolved:
        next_actions.append("Replace placeholder guide/take WAV paths or copy the real singer audio into this round.")

    if human_rating.rating_sheet_present and human_rating.rating_sheet_row_count == 0:
        if human_rating.note_reference_csv_count == 0:
            next_actions.append(
                "Export or create neutral note-reference files for this round before asking raters to label note indices."
            )
        elif human_rating.note_clip_file_count == 0:
            next_actions.append(
                "Consider regenerating the exported case after analysis so note-level guide/take clip WAVs are available for faster rater review."
            )
        next_actions.append("Collect per-rater note labels in the human-rating sheet before rebuilding the corpus.")

    if human_rating.rating_sheet_row_count > 0 and not human_rating.generated_corpus_present:
        next_actions.append("Build the generated human-rating corpus from this round before calibration.")

    if human_rating.generated_corpus_present:
        missing_human_artifacts = [artifact.label for artifact in human_rating.artifacts if not artifact.exists]
        if missing_human_artifacts:
            next_actions.append(
                "Run the human-rating calibration, threshold-fit, claim-gate, and evidence-bundle CLIs so the round has its generated review artifacts."
            )

    if not environment_validation.sheet_present:
        next_actions.append("Seed or restore the environment-validation CSV for this round.")
    elif environment_validation.row_count == 0:
        next_actions.append("Collect browser and hardware validation rows in the round CSV before review.")
    elif not environment_validation.generated_requests_present:
        next_actions.append("Preview or import the environment-validation CSV so this round has normalized request JSON.")
    elif (
        not environment_validation.packet_present
        or not environment_validation.claim_gate_json_present
        or not environment_validation.claim_gate_markdown_present
    ):
        next_actions.append(
            "Run the round refresh so this round has its local environment-validation packet and claim-gate preview before ops import."
        )
    elif environment_validation.release_claim_ready is False:
        next_actions.append(
            "Collect more native Safari and real-hardware validation rows until the round-local browser claim gate is ready for review."
        )

    if not next_actions:
        next_actions.append("This round has its current support artifacts in place; the remaining work is collecting and reviewing real evidence.")

    return EvidenceRoundAuditReport(
        round_id=paths.root.name,
        round_root=str(paths.root),
        human_rating=human_rating,
        environment_validation=environment_validation,
        next_actions=next_actions,
    )


def render_evidence_round_audit_markdown(report: EvidenceRoundAuditReport) -> str:
    lines = [
        f"# Evidence Round Audit: {report.round_id}",
        "",
        f"- Round root: {report.round_root}",
        "",
        "## Human Rating",
        "",
        f"- Metadata present: {'yes' if report.human_rating.metadata_present else 'no'}",
        f"- Rating sheet present: {'yes' if report.human_rating.rating_sheet_present else 'no'}",
        f"- Rating sheet rows: {report.human_rating.rating_sheet_row_count}",
        f"- Note-reference CSV files: {report.human_rating.note_reference_csv_count}",
        f"- Note-reference JSON files: {report.human_rating.note_reference_json_count}",
        f"- Note clip WAV files: {report.human_rating.note_clip_file_count}",
        f"- Generated corpus present: {'yes' if report.human_rating.generated_corpus_present else 'no'}",
    ]

    if report.human_rating.metadata_inventory is not None:
        lines.extend(
            [
                f"- Metadata cases using real audio: {report.human_rating.metadata_inventory.summary.cases_using_real_audio}",
                f"- Metadata all sources resolved: {'yes' if report.human_rating.metadata_inventory.summary.all_sources_resolved else 'no'}",
            ]
        )

    if report.human_rating.generated_corpus_inventory is not None:
        lines.extend(
            [
                f"- Generated corpus rated notes: {report.human_rating.generated_corpus_inventory.summary.total_rated_notes}",
                f"- Generated corpus all sources resolved: {'yes' if report.human_rating.generated_corpus_inventory.summary.all_sources_resolved else 'no'}",
            ]
        )

    if report.human_rating.error:
        lines.append(f"- Human-rating audit error: {report.human_rating.error}")

    lines.extend(["", "### Human Rating Artifacts", ""])
    for artifact in report.human_rating.artifacts:
        lines.append(f"- {artifact.label}: {'present' if artifact.exists else 'missing'} ({artifact.path})")

    lines.extend(
        [
            "",
            "## Environment Validation",
            "",
            f"- CSV present: {'yes' if report.environment_validation.sheet_present else 'no'}",
            f"- Generated requests JSON present: {'yes' if report.environment_validation.generated_requests_present else 'no'}",
            f"- Packet JSON present: {'yes' if report.environment_validation.packet_present else 'no'}",
            f"- Claim-gate JSON present: {'yes' if report.environment_validation.claim_gate_json_present else 'no'}",
            f"- Claim-gate Markdown present: {'yes' if report.environment_validation.claim_gate_markdown_present else 'no'}",
            f"- Row count: {report.environment_validation.row_count}",
            f"- Outcome counts: {report.environment_validation.outcome_counts or '{}'}",
            f"- Browsers: {', '.join(report.environment_validation.browsers) if report.environment_validation.browsers else 'none'}",
            f"- Operating systems: {', '.join(report.environment_validation.operating_systems) if report.environment_validation.operating_systems else 'none'}",
        ]
    )

    if report.environment_validation.preview_packet_summary is not None:
        lines.extend(
            [
                f"- Preview total runs: {report.environment_validation.preview_packet_summary.total_validation_runs}",
                f"- Preview PASS / WARN / FAIL: {report.environment_validation.preview_packet_summary.pass_run_count} / {report.environment_validation.preview_packet_summary.warn_run_count} / {report.environment_validation.preview_packet_summary.fail_run_count}",
                f"- Preview release-claim ready: {'yes' if report.environment_validation.release_claim_ready else 'no'}",
                f"- Preview covered matrix: {report.environment_validation.covered_matrix_count}/{report.environment_validation.total_required_matrix_cells}",
                f"- Missing essential matrix labels: {', '.join(report.environment_validation.missing_required_matrix_labels) if report.environment_validation.missing_required_matrix_labels else 'none'}",
            ]
        )

    if report.environment_validation.error:
        lines.append(f"- Environment-validation audit error: {report.environment_validation.error}")

    lines.extend(["", "### Environment Validation Artifacts", ""])
    for artifact in report.environment_validation.artifacts:
        lines.append(f"- {artifact.label}: {'present' if artifact.exists else 'missing'} ({artifact.path})")

    lines.extend(["", "## Next Actions", ""])
    for action in report.next_actions:
        lines.append(f"- {action}")
    lines.append("")
    return "\n".join(lines)
