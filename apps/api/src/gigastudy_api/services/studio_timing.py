from __future__ import annotations

from math import isfinite

from gigastudy_api.api.schemas.studios import ArrangementRegion, Studio, TempoChange
from gigastudy_api.services.engine.music_theory import quarter_beats_per_measure


def normalize_tempo_changes(
    changes: list[TempoChange] | None,
    *,
    base_bpm: int,
) -> list[TempoChange]:
    latest_by_measure: dict[int, int] = {}
    for change in changes or []:
        if change.bpm == base_bpm:
            latest_by_measure.pop(change.measure_index, None)
            continue
        latest_by_measure[change.measure_index] = change.bpm
    return [
        TempoChange(measure_index=measure_index, bpm=bpm)
        for measure_index, bpm in sorted(latest_by_measure.items())
    ]


def retime_studio_regions(
    studio: Studio,
    *,
    old_bpm: int,
    old_tempo_changes: list[TempoChange],
) -> None:
    beats_per_measure = quarter_beats_per_measure(
        studio.time_signature_numerator,
        studio.time_signature_denominator,
    )
    new_tempo_changes = studio.tempo_changes
    affected_slot_ids: set[int] = set()
    for region in studio.regions:
        if not _region_should_retime(region):
            continue
        region_start_beat = seconds_to_beat(
            region.start_seconds,
            bpm=old_bpm,
            tempo_changes=old_tempo_changes,
            beats_per_measure=beats_per_measure,
        )
        region.start_seconds = round(
            beat_to_seconds(
                region_start_beat,
                bpm=studio.bpm,
                tempo_changes=new_tempo_changes,
                beats_per_measure=beats_per_measure,
            ),
            4,
        )
        region.sync_offset_seconds = region.start_seconds
        event_end_seconds = region.start_seconds
        for event in region.pitch_events:
            relative_start_beat = max(0.0, event.start_beat - 1)
            absolute_start_beat = region_start_beat + relative_start_beat
            duration_beats = max(0.01, event.duration_beats)
            event.start_seconds = round(
                beat_to_seconds(
                    absolute_start_beat,
                    bpm=studio.bpm,
                    tempo_changes=new_tempo_changes,
                    beats_per_measure=beats_per_measure,
                ),
                4,
            )
            event.duration_seconds = round(
                max(
                    0.08,
                    duration_seconds_for_beats(
                        absolute_start_beat,
                        duration_beats,
                        bpm=studio.bpm,
                        tempo_changes=new_tempo_changes,
                        beats_per_measure=beats_per_measure,
                    ),
                ),
                4,
            )
            event_end_seconds = max(event_end_seconds, event.start_seconds + event.duration_seconds)
        region.duration_seconds = round(max(0.08, event_end_seconds - region.start_seconds), 4)
        affected_slot_ids.add(region.track_slot_id)

    for track in studio.tracks:
        slot_regions = [region for region in studio.regions if region.track_slot_id == track.slot_id]
        if track.slot_id not in affected_slot_ids or not slot_regions:
            continue
        track.duration_seconds = round(
            max(region.start_seconds + region.duration_seconds for region in slot_regions),
            4,
        )
        track.sync_offset_seconds = round(min(region.start_seconds for region in slot_regions), 3)


def beat_to_seconds(
    beat: float,
    *,
    bpm: int,
    tempo_changes: list[TempoChange],
    beats_per_measure: float,
) -> float:
    target_beat_offset = max(0.0, beat - 1)
    elapsed_seconds = 0.0
    cursor_beat_offset = 0.0
    active_bpm = max(1, bpm)
    for change in _sorted_effective_tempo_changes(tempo_changes):
        change_beat_offset = max(0.0, (change.measure_index - 1) * beats_per_measure)
        if change_beat_offset <= cursor_beat_offset:
            active_bpm = change.bpm
            continue
        if target_beat_offset <= change_beat_offset:
            return elapsed_seconds + ((target_beat_offset - cursor_beat_offset) * _seconds_per_beat(active_bpm))
        elapsed_seconds += (change_beat_offset - cursor_beat_offset) * _seconds_per_beat(active_bpm)
        cursor_beat_offset = change_beat_offset
        active_bpm = change.bpm
    return elapsed_seconds + ((target_beat_offset - cursor_beat_offset) * _seconds_per_beat(active_bpm))


def seconds_to_beat(
    seconds: float,
    *,
    bpm: int,
    tempo_changes: list[TempoChange],
    beats_per_measure: float,
) -> float:
    if not isfinite(seconds) or seconds <= 0:
        return 1.0
    elapsed_seconds = 0.0
    cursor_beat_offset = 0.0
    active_bpm = max(1, bpm)
    for change in _sorted_effective_tempo_changes(tempo_changes):
        change_beat_offset = max(0.0, (change.measure_index - 1) * beats_per_measure)
        if change_beat_offset <= cursor_beat_offset:
            active_bpm = change.bpm
            continue
        segment_seconds = (change_beat_offset - cursor_beat_offset) * _seconds_per_beat(active_bpm)
        if seconds <= elapsed_seconds + segment_seconds:
            return round(1 + cursor_beat_offset + ((seconds - elapsed_seconds) / _seconds_per_beat(active_bpm)), 4)
        elapsed_seconds += segment_seconds
        cursor_beat_offset = change_beat_offset
        active_bpm = change.bpm
    return round(1 + cursor_beat_offset + ((seconds - elapsed_seconds) / _seconds_per_beat(active_bpm)), 4)


def duration_seconds_for_beats(
    start_beat: float,
    duration_beats: float,
    *,
    bpm: int,
    tempo_changes: list[TempoChange],
    beats_per_measure: float,
) -> float:
    end_beat = start_beat + max(0.0, duration_beats)
    return max(
        0.0,
        beat_to_seconds(
            end_beat,
            bpm=bpm,
            tempo_changes=tempo_changes,
            beats_per_measure=beats_per_measure,
        )
        - beat_to_seconds(
            start_beat,
            bpm=bpm,
            tempo_changes=tempo_changes,
            beats_per_measure=beats_per_measure,
        ),
    )


def _region_should_retime(region: ArrangementRegion) -> bool:
    return bool(region.pitch_events) and not region.audio_source_path


def _sorted_effective_tempo_changes(changes: list[TempoChange]) -> list[TempoChange]:
    return sorted(changes, key=lambda change: change.measure_index)


def _seconds_per_beat(bpm: int) -> float:
    return 60 / max(1, bpm)
