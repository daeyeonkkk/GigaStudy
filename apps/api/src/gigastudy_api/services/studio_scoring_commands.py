from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import ScoreTrackRequest, Studio, TrackNote
from gigastudy_api.services.engine.voice import VoiceTranscriptionError
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_scoring import (
    ScoringRequestError,
    build_score_track_report,
    score_track_request_has_performance,
    selected_scoring_reference_slot_ids,
    validate_score_track_request,
)


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
        try:
            validate_score_track_request(
                request,
                target_track=target_track,
                reference_slot_ids=reference_slot_ids,
            )
        except ScoringRequestError as error:
            raise HTTPException(status_code=error.status_code, detail=error.detail) from error

        performance_notes = list(request.performance_notes)
        has_submitted_performance = score_track_request_has_performance(request)
        if request.performance_audio_base64 is not None:
            performance_notes = self.extract_scoring_audio(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=request.performance_filename or "scoring-take.wav",
                content_base64=request.performance_audio_base64,
                bpm=studio.bpm,
                time_signature_numerator=studio.time_signature_numerator,
                time_signature_denominator=studio.time_signature_denominator,
            )

        if not has_submitted_performance:
            raise HTTPException(
                status_code=422,
                detail="Scoring requires a recorded performance with detectable notes.",
            )

        timestamp = self._now()
        report = build_score_track_report(
            studio=studio,
            target_slot_id=slot_id,
            target_track=target_track,
            request=request,
            reference_slot_ids=reference_slot_ids,
            performance_notes=performance_notes,
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
    ) -> list[TrackNote]:
        source_path = self._assets.save_temp_upload(
            studio_id=studio_id,
            slot_id=slot_id,
            filename=filename,
            content_base64=content_base64,
        )
        try:
            return self._repository._transcribe_voice_file(
                source_path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
        except VoiceTranscriptionError:
            return []
        finally:
            self._assets.delete_temp_file(source_path)
