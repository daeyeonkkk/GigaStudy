from __future__ import annotations

from dataclasses import asdict, dataclass
from math import ceil
from typing import Any

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import SLOT_RANGES
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile


DOCUMENT_QUALITY_LOW_MESSAGE = (
    "파트나 음표를 충분히 찾지 못했습니다. 더 선명한 악보 PDF, MIDI, MusicXML을 사용해 주세요."
)


@dataclass(frozen=True)
class DocumentQualityAssessment:
    score: float
    reason: str
    passed: bool
    review_recommended: bool
    mapped_track_count: int
    event_count: int
    grid_alignment_ratio: float
    range_fit_ratio: float
    overlap_rate: float
    measure_consistency_ratio: float
    selected_method: str

    def diagnostics(self) -> dict[str, Any]:
        return asdict(self)


def assess_document_symbolic_quality(
    parsed_symbolic: ParsedSymbolicFile,
    *,
    min_score: float,
    selected_method: str,
) -> DocumentQualityAssessment:
    mapped_events = {
        slot_id: events
        for slot_id, events in parsed_symbolic.mapped_events.items()
        if events
    }
    all_events = [event for events in mapped_events.values() for event in events]
    if not all_events:
        return DocumentQualityAssessment(
            score=0,
            reason="no_events",
            passed=False,
            review_recommended=False,
            mapped_track_count=0,
            event_count=0,
            grid_alignment_ratio=0,
            range_fit_ratio=0,
            overlap_rate=1,
            measure_consistency_ratio=0,
            selected_method=selected_method,
        )

    mapped_track_count = len(mapped_events)
    event_count = len(all_events)
    grid_alignment_ratio = _grid_alignment_ratio(all_events)
    range_fit_ratio = _range_fit_ratio(mapped_events)
    overlap_rate = _overlap_rate(mapped_events)
    measure_consistency_ratio = _measure_consistency_ratio(mapped_events)

    track_factor = min(1.0, mapped_track_count / 4)
    event_factor = min(1.0, event_count / max(4, mapped_track_count * 2))
    no_overlap_factor = max(0.0, 1.0 - overlap_rate)
    score = (
        track_factor * 0.20
        + event_factor * 0.20
        + grid_alignment_ratio * 0.20
        + range_fit_ratio * 0.15
        + no_overlap_factor * 0.15
        + measure_consistency_ratio * 0.10
    )
    score = round(max(0.0, min(1.0, score)), 3)
    reason = _quality_reason(
        event_count=event_count,
        grid_alignment_ratio=grid_alignment_ratio,
        range_fit_ratio=range_fit_ratio,
        overlap_rate=overlap_rate,
        score=score,
        min_score=min_score,
    )
    passed = score >= min_score and reason == "usable"
    return DocumentQualityAssessment(
        score=score,
        reason=reason,
        passed=passed,
        review_recommended=not passed or score < 0.72,
        mapped_track_count=mapped_track_count,
        event_count=event_count,
        grid_alignment_ratio=round(grid_alignment_ratio, 3),
        range_fit_ratio=round(range_fit_ratio, 3),
        overlap_rate=round(overlap_rate, 3),
        measure_consistency_ratio=round(measure_consistency_ratio, 3),
        selected_method=selected_method,
    )


def public_document_quality_message(reason: str) -> str:
    return {
        "no_events": "음표를 충분히 찾지 못했습니다. 더 선명한 악보 PDF, MIDI, MusicXML을 사용해 주세요.",
        "too_few_events": "등록할 수 있는 음표가 너무 적습니다. 악보 PDF, MIDI, MusicXML을 사용해 주세요.",
        "poor_grid_alignment": "음표 위치를 안정적으로 맞추지 못했습니다. MIDI 또는 MusicXML을 사용하면 더 정확합니다.",
        "heavy_overlap": "같은 파트 안에서 음표가 많이 겹쳐 등록하기 어렵습니다. MIDI 또는 MusicXML을 사용해 주세요.",
        "low_range_fit": "파트별 음역 판단이 불안정합니다. 후보를 만들기 어렵습니다.",
        "low_score": DOCUMENT_QUALITY_LOW_MESSAGE,
    }.get(reason, DOCUMENT_QUALITY_LOW_MESSAGE)


def _quality_reason(
    *,
    event_count: int,
    grid_alignment_ratio: float,
    range_fit_ratio: float,
    overlap_rate: float,
    score: float,
    min_score: float,
) -> str:
    if event_count <= 0:
        return "no_events"
    if event_count < 2:
        return "too_few_events"
    if overlap_rate > 0.18:
        return "heavy_overlap"
    if grid_alignment_ratio < 0.65:
        return "poor_grid_alignment"
    if range_fit_ratio < 0.55:
        return "low_range_fit"
    if score < min_score:
        return "low_score"
    return "usable"


def _grid_alignment_ratio(events: list[TrackPitchEvent]) -> float:
    if not events:
        return 0
    aligned = 0
    for event in events:
        beat_aligned = abs(event.beat * 4 - round(event.beat * 4)) <= 0.03
        duration_aligned = abs(event.duration_beats * 4 - round(event.duration_beats * 4)) <= 0.03
        if beat_aligned and duration_aligned:
            aligned += 1
    return aligned / len(events)


def _range_fit_ratio(mapped_events: dict[int, list[TrackPitchEvent]]) -> float:
    pitched: list[tuple[int, TrackPitchEvent]] = []
    for slot_id, events in mapped_events.items():
        pitched.extend(
            (slot_id, event)
            for event in events
            if not event.is_rest and event.pitch_midi is not None
        )
    if not pitched:
        return 0
    fit_count = 0
    for slot_id, event in pitched:
        low, high = SLOT_RANGES.get(slot_id, (0, 127))
        if event.pitch_midi is not None and low <= event.pitch_midi <= high:
            fit_count += 1
    return fit_count / len(pitched)


def _overlap_rate(mapped_events: dict[int, list[TrackPitchEvent]]) -> float:
    pair_count = 0
    overlap_count = 0
    for events in mapped_events.values():
        sorted_events = sorted(events, key=lambda event: (event.beat, event.duration_beats))
        for index in range(len(sorted_events) - 1):
            current = sorted_events[index]
            next_event = sorted_events[index + 1]
            pair_count += 1
            current_end = current.beat + max(0.0, current.duration_beats)
            if next_event.beat < current_end - 0.03:
                overlap_count += 1
    if pair_count == 0:
        return 0
    return overlap_count / pair_count


def _measure_consistency_ratio(mapped_events: dict[int, list[TrackPitchEvent]]) -> float:
    if not mapped_events:
        return 0
    counts: list[int] = []
    for events in mapped_events.values():
        explicit_measures = [
            event.measure_index
            for event in events
            if event.measure_index is not None
        ]
        if explicit_measures:
            counts.append(max(explicit_measures))
            continue
        max_beat = max((event.beat + max(0.0, event.duration_beats) for event in events), default=1)
        counts.append(max(1, ceil(max_beat / 4)))
    if len(counts) <= 1:
        return 1
    return min(counts) / max(counts)
