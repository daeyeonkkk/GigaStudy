import json

from gigastudy_api.config import Settings
from gigastudy_api.services.engine.music_theory import note_from_pitch
from gigastudy_api.services.llm.deepseek import (
    _build_chat_completion_payload,
    _build_plan_revision_payload,
    _chat_completion_headers,
    _parse_deepseek_response,
    plan_harmony_with_deepseek,
)


def _note(beat: float = 1, label: str = "C5"):
    return note_from_pitch(
        beat=beat,
        duration_beats=1,
        bpm=120,
        source="musicxml",
        extraction_method="test_context",
        label=label,
        confidence=1,
    )


def test_deepseek_planner_is_disabled_until_explicitly_enabled() -> None:
    settings = Settings(deepseek_harmony_enabled=False, deepseek_api_key="secret")

    plan = plan_harmony_with_deepseek(
        settings=settings,
        title="Disabled",
        bpm=120,
        time_signature_numerator=4,
        time_signature_denominator=4,
        target_slot_id=2,
        context_notes_by_slot={1: [_note()]},
        candidate_count=3,
    )

    assert plan is None


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
        context_notes_by_slot={1: [_note(1, "C5"), _note(2, "G5")]},
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
    assert any("six-track a cappella score" in rule for rule in user_context["a_cappella_arrangement_rules"])
    assert any("meaningfully different" in rule for rule in user_context["a_cappella_arrangement_rules"])


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
        context_notes_by_slot={1: [_note(1, "C5"), _note(2, "G5")]},
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
        context_notes_by_slot={1: [_note()]},
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
