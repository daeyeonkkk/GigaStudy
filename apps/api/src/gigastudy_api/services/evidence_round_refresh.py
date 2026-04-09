from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from gigastudy_api.services.calibration import (
    load_calibration_corpus,
    render_calibration_summary_markdown,
    run_calibration_corpus,
)
from gigastudy_api.services.calibration_claim_gate import render_calibration_claim_gate_markdown, evaluate_calibration_claim_gate
from gigastudy_api.services.calibration_evidence import (
    build_evidence_bundle_slug,
    build_human_rating_evidence_bundle,
    render_human_rating_evidence_markdown,
)
from gigastudy_api.services.environment_validation_import import (
    build_environment_validation_requests,
    load_environment_validation_sheet,
    render_environment_validation_requests_json,
)
from gigastudy_api.services.environment_validation_round_preview import (
    build_round_environment_validation_preview,
    render_round_environment_validation_claim_gate_markdown,
)
from gigastudy_api.services.evidence_round_audit import inspect_evidence_round, render_evidence_round_audit_markdown
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths
from gigastudy_api.services.human_rating_builder import (
    build_human_rating_corpus,
    load_human_rating_metadata,
    load_human_rating_sheet,
    render_human_rating_corpus_json,
)
from gigastudy_api.services.threshold_fitting import (
    build_threshold_calibration_report,
    render_threshold_calibration_markdown,
)


class EvidenceRoundRefreshResult(BaseModel):
    round_root: str
    generated_corpus_written: bool
    environment_preview_written: bool
    environment_packet_written: bool
    environment_claim_gate_written: bool
    human_reports_written: bool
    human_reports_skip_reason: str | None = None
    audit_json_written: bool
    audit_markdown_written: bool
    next_actions: list[str]


def refresh_evidence_round(round_root: Path) -> EvidenceRoundRefreshResult:
    paths = resolve_evidence_round_paths(round_root)

    generated_corpus_written = False
    environment_preview_written = False
    environment_packet_written = False
    environment_claim_gate_written = False
    human_reports_written = False
    human_reports_skip_reason: str | None = None

    if paths.human_rating_cases_path.exists() and paths.human_rating_sheet_path.exists():
        metadata = load_human_rating_metadata(paths.human_rating_cases_path)
        rating_rows = load_human_rating_sheet(paths.human_rating_sheet_path)
        corpus = build_human_rating_corpus(metadata, rating_rows)
        paths.human_rating_generated_corpus_path.parent.mkdir(parents=True, exist_ok=True)
        paths.human_rating_generated_corpus_path.write_text(
            render_human_rating_corpus_json(corpus),
            encoding="utf-8",
        )
        generated_corpus_written = True

    if paths.environment_validation_sheet_path.exists():
        rows = load_environment_validation_sheet(paths.environment_validation_sheet_path)
        requests = build_environment_validation_requests(rows)
        paths.environment_validation_generated_requests_path.parent.mkdir(parents=True, exist_ok=True)
        paths.environment_validation_generated_requests_path.write_text(
            render_environment_validation_requests_json(requests),
            encoding="utf-8",
        )
        preview = build_round_environment_validation_preview(paths.root)
        paths.environment_validation_packet_json_path.write_text(
            json.dumps(preview.packet.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        paths.environment_validation_claim_gate_json_path.write_text(
            json.dumps(preview.claim_gate.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        paths.environment_validation_claim_gate_markdown_path.write_text(
            render_round_environment_validation_claim_gate_markdown(preview.claim_gate),
            encoding="utf-8",
        )
        environment_preview_written = True
        environment_packet_written = True
        environment_claim_gate_written = True

    initial_audit = inspect_evidence_round(paths.root)
    generated_inventory = initial_audit.human_rating.generated_corpus_inventory
    generated_corpus_ready = (
        generated_inventory is not None
        and generated_inventory.summary.all_sources_resolved
        and paths.human_rating_generated_corpus_path.exists()
    )

    if generated_corpus_ready:
        corpus = load_calibration_corpus(paths.human_rating_generated_corpus_path)
        summary = run_calibration_corpus(corpus, manifest_path=paths.human_rating_generated_corpus_path)
        threshold_report = build_threshold_calibration_report(summary)
        claim_gate = evaluate_calibration_claim_gate(summary, threshold_report)
        evidence_bundle = build_human_rating_evidence_bundle(
            summary,
            threshold_report,
            manifest_path=paths.human_rating_generated_corpus_path,
        )

        paths.human_rating_calibration_json_path.parent.mkdir(parents=True, exist_ok=True)
        paths.human_rating_evidence_output_dir.mkdir(parents=True, exist_ok=True)

        paths.human_rating_calibration_json_path.write_text(
            json.dumps(summary.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        paths.human_rating_calibration_markdown_path.write_text(
            render_calibration_summary_markdown(summary),
            encoding="utf-8",
        )
        paths.human_rating_threshold_json_path.write_text(
            json.dumps(threshold_report.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        paths.human_rating_threshold_markdown_path.write_text(
            render_threshold_calibration_markdown(threshold_report),
            encoding="utf-8",
        )
        paths.human_rating_claim_gate_json_path.write_text(
            json.dumps(
                {
                    "claim_gate": claim_gate.model_dump(mode="json"),
                    "calibration_summary_markdown": render_calibration_summary_markdown(summary),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        paths.human_rating_claim_gate_markdown_path.write_text(
            render_calibration_claim_gate_markdown(claim_gate),
            encoding="utf-8",
        )

        slug = build_evidence_bundle_slug(summary.corpus_id)
        (paths.human_rating_evidence_output_dir / f"{slug}.calibration-summary.json").write_text(
            json.dumps(summary.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        (paths.human_rating_evidence_output_dir / f"{slug}.calibration-summary.md").write_text(
            render_calibration_summary_markdown(summary),
            encoding="utf-8",
        )
        (paths.human_rating_evidence_output_dir / f"{slug}.threshold-report.json").write_text(
            json.dumps(threshold_report.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        (paths.human_rating_evidence_output_dir / f"{slug}.threshold-report.md").write_text(
            render_threshold_calibration_markdown(threshold_report),
            encoding="utf-8",
        )
        (paths.human_rating_evidence_output_dir / f"{slug}.evidence-bundle.json").write_text(
            json.dumps(evidence_bundle.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
        (paths.human_rating_evidence_output_dir / f"{slug}.evidence-bundle.md").write_text(
            render_human_rating_evidence_markdown(evidence_bundle),
            encoding="utf-8",
        )
        human_reports_written = True
    else:
        if not paths.human_rating_generated_corpus_path.exists():
            human_reports_skip_reason = "generated_corpus_missing"
        elif generated_inventory is None:
            human_reports_skip_reason = "generated_corpus_unreadable"
        elif not generated_inventory.summary.all_sources_resolved:
            human_reports_skip_reason = "generated_corpus_has_unresolved_audio_sources"
        else:
            human_reports_skip_reason = "generated_corpus_not_ready"

    final_audit = inspect_evidence_round(paths.root)
    paths.audit_json_path.write_text(json.dumps(final_audit.model_dump(mode="json"), indent=2), encoding="utf-8")
    paths.audit_markdown_path.write_text(render_evidence_round_audit_markdown(final_audit), encoding="utf-8")

    return EvidenceRoundRefreshResult(
        round_root=str(paths.root),
        generated_corpus_written=generated_corpus_written,
        environment_preview_written=environment_preview_written,
        environment_packet_written=environment_packet_written,
        environment_claim_gate_written=environment_claim_gate_written,
        human_reports_written=human_reports_written,
        human_reports_skip_reason=human_reports_skip_reason,
        audit_json_written=True,
        audit_markdown_written=True,
        next_actions=final_audit.next_actions,
    )
