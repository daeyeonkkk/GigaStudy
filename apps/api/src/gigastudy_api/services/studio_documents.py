from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    SourceKind,
    Studio,
    StudioListItem,
    TrackMaterialArchive,
    TrackMaterialArchiveReason,
    TrackSlot,
    build_arrangement_region_from_track_events,
    sync_studio_arrangement_regions,
    sync_studio_candidate_regions,
)
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import TRACKS

TRACK_MATERIAL_ARCHIVE_NON_PINNED_LIMIT = 6
ORIGINAL_SCORE_SOURCE_KINDS: set[SourceKind] = {"document", "midi"}


def empty_tracks(timestamp: str) -> list[TrackSlot]:
    return [
        TrackSlot(
            slot_id=slot_id,
            name=name,
            status="empty",
            updated_at=timestamp,
        )
        for slot_id, name in TRACKS
    ]


def track_has_content(track: TrackSlot) -> bool:
    return track.status == "registered" or bool(track.events)


def register_track_material(
    studio: Studio,
    track: TrackSlot,
    *,
    timestamp: str,
    source_kind: SourceKind,
    source_label: str,
    events: list[TrackPitchEvent],
    duration_seconds: float,
    registration_diagnostics: dict[str, Any],
    audio_source_path: str | None = None,
    audio_source_label: str | None = None,
    audio_mime_type: str | None = None,
) -> None:
    archive_current_track_material(studio, track, timestamp=timestamp)
    track.status = "registered"
    track.source_kind = source_kind
    track.source_label = source_label
    track.audio_source_path = audio_source_path
    track.audio_source_label = audio_source_label
    track.audio_mime_type = audio_mime_type
    track.duration_seconds = duration_seconds
    track.diagnostics = {"registration_quality": registration_diagnostics}
    track.updated_at = timestamp
    region = build_arrangement_region_from_track_events(
        track,
        events=events,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
    )
    _replace_track_region(studio, track.slot_id, region)
    track.events = []


def archive_current_track_material(
    studio: Studio,
    track: TrackSlot,
    *,
    timestamp: str,
    force_reason: TrackMaterialArchiveReason | None = None,
    force_pinned: bool | None = None,
) -> TrackMaterialArchive | None:
    snapshot = _current_track_material_snapshot(studio, track)
    if snapshot is None:
        return None

    pinned = (
        force_pinned
        if force_pinned is not None
        else _should_pin_original_score(studio, snapshot)
    )
    reason: TrackMaterialArchiveReason = force_reason or (
        "original_score" if pinned else "before_overwrite"
    )
    archive = TrackMaterialArchive(
        archive_id=f"track-archive-{uuid4().hex}",
        track_slot_id=track.slot_id,
        track_name=track.name,
        source_kind=snapshot.source_kind or track.source_kind,
        source_label=snapshot.source_label or track.source_label,
        archived_at=timestamp,
        reason=reason,
        pinned=pinned,
        region_snapshot=snapshot,
    )
    studio.track_material_archives.insert(0, archive)
    _prune_track_material_archives(studio, track.slot_id)
    return archive


def restore_track_material_archive(
    studio: Studio,
    track: TrackSlot,
    archive: TrackMaterialArchive,
) -> None:
    if archive.track_slot_id != track.slot_id:
        raise HTTPException(status_code=409, detail="Track archive can only be restored to its original slot.")

    snapshot = archive.region_snapshot.model_copy(deep=True)
    snapshot.track_slot_id = track.slot_id
    snapshot.track_name = track.name
    for event in snapshot.pitch_events:
        event.track_slot_id = track.slot_id
        event.region_id = snapshot.region_id
    _replace_track_region(studio, track.slot_id, snapshot)

    track.status = "registered"
    track.source_kind = snapshot.source_kind or archive.source_kind
    track.source_label = snapshot.source_label or archive.source_label
    track.audio_source_path = snapshot.audio_source_path
    track.audio_source_label = snapshot.source_label if snapshot.audio_source_path else None
    track.audio_mime_type = snapshot.audio_mime_type
    track.duration_seconds = snapshot.duration_seconds
    track.sync_offset_seconds = snapshot.sync_offset_seconds
    track.volume_percent = snapshot.volume_percent
    track.events = []
    track.diagnostics = {
        **snapshot.diagnostics,
        "restored_from_archive": {
            "archive_id": archive.archive_id,
            "archived_at": archive.archived_at,
            "reason": archive.reason,
            "pinned": archive.pinned,
        },
    }


def _current_track_material_snapshot(studio: Studio, track: TrackSlot) -> ArrangementRegion | None:
    regions = [
        region
        for region in studio.regions
        if region.track_slot_id == track.slot_id and (region.pitch_events or region.audio_source_path)
    ]
    if len(regions) == 1:
        return _normalized_region_snapshot(regions[0], track)
    if len(regions) > 1:
        return _composite_region_snapshot(regions, track)
    return build_arrangement_region_from_track_events(
        track,
        events=track.events,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
    )


def _normalized_region_snapshot(region: ArrangementRegion, track: TrackSlot) -> ArrangementRegion:
    snapshot = region.model_copy(deep=True)
    snapshot.track_slot_id = track.slot_id
    snapshot.track_name = track.name
    for event in snapshot.pitch_events:
        event.track_slot_id = track.slot_id
        event.region_id = snapshot.region_id
    return snapshot


def _composite_region_snapshot(
    regions: list[ArrangementRegion],
    track: TrackSlot,
) -> ArrangementRegion:
    ordered_regions = sorted(
        regions,
        key=lambda region: (region.start_seconds, region.region_id),
    )
    region_id = f"track-{track.slot_id}-archive-composite"
    pitch_events = []
    for index, region in enumerate(ordered_regions, start=1):
        for event in sorted(region.pitch_events, key=lambda item: (item.start_seconds, item.event_id)):
            next_event = event.model_copy(deep=True)
            next_event.event_id = f"{region_id}-e{index}-{len(pitch_events) + 1}"
            next_event.region_id = region_id
            next_event.track_slot_id = track.slot_id
            pitch_events.append(next_event)

    first_region = ordered_regions[0]
    region_start = min(region.start_seconds for region in ordered_regions)
    region_end = max(
        max(
            (event.start_seconds + event.duration_seconds for event in region.pitch_events),
            default=region.start_seconds + region.duration_seconds,
        )
        for region in ordered_regions
    )
    diagnostics = dict(first_region.diagnostics)
    diagnostics["archived_region_count"] = len(ordered_regions)
    return ArrangementRegion(
        region_id=region_id,
        track_slot_id=track.slot_id,
        track_name=track.name,
        source_kind=first_region.source_kind or track.source_kind,
        source_label=first_region.source_label or track.source_label,
        audio_source_path=first_region.audio_source_path,
        audio_mime_type=first_region.audio_mime_type,
        start_seconds=region_start,
        duration_seconds=max(0.001, region_end - region_start),
        sync_offset_seconds=first_region.sync_offset_seconds,
        volume_percent=track.volume_percent,
        pitch_events=pitch_events,
        diagnostics=diagnostics,
    )


def _should_pin_original_score(studio: Studio, snapshot: ArrangementRegion) -> bool:
    if snapshot.source_kind not in ORIGINAL_SCORE_SOURCE_KINDS:
        return False
    return not any(
        archive.track_slot_id == snapshot.track_slot_id
        and archive.reason == "original_score"
        and archive.pinned
        for archive in studio.track_material_archives
    )


def _prune_track_material_archives(studio: Studio, slot_id: int) -> None:
    non_pinned_seen = 0
    kept_archive_ids: set[str] = set()
    for archive in studio.track_material_archives:
        if archive.track_slot_id != slot_id:
            kept_archive_ids.add(archive.archive_id)
            continue
        if archive.pinned:
            kept_archive_ids.add(archive.archive_id)
            continue
        if non_pinned_seen < TRACK_MATERIAL_ARCHIVE_NON_PINNED_LIMIT:
            kept_archive_ids.add(archive.archive_id)
        non_pinned_seen += 1
    studio.track_material_archives = [
        archive
        for archive in studio.track_material_archives
        if archive.archive_id in kept_archive_ids
    ]


def _replace_track_region(
    studio: Studio,
    slot_id: int,
    region: ArrangementRegion | None,
) -> None:
    studio.regions = [
        existing_region
        for existing_region in studio.regions
        if existing_region.track_slot_id != slot_id
    ]
    if region is not None:
        studio.regions.append(region)


def encode_studio_payload(studio: Studio) -> dict[str, Any]:
    sync_studio_arrangement_regions(studio)
    sync_studio_candidate_regions(studio)
    payload = studio.model_dump(mode="json")
    if studio.owner_token_hash is not None:
        payload["owner_token_hash"] = studio.owner_token_hash
    if studio.client_request_id is not None:
        payload["client_request_id"] = studio.client_request_id
    if studio.client_request_fingerprint is not None:
        payload["client_request_fingerprint"] = studio.client_request_fingerprint
    return payload


def studio_list_item_from_payload(studio_id: str, studio_payload: Any) -> StudioListItem:
    if not isinstance(studio_payload, dict):
        raise HTTPException(status_code=500, detail="Stored studio payload is invalid.")
    shallow_payload = dict(studio_payload)
    report_count = payload_sidecar_count(shallow_payload, "reports")
    shallow_payload["reports"] = []
    shallow_payload["candidates"] = []
    shallow_payload["track_material_archives"] = []
    studio = Studio.model_validate(shallow_payload)
    return StudioListItem(
        studio_id=studio_id,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        registered_track_count=sum(1 for track in studio.tracks if track.status == "registered"),
        report_count=report_count,
        updated_at=studio.updated_at,
    )


def payload_sidecar_count(studio_payload: dict[str, Any], key: str) -> int:
    counts = studio_payload.get("_sidecar_counts")
    if isinstance(counts, dict):
        count = counts.get(key)
        if isinstance(count, int):
            return count
    value = studio_payload.get(key)
    return len(value) if isinstance(value, list) else 0
