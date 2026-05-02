from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from gigastudy_api.api.schemas.studios import GenerateTrackRequest, Studio
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.config import Settings
from gigastudy_api.services.engine.candidate_diagnostics import (
    candidate_diagnostics,
    generation_variant_label,
)
from gigastudy_api.services.engine.harmony import generate_rule_based_harmony_candidates
from gigastudy_api.services.engine.timeline import registered_region_events_by_slot
from gigastudy_api.services.llm.deepseek import DeepSeekHarmonyPlan, plan_harmony_with_deepseek

DEEPSEEK_GENERATION_CONTEXT_EVENT_LIMIT = 160
DEEPSEEK_GENERATION_TIMEOUT_SECONDS = 6.0


@dataclass(frozen=True)
class GeneratedTrackMaterial:
    candidate_events: list[list[TrackPitchEvent]]
    source_label: str
    method: str
    message: str
    llm_plan: DeepSeekHarmonyPlan | None


class GenerationRequestError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def build_generation_context_events_by_slot(
    studio: Studio,
    *,
    target_slot_id: int,
    requested_context_slot_ids: list[int] | None,
) -> dict[int, list[TrackPitchEvent]]:
    registered_events_by_slot = registered_region_events_by_slot(studio, exclude_slot_id=target_slot_id)
    context_slot_ids = requested_context_slot_ids or [
        slot_id for slot_id in registered_events_by_slot
    ]
    return {
        slot_id: events
        for slot_id, events in registered_events_by_slot.items()
        if slot_id in context_slot_ids
    }


def flattened_generation_context_events(
    context_events_by_slot: dict[int, list[TrackPitchEvent]],
) -> list[TrackPitchEvent]:
    return [event for events in context_events_by_slot.values() for event in events]


def generate_track_material(
    *,
    settings: Settings,
    studio: Studio,
    target_slot_id: int,
    request: GenerateTrackRequest,
) -> GeneratedTrackMaterial:
    context_events_by_slot = build_generation_context_events_by_slot(
        studio,
        target_slot_id=target_slot_id,
        requested_context_slot_ids=request.context_slot_ids,
    )
    context_events = flattened_generation_context_events(context_events_by_slot)
    if not context_events:
        raise GenerationRequestError(
            409,
            "AI generation requires at least one registered context track.",
        )
    planning_settings = _generation_planning_settings(
        settings,
        context_event_count=len(context_events),
    )
    llm_plan = plan_harmony_with_deepseek(
        settings=planning_settings,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        target_slot_id=target_slot_id,
        context_events_by_slot=context_events_by_slot,
        candidate_count=request.candidate_count,
    )
    candidate_events = generate_rule_based_harmony_candidates(
        target_slot_id=target_slot_id,
        context_tracks=context_events,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        context_events_by_slot=context_events_by_slot,
        candidate_count=request.candidate_count,
        profile_names=llm_plan.profile_names() if llm_plan is not None else None,
        harmony_plan=llm_plan,
    )
    if not candidate_events and llm_plan is not None:
        llm_plan = None
        candidate_events = generate_rule_based_harmony_candidates(
            target_slot_id=target_slot_id,
            context_tracks=context_events,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            context_events_by_slot=context_events_by_slot,
            candidate_count=request.candidate_count,
        )
    label = "퍼커션 그루브" if target_slot_id == 6 else "성부 진행 화음"
    method = (
        "rule_based_percussion_candidates_v0"
        if target_slot_id == 6
        else (
            "deepseek_guided_voice_leading_candidates_v1"
            if llm_plan is not None
            else "rule_based_voice_leading_candidates_v1"
        )
    )
    message = (
        "DeepSeek planner planned candidate directions; deterministic engine generated valid "
        "pitch-event candidates."
        if llm_plan is not None
        else "Deterministic voice-leading generated multiple candidates. Approve one candidate to register it."
    )
    return GeneratedTrackMaterial(
        candidate_events=candidate_events,
        source_label=label,
        method=method,
        message=message,
        llm_plan=llm_plan,
    )


def _generation_planning_settings(settings: Settings, *, context_event_count: int) -> Settings:
    if context_event_count > DEEPSEEK_GENERATION_CONTEXT_EVENT_LIMIT:
        return settings.model_copy(update={"deepseek_harmony_enabled": False})
    return settings.model_copy(
        update={
            "deepseek_timeout_seconds": max(
                0.5,
                min(settings.deepseek_timeout_seconds, DEEPSEEK_GENERATION_TIMEOUT_SECONDS),
            ),
            "deepseek_max_retries": 0,
            "deepseek_revision_cycles": 0,
        }
    )


def generation_candidate_review_metadata(
    *,
    slot_id: int,
    events: list[TrackPitchEvent],
    method: str,
    confidence: float,
    candidate_index: int,
    llm_plan: DeepSeekHarmonyPlan | None,
) -> tuple[dict[str, Any], str]:
    llm_direction = llm_plan.direction_for_index(candidate_index) if llm_plan is not None else None
    diagnostics: dict[str, Any] = candidate_diagnostics(
        slot_id,
        events,
        method=method,
        confidence=confidence,
    )
    if llm_plan is not None:
        diagnostics["llm_provider"] = llm_plan.provider
        diagnostics["llm_model"] = llm_plan.model
        diagnostics["llm_plan_confidence"] = round(llm_plan.confidence, 3)
        diagnostics["llm_key"] = llm_plan.key
        diagnostics["llm_mode"] = llm_plan.mode
        diagnostics["llm_phrase_summary"] = llm_plan.phrase_summary
        diagnostics["llm_warnings"] = llm_plan.warnings
        diagnostics["llm_revision_cycles"] = llm_plan.revision_cycles
        diagnostics["llm_measure_intent_count"] = len(llm_plan.measures)
        diagnostics["llm_critique_summary"] = llm_plan.critique_summary
    if llm_direction is not None:
        diagnostics["llm_profile"] = llm_direction.profile_name
        diagnostics["llm_goal"] = llm_direction.goal
        diagnostics["llm_register_bias"] = llm_direction.register_bias
        diagnostics["llm_motion_bias"] = llm_direction.motion_bias
        diagnostics["llm_rhythm_policy"] = llm_direction.rhythm_policy
        diagnostics["llm_chord_tone_priority"] = llm_direction.chord_tone_priority
        diagnostics["selection_hint"] = llm_direction.selection_hint
        diagnostics["candidate_role"] = llm_direction.role
        diagnostics["risk_tags"] = llm_direction.risk_tags
    variant_label = (
        llm_direction.title
        if llm_direction is not None
        else generation_variant_label(candidate_index, slot_id, events)
    )
    return diagnostics, variant_label
