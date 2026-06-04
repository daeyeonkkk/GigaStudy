from __future__ import annotations

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.timeline import registered_region_events_by_slot


def registration_context_events_by_slot(
    studio: Studio,
    *,
    exclude_slot_id: int,
) -> dict[int, list[TrackPitchEvent]]:
    return registered_region_events_by_slot(studio, exclude_slot_id=exclude_slot_id)


def registration_context_tracks(
    studio: Studio,
    *,
    exclude_slot_id: int,
) -> list[list[TrackPitchEvent]]:
    return list(
        registration_context_events_by_slot(
            studio,
            exclude_slot_id=exclude_slot_id,
        ).values()
    )
