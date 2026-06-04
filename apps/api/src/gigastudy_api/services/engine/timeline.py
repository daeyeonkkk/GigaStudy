from __future__ import annotations

from gigastudy_api.api.schemas.studios import ArrangementRegion, Studio
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import seconds_per_beat


def events_with_sync_offset(
    events: list[TrackPitchEvent],
    sync_offset_seconds: float,
    bpm: int,
    *,
    voice_index: int | None = None,
) -> list[TrackPitchEvent]:
    beat_offset = sync_offset_seconds / seconds_per_beat(bpm)
    return [
        event.model_copy(
            update={
                "onset_seconds": round(event.onset_seconds + sync_offset_seconds, 4),
                "beat": round(event.beat + beat_offset, 4),
                "voice_index": voice_index if event.voice_index is None else event.voice_index,
            }
        )
        for event in events
    ]


def events_from_region(region: ArrangementRegion, *, bpm: int) -> list[TrackPitchEvent]:
    beat_offset = region.start_seconds / seconds_per_beat(bpm)
    return [
        TrackPitchEvent(
            id=event.event_id,
            pitch_midi=event.pitch_midi,
            pitch_hz=event.pitch_hz,
            label=event.label,
            onset_seconds=round(event.start_seconds, 4),
            duration_seconds=round(event.duration_seconds, 4),
            beat=round(event.start_beat + beat_offset, 4),
            duration_beats=event.duration_beats,
            measure_index=event.measure_index,
            beat_in_measure=event.beat_in_measure,
            confidence=event.confidence,
            source=event.source,
            extraction_method=event.extraction_method,
            is_rest=event.is_rest,
            voice_index=event.track_slot_id,
            region_id=region.region_id,
            region_event_id=event.event_id,
            quality_warnings=list(event.quality_warnings),
        )
        for event in sorted(region.pitch_events, key=lambda item: (item.start_beat, item.event_id))
    ]


def registered_region_events_for_slot(studio: Studio, slot_id: int) -> list[TrackPitchEvent]:
    regions = sorted(
        (
            candidate
            for candidate in studio.regions
            if candidate.track_slot_id == slot_id and candidate.pitch_events
        ),
        key=lambda region: (region.start_seconds, region.region_id),
    )
    if regions:
        return [
            event
            for region in regions
            for event in events_from_region(region, bpm=studio.bpm)
        ]

    track = next((candidate for candidate in studio.tracks if candidate.slot_id == slot_id), None)
    if track is None or track.status != "registered" or not track.events:
        return []
    return events_with_sync_offset(
        track.events,
        track.sync_offset_seconds,
        studio.bpm,
        voice_index=track.slot_id,
    )


def registered_region_events_by_slot(
    studio: Studio,
    *,
    exclude_slot_id: int | None = None,
) -> dict[int, list[TrackPitchEvent]]:
    events_by_slot: dict[int, list[TrackPitchEvent]] = {}
    for track in studio.tracks:
        if track.slot_id == exclude_slot_id or track.status != "registered":
            continue
        events = registered_region_events_for_slot(studio, track.slot_id)
        if events:
            events_by_slot[track.slot_id] = events
    return events_by_slot
