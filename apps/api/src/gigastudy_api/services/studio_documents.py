from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import (
    ArrangementRegion,
    SourceKind,
    Studio,
    StudioListItem,
    TrackSlot,
    build_arrangement_region_from_track_events,
    sync_studio_arrangement_regions,
    sync_studio_candidate_regions,
)
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import TRACKS


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
    track.status = "registered"
    track.source_kind = source_kind
    track.source_label = source_label
    track.audio_source_path = audio_source_path
    track.audio_source_label = audio_source_label
    track.audio_mime_type = audio_mime_type
    track.duration_seconds = duration_seconds
    track.diagnostics = {"registration_quality": registration_diagnostics}
    track.updated_at = timestamp
    region = build_arrangement_region_from_track_events(track, events=events, bpm=studio.bpm)
    _replace_track_region(studio, track.slot_id, region)
    track.events = []


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
    return payload


def studio_list_item_from_payload(studio_id: str, studio_payload: Any) -> StudioListItem:
    if not isinstance(studio_payload, dict):
        raise HTTPException(status_code=500, detail="Stored studio payload is invalid.")
    shallow_payload = dict(studio_payload)
    report_count = payload_sidecar_count(shallow_payload, "reports")
    shallow_payload["reports"] = []
    shallow_payload["candidates"] = []
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
