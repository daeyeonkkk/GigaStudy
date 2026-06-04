import json

from gigastudy_api.config import Settings
from gigastudy_api.services.engine.extraction_plan import default_voice_extraction_plan
from gigastudy_api.services.engine.music_theory import event_from_pitch
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile, ParsedTrack, map_tracks_to_slots
from gigastudy_api.services.llm.deepseek import (
    _build_chat_completion_payload,
    _build_plan_revision_payload,
    _chat_completion_headers,
    _parse_deepseek_response,
    plan_harmony_with_deepseek,
)
from gigastudy_api.services.llm.extraction_plan import (
    _parse_deepseek_extraction_response,
    plan_voice_extraction_with_deepseek,
)
from gigastudy_api.services.llm.midi_role_review import (
    apply_midi_role_review_instruction,
    review_midi_roles_with_deepseek,
)
from gigastudy_api.services.studio_generation import (
    DEEPSEEK_GENERATION_CONTEXT_EVENT_LIMIT,
    _generation_planning_settings,
)


def _note(beat: float = 1, label: str = "C5"):
    return event_from_pitch(
        beat=beat,
        duration_beats=1,
        bpm=120,
        source="musicxml",
        extraction_method="test_context",
        label=label,
        confidence=1,
    )


def _generic_midi_role_fixture() -> ParsedSymbolicFile:
    tracks = [
        ParsedTrack(
            name=f"Staff {index}",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=pitch,
                )
            ],
            diagnostics={
                "midi_source_track_index": index,
                "midi_channels": [index],
                "midi_generic_track_name": True,
                "midi_vocal_program_hint": False,
            },
        )
        for index, pitch in [(1, 72), (2, 48)]
    ]
    mapped_events = map_tracks_to_slots(tracks, bpm=113)
    return ParsedSymbolicFile(tracks=tracks, mapped_events=mapped_events)


def test_deepseek_planner_is_disabled_until_explicitly_enabled() -> None:
    settings = Settings(deepseek_harmony_enabled=False, deepseek_api_key="secret")

    plan = plan_harmony_with_deepseek(
        settings=settings,
        title="Disabled",
        bpm=120,
        time_signature_numerator=4,
        time_signature_denominator=4,
        target_slot_id=2,
        context_events_by_slot={1: [_note()]},
        candidate_count=3,
    )

    assert plan is None


def test_generation_planning_skips_llm_for_large_context() -> None:
    settings = Settings(
        deepseek_harmony_enabled=True,
        deepseek_api_key="secret",
        deepseek_timeout_seconds=8,
        deepseek_max_retries=1,
        deepseek_revision_cycles=1,
    )

    planning_settings = _generation_planning_settings(
        settings,
        context_event_count=DEEPSEEK_GENERATION_CONTEXT_EVENT_LIMIT + 1,
    )

    assert planning_settings.deepseek_harmony_enabled is False


def test_generation_planning_uses_llm_for_typical_multitrack_context() -> None:
    settings = Settings(
        deepseek_harmony_enabled=True,
        deepseek_api_key="secret",
        deepseek_timeout_seconds=8,
    )

    planning_settings = _generation_planning_settings(settings, context_event_count=54)

    assert planning_settings.deepseek_harmony_enabled is True


def test_generation_planning_caps_llm_latency_for_small_context() -> None:
    settings = Settings(
        deepseek_harmony_enabled=True,
        deepseek_api_key="secret",
        deepseek_timeout_seconds=8,
        deepseek_max_retries=2,
        deepseek_revision_cycles=2,
    )

    planning_settings = _generation_planning_settings(settings, context_event_count=4)

    assert planning_settings.deepseek_harmony_enabled is True
    assert planning_settings.deepseek_timeout_seconds == 6.0
    assert planning_settings.deepseek_max_retries == 0
    assert planning_settings.deepseek_revision_cycles == 0


def test_deepseek_extraction_plan_is_disabled_until_explicitly_enabled() -> None:
    settings = Settings(deepseek_extraction_plan_enabled=False, deepseek_api_key="secret")
    base_plan = default_voice_extraction_plan(slot_id=3, bpm=92)

    plan = plan_voice_extraction_with_deepseek(
        settings=settings,
        base_plan=base_plan,
        title="Disabled",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        source_kind="recording",
        source_label="tenor.wav",
        context_tracks_by_slot={1: [_note(label="C5")]},
    )

    assert plan is None


def test_deepseek_midi_role_review_is_disabled_until_explicitly_enabled() -> None:
    settings = Settings(deepseek_midi_role_review_enabled=False, deepseek_api_key="secret")
    parsed = _generic_midi_role_fixture()

    instruction = review_midi_roles_with_deepseek(
        settings=settings,
        title="Disabled",
        source_label="generic.mid",
        parsed_symbolic=parsed,
    )

    assert instruction is None


def test_deepseek_midi_role_review_applies_bounded_slot_assignment(monkeypatch) -> None:
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
                    "assignments": [
                        {
                            "source_track_index": 1,
                            "midi_channels": [1],
                            "assigned_slot_id": 2,
                            "review_required": False,
                            "reason": "Upper line is closer to alto register than soprano.",
                        },
                        {
                            "source_track_index": 2,
                            "midi_channels": [2],
                            "assigned_slot_id": 5,
                            "review_required": True,
                            "reason": "Low part is useful but should stay reviewable.",
                        },
                    ],
                    "reasons": ["Generic staff names need musical role review."],
                    "warnings": ["Keep original MIDI events unchanged."],
                }
            )
            return json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")

    def fake_urlopen(request, timeout):  # noqa: ANN001
        captured_payload["timeout"] = timeout
        captured_payload["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr("gigastudy_api.services.llm.midi_role_review.urlopen", fake_urlopen)
    settings = Settings(
        deepseek_midi_role_review_enabled=True,
        deepseek_api_key="test-key",
        deepseek_base_url="https://openrouter.ai/api/v1",
        deepseek_model="deepseek/deepseek-v4-flash:free",
    )
    parsed = _generic_midi_role_fixture()

    instruction = review_midi_roles_with_deepseek(
        settings=settings,
        title="Generic MIDI",
        source_label="generic.mid",
        parsed_symbolic=parsed,
    )
    applied = apply_midi_role_review_instruction(
        parsed_symbolic=parsed,
        instruction=instruction,
        bpm=113,
    )

    assert applied is True
    assert instruction is not None
    assert instruction.used is True
    assert instruction.provider == "openrouter"
    assert set(parsed.mapped_events) == {2, 5}
    assert parsed.tracks[0].slot_id == 2
    assert parsed.tracks[1].slot_id == 5
    assert parsed.tracks[1].diagnostics["midi_seed_review_required"] is True
    assert parsed.tracks[0].diagnostics["llm_midi_role_review"]["applied"] is True
    assert captured_payload["body"]["response_format"] == {"type": "json_object"}
    user_context = json.loads(captured_payload["body"]["messages"][1]["content"])
    assert user_context["review_scope"] == "midi_singer_role_assignment"
    assert user_context["tracks"][0]["source_track_index"] == 1
    assert any("Do not create" in rule for rule in user_context["rules"])


def test_deepseek_extraction_response_applies_bounded_plan() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "confidence": 0.82,
                            "quantization_grid": 0.5,
                            "min_segment_policy": "strict",
                            "confidence_policy": "loose",
                            "widen_range_semitones": 2,
                            "merge_adjacent_same_pitch": True,
                            "suppress_unstable_events": True,
                            "reasons": ["Dense tenor input should be simplified before extraction."],
                            "warnings": ["Do not alter the studio BPM."],
                        }
                    )
                }
            }
        ]
    }

    instruction = _parse_deepseek_extraction_response(
        payload,
        model="deepseek/deepseek-v4-flash:free",
        provider="openrouter",
    )
    plan = instruction.apply_to(default_voice_extraction_plan(slot_id=3, bpm=92))

    assert plan.provider == "openrouter"
    assert plan.model == "deepseek/deepseek-v4-flash:free"
    assert plan.used_llm is True
    assert plan.quantization_grid == 0.5
    assert plan.low_midi == 46
    assert plan.high_midi == 69
    assert "Do not alter the studio BPM." in plan.warnings


def test_deepseek_payload_uses_json_mode_and_non_thinking_by_default() -> None:
    settings = Settings(
        deepseek_harmony_enabled=True,
        deepseek_api_key="secret",
        deepseek_base_url="https://api.deepseek.com",
        deepseek_model="deepseek-v4-flash",
        deepseek_thinking_enabled=False,
    )

    payload = _build_chat_completion_payload(
        settings=settings,
        title="Payload",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        target_slot_id=3,
        context_events_by_slot={1: [_note(1, "C5"), _note(2, "G5")]},
        candidate_count=3,
    )

    assert payload["model"] == "deepseek-v4-flash"
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["thinking"] == {"type": "disabled"}
    assert payload["temperature"] == settings.deepseek_temperature
    assert "JSON only" in payload["messages"][0]["content"]
    assert "measure_summaries" in payload["messages"][1]["content"]
    user_context = json.loads(payload["messages"][1]["content"])
    assert "a_cappella_arrangement_rules" in user_context
    assert any("six-track a cappella region arrangement" in rule for rule in user_context["a_cappella_arrangement_rules"])
    assert any("meaningfully different" in rule for rule in user_context["a_cappella_arrangement_rules"])
    candidate_shape = user_context["required_json_shape"]["candidate_directions"][0]
    assert "texture" in candidate_shape
    assert "rhythm_role" in candidate_shape


def test_openrouter_payload_omits_native_deepseek_thinking_field() -> None:
    settings = Settings(
        deepseek_harmony_enabled=True,
        deepseek_api_key="secret",
        deepseek_base_url="https://openrouter.ai/api/v1",
        deepseek_model="deepseek/deepseek-v4-flash:free",
        deepseek_site_url="https://gigastudy-alpha.pages.dev",
        deepseek_app_title="GigaStudy Alpha",
    )

    payload = _build_chat_completion_payload(
        settings=settings,
        title="Payload",
        bpm=92,
        time_signature_numerator=4,
        time_signature_denominator=4,
        target_slot_id=3,
        context_events_by_slot={1: [_note(1, "C5"), _note(2, "G5")]},
        candidate_count=3,
    )
    headers = _chat_completion_headers(settings)

    assert payload["model"] == "deepseek/deepseek-v4-flash:free"
    assert "thinking" not in payload
    assert "reasoning" not in payload
    assert payload["temperature"] == settings.deepseek_temperature
    assert headers["Authorization"] == "Bearer secret"
    assert headers["HTTP-Referer"] == "https://gigastudy-alpha.pages.dev"
    assert headers["X-Title"] == "GigaStudy Alpha"


def test_deepseek_response_parser_returns_bounded_candidate_plan() -> None:
    content = {
        "key": "C",
        "mode": "major",
        "confidence": 0.82,
        "phrase_summary": "Four-bar tonic to dominant shape.",
        "measures": [
            {
                "measure_index": 1,
                "function": "tonic",
                "preferred_degrees": [1, 6],
                "cadence_role": "opening",
                "target_motion": "stable",
                "allowed_tensions": [],
                "avoid": ["voice_crossing"],
            }
        ],
        "candidate_directions": [
            {
                "candidate_index": 1,
                "profile_name": "lower_support",
                "title": "Grounded support",
                "goal": "open_support",
                "register_bias": "low",
                "motion_bias": "stable",
                "rhythm_policy": "sustain_support",
                "texture": "pad_sustain",
                "rhythm_role": "sustain_with_attacks",
                "chord_tone_priority": ["root", "fifth", "third"],
                "role": "Keeps the target below soprano with stable chord tones.",
                "selection_hint": "Choose for a plain rehearsal-safe line.",
                "risk_tags": ["low_motion"],
            },
            {
                "candidate_index": 2,
                "profile_name": "moving_counterline",
                "title": "Counterline",
                "goal": "counterline",
                "register_bias": "middle",
                "motion_bias": "contrary",
                "rhythm_policy": "follow_context",
                "texture": "counterline",
                "rhythm_role": "independent_motion",
                "chord_tone_priority": ["third", "fifth", "root"],
                "role": "Adds contrary motion against the context melody.",
                "selection_hint": "Choose when the first option feels too static.",
                "risk_tags": ["more_motion"],
            },
        ],
        "warnings": [],
    }
    payload = {"choices": [{"message": {"content": json.dumps(content)}}]}

    plan = _parse_deepseek_response(payload, model="deepseek-v4-flash")

    assert plan.provider == "deepseek"
    assert plan.model == "deepseek-v4-flash"
    assert plan.profile_names() == ["lower_support", "moving_counterline"]
    assert plan.direction_for_index(2).title == "Counterline"
    assert plan.direction_for_index(1).rhythm_policy == "sustain_support"
    assert plan.direction_for_index(1).texture == "pad_sustain"
    assert plan.direction_for_index(2).rhythm_role == "independent_motion"
    assert plan.measure_intent_for_index(1).function == "tonic"


def test_deepseek_revision_payload_keeps_draft_as_json_only_plan() -> None:
    settings = Settings(
        deepseek_harmony_enabled=True,
        deepseek_api_key="secret",
        deepseek_base_url="https://api.deepseek.com",
        deepseek_model="deepseek-v4-flash",
    )
    draft_payload = {"choices": [{"message": {"content": json.dumps({"candidate_directions": []})}}]}
    draft_plan = _parse_deepseek_response(draft_payload, model="deepseek-v4-flash")

    payload = _build_plan_revision_payload(
        settings=settings,
        title="Revise",
        bpm=120,
        time_signature_numerator=4,
        time_signature_denominator=4,
        target_slot_id=2,
        context_events_by_slot={1: [_note()]},
        candidate_count=3,
        draft_plan=draft_plan,
        cycle_index=1,
    )

    assert payload["response_format"] == {"type": "json_object"}
    assert payload["thinking"] == {"type": "disabled"}
    assert "draft_plan" in payload["messages"][1]["content"]
    user_context = json.loads(payload["messages"][1]["content"])
    assert "a_cappella_arrangement_rules" in user_context
    assert "Return JSON only" in payload["messages"][0]["content"]
