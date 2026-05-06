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


def studio_has_active_track_material(studio: Studio, slot_id: int) -> bool:
    return bool(_current_track_material_snapshots(studio, _find_track(studio.tracks, slot_id)))


def _track_slot_has_legacy_content(track: TrackSlot) -> bool:
    return bool(track.events) or (
        track.status == "registered"
        and (
            bool(track.audio_source_path)
            or bool(track.source_kind)
            or bool(track.source_label)
            or track.duration_seconds > 0
        )
    )


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
    snapshots = _current_track_material_snapshots(studio, track)
    if not snapshots:
        return None

    pinned = (
        force_pinned
        if force_pinned is not None
        else _should_pin_original_score(studio, track.slot_id, snapshots)
    )
    reason: TrackMaterialArchiveReason = force_reason or (
        "original_score" if pinned else "before_overwrite"
    )
    source_region = snapshots[0]
    archive = TrackMaterialArchive(
        archive_id=f"track-archive-{uuid4().hex}",
        track_slot_id=track.slot_id,
        track_name=track.name,
        source_kind=source_region.source_kind or track.source_kind,
        source_label=source_region.source_label or track.source_label,
        archived_at=timestamp,
        reason=reason,
        pinned=pinned,
        region_snapshots=snapshots,
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

    snapshots = [
        _normalized_region_snapshot(region, track)
        for region in archive.region_snapshots
        if region.track_slot_id == track.slot_id
    ]
    if not snapshots:
        raise HTTPException(status_code=409, detail="Track archive has no restorable material.")
    _replace_track_regions(studio, track.slot_id, snapshots)

    track.status = "registered"
    source_region = snapshots[0]
    track.source_kind = source_region.source_kind or archive.source_kind
    track.source_label = source_region.source_label or archive.source_label
    track.audio_source_path = source_region.audio_source_path
    track.audio_source_label = source_region.source_label if source_region.audio_source_path else None
    track.audio_mime_type = source_region.audio_mime_type
    track.duration_seconds = _region_snapshots_duration_seconds(snapshots)
    track.sync_offset_seconds = source_region.sync_offset_seconds
    track.volume_percent = source_region.volume_percent
    track.events = []
    track.diagnostics = {
        **source_region.diagnostics,
        "restored_from_archive": {
            "archive_id": archive.archive_id,
            "archived_at": archive.archived_at,
            "reason": archive.reason,
            "pinned": archive.pinned,
        },
    }


def _current_track_material_snapshots(studio: Studio, track: TrackSlot) -> list[ArrangementRegion]:
    regions = [
        region
        for region in studio.regions
        if region.track_slot_id == track.slot_id and (region.pitch_events or region.audio_source_path)
    ]
    if regions:
        return [
            _normalized_region_snapshot(region, track)
            for region in sorted(regions, key=lambda item: (item.start_seconds, item.region_id))
        ]
    if not _track_slot_has_legacy_content(track):
        return []
    fallback_region = build_arrangement_region_from_track_events(
        track,
        events=track.events,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
    )
    return [fallback_region] if fallback_region is not None else []


def _normalized_region_snapshot(region: ArrangementRegion, track: TrackSlot) -> ArrangementRegion:
    snapshot = region.model_copy(deep=True)
    snapshot.track_slot_id = track.slot_id
    snapshot.track_name = track.name
    for event in snapshot.pitch_events:
        event.track_slot_id = track.slot_id
        event.region_id = snapshot.region_id
    return snapshot


def _should_pin_original_score(
    studio: Studio,
    slot_id: int,
    snapshots: list[ArrangementRegion],
) -> bool:
    if not any(snapshot.source_kind in ORIGINAL_SCORE_SOURCE_KINDS for snapshot in snapshots):
        return False
    return not any(
        archive.track_slot_id == slot_id
        and archive.reason == "original_score"
        and archive.pinned
        for archive in studio.track_material_archives
    )


def _region_snapshots_duration_seconds(snapshots: list[ArrangementRegion]) -> float:
    if not snapshots:
        return 0
    start_seconds = min(region.start_seconds for region in snapshots)
    end_seconds = max(region.start_seconds + region.duration_seconds for region in snapshots)
    return max(0, end_seconds - start_seconds)


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
    _replace_track_regions(studio, slot_id, [region] if region is not None else [])


def _replace_track_regions(
    studio: Studio,
    slot_id: int,
    regions: list[ArrangementRegion],
) -> None:
    studio.regions = [
        existing_region
        for existing_region in studio.regions
        if existing_region.track_slot_id != slot_id
    ]
    studio.regions.extend(regions)


def _find_track(tracks: list[TrackSlot], slot_id: int) -> TrackSlot:
    for track in tracks:
        if track.slot_id == slot_id:
            return track
    raise HTTPException(status_code=404, detail="Track slot not found.")


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
