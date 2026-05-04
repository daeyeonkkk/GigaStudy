from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import (
    PerformanceEvent,
    ScoreTrackRequest,
    Studio,
    TrackSlot,
)
from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.extraction_plan import default_voice_extraction_plan
from gigastudy_api.services.engine.voice import VoiceTranscriptionError
from gigastudy_api.services.engine.timeline import registered_region_events_for_slot
from gigastudy_api.services.llm.extraction_plan import plan_voice_extraction_with_deepseek
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_scoring import (
    ScoringRequestError,
    build_score_track_report,
    score_track_request_has_performance,
    selected_scoring_reference_slot_ids,
    validate_score_track_request,
)
from gigastudy_api.services.studio_operation_guards import ensure_no_active_extraction_jobs


class StudioScoringCommands:
    def __init__(
        self,
        *,
        assets: StudioAssetService,
        now: Callable[[], str],
        repository: Any,
    ) -> None:
        self._assets = assets
        self._now = now
        self._repository = repository

    def score_track(
        self,
        studio_id: str,
        slot_id: int,
        request: ScoreTrackRequest,
        *,
        owner_token: str | None = None,
    ) -> Studio:
        studio = self._repository.get_studio(studio_id, owner_token=owner_token, enforce_owner=True)
        target_track = self._repository._find_track(studio, slot_id)
        reference_slot_ids = selected_scoring_reference_slot_ids(
            studio,
            target_slot_id=slot_id,
            requested_reference_slot_ids=request.reference_slot_ids,
        )
        ensure_no_active_extraction_jobs(
            studio,
            {slot_id, *reference_slot_ids},
            action_label="Scoring",
        )
        target_events = registered_region_events_for_slot(studio, slot_id)
        try:
            validate_score_track_request(
                request,
                target_track=target_track,
                reference_slot_ids=reference_slot_ids,
                target_has_events=bool(target_events),
            )
        except ScoringRequestError as error:
            raise HTTPException(status_code=error.status_code, detail=error.detail) from error

        performance_events = [
            _track_event_from_performance_event(event)
            for event in request.performance_events
        ]
        has_submitted_performance = score_track_request_has_performance(request)
        if request.performance_audio_base64 is not None:
            performance_events = self.extract_scoring_audio(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=request.performance_filename or "scoring-take.wav",
                content_base64=request.performance_audio_base64,
                studio=studio,
                target_track=target_track,
                score_mode=request.score_mode,
                reference_slot_ids=reference_slot_ids,
                bpm=studio.bpm,
                time_signature_numerator=studio.time_signature_numerator,
                time_signature_denominator=studio.time_signature_denominator,
            )

        if not has_submitted_performance:
            raise HTTPException(
                status_code=422,
                detail="Scoring requires a recorded performance with detectable pitch events.",
            )

        timestamp = self._now()
        report = build_score_track_report(
            studio=studio,
            target_slot_id=slot_id,
            target_track=target_track,
            request=request,
            reference_slot_ids=reference_slot_ids,
            performance_events=performance_events,
            created_at=timestamp,
        )

        with self._repository._lock:
            studio = self._repository._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            studio.reports.append(report)
            studio.updated_at = timestamp
            self._repository._save_studio(studio)
        return studio

    def extract_scoring_audio(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_base64: str,
        bpm: int,
        time_signature_numerator: int,
        time_signature_denominator: int,
        studio: Studio | None = None,
        target_track: TrackSlot | None = None,
        score_mode: str = "answer",
        reference_slot_ids: list[int] | None = None,
    ) -> list[TrackPitchEvent]:
        source_path = self._assets.save_temp_upload(
            studio_id=studio_id,
            slot_id=slot_id,
            filename=filename,
            content_base64=content_base64,
        )
        try:
            extraction_plan = None
            if studio is not None and target_track is not None:
                extraction_plan = self._build_scoring_extraction_plan(
                    studio=studio,
                    slot_id=slot_id,
                    target_track=target_track,
                    score_mode=score_mode,
                    reference_slot_ids=reference_slot_ids or [],
                    source_label=filename,
                )
            return self._repository._transcribe_voice_file(
                source_path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                extraction_plan=extraction_plan,
            )
        except VoiceTranscriptionError:
            return []
        finally:
            self._assets.delete_temp_file(source_path)

    def _build_scoring_extraction_plan(
        self,
        *,
        studio: Studio,
        slot_id: int,
        target_track: TrackSlot,
        score_mode: str,
        reference_slot_ids: list[int],
        source_label: str,
    ):
        reference_slot_set = set(reference_slot_ids)
        context_tracks_by_slot: dict[int, list[TrackPitchEvent]] = {}
        for track in studio.tracks:
            if track.slot_id not in reference_slot_set:
                continue
            track_events = registered_region_events_for_slot(studio, track.slot_id)
            if track_events:
                context_tracks_by_slot[track.slot_id] = track_events
        expected_events: list[TrackPitchEvent] = []
        if score_mode == "answer":
            expected_events = registered_region_events_for_slot(studio, target_track.slot_id)
            context_tracks_by_slot[target_track.slot_id] = expected_events

        extraction_plan = default_voice_extraction_plan(
            slot_id=slot_id,
            bpm=studio.bpm,
            source_kind="recording",
            context_tracks_by_slot=context_tracks_by_slot,
        )
        llm_plan = plan_voice_extraction_with_deepseek(
            settings=get_settings(),
            base_plan=extraction_plan,
            title=studio.title,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            source_kind=f"evaluation_{score_mode}",
            source_label=source_label,
            context_tracks_by_slot=context_tracks_by_slot,
            expected_track_events=expected_events,
        )
        return llm_plan or extraction_plan


def _track_event_from_performance_event(event: PerformanceEvent) -> TrackPitchEvent:
    payload = {
        "label": event.label,
        "pitch_midi": event.pitch_midi,
        "pitch_hz": event.pitch_hz,
        "onset_seconds": event.start_seconds,
        "duration_seconds": event.duration_seconds,
        "beat": event.start_beat,
        "duration_beats": event.duration_beats,
        "confidence": event.confidence,
        "source": event.source,
        "extraction_method": event.extraction_method,
        "is_rest": event.is_rest,
        "measure_index": event.measure_index,
        "beat_in_measure": event.beat_in_measure,
        "quality_warnings": event.quality_warnings,
    }
    if event.event_id:
        payload["id"] = event.event_id
        payload["region_event_id"] = event.event_id
    if event.region_id:
        payload["region_id"] = event.region_id
    return TrackPitchEvent(**payload)
