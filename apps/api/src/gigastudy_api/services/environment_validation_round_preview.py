from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from gigastudy_api.api.schemas.ops import (
    EnvironmentValidationClaimGateResponse,
    EnvironmentValidationPacketResponse,
)
from gigastudy_api.services.environment_validation_claim_gate import (
    evaluate_environment_validation_claim_gate,
    render_environment_validation_claim_gate_markdown,
)
from gigastudy_api.services.environment_validation_import import (
    build_environment_validation_requests,
    load_environment_validation_sheet,
)
from gigastudy_api.services.environment_validation_packet_builder import (
    EnvironmentValidationEvidenceItem,
    build_empty_environment_diagnostics,
    build_environment_validation_packet_from_items,
)
from gigastudy_api.services.evidence_rounds import resolve_evidence_round_paths


class RoundEnvironmentValidationPreview(BaseModel):
    packet: EnvironmentValidationPacketResponse
    claim_gate: EnvironmentValidationClaimGateResponse


def build_round_environment_validation_preview(
    round_root: Path,
) -> RoundEnvironmentValidationPreview:
    packet = build_round_environment_validation_packet(round_root)
    claim_gate = evaluate_environment_validation_claim_gate(packet).model_copy(
        update={"generated_from": "round_environment_validation_claim_gate"}
    )
    return RoundEnvironmentValidationPreview(
        packet=packet,
        claim_gate=claim_gate,
    )


def build_round_environment_validation_packet(
    round_root: Path,
) -> EnvironmentValidationPacketResponse:
    paths = resolve_evidence_round_paths(round_root)
    rows = load_environment_validation_sheet(paths.environment_validation_sheet_path)
    requests = build_environment_validation_requests(rows)
    evidence_items = [
        EnvironmentValidationEvidenceItem.model_validate(request.model_dump(mode="python"))
        for request in requests
    ]
    return build_environment_validation_packet_from_items(
        evidence_items,
        diagnostics=build_empty_environment_diagnostics(),
        recent_validation_runs=[],
        generated_from="round_environment_validation_packet",
    )


def render_round_environment_validation_claim_gate_markdown(
    result: EnvironmentValidationClaimGateResponse,
) -> str:
    return render_environment_validation_claim_gate_markdown(result)
