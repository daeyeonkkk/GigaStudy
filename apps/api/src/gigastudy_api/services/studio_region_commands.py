from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    CopyRegionRequest,
    PitchEvent,
    SaveRegionEventPatch,
    SaveRegionRevisionRequest,
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
from gigastudy_api.services.studio_time import (
    STUDIO_TIME_PRECISION_SECONDS,
    clamp_studio_duration_seconds,
    round_studio_seconds,
    studio_time_precision_beats,
)
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs
from gigastudy_api.services.studio_access import require_studio_access

REGION_EDITOR_DIAGNOSTICS_KEY = "region_editor"
REGION_REVISION_HISTORY_KEY = "revision_history"
MAX_REGION_REVISIONS = 8


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
            target_track = None

            if "target_track_slot_id" in request.model_fields_set and request.target_track_slot_id is not None:
                target_track = self._repository._find_track(studio, request.target_track_slot_id)
                touched_slots.add(target_track.slot_id)

            ensure_no_active_extraction_jobs(
                studio,
                touched_slots,
                action_label="Region editing",
            )

            if target_track is not None:
                region.track_slot_id = target_track.slot_id
                region.track_name = target_track.name
                for event in region.pitch_events:
                    event.track_slot_id = target_track.slot_id

            if "start_seconds" in request.model_fields_set and request.start_seconds is not None:
                next_start = round(request.start_seconds, 4)
                delta_seconds = next_start - region.start_seconds
                region.start_seconds = next_start
                region.sync_offset_seconds = next_start
                for event in region.pitch_events:
                    event.start_seconds = round(event.start_seconds + delta_seconds, 4)

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

    def save_region_revision(
        self,
        studio_id: str,
        region_id: str,
        request: SaveRegionRevisionRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._load_editable_studio(studio_id, owner_token)
            timestamp = self._now()
            region = _find_region(studio, region_id)
            before_snapshot = _region_material_snapshot(region)
            touched_slots = {region.track_slot_id}
            target_track = None

            if "target_track_slot_id" in request.model_fields_set and request.target_track_slot_id is not None:
                target_track = self._repository._find_track(studio, request.target_track_slot_id)
                touched_slots.add(target_track.slot_id)

            ensure_no_active_extraction_jobs(
                studio,
                touched_slots,
                action_label="Region draft save",
            )

            event_patches_by_id = {event_patch.event_id: event_patch for event_patch in request.events}

            if target_track is not None:
                region.track_slot_id = target_track.slot_id
                region.track_name = target_track.name
                for event in region.pitch_events:
                    event.track_slot_id = target_track.slot_id

            if "start_seconds" in request.model_fields_set and request.start_seconds is not None:
                next_start = round(request.start_seconds, 4)
                delta_seconds = next_start - region.start_seconds
                region.start_seconds = next_start
                region.sync_offset_seconds = next_start
                if not event_patches_by_id:
                    for event in region.pitch_events:
                        event.start_seconds = round(event.start_seconds + delta_seconds, 4)

            if "duration_seconds" in request.model_fields_set and request.duration_seconds is not None:
                region.duration_seconds = round(request.duration_seconds, 4)

            if "volume_percent" in request.model_fields_set and request.volume_percent is not None:
                region.volume_percent = request.volume_percent

            if "source_label" in request.model_fields_set:
                region.source_label = request.source_label

            for event_patch in request.events:
                event = _find_event(region, event_patch.event_id)
                _apply_pitch_event_update(region, event, event_patch, bpm=studio.bpm)

            self._normalize_region(region, bpm=studio.bpm)
            after_snapshot = _region_material_snapshot(region)
            if after_snapshot != before_snapshot:
                _append_region_revision(
                    region,
                    before_snapshot,
                    label=request.revision_label,
                    summary=_summarize_region_revision(before_snapshot, after_snapshot),
                    timestamp=timestamp,
                )
            self._sync_tracks_for_slots(studio, touched_slots, timestamp=timestamp)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def restore_region_revision(
        self,
        studio_id: str,
        region_id: str,
        revision_id: str,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        with self._repository._lock:
            studio = self._load_editable_studio(studio_id, owner_token)
            timestamp = self._now()
            region = _find_region(studio, region_id)
            revision = _find_region_revision(region, revision_id)
            snapshot = revision.get("region")
            if not isinstance(snapshot, dict):
                raise HTTPException(status_code=422, detail="Region revision snapshot is invalid.")

            before_snapshot = _region_material_snapshot(region)
            target_slot_id = _snapshot_track_slot_id(snapshot)
            touched_slots = {region.track_slot_id, target_slot_id}
            ensure_no_active_extraction_jobs(
                studio,
                touched_slots,
                action_label="Region revision restore",
            )
            _apply_region_material_snapshot(studio, region, snapshot, repository=self._repository)
            self._normalize_region(region, bpm=studio.bpm)
            after_snapshot = _region_material_snapshot(region)
            if after_snapshot != before_snapshot:
                _append_region_revision(
                    region,
                    before_snapshot,
                    label=f"복원 전 - {revision.get('label') or '이전 버전'}",
                    summary="revision restore checkpoint",
                    timestamp=timestamp,
                )
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
            ensure_no_active_extraction_jobs(
                studio,
                {source_region.track_slot_id, target_slot_id},
                action_label="Region copy",
            )
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
                        "start_seconds": round(event.start_seconds + delta_seconds, 4),
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
            ensure_no_active_extraction_jobs(
                studio,
                {region.track_slot_id},
                action_label="Region split",
            )
            split_seconds = round_studio_seconds(request.split_seconds)
            region_end = region.start_seconds + region.duration_seconds
            if (
                split_seconds <= region.start_seconds + STUDIO_TIME_PRECISION_SECONDS
                or split_seconds >= region_end - STUDIO_TIME_PRECISION_SECONDS
            ):
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
                    right_start_beat = _start_beat_from_seconds(
                        event.start_seconds,
                        region_start_seconds=split_seconds,
                        beat_seconds=beat_seconds,
                    )
                    right_events.append(
                        event.model_copy(
                            update={
                                "event_id": f"{right_region_id}-event-{index}",
                                "region_id": right_region_id,
                                "start_beat": right_start_beat,
                            }
                        )
                    )
                else:
                    left_duration = max(STUDIO_TIME_PRECISION_SECONDS, split_seconds - event_start)
                    right_duration = max(STUDIO_TIME_PRECISION_SECONDS, event_end - split_seconds)
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
                                "start_beat": 1,
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
            ensure_no_active_extraction_jobs(
                studio,
                {region.track_slot_id},
                action_label="Region delete",
            )
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
            ensure_no_active_extraction_jobs(
                studio,
                {region.track_slot_id},
                action_label="Piano-roll event editing",
            )
            event = _find_event(region, event_id)
            _apply_pitch_event_update(region, event, request, bpm=studio.bpm)

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
        region.start_seconds = round_studio_seconds(region.start_seconds)
        region.duration_seconds = clamp_studio_duration_seconds(region.duration_seconds)
        region.sync_offset_seconds = round_studio_seconds(region.start_seconds)
        minimum_duration_beats = studio_time_precision_beats(beat_seconds)
        region.pitch_events = sorted(
            [
                event.model_copy(
                    update={
                        "track_slot_id": region.track_slot_id,
                        "region_id": region.region_id,
                        "start_seconds": round_studio_seconds(event.start_seconds),
                        "duration_seconds": clamp_studio_duration_seconds(event.duration_seconds),
                        "start_beat": round(max(0.0, event.start_beat), 4),
                        "duration_beats": round(max(minimum_duration_beats, event.duration_beats), 4),
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
        region.duration_seconds = clamp_studio_duration_seconds(max(region.duration_seconds, event_end - region.start_seconds))

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


def _apply_pitch_event_update(
    region: ArrangementRegion,
    event: PitchEvent,
    request: UpdatePitchEventRequest | SaveRegionEventPatch,
    *,
    bpm: int,
) -> None:
    beat_seconds = seconds_per_beat(bpm)

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
                region.start_seconds + ((event.start_beat - 1) * beat_seconds),
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


def _region_material_snapshot(region: ArrangementRegion) -> dict[str, Any]:
    return {
        "region_id": region.region_id,
        "track_slot_id": region.track_slot_id,
        "track_name": region.track_name,
        "source_kind": region.source_kind,
        "source_label": region.source_label,
        "audio_source_path": region.audio_source_path,
        "audio_mime_type": region.audio_mime_type,
        "start_seconds": round(region.start_seconds, 4),
        "duration_seconds": round(region.duration_seconds, 4),
        "sync_offset_seconds": round(region.sync_offset_seconds, 4),
        "volume_percent": region.volume_percent,
        "pitch_events": [
            event.model_dump(mode="json")
            for event in sorted(region.pitch_events, key=lambda item: (item.start_seconds, item.event_id))
        ],
    }


def _append_region_revision(
    region: ArrangementRegion,
    snapshot: dict[str, Any],
    *,
    label: str | None,
    summary: str,
    timestamp: str,
) -> None:
    diagnostics = dict(region.diagnostics)
    editor_diagnostics = dict(diagnostics.get(REGION_EDITOR_DIAGNOSTICS_KEY) or {})
    history = [
        entry
        for entry in editor_diagnostics.get(REGION_REVISION_HISTORY_KEY, [])
        if isinstance(entry, dict)
    ]
    revision_label = label.strip() if label and label.strip() else "저장 전 버전"
    editor_diagnostics[REGION_REVISION_HISTORY_KEY] = [
        {
            "revision_id": uuid4().hex[:12],
            "created_at": timestamp,
            "label": revision_label,
            "summary": summary,
            "region": snapshot,
        },
        *history,
    ][:MAX_REGION_REVISIONS]
    diagnostics[REGION_EDITOR_DIAGNOSTICS_KEY] = editor_diagnostics
    region.diagnostics = diagnostics


def _find_region_revision(region: ArrangementRegion, revision_id: str) -> dict[str, Any]:
    editor_diagnostics = region.diagnostics.get(REGION_EDITOR_DIAGNOSTICS_KEY)
    if not isinstance(editor_diagnostics, dict):
        raise HTTPException(status_code=404, detail="Region revision not found.")
    history = editor_diagnostics.get(REGION_REVISION_HISTORY_KEY)
    if not isinstance(history, list):
        raise HTTPException(status_code=404, detail="Region revision not found.")
    for entry in history:
        if isinstance(entry, dict) and entry.get("revision_id") == revision_id:
            return entry
    raise HTTPException(status_code=404, detail="Region revision not found.")


def _snapshot_track_slot_id(snapshot: dict[str, Any]) -> int:
    raw_slot_id = snapshot.get("track_slot_id")
    if not isinstance(raw_slot_id, int):
        raise HTTPException(status_code=422, detail="Region revision snapshot is invalid.")
    return raw_slot_id


def _apply_region_material_snapshot(
    studio: Studio,
    region: ArrangementRegion,
    snapshot: dict[str, Any],
    *,
    repository: Any,
) -> None:
    target_slot_id = _snapshot_track_slot_id(snapshot)
    target_track = repository._find_track(studio, target_slot_id)
    pitch_events = snapshot.get("pitch_events")
    if not isinstance(pitch_events, list):
        raise HTTPException(status_code=422, detail="Region revision snapshot is invalid.")

    region.track_slot_id = target_track.slot_id
    region.track_name = target_track.name
    region.source_kind = snapshot.get("source_kind")  # type: ignore[assignment]
    region.source_label = snapshot.get("source_label") if isinstance(snapshot.get("source_label"), str) else None
    region.audio_source_path = (
        snapshot.get("audio_source_path")
        if isinstance(snapshot.get("audio_source_path"), str)
        else None
    )
    region.audio_mime_type = (
        snapshot.get("audio_mime_type")
        if isinstance(snapshot.get("audio_mime_type"), str)
        else None
    )
    region.start_seconds = _snapshot_float(snapshot, "start_seconds")
    region.duration_seconds = _snapshot_float(snapshot, "duration_seconds")
    region.sync_offset_seconds = _snapshot_float(snapshot, "sync_offset_seconds")
    region.volume_percent = _snapshot_int(snapshot, "volume_percent")
    region.pitch_events = [PitchEvent.model_validate(event) for event in pitch_events]
    for event in region.pitch_events:
        event.track_slot_id = target_track.slot_id
        event.region_id = region.region_id


def _snapshot_float(snapshot: dict[str, Any], key: str) -> float:
    value = snapshot.get(key)
    if isinstance(value, (int, float)):
        return float(value)
    raise HTTPException(status_code=422, detail="Region revision snapshot is invalid.")


def _snapshot_int(snapshot: dict[str, Any], key: str) -> int:
    value = snapshot.get(key)
    if isinstance(value, int):
        return value
    raise HTTPException(status_code=422, detail="Region revision snapshot is invalid.")


def _summarize_region_revision(before: dict[str, Any], after: dict[str, Any]) -> str:
    changes: list[str] = []
    for key, label in [
        ("track_slot_id", "track"),
        ("start_seconds", "start"),
        ("duration_seconds", "duration"),
        ("volume_percent", "volume"),
        ("source_label", "label"),
    ]:
        if before.get(key) != after.get(key):
            changes.append(label)
    before_events = before.get("pitch_events") if isinstance(before.get("pitch_events"), list) else []
    after_events = after.get("pitch_events") if isinstance(after.get("pitch_events"), list) else []
    if before_events != after_events:
        changes.append("events")
    return ", ".join(changes) if changes else "no material change"


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
    return _start_beat_from_seconds(
        event.start_seconds,
        region_start_seconds=region.start_seconds,
        beat_seconds=beat_seconds,
    )


def _start_beat_from_seconds(
    start_seconds: float,
    *,
    region_start_seconds: float,
    beat_seconds: float,
) -> float:
    return round(max(0.0, 1 + ((start_seconds - region_start_seconds) / beat_seconds)), 4)


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
