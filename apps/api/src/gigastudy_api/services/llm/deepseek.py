from __future__ import annotations

import json
import logging
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import ValidationError

from gigastudy_api.api.schemas.studios import TrackNote
from gigastudy_api.config import Settings
from gigastudy_api.services.engine.harmony_plan import (
    ALLOWED_PROFILE_NAMES,
    DeepSeekHarmonyPlan,
    complete_harmony_plan,
)
from gigastudy_api.services.engine.music_theory import track_name

LOGGER = logging.getLogger(__name__)


def plan_harmony_with_deepseek(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    target_slot_id: int,
    context_notes_by_slot: dict[int, list[TrackNote]],
    candidate_count: int,
) -> DeepSeekHarmonyPlan | None:
    if not settings.deepseek_harmony_enabled or not settings.deepseek_api_key:
        return None
    if target_slot_id == 6:
        return None
    if not context_notes_by_slot:
        return None

    endpoint = settings.deepseek_base_url.rstrip("/") + "/chat/completions"
    request_body = _build_chat_completion_payload(
        settings=settings,
        title=title,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        target_slot_id=target_slot_id,
        context_notes_by_slot=context_notes_by_slot,
        candidate_count=candidate_count,
    )

    last_error: Exception | None = None
    for attempt_index in range(max(1, settings.deepseek_max_retries + 1)):
        try:
            plan = _request_harmony_plan(
                endpoint=endpoint,
                settings=settings,
                request_body=request_body,
            )
            plan = _revise_plan_with_deepseek(
                endpoint=endpoint,
                settings=settings,
                draft_plan=plan,
                title=title,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                target_slot_id=target_slot_id,
                context_notes_by_slot=context_notes_by_slot,
                candidate_count=candidate_count,
            )
            return complete_harmony_plan(
                plan,
                candidate_count=candidate_count,
                model=settings.deepseek_model,
                target_slot_id=target_slot_id,
            )
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValidationError, ValueError) as error:
            last_error = error
            if attempt_index >= settings.deepseek_max_retries:
                break

    LOGGER.warning("DeepSeek harmony planning failed; using deterministic harmony only: %s", last_error)
    return None


def _request_harmony_plan(
    *,
    endpoint: str,
    settings: Settings,
    request_body: dict[str, Any],
) -> DeepSeekHarmonyPlan:
    payload = json.dumps(request_body).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        method="POST",
        headers=_chat_completion_headers(settings),
    )
    with urlopen(request, timeout=settings.deepseek_timeout_seconds) as response:
        response_payload = json.loads(response.read().decode("utf-8"))
    return _parse_deepseek_response(
        response_payload,
        model=settings.deepseek_model,
        provider=_chat_completion_provider(settings),
    )


def _revise_plan_with_deepseek(
    *,
    endpoint: str,
    settings: Settings,
    draft_plan: DeepSeekHarmonyPlan,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    target_slot_id: int,
    context_notes_by_slot: dict[int, list[TrackNote]],
    candidate_count: int,
) -> DeepSeekHarmonyPlan:
    plan = draft_plan
    revision_cycles = max(0, min(settings.deepseek_revision_cycles, 2))
    for cycle_index in range(revision_cycles):
        try:
            request_body = _build_plan_revision_payload(
                settings=settings,
                title=title,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                target_slot_id=target_slot_id,
                context_notes_by_slot=context_notes_by_slot,
                candidate_count=candidate_count,
                draft_plan=plan,
                cycle_index=cycle_index + 1,
            )
            revised_plan = _request_harmony_plan(
                endpoint=endpoint,
                settings=settings,
                request_body=request_body,
            )
            revised_plan.revision_cycles = cycle_index + 1
            plan = revised_plan
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValidationError, ValueError) as error:
            LOGGER.warning("DeepSeek harmony revision failed; using previous plan: %s", error)
            break
    return plan


def _build_chat_completion_payload(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    target_slot_id: int,
    context_notes_by_slot: dict[int, list[TrackNote]],
    candidate_count: int,
) -> dict[str, Any]:
    context = {
        "product_rule": (
            "The model plans harmony only. It must not output TrackNote arrays, MIDI pitch sequences, "
            "exact beats, or final pitch-event lists."
        ),
        "studio": {
            "title": title,
            "bpm_is_absolute": True,
            "bpm": bpm,
            "time_signature": f"{time_signature_numerator}/{time_signature_denominator}",
        },
        "target_track": {
            "slot_id": target_slot_id,
            "name": track_name(target_slot_id),
        },
        "allowed_profile_names": sorted(ALLOWED_PROFILE_NAMES),
        "candidate_count": candidate_count,
        "a_cappella_arrangement_rules": [
            "Treat the output as one part inside one six-track a cappella region arrangement.",
            "Keep the target singable for its assigned voice and avoid exposed large leaps unless the role is explicitly active_motion.",
            "Prefer contrary or oblique motion against the most active context voice when it improves independence.",
            "Avoid voice crossing, cramped adjacent spacing, repeated parallel perfect fifths/octaves, and bass lines that lose foundation on structural downbeats.",
            "Candidates must be meaningfully different by role: safe blend, counterline, lower/open support, upper blend, or active motion.",
            "Do not ask for human voice audio generation; all output will become pitch-event regions.",
        ],
        "context_tracks": [
            _summarize_track(slot_id, notes)
            for slot_id, notes in sorted(context_notes_by_slot.items())
            if notes
        ],
        "measure_summaries": _summarize_measures(
            context_notes_by_slot,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "required_json_shape": {
            "key": "C|G|D|A|E|F|Bb|Eb|Ab|unknown",
            "mode": "major|minor|modal|unknown",
            "confidence": 0.0,
            "phrase_summary": "short musical structure summary",
            "measures": [
                {
                    "measure_index": 1,
                    "function": "tonic|predominant|dominant|transition|unknown",
                    "preferred_degrees": [1, 6],
                    "cadence_role": "opening|build|cadence|final|none",
                    "target_motion": "stable|stepwise|contrary|active|unknown",
                    "allowed_tensions": ["passing"],
                    "avoid": ["parallel_octave", "voice_crossing"],
                }
            ],
            "candidate_directions": [
                {
                    "candidate_index": 1,
                    "profile_name": "balanced",
                    "title": "Korean candidate title",
                    "goal": "rehearsal_safe|counterline|open_support|upper_blend|active_motion",
                    "register_bias": "low|middle|high|open|auto",
                    "motion_bias": "stable|mostly_stepwise|contrary|active",
                    "rhythm_policy": "follow_context|simplify|answer_melody|sustain_support",
                    "chord_tone_priority": ["third", "root", "fifth"],
                    "role": "Korean explanation of what this candidate does musically.",
                    "selection_hint": "Korean hint that helps the user choose this candidate.",
                    "risk_tags": ["range", "motion"],
                }
            ],
            "warnings": [],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are GigaStudy's harmony planning layer. Return JSON only. "
                "Plan practical vocal harmony for a six-track a cappella region arrangement. "
                "Use measure-level harmonic intent and distinct candidate goals. "
                "Choose distinct candidate_directions from the allowed profile names. "
                "Write title, role, selection_hint, risk_tags, phrase_summary, and warnings in Korean. "
                "Critique your draft internally for singability, voice crossing, cadence, and candidate diversity, "
                "then return only the revised final JSON. "
                "Do not generate notes, beats, MIDI, prose paragraphs, or markdown."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
        },
    ]
    return _build_json_chat_payload(settings=settings, messages=messages)


def _build_plan_revision_payload(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    target_slot_id: int,
    context_notes_by_slot: dict[int, list[TrackNote]],
    candidate_count: int,
    draft_plan: DeepSeekHarmonyPlan,
    cycle_index: int,
) -> dict[str, Any]:
    context = {
        "product_rule": (
            "Revise the harmony plan only. Do not output TrackNote arrays, exact MIDI sequences, "
            "exact beats, prose, or markdown."
        ),
        "revision_cycle": cycle_index,
        "studio": {
            "title": title,
            "bpm_is_absolute": True,
            "bpm": bpm,
            "time_signature": f"{time_signature_numerator}/{time_signature_denominator}",
        },
        "target_track": {
            "slot_id": target_slot_id,
            "name": track_name(target_slot_id),
        },
        "candidate_count": candidate_count,
        "a_cappella_arrangement_rules": [
            "Revise as an a cappella arranger: singability, independent lines, bass foundation, and candidate diversity matter.",
            "Keep the plan bounded; final notes are generated by deterministic code.",
        ],
        "context_tracks": [
            _summarize_track(slot_id, notes)
            for slot_id, notes in sorted(context_notes_by_slot.items())
            if notes
        ],
        "measure_summaries": _summarize_measures(
            context_notes_by_slot,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
        ),
        "draft_plan": draft_plan.model_dump(
            exclude={"provider", "model", "used"},
            exclude_none=True,
        ),
        "revision_checklist": [
            "Check that every candidate stays singable for the assigned vocal range.",
            "Check that the candidate directions are meaningfully different.",
            "Check that measure functions form a usable opening-build-cadence-final flow.",
            "Reduce crossing, awkward spacing, and parallel perfect interval risk.",
            "Return the same JSON schema with a practical revised plan only.",
        ],
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are GigaStudy's internal harmony reviewer. Return JSON only. "
                "Silently critique the draft plan, then return a corrected full plan. "
                "Keep values bounded to the provided schema. Korean text for user-facing fields."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
        },
    ]
    return _build_json_chat_payload(settings=settings, messages=messages)


def _build_json_chat_payload(*, settings: Settings, messages: list[dict[str, str]]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.deepseek_model,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "max_tokens": settings.deepseek_max_tokens,
    }
    provider = _chat_completion_provider(settings)
    if provider == "deepseek":
        payload["thinking"] = {"type": "enabled" if settings.deepseek_thinking_enabled else "disabled"}
    elif settings.deepseek_thinking_enabled:
        payload["reasoning"] = {"enabled": True}
    if not settings.deepseek_thinking_enabled:
        payload["temperature"] = settings.deepseek_temperature
    return payload


def _chat_completion_provider(settings: Settings) -> str:
    if "openrouter.ai" in settings.deepseek_base_url.lower():
        return "openrouter"
    return "deepseek"


def _chat_completion_headers(settings: Settings) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if _chat_completion_provider(settings) == "openrouter":
        if settings.deepseek_site_url:
            headers["HTTP-Referer"] = settings.deepseek_site_url
        if settings.deepseek_app_title:
            headers["X-Title"] = settings.deepseek_app_title
    return headers


def _summarize_track(slot_id: int, notes: list[TrackNote]) -> dict[str, Any]:
    pitched_notes = [note for note in notes if note.pitch_midi is not None and not note.is_rest]
    pitches = [note.pitch_midi for note in pitched_notes if note.pitch_midi is not None]
    return {
        "slot_id": slot_id,
        "name": track_name(slot_id),
        "note_count": len(pitched_notes),
        "range": _range_label(pitches),
        "events": [
            {
                "measure": note.measure_index,
                "beat_in_measure": note.beat_in_measure,
                "absolute_beat": note.beat,
                "duration_beats": note.duration_beats,
                "label": note.spelled_label or note.label,
                "pitch_midi": note.pitch_midi,
            }
            for note in pitched_notes[:64]
        ],
    }


def _summarize_measures(
    context_notes_by_slot: dict[int, list[TrackNote]],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[dict[str, Any]]:
    beats_per_measure = max(0.25, time_signature_numerator * (4 / max(1, time_signature_denominator)))
    measure_map: dict[int, dict[str, Any]] = {}
    for slot_id, notes in context_notes_by_slot.items():
        for note in notes:
            if note.pitch_midi is None or note.is_rest:
                continue
            measure_index = note.measure_index
            if measure_index is None:
                measure_index = int((max(note.beat, 1) - 1) // beats_per_measure) + 1
            summary = measure_map.setdefault(
                measure_index,
                {
                    "measure_index": measure_index,
                    "active_slots": set(),
                    "downbeat_labels": [],
                    "pitch_classes": set(),
                    "event_count": 0,
                },
            )
            summary["active_slots"].add(slot_id)
            summary["pitch_classes"].add(note.pitch_midi % 12)
            summary["event_count"] += 1
            beat_in_measure = note.beat_in_measure
            if beat_in_measure is None:
                beat_in_measure = ((max(note.beat, 1) - 1) % beats_per_measure) + 1
            if abs(beat_in_measure - 1) < 0.02:
                summary["downbeat_labels"].append(
                    {
                        "slot_id": slot_id,
                        "label": note.spelled_label or note.label,
                        "pitch_midi": note.pitch_midi,
                    }
                )

    summaries: list[dict[str, Any]] = []
    for measure_index in sorted(measure_map)[:64]:
        summary = measure_map[measure_index]
        summaries.append(
            {
                "measure_index": measure_index,
                "active_slots": sorted(summary["active_slots"]),
                "event_count": summary["event_count"],
                "pitch_classes": sorted(summary["pitch_classes"]),
                "downbeat_labels": summary["downbeat_labels"][:8],
            }
        )
    return summaries


def _range_label(pitches: list[int]) -> str:
    if not pitches:
        return "-"
    return f"{min(pitches)}-{max(pitches)}"


def _parse_deepseek_response(
    payload: dict[str, Any],
    *,
    model: str,
    provider: str = "deepseek",
) -> DeepSeekHarmonyPlan:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("DeepSeek response did not include choices.")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ValueError("DeepSeek response content was empty.")
    decoded = _loads_json_object(content)
    plan = DeepSeekHarmonyPlan.model_validate(decoded)
    plan.provider = provider
    plan.model = model
    plan.used = True
    return plan


def _loads_json_object(content: str) -> dict[str, Any]:
    stripped = content.strip()
    if stripped.startswith("```"):
        lines = [line for line in stripped.splitlines() if not line.strip().startswith("```")]
        stripped = "\n".join(lines).strip()
    decoded = json.loads(stripped)
    if not isinstance(decoded, dict):
        raise ValueError("DeepSeek response was not a JSON object.")
    return decoded
