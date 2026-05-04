from __future__ import annotations
import re
from pathlib import Path
from typing import Type

import pytest
from pydantic import BaseModel, ValidationError

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
from gigastudy_api.services.engine.timeline import registered_region_events_for_slot
from gigastudy_api.services.studio_generation import build_generation_context_events_by_slot
from gigastudy_api.services.studio_scoring import validate_score_track_request
from gigastudy_api.services.studio_documents import encode_studio_payload


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
                events=[
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

    assert "events" not in payload["tracks"][0]
    assert payload["regions"][0]["region_id"] == "track-1-region-1"
    assert payload["regions"][0]["pitch_events"][0]["label"] == "C4"
    assert payload["regions"][0]["pitch_events"][0]["measure_index"] == 1
    assert payload["regions"][0]["pitch_events"][0]["beat_in_measure"] == 1
    assert payload["regions"][0]["pitch_events"][0]["extraction_method"] == "contract_fixture"
    assert payload["regions"][0]["pitch_events"][0]["quality_warnings"] == ["range_checked"]


def test_studio_payload_persists_explicit_regions_from_internal_events() -> None:
    studio = Studio(
        studio_id="studio-persisted-region-contract",
        title="Persisted region contract",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                source_kind="midi",
                source_label="seed.mid",
                duration_seconds=0,
                events=[
                    TrackPitchEvent(
                        label="C4",
                        pitch_midi=60,
                        beat=1,
                        duration_beats=1,
                        extraction_method="contract_fixture",
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

    payload = encode_studio_payload(studio)

    assert payload["regions"][0]["region_id"] == "track-1-region-1"
    assert payload["regions"][0]["pitch_events"][0]["label"] == "C4"
    assert studio.regions[0].pitch_events[0].label == "C4"
    assert studio.tracks[0].events == []
    assert payload["tracks"][0]["events"] == []


def test_track_slot_rejects_unmodelled_payload_field() -> None:
    with pytest.raises(ValidationError):
        TrackSlot.model_validate(
            {
                "slot_id": 1,
                "name": "Soprano",
                "status": "registered",
                "source_kind": "midi",
                "source_label": "old.mid",
                "duration_seconds": 1,
                "unexpected_payload_field": "C4",
                "updated_at": "2026-01-01T00:00:00Z",
            }
        )


def test_track_slot_stores_events_only() -> None:
    track = TrackSlot.model_validate(
        {
            "slot_id": 1,
            "name": "Soprano",
            "status": "registered",
            "source_kind": "midi",
            "source_label": "events.mid",
            "duration_seconds": 1,
            "events": [
                {
                    "label": "C4",
                    "pitch_midi": 60,
                    "beat": 1,
                    "duration_beats": 1,
                    "source": "midi",
                }
            ],
            "updated_at": "2026-01-01T00:00:00Z",
        }
    )
    payload = track.model_dump(mode="json")

    assert track.events[0].label == "C4"
    assert payload["events"][0]["label"] == "C4"


def test_engine_context_reads_persisted_regions_without_track_events() -> None:
    track = TrackSlot(
        slot_id=1,
        name="Soprano",
        status="registered",
        source_kind="midi",
        source_label="region-only.mid",
        duration_seconds=1,
        events=[],
        updated_at="2026-01-01T00:00:00Z",
    )
    studio = Studio(
        studio_id="studio-region-first-contract",
        title="Region-first contract",
        bpm=120,
        tracks=[track],
        regions=[
            ArrangementRegion(
                region_id="track-1-region-1",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="region-only.mid",
                start_seconds=0,
                duration_seconds=1,
                pitch_events=[
                    PitchEvent(
                        event_id="track-1-region-1-event-1",
                        track_slot_id=1,
                        region_id="track-1-region-1",
                        label="C4",
                        pitch_midi=60,
                        start_seconds=0,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    events = registered_region_events_for_slot(studio, 1)
    context = build_generation_context_events_by_slot(
        studio,
        target_slot_id=2,
        requested_context_slot_ids=None,
    )

    validate_score_track_request(
        ScoreTrackRequest(include_metronome=True),
        target_track=track,
        reference_slot_ids=[],
        target_has_events=bool(events),
    )
    assert events[0].label == "C4"
    assert context[1][0].label == "C4"


def test_studio_payload_preserves_explicit_region_without_track_notes() -> None:
    studio = Studio(
        studio_id="studio-preserve-explicit-region",
        title="Preserve explicit region",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                source_kind="midi",
                source_label="region-only.mid",
                duration_seconds=1,
                events=[],
                updated_at="2026-01-01T00:00:00Z",
            )
        ],
        regions=[
            ArrangementRegion(
                region_id="explicit-track-1-region",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="region-only.mid",
                start_seconds=0,
                duration_seconds=1,
                pitch_events=[
                    PitchEvent(
                        event_id="explicit-track-1-event",
                        track_slot_id=1,
                        region_id="explicit-track-1-region",
                        label="D4",
                        pitch_midi=62,
                        start_seconds=0,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = encode_studio_payload(studio)

    assert payload["regions"][0]["region_id"] == "explicit-track-1-region"
    assert payload["regions"][0]["pitch_events"][0]["label"] == "D4"


def test_explicit_region_is_authoritative_over_stale_track_shadow() -> None:
    studio = Studio(
        studio_id="studio-explicit-region-wins",
        title="Explicit region wins",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                source_kind="midi",
                source_label="stale.mid",
                duration_seconds=1,
                events=[
                    TrackPitchEvent(
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
        regions=[
            ArrangementRegion(
                region_id="explicit-region-wins",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="edited.mid",
                start_seconds=0,
                duration_seconds=1,
                pitch_events=[
                    PitchEvent(
                        event_id="explicit-region-wins-event",
                        track_slot_id=1,
                        region_id="explicit-region-wins",
                        label="D4",
                        pitch_midi=62,
                        start_seconds=0,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = encode_studio_payload(studio)

    assert payload["regions"][0]["region_id"] == "explicit-region-wins"
    assert payload["regions"][0]["pitch_events"][0]["label"] == "D4"
    assert payload["tracks"][0]["events"] == []


def test_explicit_multi_regions_are_authoritative_after_track_shadow_is_cleared() -> None:
    studio = Studio(
        studio_id="studio-explicit-multi-region",
        title="Explicit multi-region",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                source_kind="midi",
                source_label="region-edited.mid",
                duration_seconds=4,
                events=[],
                updated_at="2026-01-01T00:00:00Z",
            )
        ],
        regions=[
            ArrangementRegion(
                region_id="explicit-region-a",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="region-edited.mid",
                start_seconds=0,
                duration_seconds=1,
                pitch_events=[
                    PitchEvent(
                        event_id="explicit-region-a-event",
                        track_slot_id=1,
                        region_id="explicit-region-a",
                        label="C4",
                        pitch_midi=60,
                        start_seconds=0,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
            ),
            ArrangementRegion(
                region_id="explicit-region-b",
                track_slot_id=1,
                track_name="Soprano",
                source_kind="midi",
                source_label="region-edited.mid",
                start_seconds=2,
                duration_seconds=1,
                pitch_events=[
                    PitchEvent(
                        event_id="explicit-region-b-event",
                        track_slot_id=1,
                        region_id="explicit-region-b",
                        label="D4",
                        pitch_midi=62,
                        start_seconds=2,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
            ),
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = build_studio_response(studio).model_dump(mode="json")
    events = registered_region_events_for_slot(studio, 1)

    assert [region["region_id"] for region in payload["regions"]] == [
        "explicit-region-a",
        "explicit-region-b",
    ]
    assert [event.label for event in events] == ["C4", "D4"]


def test_studio_response_drops_stale_explicit_region_for_empty_track() -> None:
    studio = Studio(
        studio_id="studio-drop-stale-region",
        title="Drop stale region",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="empty",
                duration_seconds=0,
                events=[],
                updated_at="2026-01-01T00:00:00Z",
            )
        ],
        regions=[
            ArrangementRegion(
                region_id="stale-track-1-region",
                track_slot_id=1,
                track_name="Soprano",
                start_seconds=0,
                duration_seconds=1,
                pitch_events=[
                    PitchEvent(
                        event_id="stale-track-1-event",
                        track_slot_id=1,
                        region_id="stale-track-1-region",
                        label="D4",
                        pitch_midi=62,
                        start_seconds=0,
                        duration_seconds=0.5,
                        start_beat=1,
                        duration_beats=1,
                        source="midi",
                    )
                ],
            )
        ],
        reports=[],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = build_studio_response(studio).model_dump(mode="json")

    assert payload["regions"] == []


def test_candidate_response_includes_region_candidate() -> None:
    candidate = ExtractionCandidate(
        candidate_id="candidate-region-contract",
        suggested_slot_id=2,
        source_kind="ai",
        source_label="AI harmony",
        method="rule_based",
        events=[
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

    assert "events" not in payload
    assert payload["region"]["region_id"] == "candidate-candidate-region-contract-region-1"
    assert payload["region"]["suggested_slot_id"] == 2
    assert payload["region"]["pitch_events"][0]["label"] == "E4"
    assert payload["region"]["pitch_events"][0]["extraction_method"] == "candidate_fixture"
    assert payload["region"]["pitch_events"][0]["quality_warnings"] == ["candidate_checked"]


def test_studio_payload_persists_candidate_region_from_internal_events() -> None:
    candidate = ExtractionCandidate(
        candidate_id="candidate-persisted-region",
        suggested_slot_id=3,
        source_kind="ai",
        source_label="AI alto",
        method="rule_based",
        events=[
            TrackPitchEvent(
                label="A3",
                pitch_midi=57,
                beat=2,
                duration_beats=1.5,
                onset_seconds=0.5,
                duration_seconds=0.75,
                extraction_method="candidate_persist_fixture",
                source="ai",
            )
        ],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    studio = Studio(
        studio_id="candidate-persisted-region-studio",
        title="Candidate persisted region",
        bpm=120,
        tracks=[],
        reports=[],
        candidates=[candidate],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = encode_studio_payload(studio)

    assert payload["candidates"][0]["region"]["region_id"] == "candidate-candidate-persisted-region-region-1"
    assert payload["candidates"][0]["region"]["suggested_slot_id"] == 3
    assert payload["candidates"][0]["region"]["pitch_events"][0]["label"] == "A3"
    assert studio.candidates[0].region is not None
    assert studio.candidates[0].region.pitch_events[0].label == "A3"


def test_extraction_candidate_rejects_unmodelled_payload_field() -> None:
    with pytest.raises(ValidationError):
        ExtractionCandidate.model_validate(
            {
                "candidate_id": "old-candidate-events",
                "suggested_slot_id": 2,
                "source_kind": "ai",
                "source_label": "AI harmony",
                "method": "rule_based",
                "unexpected_payload_field": "E4",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
        )


def test_extraction_candidate_stores_events_only() -> None:
    candidate = ExtractionCandidate.model_validate(
        {
            "candidate_id": "candidate-events",
            "suggested_slot_id": 2,
            "source_kind": "ai",
            "source_label": "AI harmony",
            "method": "rule_based",
            "events": [
                {
                    "label": "E4",
                    "pitch_midi": 64,
                    "beat": 1,
                    "duration_beats": 1,
                    "source": "ai",
                }
            ],
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
    )
    payload = candidate.model_dump(mode="json")

    assert candidate.events[0].label == "E4"
    assert payload["events"][0]["label"] == "E4"


def test_scoring_report_rejects_unmodelled_count_field() -> None:
    with pytest.raises(ValidationError):
        ScoringReport.model_validate(
            {
                "report_id": "old-report",
                "target_slot_id": 1,
                "target_track_name": "Soprano",
                "reference_slot_ids": [2],
                "include_metronome": True,
                "created_at": "2026-01-01T00:00:00Z",
                "unexpected_event_count": 4,
                "issues": [],
            }
        )


def test_report_issue_rejects_unmodelled_event_id_field() -> None:
    with pytest.raises(ValidationError):
        ReportIssue.model_validate(
            {
                "at_seconds": 0,
                "issue_type": "pitch",
                "unexpected_event_id": "answer-source",
            }
        )


def test_studio_payload_preserves_explicit_candidate_region_without_internal_events() -> None:
    candidate = ExtractionCandidate(
        candidate_id="candidate-region-only",
        suggested_slot_id=4,
        source_kind="ai",
        source_label="AI tenor",
        method="rule_based",
        events=[],
        region=CandidateRegion(
            region_id="explicit-candidate-region",
            suggested_slot_id=4,
            source_kind="ai",
            source_label="AI tenor",
            start_seconds=0,
            duration_seconds=1,
            pitch_events=[
                PitchEvent(
                    event_id="explicit-candidate-event",
                    track_slot_id=4,
                    region_id="explicit-candidate-region",
                    label="F3",
                    pitch_midi=53,
                    start_seconds=0,
                    duration_seconds=0.5,
                    start_beat=1,
                    duration_beats=1,
                    source="ai",
                )
            ],
        ),
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    studio = Studio(
        studio_id="candidate-region-only-studio",
        title="Candidate region-only",
        bpm=120,
        tracks=[],
        reports=[],
        candidates=[candidate],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    payload = encode_studio_payload(studio)

    assert payload["candidates"][0]["region"]["region_id"] == "explicit-candidate-region"
    assert payload["candidates"][0]["region"]["pitch_events"][0]["label"] == "F3"


def test_score_track_request_uses_performance_events() -> None:
    assert "performance_events" in ScoreTrackRequest.model_fields


def test_public_openapi_exposes_region_event_contracts() -> None:
    openapi = create_app().openapi()
    schemas = openapi["components"]["schemas"]
    scoring_properties = schemas["ScoringReport"]["properties"]
    issue_properties = schemas["ReportIssue"]["properties"]

    assert hasattr(studio_schemas, "PitchEvent")
    assert "PitchEvent" in schemas
    assert "ArrangementRegion" in schemas
    assert "CandidateRegion" in schemas
    assert "UpdateRegionRequest" in schemas
    assert "CopyRegionRequest" in schemas
    assert "SplitRegionRequest" in schemas
    assert "UpdatePitchEventRequest" in schemas
    assert "TrackSlotResponse" in schemas
    assert "performance_events" in schemas["ScoreTrackRequest"]["properties"]
    assert {
        "answer_event_count",
        "performance_event_count",
        "matched_event_count",
        "missing_event_count",
        "extra_event_count",
    } <= set(scoring_properties)
    assert {"answer_event_id", "performance_event_id"} <= set(issue_properties)


def test_track_pitch_event_rejects_unmodelled_layout_fields() -> None:
    extra_field_sets = [
        {"document_row_index": 2},
        {"document_lane": "upper"},
        {"display_offset": 12},
    ]
    for extra_fields in extra_field_sets:
        with pytest.raises(ValidationError):
            TrackPitchEvent.model_validate(
                {
                    "label": "C4",
                    "pitch_midi": 60,
                    "beat": 1,
                    "duration_beats": 1,
                    "source": "musicxml",
                    **extra_fields,
                }
            )


def _extract_ts_type_fields(source: str, type_name: str) -> set[str]:
    match = re.search(rf"(?:export\s+)?type\s+{re.escape(type_name)}\s*=\s*\{{(?P<body>.*?)\n\}}", source, re.S)
    assert match is not None, f"Missing TypeScript type {type_name}"
    fields: set[str] = set()
    for line in match.group("body").splitlines():
        field_match = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\??:", line)
        if field_match:
            fields.add(field_match.group(1))
    return fields
