from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import math
from typing import Iterable

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.event_normalization import normalize_track_events
from gigastudy_api.services.engine.music_theory import event_from_pitch, quarter_beats_per_measure
from gigastudy_api.services.engine.registration_policy import build_registration_grid_policy

PERCUSSION_SLOT_ID = 6
PERCUSSION_GENERATION_METHOD = "rule_based_vocal_percussion_v1"
PERCUSSION_SOURCE_LABEL = "Generated percussion groove"

_PERCUSSION_LABELS = {"Kick", "Snare", "Clap", "HatClosed", "HatOpen", "Rim"}


@dataclass(frozen=True)
class PercussionPatternRole:
    name: str
    title: str
    role: str
    selection_hint: str


@dataclass(frozen=True)
class PercussionContext:
    bpm: int
    time_signature_numerator: int
    time_signature_denominator: int
    grid_beats: float
    beats_per_measure: float
    steps_per_measure: int
    measure_count: int
    total_steps: int
    context_steps: frozenset[int]
    low_context_steps: frozenset[int]
    density_by_measure: dict[int, int]


PERCUSSION_PATTERN_ROLES: tuple[PercussionPatternRole, ...] = (
    PercussionPatternRole(
        name="steady_pulse",
        title="기본 박",
        role="다운비트 중심의 안정적인 퍼커션",
        selection_hint="처음 맞춰 부를 때 기준 박을 가장 분명하게 들려줍니다.",
    ),
    PercussionPatternRole(
        name="backbeat_support",
        title="백비트",
        role="스네어와 박수가 중심인 퍼커션",
        selection_hint="곡의 큰 박과 응답 지점을 또렷하게 잡아줍니다.",
    ),
    PercussionPatternRole(
        name="active_texture",
        title="촘촘한 리듬",
        role="하이햇과 림을 더한 움직임 있는 퍼커션",
        selection_hint="이미 성부가 충분히 채워진 구간에 리듬감을 더합니다.",
    ),
    PercussionPatternRole(
        name="sparse_support",
        title="여백 있는 박",
        role="필요한 박만 남긴 가벼운 퍼커션",
        selection_hint="느슨한 편곡이나 조용한 구간에 잘 맞습니다.",
    ),
    PercussionPatternRole(
        name="syncopated_lift",
        title="당김 리듬",
        role="앞박과 뒷박을 섞은 퍼커션",
        selection_hint="반복이 단조로울 때 작은 추진력을 더합니다.",
    ),
)


def generate_percussion_candidates(
    *,
    context_tracks: list[TrackPitchEvent],
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    context_events_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
    candidate_count: int = 3,
) -> list[list[TrackPitchEvent]]:
    context = build_percussion_context(
        context_tracks=context_tracks,
        context_events_by_slot=context_events_by_slot,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if context.total_steps <= 0:
        return []

    resolved_candidate_count = max(1, min(5, candidate_count))
    candidates: list[list[TrackPitchEvent]] = []
    for index in range(resolved_candidate_count):
        role = percussion_pattern_role(index + 1)
        generated = _generate_percussion_for_role(context, role)
        normalized = normalize_track_events(
            generated,
            bpm=bpm,
            slot_id=PERCUSSION_SLOT_ID,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=context.grid_beats,
            merge_adjacent_same_pitch=False,
        )
        candidates.append(normalized)
    return candidates


def build_percussion_context(
    *,
    context_tracks: list[TrackPitchEvent],
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    context_events_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
) -> PercussionContext:
    policy = build_registration_grid_policy(
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    grid_beats = policy.rhythm_grid_beats
    beats_per_measure = quarter_beats_per_measure(
        time_signature_numerator,
        time_signature_denominator,
    )
    steps_per_measure = max(1, round(beats_per_measure / grid_beats))
    events = [event for event in context_tracks if not event.is_rest]
    max_end_beat = max(
        (event.beat + max(grid_beats, event.duration_beats) for event in events),
        default=1 + beats_per_measure,
    )
    measure_count = max(1, math.ceil(max(0.0, max_end_beat - 1) / beats_per_measure - 0.0001))
    total_steps = max(1, measure_count * steps_per_measure)

    context_steps = frozenset(
        _step_from_beat(event.beat, grid_beats)
        for event in events
        if 0 <= _step_from_beat(event.beat, grid_beats) < total_steps
    )
    low_context_steps = frozenset(
        _context_steps_for_slots(
            context_events_by_slot or {},
            low_slots={4, 5},
            grid_beats=grid_beats,
            total_steps=total_steps,
        )
    )
    density_counter: Counter[int] = Counter()
    for step in context_steps:
        density_counter[step // steps_per_measure] += 1

    return PercussionContext(
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        grid_beats=grid_beats,
        beats_per_measure=beats_per_measure,
        steps_per_measure=steps_per_measure,
        measure_count=measure_count,
        total_steps=total_steps,
        context_steps=context_steps,
        low_context_steps=low_context_steps,
        density_by_measure=dict(density_counter),
    )


def percussion_pattern_role(candidate_index: int) -> PercussionPatternRole:
    return PERCUSSION_PATTERN_ROLES[(max(1, candidate_index) - 1) % len(PERCUSSION_PATTERN_ROLES)]


def percussion_candidate_variant_label(candidate_index: int, events: list[TrackPitchEvent]) -> str:
    role = percussion_pattern_role(candidate_index)
    counts = Counter(event.label for event in events if not event.is_rest)
    dominant = max(
        _PERCUSSION_LABELS,
        key=lambda label: (counts[label], label == "Kick", label),
    )
    dominant_label = {
        "Kick": "킥 중심",
        "Snare": "스네어 중심",
        "Clap": "박수 중심",
        "HatClosed": "하이햇 중심",
        "HatOpen": "열린 하이햇",
        "Rim": "림 중심",
    }.get(dominant, dominant)
    return f"{role.title} - {dominant_label}"


def percussion_candidate_diagnostics(
    *,
    candidate_index: int,
    events: list[TrackPitchEvent],
    context_events_by_slot: dict[int, list[TrackPitchEvent]] | None,
) -> dict[str, object]:
    role = percussion_pattern_role(candidate_index)
    labels = [event.label for event in events if not event.is_rest]
    counts = Counter(labels)
    context_event_count = sum(len(track_events) for track_events in (context_events_by_slot or {}).values())
    measure_indices = {event.measure_index for event in events if event.measure_index is not None}
    measure_count = max(1, len(measure_indices))
    context_step_hits = {
        round(event.beat, 4)
        for track_events in (context_events_by_slot or {}).values()
        for event in track_events
        if not event.is_rest
    }
    candidate_step_hits = {round(event.beat, 4) for event in events if not event.is_rest}
    context_onset_coverage = (
        len(context_step_hits & candidate_step_hits) / len(context_step_hits)
        if context_step_hits
        else None
    )
    return {
        "candidate_role": role.role,
        "selection_hint": role.selection_hint,
        "percussion_pattern_role": role.name,
        "percussion_kick_count": counts["Kick"],
        "percussion_snare_count": counts["Snare"],
        "percussion_clap_count": counts["Clap"],
        "percussion_hat_count": counts["HatClosed"] + counts["HatOpen"],
        "percussion_rim_count": counts["Rim"],
        "percussion_density_per_measure": round(len(labels) / measure_count, 2),
        "percussion_context_event_count": context_event_count,
        "review_hint": None,
        "context_onset_coverage_ratio": (
            None if context_onset_coverage is None else round(context_onset_coverage, 3)
        ),
    }


def _generate_percussion_for_role(
    context: PercussionContext,
    role: PercussionPatternRole,
) -> list[TrackPitchEvent]:
    events: list[TrackPitchEvent] = []
    for step in range(context.total_steps):
        label = _hit_for_step(context, role, step)
        if label is None:
            continue
        beat = round(step * context.grid_beats + 1, 4)
        events.append(
            event_from_pitch(
                beat=beat,
                duration_beats=context.grid_beats,
                bpm=context.bpm,
                source="ai",
                extraction_method=PERCUSSION_GENERATION_METHOD,
                time_signature_numerator=context.time_signature_numerator,
                time_signature_denominator=context.time_signature_denominator,
                label=label,
                confidence=0.78,
                quantization_grid=context.grid_beats,
            )
        )
    return events


def _hit_for_step(context: PercussionContext, role: PercussionPatternRole, step: int) -> str | None:
    measure_step = step % context.steps_per_measure
    measure_index = step // context.steps_per_measure
    density = context.density_by_measure.get(measure_index, 0)
    sparse_measure = density <= 1
    dense_measure = density >= max(4, context.steps_per_measure // 3)
    downbeat = measure_step == 0
    midpoint = _midpoint_step(context)
    backbeats = _backbeat_steps(context)
    eighth_interval = _eighth_interval_steps(context)
    quarter_interval = _quarter_interval_steps(context)
    final_eighth = max(0, context.steps_per_measure - eighth_interval)
    low_anchor = _near_step(step, context.low_context_steps, tolerance=1)
    context_anchor = _near_step(step, context.context_steps, tolerance=1)

    if role.name == "steady_pulse":
        if downbeat:
            return "Kick"
        if measure_step == midpoint:
            return "Snare"
        if not sparse_measure and measure_step % quarter_interval == 0:
            return "HatClosed"
        return None

    if role.name == "backbeat_support":
        if downbeat or (low_anchor and measure_step not in backbeats):
            return "Kick"
        if measure_step in backbeats:
            return "Clap" if dense_measure else "Snare"
        if measure_step == final_eighth and not sparse_measure:
            return "HatOpen"
        if not sparse_measure and measure_step % eighth_interval == 0:
            return "HatClosed"
        return None

    if role.name == "active_texture":
        if downbeat or low_anchor:
            return "Kick"
        if measure_step in backbeats:
            return "Snare"
        if context_anchor and measure_step % eighth_interval != 0:
            return "Rim"
        if measure_step == final_eighth:
            return "HatOpen"
        if measure_step % eighth_interval == 0:
            return "HatClosed"
        return None

    if role.name == "sparse_support":
        if downbeat:
            return "Kick"
        if not sparse_measure and measure_step == midpoint:
            return "Clap"
        if dense_measure and measure_step == final_eighth:
            return "HatClosed"
        return None

    if downbeat or (low_anchor and measure_step % eighth_interval == 0):
        return "Kick"
    if measure_step in backbeats:
        return "Snare"
    syncopated_step = (measure_step + 1) % max(1, quarter_interval) == 0
    if context_anchor and syncopated_step:
        return "Rim"
    if not sparse_measure and measure_step % eighth_interval == 0:
        return "HatClosed"
    return None


def _step_from_beat(beat: float, grid_beats: float) -> int:
    return round((max(1.0, beat) - 1) / max(0.0001, grid_beats))


def _context_steps_for_slots(
    context_events_by_slot: dict[int, list[TrackPitchEvent]],
    *,
    low_slots: set[int],
    grid_beats: float,
    total_steps: int,
) -> Iterable[int]:
    for slot_id, events in context_events_by_slot.items():
        if slot_id not in low_slots:
            continue
        for event in events:
            if event.is_rest:
                continue
            step = _step_from_beat(event.beat, grid_beats)
            if 0 <= step < total_steps:
                yield step


def _midpoint_step(context: PercussionContext) -> int:
    return max(1, min(context.steps_per_measure - 1, round(context.steps_per_measure / 2)))


def _backbeat_steps(context: PercussionContext) -> set[int]:
    quarter = _quarter_interval_steps(context)
    if context.time_signature_denominator == 4:
        if context.time_signature_numerator >= 4:
            return {step for step in (quarter, quarter * 3) if 0 < step < context.steps_per_measure}
        if context.time_signature_numerator == 3:
            return {quarter}
    return {_midpoint_step(context)}


def _quarter_interval_steps(context: PercussionContext) -> int:
    return max(1, round(1 / context.grid_beats))


def _eighth_interval_steps(context: PercussionContext) -> int:
    return max(1, round(0.5 / context.grid_beats))


def _near_step(step: int, candidates: frozenset[int], *, tolerance: int) -> bool:
    return any(abs(step - candidate) <= tolerance for candidate in candidates)
