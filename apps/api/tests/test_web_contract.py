from __future__ import annotations

import re
from pathlib import Path
from typing import Type

from pydantic import BaseModel

from gigastudy_api.api.schemas.admin import (
    AdminAssetSummary,
    AdminDeleteResult,
    AdminEngineDrainResult,
    AdminLimitSummary,
    AdminStorageSummary,
    AdminStudioSummary,
)
from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    CandidateRegion,
    DirectUploadTarget,
    ExtractionCandidate,
    PitchEvent,
    ReportIssue,
    ScoringReport,
    Studio,
    StudioListItem,
    TrackExtractionJob,
    TrackNote,
    TrackSlot,
)


WEB_TYPES_PATH = Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "types" / "studio.ts"


def test_web_studio_response_types_cover_api_schema_fields() -> None:
    web_types = WEB_TYPES_PATH.read_text(encoding="utf-8")
    contracts: list[tuple[Type[BaseModel], str, set[str]]] = [
        (PitchEvent, "PitchEvent", set()),
        (ArrangementRegion, "ArrangementRegion", set()),
        (CandidateRegion, "CandidateRegion", set()),
        (TrackNote, "TrackNote", set()),
        (TrackExtractionJob, "TrackExtractionJob", set()),
        (ExtractionCandidate, "ExtractionCandidate", set()),
        (TrackSlot, "TrackSlot", set()),
        (ReportIssue, "ReportIssue", set()),
        (ScoringReport, "ScoringReport", set()),
        (Studio, "Studio", {"owner_token_hash"}),
        (StudioListItem, "StudioListItem", set()),
        (DirectUploadTarget, "DirectUploadTarget", set()),
        (AdminAssetSummary, "AdminAssetSummary", set()),
        (AdminStudioSummary, "AdminStudioSummary", set()),
        (AdminLimitSummary, "AdminLimitSummary", set()),
        (AdminStorageSummary, "AdminStorageSummary", set()),
        (AdminDeleteResult, "AdminDeleteResult", set()),
        (AdminEngineDrainResult, "AdminEngineDrainResult", set()),
    ]

    for model, type_name, excluded_fields in contracts:
        api_fields = set(model.model_fields) - excluded_fields
        ts_fields = _extract_ts_type_fields(web_types, type_name)
        assert api_fields <= ts_fields, f"{type_name} missing fields: {sorted(api_fields - ts_fields)}"


def test_studio_response_includes_arrangement_regions() -> None:
    studio = Studio(
        studio_id="studio-region-contract",
        title="Region contract",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                source_kind="midi",
                source_label="seed.mid",
                duration_seconds=0,
                notes=[
                    TrackNote(
                        label="C4",
                        pitch_midi=60,
                        beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
                updated_at="2026-01-01T00:00:00Z",
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = studio.model_dump(mode="json")

    assert payload["regions"][0]["region_id"] == "track-1-region-1"
    assert payload["regions"][0]["pitch_events"][0]["label"] == "C4"


def test_candidate_response_includes_region_candidate() -> None:
    candidate = ExtractionCandidate(
        candidate_id="candidate-region-contract",
        suggested_slot_id=2,
        source_kind="ai",
        source_label="AI harmony",
        method="rule_based",
        notes=[
            TrackNote(
                label="E4",
                pitch_midi=64,
                beat=1,
                duration_beats=1,
                onset_seconds=0,
                duration_seconds=0.5,
                source="ai",
            )
        ],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = candidate.model_dump(mode="json")

    assert payload["region"]["region_id"] == "candidate-candidate-region-contract-region-1"
    assert payload["region"]["suggested_slot_id"] == 2
    assert payload["region"]["pitch_events"][0]["label"] == "E4"


def _extract_ts_type_fields(source: str, type_name: str) -> set[str]:
    match = re.search(rf"(?:export\s+)?type\s+{re.escape(type_name)}\s*=\s*\{{(?P<body>.*?)\n\}}", source, re.S)
    assert match is not None, f"Missing TypeScript type {type_name}"
    fields: set[str] = set()
    for line in match.group("body").splitlines():
        field_match = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\??:", line)
        if field_match:
            fields.add(field_match.group(1))
    return fields
