from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from gigastudy_api.api.schemas.studios import GenerateTrackRequest, Studio, TrackNote
from gigastudy_api.config import Settings
from gigastudy_api.services.engine.candidate_diagnostics import (
    candidate_diagnostics,
    generation_variant_label,
)
from gigastudy_api.services.engine.harmony import generate_rule_based_harmony_candidates
from gigastudy_api.services.engine.timeline import notes_with_sync_offset
from gigastudy_api.services.llm.deepseek import DeepSeekHarmonyPlan, plan_harmony_with_deepseek


@dataclass(frozen=True)
class GeneratedTrackMaterial:
    candidate_notes: list[list[TrackNote]]
    source_label: str
    method: str
    message: str
    llm_plan: DeepSeekHarmonyPlan | None


class GenerationRequestError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def build_generation_context_notes_by_slot(
    studio: Studio,
    *,
    target_slot_id: int,
    requested_context_slot_ids: list[int] | None,
) -> dict[int, list[TrackNote]]:
    registered_tracks = [track for track in studio.tracks if track.status == "registered"]
    context_slot_ids = requested_context_slot_ids or [
        track.slot_id for track in registered_tracks
    ]
    return {
        track.slot_id: notes_with_sync_offset(
            track.notes,
            track.sync_offset_seconds,
            studio.bpm,
            voice_index=track.slot_id,
        )
        for track in registered_tracks
        if track.slot_id in context_slot_ids and track.slot_id != target_slot_id
    }


def flattened_generation_context_notes(
    context_notes_by_slot: dict[int, list[TrackNote]],
) -> list[TrackNote]:
    return [note for notes in context_notes_by_slot.values() for note in notes]


def generate_track_material(
    *,
    settings: Settings,
    studio: Studio,
    target_slot_id: int,
    request: GenerateTrackRequest,
) -> GeneratedTrackMaterial:
    context_notes_by_slot = build_generation_context_notes_by_slot(
        studio,
        target_slot_id=target_slot_id,
        requested_context_slot_ids=request.context_slot_ids,
    )
    context_notes = flattened_generation_context_notes(context_notes_by_slot)
    if not context_notes:
        raise GenerationRequestError(
            409,
            "AI generation requires at least one registered context track.",
        )
    llm_plan = plan_harmony_with_deepseek(
        settings=settings,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        target_slot_id=target_slot_id,
        context_notes_by_slot=context_notes_by_slot,
        candidate_count=request.candidate_count,
    )
    candidate_notes = generate_rule_based_harmony_candidates(
        target_slot_id=target_slot_id,
        context_tracks=context_notes,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        context_notes_by_slot=context_notes_by_slot,
        candidate_count=request.candidate_count,
        profile_names=llm_plan.profile_names() if llm_plan is not None else None,
        harmony_plan=llm_plan,
    )
    label = "Generated percussion groove" if target_slot_id == 6 else "Voice-leading harmony score"
    method = (
        "rule_based_percussion_candidates_v0"
        if target_slot_id == 6
        else (
            "deepseek_v4_flash_guided_voice_leading_candidates_v1"
            if llm_plan is not None
            else "rule_based_voice_leading_candidates_v1"
        )
    )
    message = (
        "DeepSeek V4 Flash planned candidate directions; deterministic engine generated valid "
        "TrackNote candidates."
        if llm_plan is not None
        else "AI generated multiple candidates. Approve one candidate to register it."
    )
    return GeneratedTrackMaterial(
        candidate_notes=candidate_notes,
        source_label=label,
        method=method,
        message=message,
        llm_plan=llm_plan,
    )


def generation_candidate_review_metadata(
    *,
    slot_id: int,
    notes: list[TrackNote],
    method: str,
    confidence: float,
    candidate_index: int,
    llm_plan: DeepSeekHarmonyPlan | None,
) -> tuple[dict[str, Any], str]:
    llm_direction = llm_plan.direction_for_index(candidate_index) if llm_plan is not None else None
    diagnostics: dict[str, Any] = candidate_diagnostics(
        slot_id,
        notes,
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
        else generation_variant_label(candidate_index, slot_id, notes)
    )
    return diagnostics, variant_label
