from __future__ import annotations

from dataclasses import dataclass
import json
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
from gigastudy_api.services.llm.provider import DeepSeekHarmonyPlan, plan_harmony

DEEPSEEK_GENERATION_CONTEXT_EVENT_LIMIT = 160
DEEPSEEK_GENERATION_TIMEOUT_SECONDS = 6.0
GENERATION_EXTRA_DIVERSITY_CANDIDATES = 2
GENERATION_DISTINCT_DIFFERENCE_THRESHOLD = 0.18
_HARMONY_PLAN_CACHE_MAX_ENTRIES = 64
_harmony_plan_cache: dict[str, DeepSeekHarmonyPlan | None] = {}


@dataclass(frozen=True)
class GeneratedTrackMaterial:
    candidate_events: list[list[TrackPitchEvent]]
    context_events_by_slot: dict[int, list[TrackPitchEvent]]
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
    llm_plan = _cached_plan_harmony(
        settings=planning_settings,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        target_slot_id=target_slot_id,
        context_events_by_slot=context_events_by_slot,
        candidate_count=request.candidate_count,
    )
    engine_candidate_count = generation_search_candidate_count(request.candidate_count)
    candidate_events = generate_rule_based_harmony_candidates(
        target_slot_id=target_slot_id,
        context_tracks=context_events,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        context_events_by_slot=context_events_by_slot,
        candidate_count=engine_candidate_count,
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
            candidate_count=engine_candidate_count,
        )
    candidate_events = select_diverse_generated_candidates(
        candidate_events,
        requested_count=request.candidate_count,
    )
    label = "퍼커션 그루브" if target_slot_id == 6 else "성부 진행 화음"
    method = (
        "rule_based_percussion_candidates_v0"
        if target_slot_id == 6
        else (
            "llm_guided_voice_leading_candidates_v1"
            if llm_plan is not None
            else "rule_based_voice_leading_candidates_v1"
        )
    )
    message = (
        "화음 계획을 바탕으로 결정론 엔진이 후보를 만들었습니다."
        if llm_plan is not None
        else "화성 진행 규칙으로 여러 후보를 만들었습니다. 하나를 승인하면 트랙에 등록됩니다."
    )
    return GeneratedTrackMaterial(
        candidate_events=candidate_events,
        context_events_by_slot=context_events_by_slot,
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


def _cached_plan_harmony(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    target_slot_id: int,
    context_events_by_slot: dict[int, list[TrackPitchEvent]],
    candidate_count: int,
) -> DeepSeekHarmonyPlan | None:
    key = _harmony_plan_cache_key(
        settings=settings,
        title=title,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        target_slot_id=target_slot_id,
        context_events_by_slot=context_events_by_slot,
        candidate_count=candidate_count,
    )
    if key in _harmony_plan_cache:
        return _harmony_plan_cache[key]
    result = plan_harmony(
        settings=settings,
        title=title,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        target_slot_id=target_slot_id,
        context_events_by_slot=context_events_by_slot,
        candidate_count=candidate_count,
    )
    if len(_harmony_plan_cache) >= _HARMONY_PLAN_CACHE_MAX_ENTRIES:
        _harmony_plan_cache.pop(next(iter(_harmony_plan_cache)))
    _harmony_plan_cache[key] = result
    return result


def _harmony_plan_cache_key(
    *,
    settings: Settings,
    title: str,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    target_slot_id: int,
    context_events_by_slot: dict[int, list[TrackPitchEvent]],
    candidate_count: int,
) -> str:
    context_signature = {
        str(slot_id): [
            [
                event.pitch_midi,
                round(event.onset_seconds, 4),
                round(event.duration_seconds, 4),
                round(event.beat, 4),
                round(event.duration_beats, 4),
            ]
            for event in events
        ]
        for slot_id, events in sorted(context_events_by_slot.items())
    }
    return json.dumps(
        {
            "bpm": bpm,
            "candidate_count": candidate_count,
            "context": context_signature,
            "deepseek_enabled": settings.deepseek_harmony_enabled,
            "meter": [time_signature_numerator, time_signature_denominator],
            "target_slot_id": target_slot_id,
            "title": title,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def generation_search_candidate_count(requested_count: int) -> int:
    return max(
        1,
        min(5, requested_count + GENERATION_EXTRA_DIVERSITY_CANDIDATES),
    )


def select_diverse_generated_candidates(
    candidates: list[list[TrackPitchEvent]],
    *,
    requested_count: int,
) -> list[list[TrackPitchEvent]]:
    if requested_count <= 0:
        return []

    selected: list[list[TrackPitchEvent]] = []
    similar_candidates: list[list[TrackPitchEvent]] = []
    for candidate in candidates:
        if not candidate:
            continue
        if all(
            generated_candidate_difference_score(candidate, current) >= GENERATION_DISTINCT_DIFFERENCE_THRESHOLD
            for current in selected
        ):
            selected.append(candidate)
        else:
            similar_candidates.append(candidate)
        if len(selected) >= requested_count:
            return selected

    for candidate in similar_candidates:
        if all(_event_sequence_signature(candidate) != _event_sequence_signature(current) for current in selected):
            selected.append(candidate)
        if len(selected) >= requested_count:
            return selected

    for candidate in candidates:
        if candidate and candidate not in selected:
            selected.append(candidate)
        if len(selected) >= requested_count:
            break
    return selected[:requested_count]


def generated_candidate_difference_score(
    first: list[TrackPitchEvent],
    second: list[TrackPitchEvent],
) -> float:
    first_pitches = _pitch_sequence(first)
    second_pitches = _pitch_sequence(second)
    if not first_pitches or not second_pitches:
        return _unpitched_event_difference_score(first, second)

    pair_count = min(len(first_pitches), len(second_pitches))
    changed_positions = sum(
        1
        for index in range(pair_count)
        if abs(first_pitches[index] - second_pitches[index]) >= 3
    )
    average_register_delta = abs(
        (sum(first_pitches) / len(first_pitches))
        - (sum(second_pitches) / len(second_pitches))
    )
    contour_delta = _contour_difference_score(first_pitches, second_pitches)
    rhythm_delta = _rhythm_difference_score(first, second)
    length_delta = abs(len(first_pitches) - len(second_pitches)) / max(len(first_pitches), len(second_pitches))
    return (
        (changed_positions / pair_count) * 0.56
        + min(1.0, average_register_delta / 8) * 0.18
        + contour_delta * 0.14
        + rhythm_delta * 0.08
        + length_delta * 0.04
    )


def generation_context_diagnostics(
    *,
    events: list[TrackPitchEvent],
    context_events_by_slot: dict[int, list[TrackPitchEvent]] | None,
    sibling_candidates: list[list[TrackPitchEvent]] | None,
) -> dict[str, Any]:
    context_events_by_slot = context_events_by_slot or {}
    context_slot_ids = sorted(slot_id for slot_id, events in context_events_by_slot.items() if events)
    sibling_scores = [
        generated_candidate_difference_score(events, sibling)
        for sibling in (sibling_candidates or [])
        if sibling
    ]
    closest_difference = min(sibling_scores) if sibling_scores else None
    return {
        "generation_context_slot_ids": context_slot_ids,
        "generation_context_track_count": len(context_slot_ids),
        "generation_context_event_count": sum(len(events) for events in context_events_by_slot.values()),
        "candidate_diversity_score": (
            None
            if closest_difference is None
            else round(max(0.0, min(1.0, closest_difference)), 3)
        ),
        "candidate_diversity_label": _candidate_diversity_label(closest_difference),
    }


def generation_candidate_review_metadata(
    *,
    slot_id: int,
    events: list[TrackPitchEvent],
    method: str,
    confidence: float,
    candidate_index: int,
    llm_plan: DeepSeekHarmonyPlan | None,
    context_events_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
    sibling_candidates: list[list[TrackPitchEvent]] | None = None,
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
    diagnostics.update(
        generation_context_diagnostics(
            events=events,
            context_events_by_slot=context_events_by_slot,
            sibling_candidates=sibling_candidates,
        )
    )
    variant_label = (
        llm_direction.title
        if llm_direction is not None
        else generation_variant_label(candidate_index, slot_id, events)
    )
    return diagnostics, variant_label


def _pitch_sequence(events: list[TrackPitchEvent]) -> list[int]:
    return [
        event.pitch_midi
        for event in sorted(events, key=lambda item: (item.beat, item.id))
        if event.pitch_midi is not None and not event.is_rest
    ]


def _event_sequence_signature(events: list[TrackPitchEvent]) -> tuple[tuple[float, float, int | None], ...]:
    return tuple(
        (
            round(event.beat, 3),
            round(event.duration_beats, 3),
            event.pitch_midi,
        )
        for event in sorted(events, key=lambda item: (item.beat, item.id))
        if not event.is_rest
    )


def _contour_difference_score(first_pitches: list[int], second_pitches: list[int]) -> float:
    first_contour = _contour_signature(first_pitches)
    second_contour = _contour_signature(second_pitches)
    if not first_contour or not second_contour:
        return 0.0
    pair_count = min(len(first_contour), len(second_contour))
    return sum(1 for index in range(pair_count) if first_contour[index] != second_contour[index]) / pair_count


def _contour_signature(pitches: list[int]) -> tuple[int, ...]:
    return tuple(
        _motion_direction(pitches[index - 1], pitches[index])
        for index in range(1, len(pitches))
    )


def _rhythm_difference_score(first: list[TrackPitchEvent], second: list[TrackPitchEvent]) -> float:
    first_signature = [
        (round(event.beat, 3), round(event.duration_beats, 3))
        for event in sorted(first, key=lambda item: (item.beat, item.id))
        if not event.is_rest
    ]
    second_signature = [
        (round(event.beat, 3), round(event.duration_beats, 3))
        for event in sorted(second, key=lambda item: (item.beat, item.id))
        if not event.is_rest
    ]
    if not first_signature or not second_signature:
        return 1.0 if first_signature != second_signature else 0.0
    pair_count = min(len(first_signature), len(second_signature))
    changed = sum(1 for index in range(pair_count) if first_signature[index] != second_signature[index])
    length_delta = abs(len(first_signature) - len(second_signature)) / max(len(first_signature), len(second_signature))
    return changed / pair_count * 0.8 + length_delta * 0.2


def _unpitched_event_difference_score(
    first: list[TrackPitchEvent],
    second: list[TrackPitchEvent],
) -> float:
    first_labels = [
        event.label
        for event in sorted(first, key=lambda item: (item.beat, item.id))
        if not event.is_rest
    ]
    second_labels = [
        event.label
        for event in sorted(second, key=lambda item: (item.beat, item.id))
        if not event.is_rest
    ]
    if not first_labels or not second_labels:
        return 1.0 if first_labels != second_labels else 0.0
    pair_count = min(len(first_labels), len(second_labels))
    label_delta = sum(1 for index in range(pair_count) if first_labels[index] != second_labels[index]) / pair_count
    length_delta = abs(len(first_labels) - len(second_labels)) / max(len(first_labels), len(second_labels))
    return label_delta * 0.8 + _rhythm_difference_score(first, second) * 0.15 + length_delta * 0.05


def _motion_direction(previous_pitch: int, current_pitch: int) -> int:
    if current_pitch > previous_pitch:
        return 1
    if current_pitch < previous_pitch:
        return -1
    return 0


def _candidate_diversity_label(closest_difference: float | None) -> str:
    if closest_difference is None:
        return "single"
    if closest_difference >= GENERATION_DISTINCT_DIFFERENCE_THRESHOLD:
        return "distinct"
    if closest_difference > 0:
        return "similar"
    return "duplicate"
