from __future__ import annotations

from typing import Any

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import SLOT_RANGES, midi_to_label, track_name
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile


def track_duration_seconds(events: list[TrackPitchEvent]) -> float:
    if not events:
        return 0
    return round(max(event.onset_seconds + event.duration_seconds for event in events), 4)


def parsed_track_diagnostics_by_slot(
    parsed_symbolic: ParsedSymbolicFile,
    *,
    method: str,
    fallback_method: str,
) -> dict[int, dict[str, Any]]:
    diagnostics_by_slot: dict[int, dict[str, Any]] = {}
    for parsed_track in parsed_symbolic.tracks:
        if parsed_track.slot_id is None or not parsed_track.events:
            continue
        diagnostics = dict(parsed_track.diagnostics)
        diagnostics.setdefault("engine", method)
        diagnostics.setdefault("candidate_method", fallback_method)
        diagnostics.setdefault("part_name", parsed_track.name)
        diagnostics_by_slot[parsed_track.slot_id] = diagnostics
    return diagnostics_by_slot


def candidate_diagnostics(
    slot_id: int,
    events: list[TrackPitchEvent],
    *,
    method: str,
    confidence: float,
    source_diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    diagnostics = dict(source_diagnostics or {})
    pitched_events = [
        event
        for event in events
        if not event.is_rest and event.pitch_midi is not None
    ]
    measure_indices = {
        event.measure_index
        for event in events
        if event.measure_index is not None
    }
    duration_seconds = track_duration_seconds(events) if events else 0
    measure_count = len(measure_indices)
    if measure_count == 0 and events:
        measure_count = max(1, int(max(event.beat + event.duration_beats for event in events) // 4) + 1)
    avg_event_confidence = sum(event.confidence for event in events) / len(events) if events else 0
    range_fit_ratio = candidate_range_fit_ratio(slot_id, pitched_events)
    timing_grid_ratio = candidate_timing_grid_ratio(events)
    event_count = len(events)
    diagnostics.update(
        {
            "candidate_method": method,
            "track": track_name(slot_id),
            "event_count": event_count,
            "pitched_event_count": len(pitched_events),
            "rest_event_count": event_count - len(pitched_events),
            "measure_count": measure_count,
            "duration_seconds": round(duration_seconds, 3),
            "range": candidate_range_label(pitched_events),
            "avg_event_confidence": round(avg_event_confidence, 3),
            "range_fit_ratio": round(range_fit_ratio, 3),
            "timing_grid_ratio": round(timing_grid_ratio, 3),
            "density_events_per_measure": round(event_count / max(1, measure_count), 2),
            "confidence_label": confidence_label(confidence),
            "review_hint": diagnostics.get("review_hint")
            or review_hint_for_candidate(
                method=method,
                event_count=event_count,
                range_fit_ratio=range_fit_ratio,
                timing_grid_ratio=timing_grid_ratio,
                avg_event_confidence=avg_event_confidence,
            ),
        }
    )
    return diagnostics


def estimate_candidate_confidence(
    slot_id: int,
    events: list[TrackPitchEvent],
    *,
    method: str,
    fallback_confidence: float,
    diagnostics: dict[str, Any] | None = None,
) -> float:
    if not events:
        return 0

    if method.startswith("audiveris"):
        base = max(fallback_confidence, 0.62)
    elif method.startswith("pdf_vector"):
        base = max(fallback_confidence, 0.44)
    elif method.startswith("voice"):
        base = max(fallback_confidence, 0.4)
    else:
        base = fallback_confidence

    avg_event_confidence = sum(event.confidence for event in events) / len(events)
    range_fit_ratio = diagnostic_float(
        diagnostics,
        "range_fit_ratio",
        default=candidate_range_fit_ratio(slot_id, [event for event in events if event.pitch_midi is not None]),
    )
    timing_grid_ratio = diagnostic_float(
        diagnostics,
        "timing_grid_ratio",
        default=candidate_timing_grid_ratio(events),
    )
    measure_count = diagnostic_int(diagnostics, "measure_count", default=0)

    event_volume_bonus = min(0.12, len(events) / 1200)
    measure_bonus = min(0.08, measure_count / 80)
    confidence = (
        base * 0.52
        + avg_event_confidence * 0.3
        + range_fit_ratio * 0.12
        + timing_grid_ratio * 0.06
        + event_volume_bonus
        + measure_bonus
    )
    if len(events) < 4:
        confidence -= 0.08
    if range_fit_ratio < 0.85:
        confidence -= (0.85 - range_fit_ratio) * 0.16
    if timing_grid_ratio < 0.75:
        confidence -= (0.75 - timing_grid_ratio) * 0.08
    return round(max(0.15, min(0.92, confidence)), 3)


def candidate_review_message(
    slot_id: int,
    events: list[TrackPitchEvent],
    *,
    method: str,
    diagnostics: dict[str, Any] | None,
    default_message: str | None,
) -> str | None:
    if not events:
        return default_message
    if diagnostics is None:
        diagnostics = candidate_diagnostics(
            slot_id,
            events,
            method=method,
            confidence=0.5,
        )
    event_count = diagnostic_int(
        diagnostics,
        "event_count",
        default=len(events),
    )
    measure_count = diagnostic_int(diagnostics, "measure_count", default=0)
    candidate_confidence_label = str(diagnostics.get("confidence_label") or "review")
    hint = str(diagnostics.get("review_hint") or "")
    hint_label = review_hint_label(hint)
    if method.startswith("pdf_vector"):
        return (
            f"{track_name(slot_id)}: extracted {event_count} events across "
            f"{measure_count} measures from vector PDF. {candidate_confidence_label}; {hint_label}"
        )
    if method.startswith("audiveris"):
        return (
            f"{track_name(slot_id)}: extracted {event_count} events across "
            f"{measure_count} measures from Audiveris MusicXML. {candidate_confidence_label}; review against source."
        )
    return default_message


def generation_variant_label(index: int, slot_id: int, events: list[TrackPitchEvent]) -> str:
    if slot_id == 6:
        return percussion_variant_label(index, events)

    pitched_events = [
        event
        for event in events
        if event.pitch_midi is not None and not event.is_rest
    ]
    if not pitched_events:
        return f"Candidate {index}"

    midi_values = [event.pitch_midi for event in pitched_events if event.pitch_midi is not None]
    average_midi = sum(midi_values) / len(midi_values)
    low, high = SLOT_RANGES.get(slot_id, (min(midi_values), max(midi_values)))
    slot_center = (low + high) / 2
    if average_midi < slot_center - 2:
        register_label = "Lower support"
    elif average_midi > slot_center + 2:
        register_label = "Upper blend"
    else:
        register_label = "Balanced"

    intervals = [
        abs(midi_values[index] - midi_values[index - 1])
        for index in range(1, len(midi_values))
    ]
    average_step = sum(intervals) / len(intervals) if intervals else 0
    leap_count = sum(1 for interval in intervals if interval >= 5)
    if average_step <= 1.25:
        motion_label = "stepwise"
    elif leap_count >= 2:
        motion_label = "active leaps"
    else:
        motion_label = "gentle motion"

    contour_delta = midi_values[-1] - midi_values[0]
    if contour_delta >= 3:
        contour_label = "rising"
    elif contour_delta <= -3:
        contour_label = "falling"
    else:
        contour_label = "level"

    average_label = midi_to_label(round(average_midi))
    return f"{register_label} {motion_label} - {contour_label} - avg {average_label}"


def percussion_variant_label(index: int, events: list[TrackPitchEvent]) -> str:
    labels = [event.label for event in events[:8]]
    kick_count = labels.count("Kick")
    snare_count = labels.count("Snare")
    if kick_count > snare_count:
        feel = "kick-led"
    elif snare_count > kick_count:
        feel = "snare-led"
    else:
        feel = "balanced"
    return f"Groove {index} - {feel}"


def diagnostic_float(diagnostics: dict[str, Any] | None, key: str, *, default: float) -> float:
    if diagnostics is None:
        return default
    value = diagnostics.get(key)
    return float(value) if isinstance(value, (int, float)) else default


def diagnostic_int(diagnostics: dict[str, Any] | None, key: str, *, default: int) -> int:
    if diagnostics is None:
        return default
    value = diagnostics.get(key)
    return int(value) if isinstance(value, (int, float)) else default


def candidate_range_fit_ratio(slot_id: int, events: list[TrackPitchEvent]) -> float:
    pitched = [event for event in events if event.pitch_midi is not None]
    if not pitched:
        return 0
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    in_range = [
        event
        for event in pitched
        if event.pitch_midi is not None and low <= event.pitch_midi <= high
    ]
    return len(in_range) / len(pitched)


def candidate_timing_grid_ratio(events: list[TrackPitchEvent]) -> float:
    if not events:
        return 0
    aligned = 0
    for event in events:
        beat_aligned = abs(event.beat * 4 - round(event.beat * 4)) <= 0.03
        duration_aligned = abs(event.duration_beats * 4 - round(event.duration_beats * 4)) <= 0.03
        if beat_aligned and duration_aligned:
            aligned += 1
    return aligned / len(events)


def candidate_range_label(events: list[TrackPitchEvent]) -> str:
    midi_pitchs = [
        event
        for event in events
        if event.pitch_midi is not None
    ]
    if not midi_pitchs:
        return "-"
    sorted_events = sorted(midi_pitchs, key=lambda event: event.pitch_midi or 0)
    return f"{sorted_events[0].label} - {sorted_events[-1].label}"


def confidence_label(confidence: float) -> str:
    if confidence >= 0.72:
        return "high confidence"
    if confidence >= 0.5:
        return "medium confidence"
    return "low confidence"


def review_hint_for_candidate(
    *,
    method: str,
    event_count: int,
    range_fit_ratio: float,
    timing_grid_ratio: float,
    avg_event_confidence: float,
) -> str:
    if event_count < 4:
        return "few_events"
    if avg_event_confidence < 0.52:
        return "low_event_confidence"
    if range_fit_ratio < 0.85:
        return "range_outliers"
    if timing_grid_ratio < 0.82:
        return "rhythm_grid_review"
    if method.startswith("pdf_vector"):
        return "review_accidentals_and_rhythm"
    return "review_against_source"


def review_hint_label(hint: str) -> str:
    return {
        "few_events": "Few events were detected; confirm the part assignment.",
        "low_event_confidence": "Event confidence is low; compare against the source.",
        "range_outliers": "Some events sit outside the target range; confirm the track.",
        "rhythm_grid_review": "Rhythm grid is unstable; review timing against the source.",
        "partial_document_review": "Only part of the document was detected; check missing parts.",
        "review_accidentals_and_rhythm": "Review accidentals and rhythm against the source.",
        "review_against_source": "Review against the source before approval.",
    }.get(hint, "Review against the source before approval.")
