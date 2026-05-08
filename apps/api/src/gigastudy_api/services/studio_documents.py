from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    PitchEvent,
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
from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import TRACKS

TRACK_MATERIAL_ARCHIVE_NON_PINNED_LIMIT = 3
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
    if region is not None and source_kind in {"recording", "audio"} and audio_source_path:
        _ensure_region_audio_source_anchors(region)
    _replace_track_region(studio, track.slot_id, region)
    track.events = []
    if source_kind in {"recording", "audio"} and audio_source_path:
        had_original_recording_version = any(
            archive.track_slot_id == track.slot_id
            and archive.reason == "original_recording"
            and archive.pinned
            for archive in studio.track_material_archives
        )
        original_version = ensure_original_recording_material_version(
            studio,
            track,
            timestamp=timestamp,
        )
        if original_version is not None and not had_original_recording_version:
            track.active_material_version_id = original_version.archive_id
        else:
            track.active_material_version_id = None
    else:
        track.active_material_version_id = None


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
    archive = _append_track_material_archive(
        studio,
        track,
        snapshots=snapshots,
        timestamp=timestamp,
        reason=reason,
        pinned=pinned,
        label=_default_archive_label(reason),
    )
    return archive


def ensure_original_recording_material_version(
    studio: Studio,
    track: TrackSlot,
    *,
    timestamp: str,
) -> TrackMaterialArchive | None:
    existing = next(
        (
            archive
            for archive in studio.track_material_archives
            if archive.track_slot_id == track.slot_id
            and archive.reason == "original_recording"
            and archive.pinned
        ),
        None,
    )
    if existing is not None:
        return existing
    snapshots = _current_track_material_snapshots(studio, track)
    if not snapshots or not any(snapshot.audio_source_path for snapshot in snapshots):
        return None
    return _append_track_material_archive(
        studio,
        track,
        snapshots=snapshots,
        timestamp=timestamp,
        reason="original_recording",
        pinned=True,
        label="원본 녹음",
    )


def create_tuned_recording_material_version(
    studio: Studio,
    track: TrackSlot,
    *,
    audio_mime_type: str,
    audio_source_path: str,
    based_on_archive_id: str | None,
    label: str,
    timestamp: str,
) -> TrackMaterialArchive:
    snapshots = _current_track_material_snapshots(studio, track)
    if not snapshots:
        raise HTTPException(status_code=409, detail="편집을 반영할 트랙 내용이 없습니다.")
    tuned_snapshots = []
    for snapshot in snapshots:
        tuned_snapshot = snapshot.model_copy(deep=True)
        tuned_snapshot.audio_source_path = audio_source_path
        tuned_snapshot.audio_mime_type = audio_mime_type
        tuned_snapshot.source_kind = "audio"
        tuned_snapshot.source_label = label
        tuned_snapshot.diagnostics = {
            **tuned_snapshot.diagnostics,
            "tuning_render": {
                "based_on_archive_id": based_on_archive_id,
                "created_at": timestamp,
            },
        }
        tuned_snapshots.append(tuned_snapshot)
    return _append_track_material_archive(
        studio,
        track,
        snapshots=tuned_snapshots,
        timestamp=timestamp,
        reason="tuned_recording",
        pinned=False,
        label=label,
        based_on_archive_id=based_on_archive_id,
    )


def restore_track_material_archive(
    studio: Studio,
    track: TrackSlot,
    archive: TrackMaterialArchive,
) -> None:
    if archive.track_slot_id != track.slot_id:
        raise HTTPException(status_code=409, detail="이 버전은 원래 트랙으로만 되돌릴 수 있습니다.")

    snapshots = [
        _normalized_region_snapshot(region, track)
        for region in archive.region_snapshots
        if region.track_slot_id == track.slot_id
    ]
    if not snapshots:
        raise HTTPException(status_code=409, detail="되돌릴 수 있는 트랙 내용이 없습니다.")
    _replace_track_regions(studio, track.slot_id, snapshots)

    track.status = "registered"
    source_region = snapshots[0]
    track.source_kind = source_region.source_kind or archive.source_kind
    track.source_label = source_region.source_label or archive.source_label
    track.audio_source_path = source_region.audio_source_path
    track.audio_source_label = source_region.source_label if source_region.audio_source_path else None
    track.audio_mime_type = source_region.audio_mime_type
    track.active_material_version_id = archive.archive_id
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


def _append_track_material_archive(
    studio: Studio,
    track: TrackSlot,
    *,
    snapshots: list[ArrangementRegion],
    timestamp: str,
    reason: TrackMaterialArchiveReason,
    pinned: bool,
    label: str | None = None,
    based_on_archive_id: str | None = None,
) -> TrackMaterialArchive:
    source_region = snapshots[0]
    archive = TrackMaterialArchive(
        archive_id=f"track-archive-{uuid4().hex}",
        track_slot_id=track.slot_id,
        track_name=track.name,
        source_kind=source_region.source_kind or track.source_kind,
        source_label=source_region.source_label or track.source_label,
        label=label,
        based_on_archive_id=based_on_archive_id,
        archived_at=timestamp,
        reason=reason,
        pinned=pinned,
        region_snapshots=snapshots,
    )
    studio.track_material_archives.insert(0, archive)
    _prune_track_material_archives(studio, track.slot_id)
    return archive


def _default_archive_label(reason: TrackMaterialArchiveReason) -> str | None:
    if reason == "original_score":
        return "원본 악보"
    if reason == "original_recording":
        return "원본 녹음"
    if reason == "tuned_recording":
        return "보정본"
    if reason == "previous_active":
        return "이전 사용본"
    return None


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


def ensure_audio_source_anchors_for_track(studio: Studio, track: TrackSlot) -> bool:
    changed = False
    source_anchor_regions = _recording_archive_regions_by_event_id(studio, track.slot_id)
    for region in studio.regions:
        if region.track_slot_id != track.slot_id or not region.audio_source_path or not region.pitch_events:
            continue
        changed = _ensure_region_audio_source_anchors(
            region,
            source_events=source_anchor_regions,
        ) or changed
    return changed


def _recording_archive_regions_by_event_id(
    studio: Studio,
    slot_id: int,
) -> dict[str, PitchEvent]:
    events_by_id: dict[str, PitchEvent] = {}
    for archive in studio.track_material_archives:
        if archive.track_slot_id != slot_id or archive.reason != "original_recording" or not archive.pinned:
            continue
        for region in archive.region_snapshots:
            for event in region.pitch_events:
                events_by_id.setdefault(event.event_id, event)
    return events_by_id


def _ensure_region_audio_source_anchors(
    region: ArrangementRegion,
    *,
    source_events: dict[str, PitchEvent] | None = None,
) -> bool:
    diagnostics = dict(region.diagnostics or {})
    existing = diagnostics.get("audio_source_anchors")
    anchors: dict[str, Any] = dict(existing) if isinstance(existing, dict) else {}
    changed = not isinstance(existing, dict)
    source_events = source_events or {}
    for event in region.pitch_events:
        if event.is_rest or event.event_id in anchors:
            continue
        source_event = source_events.get(event.event_id) or event
        anchors[event.event_id] = _audio_source_anchor_payload(event, source_event)
        changed = True
    if changed:
        diagnostics["audio_source_anchors"] = anchors
        region.diagnostics = diagnostics
    return changed


def _audio_source_anchor_payload(event: PitchEvent, source_event: PitchEvent) -> dict[str, Any]:
    source_duration_seconds = max(0.0, source_event.duration_seconds)
    return {
        "source_event_id": source_event.event_id,
        "source_start_seconds": source_event.start_seconds,
        "source_duration_seconds": source_duration_seconds,
        "source_pitch_hz": _event_frequency_hz(source_event),
        "voiced_start_offset": 0.0,
        "voiced_duration_seconds": source_duration_seconds,
        "confidence": event.confidence,
    }


def _event_frequency_hz(event: PitchEvent) -> float | None:
    if event.pitch_hz is not None and event.pitch_hz > 0:
        return event.pitch_hz
    if event.pitch_midi is None:
        return None
    return 440.0 * (2.0 ** ((event.pitch_midi - 69) / 12.0))


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
    non_pinned_limit = max(0, get_settings().track_archive_non_pinned_limit)
    non_pinned_seen = 0
    kept_archive_ids: set[str] = set()
    for archive in studio.track_material_archives:
        if archive.track_slot_id != slot_id:
            kept_archive_ids.add(archive.archive_id)
            continue
        if archive.pinned:
            kept_archive_ids.add(archive.archive_id)
            continue
        if non_pinned_seen < non_pinned_limit:
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
