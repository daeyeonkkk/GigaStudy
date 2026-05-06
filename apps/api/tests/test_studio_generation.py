from gigastudy_api.services.engine.music_theory import event_from_pitch
from gigastudy_api.services.studio_generation import (
    generated_candidate_difference_score,
    generation_candidate_review_metadata,
    generation_context_diagnostics,
    generation_search_candidate_count,
    select_diverse_generated_candidates,
)


def _note(beat: float, label: str):
    return event_from_pitch(
        beat=beat,
        duration_beats=1,
        bpm=120,
        source="ai",
        extraction_method="generation_test",
        label=label,
        confidence=0.8,
    )


def _candidate(*labels: str):
    return [_note(index + 1, label) for index, label in enumerate(labels)]


def test_generation_search_overrequests_candidates_for_diversity_pool() -> None:
    assert generation_search_candidate_count(1) == 3
    assert generation_search_candidate_count(3) == 5
    assert generation_search_candidate_count(5) == 5


def test_select_diverse_generated_candidates_prefers_distinct_pitch_sequences() -> None:
    duplicate = _candidate("C4", "D4", "E4")
    candidates = [
        duplicate,
        _candidate("C4", "D4", "E4"),
        _candidate("E4", "F4", "G4"),
        _candidate("G3", "A3", "B3"),
    ]

    selected = select_diverse_generated_candidates(candidates, requested_count=3)
    selected_sequences = [tuple(event.label for event in candidate) for candidate in selected]

    assert selected_sequences == [
        ("C4", "D4", "E4"),
        ("E4", "F4", "G4"),
        ("G3", "A3", "B3"),
    ]
    assert generated_candidate_difference_score(selected[0], selected[1]) >= 0.18


def test_select_diverse_generated_candidates_omits_empty_fallback_candidates() -> None:
    selected = select_diverse_generated_candidates(
        [
            [],
            _candidate("C4", "D4", "E4"),
            [],
        ],
        requested_count=3,
    )

    assert [tuple(event.label for event in candidate) for candidate in selected] == [
        ("C4", "D4", "E4"),
    ]


def test_generation_context_diagnostics_reports_context_and_sibling_diversity() -> None:
    candidate = _candidate("C4", "D4", "E4")
    diagnostics = generation_context_diagnostics(
        events=candidate,
        context_events_by_slot={1: _candidate("C5", "D5"), 3: _candidate("G3")},
        sibling_candidates=[_candidate("E4", "F4", "G4")],
    )

    assert diagnostics["generation_context_slot_ids"] == [1, 3]
    assert diagnostics["generation_context_track_count"] == 2
    assert diagnostics["generation_context_event_count"] == 3
    assert diagnostics["candidate_diversity_score"] is not None
    assert diagnostics["candidate_diversity_label"] == "distinct"


def test_generation_candidate_metadata_includes_acappella_quality_report() -> None:
    candidate = _candidate("E3", "F3", "E3")
    context = {3: _candidate("C4", "C4", "C4")}

    diagnostics, _label = generation_candidate_review_metadata(
        slot_id=5,
        events=candidate,
        method="rule_based_voice_leading_candidates_v1",
        confidence=0.8,
        candidate_index=1,
        llm_plan=None,
        context_events_by_slot=context,
        sibling_candidates=[],
    )

    assert diagnostics["acappella_engine_version"] == "acappella_track_generation_v3"
    assert diagnostics["arrangement_role"] == "원본 리듬 기반 후보"
    assert diagnostics["acappella_quality_label"] in {"추천 가능", "확인 필요", "재생성 권장"}
    assert diagnostics["context_onset_coverage_ratio"] is not None
    assert isinstance(diagnostics["generation_quality_warnings"], list)
