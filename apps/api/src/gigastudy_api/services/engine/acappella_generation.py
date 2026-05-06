from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.harmony_plan import DeepSeekCandidateDirection
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    event_from_pitch,
    quarter_beats_per_measure,
)

ACAPPELLA_GENERATION_VERSION = "acappella_track_generation_v3"
VOCAL_SLOT_IDS = (1, 2, 3, 4, 5)
RHYTHM_GRID_BEATS = 0.25
GRID_TOLERANCE_BEATS = 0.001
HARSH_STRUCTURAL_INTERVALS = {1, 2, 6, 10, 11}


@dataclass(frozen=True)
class ArrangementContext:
    target_slot_id: int
    context_slot_ids: tuple[int, ...]
    vocal_events_by_slot: dict[int, tuple[TrackPitchEvent, ...]]
    rhythm_events_by_slot: dict[int, tuple[TrackPitchEvent, ...]]
    lead_slot_id: int | None
    active_voice_slot_id: int | None
    beats_per_measure: float
    measure_count: int
    max_beat: float
    articulation_anchors: tuple[float, ...]
    strong_beat_anchors: tuple[float, ...]
    context_density_events_per_measure: float
    repeated_motif_ratio: float


@dataclass(frozen=True)
class CandidateQualityReport:
    target_slot_id: int
    quality_score: float
    role_fit_score: float
    rhythm_fit_score: float
    harmonic_fit_score: float
    voice_leading_score: float
    singability_score: float
    spacing_score: float
    articulation_score: float
    event_count: int
    attack_count: int
    density_events_per_measure: float
    context_density_events_per_measure: float
    context_onset_match_ratio: float
    context_onset_coverage_ratio: float
    long_sustain_ratio: float
    range_fit_ratio: float
    timing_grid_ratio: float
    voice_crossing_count: int
    spacing_issue_count: int
    parallel_perfect_count: int
    structural_dissonance_count: int
    large_leap_count: int
    warnings: tuple[str, ...]
    quality_label: str


def compile_arrangement_context(
    context_events_by_slot: dict[int, list[TrackPitchEvent]] | dict[int, tuple[TrackPitchEvent, ...]] | None,
    *,
    target_slot_id: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> ArrangementContext:
    context_events_by_slot = context_events_by_slot or {}
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    vocal_events_by_slot = {
        slot_id: tuple(_pitched_events(list(events)))
        for slot_id, events in context_events_by_slot.items()
        if slot_id in VOCAL_SLOT_IDS and slot_id != target_slot_id and events
    }
    rhythm_events_by_slot = {
        slot_id: tuple(_rhythm_events(list(events)))
        for slot_id, events in context_events_by_slot.items()
        if slot_id != target_slot_id and events
    }
    rhythm_events_by_slot = {
        slot_id: events
        for slot_id, events in rhythm_events_by_slot.items()
        if events
    }
    all_rhythm_events = [
        event
        for events in rhythm_events_by_slot.values()
        for event in events
    ]
    all_vocal_events = [
        event
        for events in vocal_events_by_slot.values()
        for event in events
    ]
    max_beat = max(
        (
            event.beat + max(RHYTHM_GRID_BEATS, event.duration_beats)
            for event in all_rhythm_events or all_vocal_events
        ),
        default=1 + beats_per_measure,
    )
    measure_count = max(1, int((max_beat - 1) // beats_per_measure) + 1)
    strong_beat_anchors = tuple(
        round(1 + measure_index * beats_per_measure + beat_offset, 4)
        for measure_index in range(measure_count)
        for beat_offset in range(max(1, int(round(beats_per_measure))))
        if 1 + measure_index * beats_per_measure + beat_offset < max_beat + GRID_TOLERANCE_BEATS
    )
    articulation_anchors = _articulation_anchors(
        all_rhythm_events,
        strong_beat_anchors=strong_beat_anchors,
    )
    context_density = round(len(all_vocal_events) / max(1, measure_count), 3)
    return ArrangementContext(
        target_slot_id=target_slot_id,
        context_slot_ids=tuple(sorted(slot_id for slot_id, events in rhythm_events_by_slot.items() if events)),
        vocal_events_by_slot=vocal_events_by_slot,
        rhythm_events_by_slot=rhythm_events_by_slot,
        lead_slot_id=_estimate_lead_slot(vocal_events_by_slot),
        active_voice_slot_id=_estimate_active_voice_slot(vocal_events_by_slot),
        beats_per_measure=beats_per_measure,
        measure_count=measure_count,
        max_beat=round(max_beat, 4),
        articulation_anchors=articulation_anchors,
        strong_beat_anchors=strong_beat_anchors,
        context_density_events_per_measure=context_density,
        repeated_motif_ratio=_repeated_motif_ratio(all_rhythm_events),
    )


def apply_acappella_articulation_pass(
    events: list[TrackPitchEvent],
    *,
    context: ArrangementContext,
    candidate_goal: DeepSeekCandidateDirection | None,
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> list[TrackPitchEvent]:
    if not events:
        return []
    rhythm_policy = candidate_goal.rhythm_policy if candidate_goal is not None else "follow_context"
    if rhythm_policy == "simplify":
        split_anchors = context.strong_beat_anchors
        minimum_duration_for_split = context.beats_per_measure
    elif rhythm_policy == "sustain_support":
        split_anchors = _dense_support_anchors(context)
        minimum_duration_for_split = max(1.0, context.beats_per_measure / 2)
    else:
        split_anchors = context.articulation_anchors
        minimum_duration_for_split = RHYTHM_GRID_BEATS * 2

    articulated: list[TrackPitchEvent] = []
    for event in sorted(events, key=lambda item: (item.beat, item.id)):
        if event.is_rest or event.pitch_midi is None or event.duration_beats < minimum_duration_for_split:
            articulated.append(event)
            continue
        split_points = [
            anchor
            for anchor in split_anchors
            if event.beat + RHYTHM_GRID_BEATS <= anchor < event.beat + event.duration_beats - GRID_TOLERANCE_BEATS
        ]
        if not split_points:
            articulated.append(event)
            continue
        articulated.extend(
            _split_event_at_anchors(
                event,
                split_points=split_points,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
        )
    return articulated


def acappella_quality_diagnostics(
    *,
    target_slot_id: int,
    events: list[TrackPitchEvent],
    context_events_by_slot: dict[int, list[TrackPitchEvent]] | None,
    candidate_goal: DeepSeekCandidateDirection | None = None,
    sibling_candidates: list[list[TrackPitchEvent]] | None = None,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> dict[str, Any]:
    context = compile_arrangement_context(
        context_events_by_slot,
        target_slot_id=target_slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    report = score_acappella_candidate(
        target_slot_id=target_slot_id,
        events=events,
        context=context,
        candidate_goal=candidate_goal,
        sibling_candidates=sibling_candidates,
    )
    return {
        "acappella_engine_version": ACAPPELLA_GENERATION_VERSION,
        "acappella_context_slot_ids": list(context.context_slot_ids),
        "acappella_lead_slot_id": context.lead_slot_id,
        "acappella_active_voice_slot_id": context.active_voice_slot_id,
        "acappella_context_density_events_per_measure": context.context_density_events_per_measure,
        "acappella_context_repeated_motif_ratio": context.repeated_motif_ratio,
        "arrangement_goal": candidate_goal.goal if candidate_goal is not None else "rehearsal_safe",
        "arrangement_texture": candidate_goal.texture if candidate_goal is not None else "block_harmony",
        "arrangement_rhythm_role": candidate_goal.rhythm_role if candidate_goal is not None else "context_lock",
        "arrangement_role": _candidate_role_label(candidate_goal, target_slot_id),
        "arrangement_selection_hint": _candidate_selection_hint(candidate_goal),
        "acappella_quality_score": report.quality_score,
        "acappella_quality_label": report.quality_label,
        "role_fit_score": report.role_fit_score,
        "rhythm_fit_score": report.rhythm_fit_score,
        "harmonic_fit_score": report.harmonic_fit_score,
        "voice_leading_score": report.voice_leading_score,
        "singability_score": report.singability_score,
        "spacing_score": report.spacing_score,
        "articulation_score": report.articulation_score,
        "attack_count": report.attack_count,
        "context_onset_match_ratio": report.context_onset_match_ratio,
        "context_onset_coverage_ratio": report.context_onset_coverage_ratio,
        "long_sustain_ratio": report.long_sustain_ratio,
        "voice_crossing_count": report.voice_crossing_count,
        "spacing_issue_count": report.spacing_issue_count,
        "parallel_perfect_count": report.parallel_perfect_count,
        "structural_dissonance_count": report.structural_dissonance_count,
        "large_leap_count": report.large_leap_count,
        "generation_quality_warnings": list(report.warnings),
        "review_hint": _review_hint_for_report(report),
    }


def score_acappella_candidate(
    *,
    target_slot_id: int,
    events: list[TrackPitchEvent],
    context: ArrangementContext,
    candidate_goal: DeepSeekCandidateDirection | None = None,
    sibling_candidates: list[list[TrackPitchEvent]] | None = None,
) -> CandidateQualityReport:
    pitched_events = _pitched_events(events)
    event_count = len([event for event in events if not event.is_rest])
    attack_count = len(pitched_events)
    measure_count = _candidate_measure_count(pitched_events, context)
    density = round(event_count / max(1, measure_count), 3)
    range_fit_ratio = _range_fit_ratio(target_slot_id, pitched_events)
    timing_grid_ratio = _timing_grid_ratio(events)
    match_ratio = _context_onset_match_ratio(pitched_events, context.articulation_anchors)
    coverage_ratio = _context_onset_coverage_ratio(pitched_events, context.articulation_anchors)
    long_sustain_ratio = _long_sustain_ratio(pitched_events, context.beats_per_measure)
    voice_crossing_count = _voice_crossing_count(target_slot_id, pitched_events, context)
    spacing_issue_count = _spacing_issue_count(target_slot_id, pitched_events, context)
    parallel_perfect_count = _parallel_perfect_count(target_slot_id, pitched_events, context)
    structural_dissonance_count = _structural_dissonance_count(target_slot_id, pitched_events, context)
    large_leap_count = _large_leap_count(pitched_events)
    sibling_similarity_penalty = _sibling_similarity_penalty(events, sibling_candidates or [])

    rhythm_policy = candidate_goal.rhythm_policy if candidate_goal is not None else "follow_context"
    expected_anchor_coverage = 0.3 if rhythm_policy == "sustain_support" else 0.55
    rhythm_fit_score = _bounded_score(
        100
        - max(0, expected_anchor_coverage - coverage_ratio) * 80
        - max(0, 0.45 - match_ratio) * 40
        - max(0, long_sustain_ratio - (0.5 if rhythm_policy == "sustain_support" else 0.28)) * 35
    )
    articulation_score = _bounded_score(
        100
        - max(0, expected_anchor_coverage - coverage_ratio) * 90
        - max(0, long_sustain_ratio - 0.25) * 45
    )
    harmonic_fit_score = _bounded_score(100 - structural_dissonance_count * 16)
    voice_leading_score = _bounded_score(100 - parallel_perfect_count * 28 - voice_crossing_count * 35)
    singability_score = _bounded_score(100 - large_leap_count * 10 - max(0, density - 8) * 3)
    spacing_score = _bounded_score(100 - spacing_issue_count * 14)
    role_fit_score = _role_fit_score(
        candidate_goal,
        target_slot_id=target_slot_id,
        density=density,
        long_sustain_ratio=long_sustain_ratio,
        context=context,
    )
    quality_score = _bounded_score(
        role_fit_score * 0.16
        + rhythm_fit_score * 0.17
        + harmonic_fit_score * 0.18
        + voice_leading_score * 0.18
        + singability_score * 0.13
        + spacing_score * 0.1
        + articulation_score * 0.08
        - (100 - range_fit_ratio * 100) * 0.45
        - (100 - timing_grid_ratio * 100) * 0.6
        - sibling_similarity_penalty
    )
    warnings = _quality_warnings(
        range_fit_ratio=range_fit_ratio,
        timing_grid_ratio=timing_grid_ratio,
        coverage_ratio=coverage_ratio,
        expected_anchor_coverage=expected_anchor_coverage,
        long_sustain_ratio=long_sustain_ratio,
        voice_crossing_count=voice_crossing_count,
        spacing_issue_count=spacing_issue_count,
        parallel_perfect_count=parallel_perfect_count,
        structural_dissonance_count=structural_dissonance_count,
        large_leap_count=large_leap_count,
        sibling_similarity_penalty=sibling_similarity_penalty,
    )
    return CandidateQualityReport(
        target_slot_id=target_slot_id,
        quality_score=round(quality_score, 3),
        role_fit_score=round(role_fit_score / 100, 3),
        rhythm_fit_score=round(rhythm_fit_score / 100, 3),
        harmonic_fit_score=round(harmonic_fit_score / 100, 3),
        voice_leading_score=round(voice_leading_score / 100, 3),
        singability_score=round(singability_score / 100, 3),
        spacing_score=round(spacing_score / 100, 3),
        articulation_score=round(articulation_score / 100, 3),
        event_count=event_count,
        attack_count=attack_count,
        density_events_per_measure=density,
        context_density_events_per_measure=context.context_density_events_per_measure,
        context_onset_match_ratio=round(match_ratio, 3),
        context_onset_coverage_ratio=round(coverage_ratio, 3),
        long_sustain_ratio=round(long_sustain_ratio, 3),
        range_fit_ratio=round(range_fit_ratio, 3),
        timing_grid_ratio=round(timing_grid_ratio, 3),
        voice_crossing_count=voice_crossing_count,
        spacing_issue_count=spacing_issue_count,
        parallel_perfect_count=parallel_perfect_count,
        structural_dissonance_count=structural_dissonance_count,
        large_leap_count=large_leap_count,
        warnings=tuple(warnings),
        quality_label=_quality_label(quality_score, warnings),
    )


def _pitched_events(events: list[TrackPitchEvent]) -> list[TrackPitchEvent]:
    return sorted(
        [event for event in events if not event.is_rest and event.pitch_midi is not None],
        key=lambda event: (event.beat, event.id),
    )


def _rhythm_events(events: list[TrackPitchEvent]) -> list[TrackPitchEvent]:
    return sorted(
        [event for event in events if not event.is_rest],
        key=lambda event: (event.beat, event.id),
    )


def _articulation_anchors(
    events: list[TrackPitchEvent],
    *,
    strong_beat_anchors: tuple[float, ...],
) -> tuple[float, ...]:
    anchors = {
        round(event.beat, 4)
        for event in events
        if event.duration_beats <= 1.0 or _is_near_integer_beat(event.beat)
    }
    anchors.update(strong_beat_anchors)
    return tuple(sorted(anchor for anchor in anchors if anchor >= 1.0))


def _dense_support_anchors(context: ArrangementContext) -> tuple[float, ...]:
    anchors = set(context.strong_beat_anchors)
    if context.context_density_events_per_measure >= 3.0 or context.repeated_motif_ratio >= 0.28:
        anchors.update(context.articulation_anchors)
    return tuple(sorted(anchors))


def _estimate_lead_slot(vocal_events_by_slot: dict[int, tuple[TrackPitchEvent, ...]]) -> int | None:
    if not vocal_events_by_slot:
        return None
    scored: list[tuple[float, int]] = []
    for slot_id, events in vocal_events_by_slot.items():
        if not events:
            continue
        pitch_values = [event.pitch_midi or 0 for event in events]
        pitch_span = max(pitch_values) - min(pitch_values)
        avg_duration = sum(event.duration_beats for event in events) / len(events)
        score = len(events) * 0.45 + pitch_span * 0.22 + (1 / max(0.25, avg_duration)) * 0.18
        scored.append((score, slot_id))
    return max(scored, default=(0, None), key=lambda item: item[0])[1]


def _estimate_active_voice_slot(vocal_events_by_slot: dict[int, tuple[TrackPitchEvent, ...]]) -> int | None:
    if not vocal_events_by_slot:
        return None
    return max(
        ((len(events), slot_id) for slot_id, events in vocal_events_by_slot.items()),
        default=(0, None),
        key=lambda item: item[0],
    )[1]


def _repeated_motif_ratio(events: list[TrackPitchEvent]) -> float:
    if len(events) < 3:
        return 0.0
    ordered = sorted(events, key=lambda event: (event.beat, event.id))
    repeated = 0
    for left, right in zip(ordered, ordered[1:], strict=False):
        same_pitch = left.pitch_midi is not None and left.pitch_midi == right.pitch_midi
        close_gap = abs(right.beat - (left.beat + max(RHYTHM_GRID_BEATS, left.duration_beats))) <= RHYTHM_GRID_BEATS
        same_duration = abs(left.duration_beats - right.duration_beats) <= RHYTHM_GRID_BEATS
        if (same_pitch and close_gap) or (close_gap and same_duration):
            repeated += 1
    return round(repeated / max(1, len(ordered) - 1), 3)


def _split_event_at_anchors(
    event: TrackPitchEvent,
    *,
    split_points: list[float],
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackPitchEvent]:
    points = [event.beat, *split_points, event.beat + event.duration_beats]
    pieces: list[TrackPitchEvent] = []
    for start, end in zip(points, points[1:], strict=False):
        duration = round(max(RHYTHM_GRID_BEATS, end - start), 4)
        if duration < RHYTHM_GRID_BEATS - GRID_TOLERANCE_BEATS:
            continue
        warnings = list(event.quality_warnings)
        if "ai_context_articulation_anchor" not in warnings:
            warnings.append("ai_context_articulation_anchor")
        pieces.append(
            event_from_pitch(
                beat=round(start, 4),
                duration_beats=duration,
                bpm=bpm,
                source=event.source,
                extraction_method=event.extraction_method,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                pitch_midi=event.pitch_midi,
                label=event.label,
                confidence=event.confidence,
                voice_index=event.voice_index,
                is_rest=event.is_rest,
                is_tied=False,
                quality_warnings=warnings,
            )
        )
    return pieces


def _candidate_measure_count(events: list[TrackPitchEvent], context: ArrangementContext) -> int:
    if not events:
        return context.measure_count
    measures = {event.measure_index for event in events if event.measure_index is not None}
    if measures:
        return max(1, len(measures))
    return max(1, int((max(event.beat + event.duration_beats for event in events) - 1) // context.beats_per_measure) + 1)


def _range_fit_ratio(target_slot_id: int, events: list[TrackPitchEvent]) -> float:
    if not events:
        return 0.0
    low, high = SLOT_RANGES.get(target_slot_id, (0, 127))
    in_range = sum(1 for event in events if event.pitch_midi is not None and low <= event.pitch_midi <= high)
    return in_range / len(events)


def _timing_grid_ratio(events: list[TrackPitchEvent]) -> float:
    if not events:
        return 0.0
    aligned = sum(
        1
        for event in events
        if _is_on_grid(event.beat) and _is_on_grid(event.duration_beats)
    )
    return aligned / len(events)


def _context_onset_match_ratio(events: list[TrackPitchEvent], anchors: tuple[float, ...]) -> float:
    if not events:
        return 0.0
    if not anchors:
        return 1.0
    matched = sum(1 for event in events if _has_nearby_anchor(event.beat, anchors))
    return matched / len(events)


def _context_onset_coverage_ratio(events: list[TrackPitchEvent], anchors: tuple[float, ...]) -> float:
    if not anchors:
        return 1.0 if events else 0.0
    event_beats = tuple(round(event.beat, 4) for event in events)
    covered = sum(1 for anchor in anchors if _has_nearby_anchor(anchor, event_beats))
    return covered / len(anchors)


def _long_sustain_ratio(events: list[TrackPitchEvent], beats_per_measure: float) -> float:
    if not events:
        return 0.0
    long_threshold = max(1.5, min(beats_per_measure, 2.0))
    long_events = sum(1 for event in events if event.duration_beats >= long_threshold)
    return long_events / len(events)


def _voice_crossing_count(target_slot_id: int, events: list[TrackPitchEvent], context: ArrangementContext) -> int:
    count = 0
    for event in events:
        active = _active_context_at(context.vocal_events_by_slot, event.beat)
        higher = [
            context_event.pitch_midi
            for slot_id, context_event in active.items()
            if slot_id < target_slot_id and context_event.pitch_midi is not None
        ]
        lower = [
            context_event.pitch_midi
            for slot_id, context_event in active.items()
            if slot_id > target_slot_id and context_event.pitch_midi is not None
        ]
        if event.pitch_midi is None:
            continue
        if higher and event.pitch_midi >= min(higher):
            count += 1
        elif lower and event.pitch_midi <= max(lower):
            count += 1
    return count


def _spacing_issue_count(target_slot_id: int, events: list[TrackPitchEvent], context: ArrangementContext) -> int:
    count = 0
    for event in events:
        if event.pitch_midi is None:
            continue
        active = _active_context_at(context.vocal_events_by_slot, event.beat)
        nearest_higher = _nearest_context_pitch(active, target_slot_id, direction=-1)
        nearest_lower = _nearest_context_pitch(active, target_slot_id, direction=1)
        if nearest_higher is not None:
            gap = nearest_higher - event.pitch_midi
            if target_slot_id in {2, 3, 4} and gap > 12:
                count += 1
            if gap < 2:
                count += 1
        if nearest_lower is not None:
            gap = event.pitch_midi - nearest_lower
            if target_slot_id in {1, 2, 3} and gap > 12:
                count += 1
            if gap < 2:
                count += 1
    return count


def _parallel_perfect_count(target_slot_id: int, events: list[TrackPitchEvent], context: ArrangementContext) -> int:
    count = 0
    ordered = [event for event in events if event.pitch_midi is not None]
    for previous, current in zip(ordered, ordered[1:], strict=False):
        target_motion = _motion_direction(previous.pitch_midi or 0, current.pitch_midi or 0)
        if target_motion == 0:
            continue
        previous_active = _active_context_at(context.vocal_events_by_slot, previous.beat)
        current_active = _active_context_at(context.vocal_events_by_slot, current.beat)
        for slot_id, current_context in current_active.items():
            if slot_id == target_slot_id or current_context.pitch_midi is None:
                continue
            previous_context = previous_active.get(slot_id)
            if previous_context is None or previous_context.pitch_midi is None:
                continue
            context_motion = _motion_direction(previous_context.pitch_midi, current_context.pitch_midi)
            if context_motion == 0 or context_motion != target_motion:
                continue
            previous_interval = abs((previous.pitch_midi or 0) - previous_context.pitch_midi) % 12
            current_interval = abs((current.pitch_midi or 0) - current_context.pitch_midi) % 12
            if previous_interval in {0, 7} and current_interval in {0, 7}:
                count += 1
    return count


def _structural_dissonance_count(target_slot_id: int, events: list[TrackPitchEvent], context: ArrangementContext) -> int:
    count = 0
    for index, event in enumerate(events):
        if event.pitch_midi is None or not _has_nearby_anchor(event.beat, context.strong_beat_anchors):
            continue
        active = _active_context_at(context.vocal_events_by_slot, event.beat)
        intervals = [
            abs(event.pitch_midi - (context_event.pitch_midi or event.pitch_midi)) % 12
            for slot_id, context_event in active.items()
            if slot_id != target_slot_id and context_event.pitch_midi is not None
        ]
        if not intervals or not any(interval in HARSH_STRUCTURAL_INTERVALS for interval in intervals):
            continue
        next_event = events[index + 1] if index + 1 < len(events) else None
        resolves_by_step = (
            next_event is not None
            and next_event.pitch_midi is not None
            and abs(next_event.pitch_midi - event.pitch_midi) <= 2
        )
        if not resolves_by_step:
            count += 1
    return count


def _large_leap_count(events: list[TrackPitchEvent]) -> int:
    return sum(
        1
        for previous, current in zip(events, events[1:], strict=False)
        if previous.pitch_midi is not None
        and current.pitch_midi is not None
        and abs(current.pitch_midi - previous.pitch_midi) > 7
    )


def _sibling_similarity_penalty(events: list[TrackPitchEvent], siblings: list[list[TrackPitchEvent]]) -> float:
    if not events or not siblings:
        return 0.0
    signature = _rhythm_pitch_signature(events)
    if not signature:
        return 0.0
    max_penalty = 0.0
    for sibling in siblings:
        sibling_signature = _rhythm_pitch_signature(sibling)
        if not sibling_signature:
            continue
        pair_count = min(len(signature), len(sibling_signature))
        same = sum(1 for index in range(pair_count) if signature[index] == sibling_signature[index])
        similarity = same / max(1, max(len(signature), len(sibling_signature)))
        max_penalty = max(max_penalty, max(0.0, similarity - 0.74) * 18)
    return max_penalty


def _role_fit_score(
    candidate_goal: DeepSeekCandidateDirection | None,
    *,
    target_slot_id: int,
    density: float,
    long_sustain_ratio: float,
    context: ArrangementContext,
) -> float:
    if candidate_goal is None:
        return _bounded_score(90 - max(0, long_sustain_ratio - 0.35) * 25)
    score = 92.0
    if candidate_goal.goal == "counterline":
        if density < max(1.2, context.context_density_events_per_measure * 0.35):
            score -= 16
        if long_sustain_ratio > 0.25:
            score -= 12
    elif candidate_goal.goal == "rehearsal_safe":
        if density > 8:
            score -= (density - 8) * 3
    elif candidate_goal.goal == "open_support":
        if target_slot_id not in {4, 5} and candidate_goal.register_bias == "low":
            score -= 8
        if density > 6:
            score -= (density - 6) * 2
    elif candidate_goal.goal == "upper_blend":
        if target_slot_id in {4, 5}:
            score -= 8
    elif candidate_goal.goal == "active_motion":
        if density < 2:
            score -= 12
    return _bounded_score(score)


def _quality_warnings(
    *,
    range_fit_ratio: float,
    timing_grid_ratio: float,
    coverage_ratio: float,
    expected_anchor_coverage: float,
    long_sustain_ratio: float,
    voice_crossing_count: int,
    spacing_issue_count: int,
    parallel_perfect_count: int,
    structural_dissonance_count: int,
    large_leap_count: int,
    sibling_similarity_penalty: float,
) -> list[str]:
    warnings: list[str] = []
    if timing_grid_ratio < 1:
        warnings.append("grid_contract_review")
    if range_fit_ratio < 0.95:
        warnings.append("range_outlier")
    if voice_crossing_count:
        warnings.append("voice_crossing")
    if parallel_perfect_count:
        warnings.append("parallel_motion")
    if structural_dissonance_count:
        warnings.append("unresolved_structural_tension")
    if spacing_issue_count:
        warnings.append("spacing_review")
    if coverage_ratio < expected_anchor_coverage:
        warnings.append("context_rhythm_mismatch")
    if long_sustain_ratio > 0.38:
        warnings.append("long_sustain_review")
    if large_leap_count >= 2:
        warnings.append("large_leap_review")
    if sibling_similarity_penalty > 0:
        warnings.append("similar_candidate")
    if coverage_ratio < 0.35 and long_sustain_ratio > 0.25:
        warnings.append("attack_shortage")
    return warnings


def _review_hint_for_report(report: CandidateQualityReport) -> str:
    if report.quality_score < 58:
        return "ai_regenerate_recommended"
    if "attack_shortage" in report.warnings or "long_sustain_review" in report.warnings:
        return "ai_articulation_review"
    if report.warnings:
        return "ai_arrangement_review"
    return "ai_candidate_ready"


def _quality_label(score: float, warnings: list[str]) -> str:
    if score < 58 or "grid_contract_review" in warnings or "voice_crossing" in warnings:
        return "재생성 권장"
    if score < 76 or warnings:
        return "확인 필요"
    return "추천 가능"


def _candidate_role_label(candidate_goal: DeepSeekCandidateDirection | None, target_slot_id: int) -> str:
    goal = candidate_goal.goal if candidate_goal is not None else "rehearsal_safe"
    if goal == "counterline":
        return "독립적인 움직임 후보"
    if goal == "open_support":
        return "안정적 받침 후보" if target_slot_id in {4, 5} else "넓은 화음 후보"
    if goal == "upper_blend":
        return "상성부 블렌드 후보"
    if goal == "active_motion":
        return "리듬 움직임 후보"
    return "원본 리듬 기반 후보"


def _candidate_selection_hint(candidate_goal: DeepSeekCandidateDirection | None) -> str:
    if candidate_goal is None:
        return "타 트랙 리듬과 화음을 기준으로 만든 기본 후보입니다."
    if candidate_goal.selection_hint:
        return candidate_goal.selection_hint
    return {
        "counterline": "기존 파트와 다른 움직임이 필요할 때 선택하세요.",
        "open_support": "합창 질감에 받침과 무게가 필요할 때 선택하세요.",
        "upper_blend": "상성부가 비어 있거나 밝은 블렌드가 필요할 때 선택하세요.",
        "active_motion": "리듬 에너지와 반복 hook이 필요할 때 선택하세요.",
    }.get(candidate_goal.goal, "가장 안전한 첫 연습용 후보입니다.")


def _active_context_at(
    events_by_slot: dict[int, tuple[TrackPitchEvent, ...]],
    beat: float,
) -> dict[int, TrackPitchEvent]:
    active: dict[int, TrackPitchEvent] = {}
    for slot_id, events in events_by_slot.items():
        candidates = [
            event
            for event in events
            if event.beat <= beat + GRID_TOLERANCE_BEATS
            and beat < event.beat + max(RHYTHM_GRID_BEATS, event.duration_beats) - GRID_TOLERANCE_BEATS
        ]
        if candidates:
            active[slot_id] = max(candidates, key=lambda event: (event.beat, event.duration_beats))
    return active


def _nearest_context_pitch(
    active: dict[int, TrackPitchEvent],
    target_slot_id: int,
    *,
    direction: int,
) -> int | None:
    if direction < 0:
        slots = sorted((slot_id for slot_id in active if slot_id < target_slot_id), reverse=True)
    else:
        slots = sorted(slot_id for slot_id in active if slot_id > target_slot_id)
    for slot_id in slots:
        pitch = active[slot_id].pitch_midi
        if pitch is not None:
            return pitch
    return None


def _rhythm_pitch_signature(events: list[TrackPitchEvent]) -> tuple[tuple[float, float, int | None], ...]:
    return tuple(
        (round(event.beat, 3), round(event.duration_beats, 3), event.pitch_midi)
        for event in sorted(events, key=lambda item: (item.beat, item.id))
        if not event.is_rest
    )


def _is_on_grid(value: float) -> bool:
    return abs(value / RHYTHM_GRID_BEATS - round(value / RHYTHM_GRID_BEATS)) <= GRID_TOLERANCE_BEATS


def _is_near_integer_beat(value: float) -> bool:
    return abs(value - round(value)) <= GRID_TOLERANCE_BEATS


def _has_nearby_anchor(beat: float, anchors: tuple[float, ...]) -> bool:
    return any(abs(beat - anchor) <= 0.031 for anchor in anchors)


def _motion_direction(previous_pitch: int, current_pitch: int) -> int:
    if current_pitch > previous_pitch:
        return 1
    if current_pitch < previous_pitch:
        return -1
    return 0


def _bounded_score(value: float) -> float:
    return max(0.0, min(100.0, value))
