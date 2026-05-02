from __future__ import annotations

import json
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
from gigastudy_api.api.schemas import studios as studio_schemas
from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    CandidateRegion,
    DirectUploadTarget,
    ExtractionCandidate,
    ExtractionCandidateResponse,
    PitchEvent,
    ReportIssue,
    ScoreTrackRequest,
    ScoringReport,
    Studio,
    StudioListItem,
    StudioResponse,
    TrackExtractionJob,
    TrackSlot,
    TrackSlotResponse,
    build_studio_response,
)
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.main import create_app


WEB_TYPES_PATH = Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "types" / "studio.ts"


def test_web_studio_response_types_cover_api_schema_fields() -> None:
    web_types = WEB_TYPES_PATH.read_text(encoding="utf-8")
    contracts: list[tuple[Type[BaseModel], str, set[str]]] = [
        (PitchEvent, "PitchEvent", set()),
        (ArrangementRegion, "ArrangementRegion", set()),
        (CandidateRegion, "CandidateRegion", set()),
        (TrackExtractionJob, "TrackExtractionJob", set()),
        (ExtractionCandidateResponse, "ExtractionCandidate", set()),
        (TrackSlotResponse, "TrackSlot", set()),
        (ReportIssue, "ReportIssue", set()),
        (ScoringReport, "ScoringReport", set()),
        (StudioResponse, "Studio", set()),
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
                    TrackPitchEvent(
                        label="C4",
                        pitch_midi=60,
                        beat=1,
                        duration_beats=1,
                        measure_index=1,
                        beat_in_measure=1,
                        extraction_method="contract_fixture",
                        quality_warnings=["range_checked"],
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

    payload = build_studio_response(studio).model_dump(mode="json")

    assert "notes" not in payload["tracks"][0]
    assert payload["regions"][0]["region_id"] == "track-1-region-1"
    assert payload["regions"][0]["pitch_events"][0]["label"] == "C4"
    assert payload["regions"][0]["pitch_events"][0]["measure_index"] == 1
    assert payload["regions"][0]["pitch_events"][0]["beat_in_measure"] == 1
    assert payload["regions"][0]["pitch_events"][0]["extraction_method"] == "contract_fixture"
    assert payload["regions"][0]["pitch_events"][0]["quality_warnings"] == ["range_checked"]


def test_candidate_response_includes_region_candidate() -> None:
    candidate = ExtractionCandidate(
        candidate_id="candidate-region-contract",
        suggested_slot_id=2,
        source_kind="ai",
        source_label="AI harmony",
        method="rule_based",
        notes=[
            TrackPitchEvent(
                label="E4",
                pitch_midi=64,
                beat=1,
                duration_beats=1,
                onset_seconds=0,
                duration_seconds=0.5,
                extraction_method="candidate_fixture",
                quality_warnings=["candidate_checked"],
                source="ai",
            )
        ],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    studio = Studio(
        studio_id="candidate-region-contract-studio",
        title="Candidate response contract",
        bpm=120,
        tracks=[],
        reports=[],
        candidates=[candidate],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = build_studio_response(studio).model_dump(mode="json")["candidates"][0]

    assert "notes" not in payload
    assert payload["region"]["region_id"] == "candidate-candidate-region-contract-region-1"
    assert payload["region"]["suggested_slot_id"] == 2
    assert payload["region"]["pitch_events"][0]["label"] == "E4"
    assert payload["region"]["pitch_events"][0]["extraction_method"] == "candidate_fixture"
    assert payload["region"]["pitch_events"][0]["quality_warnings"] == ["candidate_checked"]


def test_score_track_request_uses_performance_events_not_notes() -> None:
    assert "performance_events" in ScoreTrackRequest.model_fields
    assert "performance_notes" not in ScoreTrackRequest.model_fields


def test_public_openapi_does_not_expose_legacy_note_contracts() -> None:
    openapi = create_app().openapi()
    schemas = openapi["components"]["schemas"]
    serialized = json.dumps(openapi)

    assert not hasattr(studio_schemas, "NoteSource")
    assert not hasattr(studio_schemas, "PitchEventSource")
    assert not hasattr(studio_schemas, "TrackNote")
    assert not hasattr(studio_schemas, "TrackPitchEvent")
    assert "TrackNote" not in schemas
    assert "TrackPitchEvent" not in schemas
    assert "performance_notes" not in serialized


def test_track_pitch_event_reads_legacy_warning_field_but_dumps_quality_warnings() -> None:
    note = TrackPitchEvent.model_validate(
        {
            "label": "C4",
            "pitch_midi": 60,
            "beat": 1,
            "duration_beats": 1,
            "source": "midi",
            "notation_warnings": ["legacy_warning"],
        }
    )
    payload = note.model_dump(mode="json")

    assert note.quality_warnings == ["legacy_warning"]
    assert payload["quality_warnings"] == ["legacy_warning"]
    assert "notation_warnings" not in payload


def test_track_pitch_event_reads_legacy_staff_index_but_dumps_source_staff_index() -> None:
    note = TrackPitchEvent.model_validate(
        {
            "label": "C4",
            "pitch_midi": 60,
            "beat": 1,
            "duration_beats": 1,
            "source": "musicxml",
            "staff_index": 2,
        }
    )
    payload = note.model_dump(mode="json")

    assert note.source_staff_index == 2
    assert payload["source_staff_index"] == 2
    assert "staff_index" not in payload


def test_track_pitch_event_reads_legacy_display_policy_but_dumps_pitch_policy() -> None:
    note = TrackPitchEvent.model_validate(
        {
            "label": "G3",
            "pitch_midi": 55,
            "beat": 1,
            "duration_beats": 1,
            "source": "musicxml",
            "clef": "treble_8vb",
            "display_octave_shift": 12,
        }
    )
    payload = note.model_dump(mode="json")

    assert note.pitch_register == "tenor_voice"
    assert note.pitch_label_octave_shift == 12
    assert payload["pitch_register"] == "tenor_voice"
    assert payload["pitch_label_octave_shift"] == 12
    assert "clef" not in payload
    assert "display_octave_shift" not in payload


def _extract_ts_type_fields(source: str, type_name: str) -> set[str]:
    match = re.search(rf"(?:export\s+)?type\s+{re.escape(type_name)}\s*=\s*\{{(?P<body>.*?)\n\}}", source, re.S)
    assert match is not None, f"Missing TypeScript type {type_name}"
    fields: set[str] = set()
    for line in match.group("body").splitlines():
        field_match = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\??:", line)
        if field_match:
            fields.add(field_match.group(1))
    return fields
