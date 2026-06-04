import json

from gigastudy_api.config import Settings
from gigastudy_api.services.engine.music_theory import event_from_pitch
from gigastudy_api.services.engine.event_quality import (
    apply_registration_review_instruction,
    prepare_events_for_track_registration,
)
from gigastudy_api.services.llm.registration_review import (
    review_ensemble_registration_with_deepseek,
    review_track_registration_with_deepseek,
)


def test_registration_review_instruction_applies_coarser_voice_grid_and_noise_filter() -> None:
    noisy_notes = [
        event_from_pitch(
            beat=1 + index * 0.13,
            duration_beats=0.1,
            bpm=92,
            source="voice",
            extraction_method="test_noise",
            pitch_midi=64 + (index % 5),
            confidence=0.8 if index % 4 else 0.22,
        )
        for index in range(24)
    ]
    baseline = prepare_events_for_track_registration(
        noisy_notes,
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    result = apply_registration_review_instruction(
        noisy_notes,
        instruction={
            "confidence": 0.86,
            "quantization_grid": 0.5,
            "merge_adjacent_same_pitch": True,
            "simplify_dense_measures": True,
            "suppress_unstable_events": True,
            "reasons": ["Dense voice input should use a coarser 0.5 beat grid."],
        },
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
        baseline_result=baseline,
    )

    assert result.events
    assert result.diagnostics["llm_registration_review"]["applied"] is True
    assert result.diagnostics["pre_llm_registration_quality"]["registered_event_count"] == len(baseline.events)
    assert result.diagnostics["registered_event_count"] <= 8
    assert result.diagnostics["max_events_per_measure"] <= 8
    assert "llm_dense_voice_measure_simplification" in result.diagnostics["actions"]
    assert all(note.quantization_grid == 0.5 for note in result.events)
    assert all(note.beat * 2 == int(note.beat * 2) for note in result.events)


def test_registration_quality_collapses_short_neighbor_pitch_blip() -> None:
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=0.5,
            bpm=92,
            source="voice",
            extraction_method="test_blip",
            pitch_midi=72,
            confidence=0.86,
        ),
        event_from_pitch(
            beat=1.5,
            duration_beats=0.25,
            bpm=92,
            source="voice",
            extraction_method="test_blip",
            pitch_midi=73,
            confidence=0.62,
        ),
        event_from_pitch(
            beat=1.75,
            duration_beats=0.75,
            bpm=92,
            source="voice",
            extraction_method="test_blip",
            pitch_midi=72,
            confidence=0.84,
        ),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(note.label, note.beat, note.duration_beats) for note in result.events] == [("C5", 1.0, 1.5)]
    assert "voice_pitch_blip_collapse_1" in result.diagnostics["actions"]


def test_registration_quality_prefers_readable_grid_for_moderate_micro_notes() -> None:
    notes = [
        event_from_pitch(
            beat=1 + index * 0.25,
            duration_beats=0.25,
            bpm=92,
            source="voice",
            extraction_method="test_micro_notes",
            pitch_midi=67 + (index % 3),
            confidence=0.68,
        )
        for index in range(7)
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=92,
        slot_id=2,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert "readability_grid_0.5" in result.diagnostics["actions"]
    assert result.diagnostics["max_events_per_measure"] <= 4
    assert all(note.quantization_grid == 0.5 for note in result.events)


def test_registration_quality_removes_isolated_short_artifact() -> None:
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=92,
            source="voice",
            extraction_method="test_isolated_noise",
            pitch_midi=72,
            confidence=0.86,
        ),
        event_from_pitch(
            beat=4,
            duration_beats=0.25,
            bpm=92,
            source="voice",
            extraction_method="test_isolated_noise",
            pitch_midi=78,
            confidence=0.42,
        ),
        event_from_pitch(
            beat=6,
            duration_beats=1,
            bpm=92,
            source="voice",
            extraction_method="test_isolated_noise",
            pitch_midi=74,
            confidence=0.84,
        ),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [note.label for note in result.events] == ["C5", "D5"]
    assert "F#5" not in [note.label for note in result.events]
    assert "voice_isolated_artifact_removed_1" in result.diagnostics["actions"]
    assert result.diagnostics["isolated_short_event_count"] == 0


def test_registration_quality_bridges_short_detector_gap_inside_phrase() -> None:
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=0.75,
            bpm=92,
            source="voice",
            extraction_method="test_phrase_gap",
            pitch_midi=72,
            confidence=0.84,
        ),
        event_from_pitch(
            beat=2,
            duration_beats=1,
            bpm=92,
            source="voice",
            extraction_method="test_phrase_gap",
            pitch_midi=74,
            confidence=0.82,
        ),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(note.label, note.beat, note.duration_beats) for note in result.events] == [
        ("C5", 1.0, 1.0),
        ("D5", 2.0, 1.0),
    ]
    assert "voice_phrase_gap_bridge_1" in result.diagnostics["actions"]
    assert result.diagnostics["short_phrase_gap_count"] == 0


def test_registration_quality_bridges_short_measure_tail_before_barline() -> None:
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=3.75,
            bpm=92,
            source="voice",
            extraction_method="test_measure_tail",
            pitch_midi=72,
            confidence=0.86,
        ),
        event_from_pitch(
            beat=5,
            duration_beats=1,
            bpm=92,
            source="voice",
            extraction_method="test_measure_tail",
            pitch_midi=74,
            confidence=0.83,
        ),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(note.label, note.beat, note.duration_beats, note.measure_index) for note in result.events] == [
        ("C5", 1.0, 4.0, 1),
        ("D5", 5.0, 1.0, 2),
    ]
    assert "voice_measure_tail_bridge_1" in result.diagnostics["actions"]
    assert result.diagnostics["measure_tail_gap_count"] == 0


def test_registration_quality_collapses_low_confidence_short_event_cluster() -> None:
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=0.25,
            bpm=92,
            source="voice",
            extraction_method="test_short_cluster",
            pitch_midi=72,
            confidence=0.62,
        ),
        event_from_pitch(
            beat=1.25,
            duration_beats=0.25,
            bpm=92,
            source="voice",
            extraction_method="test_short_cluster",
            pitch_midi=73,
            confidence=0.58,
        ),
        event_from_pitch(
            beat=1.5,
            duration_beats=0.25,
            bpm=92,
            source="voice",
            extraction_method="test_short_cluster",
            pitch_midi=74,
            confidence=0.6,
        ),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(note.label, note.beat, note.duration_beats) for note in result.events] == [("C5", 1.0, 0.75)]
    assert "voice_short_cluster_collapse_1" in result.diagnostics["actions"]
    assert result.diagnostics["short_event_cluster_count"] == 0


def test_registration_review_instruction_can_force_key_spelling_without_llm_writing_notes() -> None:
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test_document",
            pitch_midi=70,
        )
    ]
    baseline = prepare_events_for_track_registration(
        notes,
        bpm=120,
        slot_id=2,
        source_kind="document",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    result = apply_registration_review_instruction(
        notes,
        instruction={
            "confidence": 0.91,
            "prefer_key_signature": "F",
            "reasons": ["Bb reads more naturally as the key signature than as repeated accidentals."],
        },
        bpm=120,
        slot_id=2,
        source_kind="document",
        time_signature_numerator=4,
        time_signature_denominator=4,
        baseline_result=baseline,
    )

    assert result.events[0].pitch_midi == 70
    assert result.events[0].key_signature == "F"
    assert result.events[0].spelled_label == "Bb4"
    assert result.events[0].accidental is None
    assert "llm_prefer_key_F" in result.diagnostics["actions"]


def test_deepseek_registration_review_is_disabled_without_feature_flag() -> None:
    settings = Settings(
        deepseek_registration_review_enabled=False,
        deepseek_api_key="test-key",
    )
    note = event_from_pitch(
        beat=1,
        duration_beats=1,
        bpm=92,
        source="voice",
        extraction_method="test",
        pitch_midi=60,
    )

    instruction = review_track_registration_with_deepseek(
        settings=settings,
        title="test",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        slot_id=1,
        source_kind="recording",
        original_events=[note],
        prepared_events=[note],
        diagnostics={},
    )

    assert instruction is None


def test_deepseek_ensemble_registration_review_is_disabled_without_feature_flag() -> None:
    settings = Settings(
        deepseek_ensemble_review_enabled=False,
        deepseek_api_key="test-key",
    )
    note = event_from_pitch(
        beat=1,
        duration_beats=1,
        bpm=92,
        source="voice",
        extraction_method="test",
        pitch_midi=60,
    )

    instruction = review_ensemble_registration_with_deepseek(
        settings=settings,
        title="test",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        slot_id=2,
        source_kind="recording",
        original_events=[note],
        prepared_events=[note],
        diagnostics={},
        context_tracks_by_slot={1: [note]},
    )

    assert instruction is None


def test_deepseek_registration_review_parses_bounded_json_instruction(monkeypatch) -> None:
    captured_payload: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            content = json.dumps(
                {
                    "confidence": 0.84,
                    "quantization_grid": 0.5,
                    "merge_adjacent_same_pitch": True,
                    "simplify_dense_measures": True,
                    "collapse_pitch_blips": True,
                    "remove_isolated_artifacts": True,
                    "bridge_short_phrase_gaps": True,
                    "bridge_measure_tail_gaps": True,
                    "collapse_short_event_clusters": True,
                    "prefer_key_signature": "F",
                    "reasons": ["Coarser grid improves readability."],
                }
            )
            return json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")

    def fake_urlopen(request, timeout):  # noqa: ANN001
        captured_payload["timeout"] = timeout
        captured_payload["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr("gigastudy_api.services.llm.registration_review.urlopen", fake_urlopen)
    settings = Settings(
        deepseek_registration_review_enabled=True,
        deepseek_api_key="test-key",
        deepseek_base_url="https://openrouter.ai/api/v1",
        deepseek_model="deepseek/deepseek-v4-flash:free",
        deepseek_thinking_enabled=True,
    )
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=92,
            source="voice",
            extraction_method="test",
            pitch_midi=60,
            confidence=0.8,
        ),
        event_from_pitch(
            beat=4,
            duration_beats=0.16,
            bpm=92,
            source="voice",
            extraction_method="test",
            pitch_midi=61,
            confidence=0.4,
        ),
        event_from_pitch(
            beat=6,
            duration_beats=1,
            bpm=92,
            source="voice",
            extraction_method="test",
            pitch_midi=62,
            confidence=0.8,
        ),
    ]

    instruction = review_track_registration_with_deepseek(
        settings=settings,
        title="test",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        slot_id=1,
        source_kind="recording",
        original_events=notes,
        prepared_events=notes,
        diagnostics={"max_events_per_measure": 12},
    )

    assert instruction is not None
    assert instruction.used is True
    assert instruction.provider == "openrouter"
    assert instruction.quantization_grid == 0.5
    assert instruction.collapse_pitch_blips is True
    assert instruction.remove_isolated_artifacts is True
    assert instruction.bridge_short_phrase_gaps is True
    assert instruction.bridge_measure_tail_gaps is True
    assert instruction.collapse_short_event_clusters is True
    assert instruction.prefer_key_signature == "F"
    assert captured_payload["body"]["response_format"] == {"type": "json_object"}
    assert captured_payload["body"]["reasoning"] == {"enabled": True}
    assert "thinking" not in captured_payload["body"]
    user_context = json.loads(captured_payload["body"]["messages"][1]["content"])
    options = user_context["deterministic_quality_options"]
    assert options[0]["isolated_short_event_count"] == 1
    assert "short_phrase_gap_count" in options[0]
    assert "measure_tail_gap_count" in options[0]
    assert "short_event_cluster_count" in options[0]
    assert [option["option"] for option in options] == [
        "current_prepared_result",
        "coarse_0_5_beat_grid_candidate",
    ]


def test_deepseek_registration_plan_sends_sibling_context(monkeypatch) -> None:
    captured_payload: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            content = json.dumps(
                {
                    "confidence": 0.8,
                    "quantization_grid": "0.5",
                    "merge_adjacent_same_pitch": True,
                    "reasons": ["湲곗〈 ?몃옓 留λ씫?????쎄린 ?ъ슫 ?깅줉 怨꾪쉷?낅땲??"],
                }
            )
            return json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")

    def fake_urlopen(request, timeout):  # noqa: ANN001
        captured_payload["timeout"] = timeout
        captured_payload["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr("gigastudy_api.services.llm.registration_review.urlopen", fake_urlopen)
    settings = Settings(
        deepseek_registration_review_enabled=True,
        deepseek_api_key="test-key",
        deepseek_base_url="https://openrouter.ai/api/v1",
        deepseek_model="deepseek/deepseek-v4-flash",
    )
    soprano = event_from_pitch(
        beat=1,
        duration_beats=2,
        bpm=92,
        source="musicxml",
        extraction_method="test_context",
        pitch_midi=72,
        confidence=0.95,
    )
    tenor_take = event_from_pitch(
        beat=1,
        duration_beats=0.5,
        bpm=92,
        source="voice",
        extraction_method="test_target",
        pitch_midi=55,
        confidence=0.78,
    )

    instruction = review_track_registration_with_deepseek(
        settings=settings,
        title="test",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        slot_id=3,
        source_kind="recording",
        original_events=[tenor_take],
        prepared_events=[tenor_take],
        diagnostics={"max_events_per_measure": 8},
        context_tracks_by_slot={1: [soprano]},
    )

    assert instruction is not None
    assert instruction.quantization_grid == 0.5
    user_context = json.loads(captured_payload["body"]["messages"][1]["content"])
    assert user_context["review_scope"] == "single_track_registration_plan"
    assert user_context["ensemble_context"]["available"] is True
    assert user_context["ensemble_context"]["registered_or_reference_tracks"][0]["slot_id"] == 1
    assert user_context["ensemble_context"]["target_slot_id"] == 3
    assert any("sibling-track context" in item for item in user_context["review_checklist"])


def test_deepseek_ensemble_registration_review_sends_sibling_track_context(monkeypatch) -> None:
    captured_payload: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            content = json.dumps(
                {
                    "confidence": 0.82,
                    "quantization_grid": 0.5,
                    "merge_adjacent_same_pitch": True,
                    "reasons": ["?숈긽釉??덉뿉???쎄린 ?쎄쾶 0.5 beat grid媛 ?レ뒿?덈떎."],
                }
            )
            return json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")

    def fake_urlopen(request, timeout):  # noqa: ANN001
        captured_payload["timeout"] = timeout
        captured_payload["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr("gigastudy_api.services.llm.registration_review.urlopen", fake_urlopen)
    settings = Settings(
        deepseek_ensemble_review_enabled=True,
        deepseek_api_key="test-key",
        deepseek_base_url="https://openrouter.ai/api/v1",
        deepseek_model="deepseek/deepseek-v4-flash:free",
    )
    soprano = event_from_pitch(
        beat=1,
        duration_beats=2,
        bpm=92,
        source="musicxml",
        extraction_method="test_context",
        pitch_midi=72,
        confidence=0.95,
    )
    alto = event_from_pitch(
        beat=1,
        duration_beats=0.5,
        bpm=92,
        source="voice",
        extraction_method="test_target",
        pitch_midi=67,
        confidence=0.78,
    )

    instruction = review_ensemble_registration_with_deepseek(
        settings=settings,
        title="test",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        slot_id=2,
        source_kind="recording",
        original_events=[alto],
        prepared_events=[alto],
        diagnostics={"ensemble_arrangement": {"warnings": ["spacing"]}},
        context_tracks_by_slot={1: [soprano]},
        proposed_tracks_by_slot={2: [alto]},
    )

    assert instruction is not None
    assert instruction.used is True
    assert instruction.provider == "openrouter"
    assert instruction.quantization_grid == 0.5
    user_context = json.loads(captured_payload["body"]["messages"][1]["content"])
    assert user_context["review_scope"] == "a_cappella_ensemble_registration"
    assert user_context["ensemble_context"]["available"] is True
    assert user_context["ensemble_context"]["registered_or_reference_tracks"][0]["slot_id"] == 1
    assert user_context["ensemble_context"]["proposed_batch_tracks"][0]["slot_id"] == 2
    assert user_context["ensemble_context"]["vertical_snapshots"][0]["active"]
    assert any("six-track a cappella region arrangement" in item for item in user_context["review_checklist"])
