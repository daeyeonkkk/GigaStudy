from gigastudy_api.api.schemas.studios import GenerateTrackRequest, Studio, TrackSlot
from gigastudy_api.config import Settings
from gigastudy_api.services.engine.music_theory import event_from_pitch
from gigastudy_api.services.engine.percussion_generation import (
    PERCUSSION_GENERATION_METHOD,
    generate_percussion_candidates,
)
from gigastudy_api.services.studio_generation import generate_track_material
from gigastudy_api.services.studio_generation import generation_candidate_review_metadata


def _context_note(
    beat: float,
    *,
    duration_beats: float = 0.25,
    label: str = "C4",
    slot_id: int | None = None,
):
    event = event_from_pitch(
        beat=beat,
        duration_beats=duration_beats,
        bpm=120,
        source="midi",
        extraction_method="test_context",
        label=label,
        confidence=1,
    )
    if slot_id is not None:
        event.voice_index = slot_id
    return event


def test_percussion_candidates_use_meter_derived_grid_for_common_meters() -> None:
    cases = [
        (4, 4, 0.25),
        (3, 4, 0.25),
        (6, 8, 0.25),
    ]

    for numerator, denominator, expected_grid in cases:
        candidates = generate_percussion_candidates(
            context_tracks=[_context_note(1, duration_beats=8)],
            bpm=120,
            time_signature_numerator=numerator,
            time_signature_denominator=denominator,
            candidate_count=3,
        )

        assert len(candidates) == 3
        assert candidates[0][0].beat == 1
        assert candidates[0][0].label == "Kick"
        assert all(event.duration_beats == expected_grid for event in candidates[0])
        assert all(event.extraction_method == PERCUSSION_GENERATION_METHOD for event in candidates[0])


def test_percussion_generation_respects_context_length() -> None:
    candidates = generate_percussion_candidates(
        context_tracks=[_context_note(1, duration_beats=4)],
        bpm=120,
        time_signature_numerator=4,
        time_signature_denominator=4,
        candidate_count=1,
    )

    assert candidates
    assert max(event.beat + event.duration_beats for event in candidates[0]) <= 5


def test_dense_context_generates_more_hat_and_rim_activity_than_sparse_context() -> None:
    sparse = generate_percussion_candidates(
        context_tracks=[_context_note(1, duration_beats=4)],
        bpm=120,
        candidate_count=3,
    )[2]
    dense_context = [_context_note(1 + index * 0.25) for index in range(16)]
    dense = generate_percussion_candidates(
        context_tracks=dense_context,
        bpm=120,
        candidate_count=3,
    )[2]

    sparse_texture_count = sum(1 for event in sparse if event.label in {"HatClosed", "HatOpen", "Rim"})
    dense_texture_count = sum(1 for event in dense if event.label in {"HatClosed", "HatOpen", "Rim"})

    assert dense_texture_count > sparse_texture_count


def test_percussion_candidates_have_distinct_pattern_roles() -> None:
    candidates = generate_percussion_candidates(
        context_tracks=[_context_note(1 + index * 0.5) for index in range(12)],
        bpm=120,
        candidate_count=3,
    )
    signatures = {
        tuple((event.beat, event.label) for event in candidate)
        for candidate in candidates
    }

    assert len(signatures) == 3


def test_percussion_candidate_metadata_treats_unpitched_hits_as_in_range() -> None:
    events = generate_percussion_candidates(
        context_tracks=[_context_note(1, duration_beats=4)],
        bpm=120,
        candidate_count=1,
    )[0]

    diagnostics, variant_label = generation_candidate_review_metadata(
        slot_id=6,
        events=events,
        method=PERCUSSION_GENERATION_METHOD,
        confidence=0.78,
        candidate_index=1,
        llm_plan=None,
        context_events_by_slot={1: [_context_note(1, duration_beats=4)]},
        sibling_candidates=[],
    )

    assert diagnostics["range_fit_ratio"] == 1.0
    assert diagnostics["review_hint"] is None
    assert diagnostics["candidate_role"] == "다운비트 중심의 안정적인 퍼커션"
    assert variant_label.startswith("기본 박")


def test_studio_generation_skips_harmony_planner_for_percussion(monkeypatch) -> None:
    def fail_if_called(**_kwargs):
        raise AssertionError("percussion generation must not call the harmony planner")

    monkeypatch.setattr("gigastudy_api.services.studio_generation._cached_plan_harmony", fail_if_called)
    timestamp = "2026-05-07T00:00:00+00:00"
    studio = Studio(
        studio_id="percussion-studio",
        title="Percussion studio",
        bpm=120,
        tracks=[
            TrackSlot(
                slot_id=1,
                name="Soprano",
                status="registered",
                source_kind="midi",
                source_label="context.mid",
                events=[_context_note(1, duration_beats=4)],
                updated_at=timestamp,
            ),
            *[
                TrackSlot(slot_id=slot_id, name=name, status="empty", updated_at=timestamp)
                for slot_id, name in [
                    (2, "Alto"),
                    (3, "Tenor"),
                    (4, "Baritone"),
                    (5, "Bass"),
                    (6, "Percussion"),
                ]
            ],
        ],
        reports=[],
        regions=[],
        created_at=timestamp,
        updated_at=timestamp,
    )

    material = generate_track_material(
        settings=Settings(),
        studio=studio,
        target_slot_id=6,
        request=GenerateTrackRequest(context_slot_ids=[], candidate_count=3),
    )

    assert material.llm_plan is None
    assert material.method == PERCUSSION_GENERATION_METHOD
    assert len(material.candidate_events) == 3
