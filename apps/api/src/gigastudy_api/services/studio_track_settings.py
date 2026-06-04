from __future__ import annotations

from gigastudy_api.api.schemas.studios import Studio, TrackSlot


class TrackSettingsError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def set_track_sync_offset(
    track: TrackSlot,
    *,
    sync_offset_seconds: float,
    precision: int,
    timestamp: str,
) -> None:
    track.sync_offset_seconds = round(sync_offset_seconds, precision)
    track.updated_at = timestamp


def shift_registered_track_sync_offsets(
    studio: Studio,
    *,
    delta_seconds: float,
    precision: int,
    minimum_seconds: float,
    maximum_seconds: float,
    timestamp: str,
) -> None:
    registered_tracks = [track for track in studio.tracks if track.status == "registered"]
    if not registered_tracks:
        raise TrackSettingsError(
            409,
            "At least one registered track is required to shift sync.",
        )

    delta_seconds = round(delta_seconds, precision)
    next_offsets = {
        track.slot_id: round(track.sync_offset_seconds + delta_seconds, precision)
        for track in registered_tracks
    }
    out_of_range = [
        slot_id
        for slot_id, offset in next_offsets.items()
        if offset < minimum_seconds or offset > maximum_seconds
    ]
    if out_of_range:
        raise TrackSettingsError(
            422,
            "Sync shift would move a registered track outside the -30s to +30s range.",
        )

    for track in registered_tracks:
        track.sync_offset_seconds = next_offsets[track.slot_id]
        track.updated_at = timestamp


def set_track_volume(track: TrackSlot, *, volume_percent: int, timestamp: str) -> None:
    track.volume_percent = volume_percent
    track.updated_at = timestamp


def set_studio_time_signature(
    studio: Studio,
    *,
    numerator: int,
    denominator: int,
    timestamp: str,
) -> None:
    studio.time_signature_numerator = numerator
    studio.time_signature_denominator = denominator
    studio.updated_at = timestamp
