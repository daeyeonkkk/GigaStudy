from __future__ import annotations

from gigastudy_api.api.schemas.studios import TrackNote, TrackSlot
from gigastudy_api.services.engine.music_theory import seconds_per_beat


def notes_with_sync_offset(
    notes: list[TrackNote],
    sync_offset_seconds: float,
    bpm: int,
    *,
    voice_index: int | None = None,
) -> list[TrackNote]:
    beat_offset = sync_offset_seconds / seconds_per_beat(bpm)
    return [
        note.model_copy(
            update={
                "onset_seconds": round(note.onset_seconds + sync_offset_seconds, 4),
                "beat": round(note.beat + beat_offset, 4),
                "voice_index": voice_index if note.voice_index is None else note.voice_index,
            }
        )
        for note in notes
    ]


def registered_sync_resolved_tracks_by_slot(
    tracks: list[TrackSlot],
    *,
    bpm: int,
    exclude_slot_id: int | None = None,
) -> dict[int, list[TrackNote]]:
    return {
        track.slot_id: notes_with_sync_offset(
            track.notes,
            track.sync_offset_seconds,
            bpm,
            voice_index=track.slot_id,
        )
        for track in tracks
        if track.slot_id != exclude_slot_id
        and track.status == "registered"
        and track.notes
    }


def registered_sync_resolved_tracks(
    tracks: list[TrackSlot],
    *,
    bpm: int,
    exclude_slot_id: int | None = None,
) -> list[list[TrackNote]]:
    return list(
        registered_sync_resolved_tracks_by_slot(
            tracks,
            bpm=bpm,
            exclude_slot_id=exclude_slot_id,
        ).values()
    )
