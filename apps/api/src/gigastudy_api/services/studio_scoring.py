from __future__ import annotations

from gigastudy_api.api.schemas.studios import (
    ScoreTrackRequest,
    ScoringReport,
    Studio,
    TrackSlot,
)
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.scoring import (
    build_harmony_scoring_report,
    build_scoring_report,
)
from gigastudy_api.services.engine.timeline import registered_region_events_for_slot


class ScoringRequestError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def selected_scoring_reference_slot_ids(
    studio: Studio,
    *,
    target_slot_id: int,
    requested_reference_slot_ids: list[int],
) -> list[int]:
    valid_reference_ids = {
        track.slot_id for track in studio.tracks if track.status == "registered"
    }
    return [
        reference_id
        for reference_id in requested_reference_slot_ids
        if reference_id in valid_reference_ids and reference_id != target_slot_id
    ]


def validate_score_track_request(
    request: ScoreTrackRequest,
    *,
    target_track: TrackSlot,
    reference_slot_ids: list[int],
    target_has_events: bool | None = None,
) -> None:
    has_target_events = bool(target_track.events) if target_has_events is None else target_has_events
    if request.score_mode == "answer" and (
        target_track.status != "registered" or not has_target_events
    ):
        raise ScoringRequestError(409, "Scoring requires a registered answer track.")
    if (
        request.score_mode == "answer"
        and not reference_slot_ids
        and not request.include_metronome
    ):
        raise ScoringRequestError(422, "Choose at least one reference track or the metronome.")
    if request.score_mode == "harmony" and not reference_slot_ids:
        raise ScoringRequestError(422, "Harmony scoring requires at least one registered reference track.")


def score_track_request_has_performance(request: ScoreTrackRequest) -> bool:
    return (
        bool(request.performance_events)
        or request.performance_audio_base64 is not None
        or request.performance_asset_path is not None
    )


def build_score_track_report(
    *,
    studio: Studio,
    target_slot_id: int,
    target_track: TrackSlot,
    request: ScoreTrackRequest,
    reference_slot_ids: list[int],
    performance_events: list[TrackPitchEvent],
    created_at: str,
) -> ScoringReport:
    if request.score_mode == "harmony":
        reference_slot_id_set = set(reference_slot_ids)
        reference_tracks_by_slot = {
            track.slot_id: registered_region_events_for_slot(studio, track.slot_id)
            for track in studio.tracks
            if track.slot_id in reference_slot_id_set
        }
        return build_harmony_scoring_report(
            target_slot_id=target_slot_id,
            target_track_name=target_track.name,
            reference_slot_ids=reference_slot_ids,
            include_metronome=request.include_metronome,
            created_at=created_at,
            reference_tracks_by_slot=reference_tracks_by_slot,
            performance_events=performance_events,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
        )

    answer_events = registered_region_events_for_slot(studio, target_track.slot_id)
    return build_scoring_report(
        target_slot_id=target_slot_id,
        target_track_name=target_track.name,
        reference_slot_ids=reference_slot_ids,
        include_metronome=request.include_metronome,
        created_at=created_at,
        answer_events=answer_events,
        performance_events=performance_events,
        bpm=studio.bpm,
    )
