from __future__ import annotations

from gigastudy_api.api.schemas.studios import ReportIssue
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import seconds_per_beat


def with_region_event_coordinates(
    issues: list[ReportIssue],
    *,
    target_slot_id: int,
    answer_events: list[TrackPitchEvent],
    performance_events: list[TrackPitchEvent],
    alignment_offset_seconds: float,
    bpm: int,
) -> list[ReportIssue]:
    answer_by_id = {event.id: event for event in answer_events}
    performance_by_id = {event.id: event for event in performance_events}
    answer_region_id = track_region_id(target_slot_id)
    performance_region_id = performance_region_id_for_slot(target_slot_id)
    beat_offset = alignment_offset_seconds / seconds_per_beat(bpm)

    annotated: list[ReportIssue] = []
    for issue in issues:
        updates: dict[str, object] = {}
        if issue.answer_source_event_id and (answer_event := answer_by_id.get(issue.answer_source_event_id)):
            answer_focus_region_id = focus_region_id(answer_event, answer_region_id)
            updates["answer_region_id"] = answer_focus_region_id
            updates["answer_event_id"] = focus_event_id(answer_event, answer_focus_region_id)
            updates["expected_beat"] = round(answer_event.beat, 4)
        if issue.performance_source_event_id and (
            performance_event := performance_by_id.get(issue.performance_source_event_id)
        ):
            performance_focus_region_id = focus_region_id(performance_event, performance_region_id)
            updates["performance_region_id"] = performance_focus_region_id
            updates["performance_event_id"] = focus_event_id(performance_event, performance_focus_region_id)
            updates["actual_beat"] = round(max(1.0, performance_event.beat - beat_offset), 4)
        annotated.append(issue.model_copy(update=updates))
    return annotated


def focus_region_id(event: TrackPitchEvent, fallback_region_id: str) -> str:
    return event.region_id or fallback_region_id


def focus_event_id(event: TrackPitchEvent, region_id: str) -> str:
    if event.region_event_id:
        return event.region_event_id
    if event.id.startswith(f"{region_id}-"):
        return event.id
    return f"{region_id}-{event.id}"


def track_region_id(slot_id: int) -> str:
    return f"track-{slot_id}-region-1"


def performance_region_id_for_slot(slot_id: int) -> str:
    return f"performance-{slot_id}-region-1"
