from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    CopyRegionRequest,
    PitchEvent,
    SplitRegionRequest,
    Studio,
    UpdatePitchEventRequest,
    UpdateRegionRequest,
    sync_studio_arrangement_regions,
)
from gigastudy_api.services.engine.music_theory import (
    label_to_midi,
    midi_to_frequency,
    midi_to_label,
    seconds_per_beat,
)
from gigastudy_api.services.studio_access import require_studio_access


class StudioRegionCommands:
    def __init__(
        self,
        *,
        now: Any,
        repository: Any,
    ) -> None:
        self._now = now
        self._repository = repository

    def update_region(
        self,
        studio_id: str,
        region_id: str,
        request: UpdateRegionRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._load_editable_studio(studio_id, owner_token)
            timestamp = self._now()
            region = _find_region(studio, region_id)
            touched_slots = {region.track_slot_id}

            if "target_track_slot_id" in request.model_fields_set and request.target_track_slot_id is not None:
                target_track = self._repository._find_track(studio, request.target_track_slot_id)
                region.track_slot_id = target_track.slot_id
                region.track_name = target_track.name
                for event in region.pitch_events:
                    event.track_slot_id = target_track.slot_id
                touched_slots.add(target_track.slot_id)

            if "start_seconds" in request.model_fields_set and request.start_seconds is not None:
                next_start = round(request.start_seconds, 4)
                delta_seconds = next_start - region.start_seconds
                region.start_seconds = next_start
                region.sync_offset_seconds = next_start
                for event in region.pitch_events:
                    event.start_seconds = round(max(0.0, event.start_seconds + delta_seconds), 4)

            if "duration_seconds" in request.model_fields_set and request.duration_seconds is not None:
                region.duration_seconds = round(request.duration_seconds, 4)

            if "volume_percent" in request.model_fields_set and request.volume_percent is not None:
                region.volume_percent = request.volume_percent

            if "source_label" in request.model_fields_set:
                region.source_label = request.source_label

            self._normalize_region(region, bpm=studio.bpm)
            self._sync_tracks_for_slots(studio, touched_slots, timestamp=timestamp)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def copy_region(
        self,
        studio_id: str,
        region_id: str,
        request: CopyRegionRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._load_editable_studio(studio_id, owner_token)
            timestamp = self._now()
            source_region = _find_region(studio, region_id)
            target_slot_id = request.target_track_slot_id or source_region.track_slot_id
            target_track = self._repository._find_track(studio, target_slot_id)
            next_start = (
                round(request.start_seconds, 4)
                if request.start_seconds is not None
                else round(source_region.start_seconds + source_region.duration_seconds, 4)
            )
            new_region_id = _new_region_id(target_slot_id)
            delta_seconds = next_start - source_region.start_seconds

            copied_region = source_region.model_copy(
                deep=True,
                update={
                    "region_id": new_region_id,
                    "track_slot_id": target_slot_id,
                    "track_name": target_track.name,
                    "start_seconds": next_start,
                    "sync_offset_seconds": next_start,
                },
            )
            copied_region.pitch_events = [
                event.model_copy(
                    update={
                        "event_id": f"{new_region_id}-event-{index}",
                        "region_id": new_region_id,
                        "track_slot_id": target_slot_id,
                        "start_seconds": round(max(0.0, event.start_seconds + delta_seconds), 4),
                    }
                )
                for index, event in enumerate(source_region.pitch_events, start=1)
            ]
            self._normalize_region(copied_region, bpm=studio.bpm)
            studio.regions.append(copied_region)
            self._sync_tracks_for_slots(
                studio,
                {source_region.track_slot_id, target_slot_id},
                timestamp=timestamp,
            )
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def split_region(
        self,
        studio_id: str,
        region_id: str,
        request: SplitRegionRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._load_editable_studio(studio_id, owner_token)
            timestamp = self._now()
            region = _find_region(studio, region_id)
            split_seconds = round(request.split_seconds, 4)
            region_end = region.start_seconds + region.duration_seconds
            if split_seconds <= region.start_seconds + 0.05 or split_seconds >= region_end - 0.05:
                raise HTTPException(status_code=422, detail="Split point must be inside the region.")

            beat_seconds = seconds_per_beat(studio.bpm)
            right_region_id = _new_region_id(region.track_slot_id)
            left_events: list[PitchEvent] = []
            right_events: list[PitchEvent] = []

            for index, event in enumerate(region.pitch_events, start=1):
                event_start = event.start_seconds
                event_end = event.start_seconds + event.duration_seconds
                if event_end <= split_seconds:
                    left_events.append(event)
                elif event_start >= split_seconds:
                    right_events.append(
                        event.model_copy(
                            update={
                                "event_id": f"{right_region_id}-event-{index}",
                                "region_id": right_region_id,
                            }
                        )
                    )
                else:
                    left_duration = max(0.08, split_seconds - event_start)
                    right_duration = max(0.08, event_end - split_seconds)
                    left_events.append(
                        event.model_copy(
                            update={
                                "duration_seconds": round(left_duration, 4),
                                "duration_beats": round(left_duration / beat_seconds, 4),
                            }
                        )
                    )
                    right_events.append(
                        event.model_copy(
                            update={
                                "event_id": f"{right_region_id}-event-{index}",
                                "region_id": right_region_id,
                                "start_seconds": split_seconds,
                                "duration_seconds": round(right_duration, 4),
                                "start_beat": round(
                                    event.start_beat + (split_seconds - event_start) / beat_seconds,
                                    4,
                                ),
                                "duration_beats": round(right_duration / beat_seconds, 4),
                            }
                        )
                    )

            right_region = region.model_copy(
                deep=True,
                update={
                    "region_id": right_region_id,
                    "start_seconds": split_seconds,
                    "duration_seconds": round(region_end - split_seconds, 4),
                    "sync_offset_seconds": split_seconds,
                    "pitch_events": right_events,
                },
            )
            region.duration_seconds = round(split_seconds - region.start_seconds, 4)
            region.pitch_events = left_events
            self._normalize_region(region, bpm=studio.bpm)
            self._normalize_region(right_region, bpm=studio.bpm)
            studio.regions.append(right_region)
            self._sync_tracks_for_slots(studio, {region.track_slot_id}, timestamp=timestamp)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def delete_region(
        self,
        studio_id: str,
        region_id: str,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._load_editable_studio(studio_id, owner_token)
            timestamp = self._now()
            region = _find_region(studio, region_id)
            studio.regions = [candidate for candidate in studio.regions if candidate.region_id != region_id]
            self._sync_tracks_for_slots(studio, {region.track_slot_id}, timestamp=timestamp)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def update_pitch_event(
        self,
        studio_id: str,
        region_id: str,
        event_id: str,
        request: UpdatePitchEventRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._load_editable_studio(studio_id, owner_token)
            timestamp = self._now()
            region = _find_region(studio, region_id)
            event = _find_event(region, event_id)
            beat_seconds = seconds_per_beat(studio.bpm)

            if "label" in request.model_fields_set and request.label is not None:
                event.label = request.label

            if "is_rest" in request.model_fields_set and request.is_rest is not None:
                event.is_rest = request.is_rest

            if "pitch_midi" in request.model_fields_set:
                event.pitch_midi = request.pitch_midi
                if request.pitch_midi is not None:
                    event.pitch_hz = midi_to_frequency(request.pitch_midi)
                    if "label" not in request.model_fields_set:
                        event.label = midi_to_label(request.pitch_midi)
                    event.is_rest = False
                else:
                    event.pitch_hz = None

            if "label" in request.model_fields_set and "pitch_midi" not in request.model_fields_set:
                resolved_midi = label_to_midi(event.label)
                if resolved_midi is not None:
                    event.pitch_midi = resolved_midi
                    event.pitch_hz = midi_to_frequency(resolved_midi)
                    event.is_rest = False

            if event.is_rest and "label" not in request.model_fields_set:
                event.label = "Rest"
                if "pitch_midi" not in request.model_fields_set:
                    event.pitch_midi = None
                    event.pitch_hz = None

            if "start_seconds" in request.model_fields_set and request.start_seconds is not None:
                event.start_seconds = round(request.start_seconds, 4)
                if "start_beat" not in request.model_fields_set:
                    event.start_beat = _start_beat_for_event(region, event, beat_seconds=beat_seconds)

            if "start_beat" in request.model_fields_set and request.start_beat is not None:
                event.start_beat = round(request.start_beat, 4)
                if "start_seconds" not in request.model_fields_set:
                    event.start_seconds = round(
                        max(0.0, region.start_seconds + ((event.start_beat - 1) * beat_seconds)),
                        4,
                    )

            if "duration_seconds" in request.model_fields_set and request.duration_seconds is not None:
                event.duration_seconds = round(request.duration_seconds, 4)
                if "duration_beats" not in request.model_fields_set:
                    event.duration_beats = round(event.duration_seconds / beat_seconds, 4)

            if "duration_beats" in request.model_fields_set and request.duration_beats is not None:
                event.duration_beats = round(request.duration_beats, 4)
                if "duration_seconds" not in request.model_fields_set:
                    event.duration_seconds = round(event.duration_beats * beat_seconds, 4)

            if "confidence" in request.model_fields_set and request.confidence is not None:
                event.confidence = request.confidence

            self._normalize_region(region, bpm=studio.bpm)
            self._sync_tracks_for_slots(studio, {region.track_slot_id}, timestamp=timestamp)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def _load_editable_studio(self, studio_id: str, owner_token: str | None) -> Studio:
        studio = self._repository._load_studio(studio_id)
        if studio is None:
            raise HTTPException(status_code=404, detail="Studio not found.")
        require_studio_access(studio, owner_token)
        studio.regions = sync_studio_arrangement_regions(studio)
        return studio

    def _normalize_region(self, region: ArrangementRegion, *, bpm: int) -> None:
        beat_seconds = seconds_per_beat(bpm)
        region.start_seconds = round(max(0.0, region.start_seconds), 4)
        region.duration_seconds = round(max(0.08, region.duration_seconds), 4)
        region.sync_offset_seconds = round(region.start_seconds, 4)
        region.pitch_events = sorted(
            [
                event.model_copy(
                    update={
                        "track_slot_id": region.track_slot_id,
                        "region_id": region.region_id,
                        "start_seconds": round(max(0.0, event.start_seconds), 4),
                        "duration_seconds": round(max(0.08, event.duration_seconds), 4),
                        "start_beat": round(max(0.0, event.start_beat), 4),
                        "duration_beats": round(max(0.01, event.duration_beats), 4),
                    }
                )
                for event in region.pitch_events
            ],
            key=lambda item: (item.start_seconds, item.event_id),
        )
        event_end = max(
            (event.start_seconds + event.duration_seconds for event in region.pitch_events),
            default=region.start_seconds + region.duration_seconds,
        )
        region.duration_seconds = round(max(region.duration_seconds, event_end - region.start_seconds, beat_seconds), 4)

    def _sync_tracks_for_slots(
        self,
        studio: Studio,
        slot_ids: set[int],
        *,
        timestamp: str,
    ) -> None:
        for slot_id in slot_ids:
            track = self._repository._find_track(studio, slot_id)
            slot_regions = [
                region
                for region in sorted(
                    studio.regions,
                    key=lambda item: (item.start_seconds, item.region_id),
                )
                if region.track_slot_id == slot_id and _region_has_content(region)
            ]
            if not slot_regions:
                _clear_track(track, timestamp=timestamp)
                continue

            first_region = slot_regions[0]
            track.status = "registered"
            track.source_kind = first_region.source_kind
            track.source_label = first_region.source_label
            track.audio_source_path = first_region.audio_source_path
            track.audio_source_label = first_region.source_label
            track.audio_mime_type = first_region.audio_mime_type
            track.duration_seconds = round(
                max(region.start_seconds + region.duration_seconds for region in slot_regions),
                4,
            )
            track.sync_offset_seconds = round(min(region.start_seconds for region in slot_regions), 3)
            track.volume_percent = first_region.volume_percent
            track.events = []
            track.diagnostics = {
                "region_editor": {
                    "region_count": len(slot_regions),
                    "event_count": sum(len(region.pitch_events) for region in slot_regions),
                }
            }
            track.updated_at = timestamp


def _find_region(studio: Studio, region_id: str) -> ArrangementRegion:
    for region in studio.regions:
        if region.region_id == region_id:
            return region
    raise HTTPException(status_code=404, detail="Region not found.")


def _find_event(region: ArrangementRegion, event_id: str) -> PitchEvent:
    for event in region.pitch_events:
        if event.event_id == event_id:
            return event
    raise HTTPException(status_code=404, detail="Pitch event not found.")


def _new_region_id(slot_id: int) -> str:
    return f"track-{slot_id}-region-{uuid4().hex[:10]}"


def _start_beat_for_event(region: ArrangementRegion, event: PitchEvent, *, beat_seconds: float) -> float:
    return round(max(0.0, 1 + ((event.start_seconds - region.start_seconds) / beat_seconds)), 4)


def _region_has_content(region: ArrangementRegion) -> bool:
    return bool(region.pitch_events or region.audio_source_path)


def _clear_track(track: Any, *, timestamp: str) -> None:
    track.status = "empty"
    track.source_kind = None
    track.source_label = None
    track.audio_source_path = None
    track.audio_source_label = None
    track.audio_mime_type = None
    track.duration_seconds = 0
    track.events = []
    track.diagnostics = {}
    track.updated_at = timestamp
