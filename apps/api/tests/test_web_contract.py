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
    DirectUploadTarget,
    ExtractionCandidate,
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
        (TrackNote, "ScoreNote", set()),
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


def _extract_ts_type_fields(source: str, type_name: str) -> set[str]:
    match = re.search(rf"(?:export\s+)?type\s+{re.escape(type_name)}\s*=\s*\{{(?P<body>.*?)\n\}}", source, re.S)
    assert match is not None, f"Missing TypeScript type {type_name}"
    fields: set[str] = set()
    for line in match.group("body").splitlines():
        field_match = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\??:", line)
        if field_match:
            fields.add(field_match.group(1))
    return fields
