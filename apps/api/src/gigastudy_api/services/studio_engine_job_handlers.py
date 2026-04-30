from __future__ import annotations

from pathlib import Path
from typing import Any
from collections.abc import Callable

from gigastudy_api.config import get_settings
from gigastudy_api.services.engine.candidate_diagnostics import (
    candidate_diagnostics,
    candidate_review_message,
    estimate_candidate_confidence,
    parsed_track_diagnostics_by_slot,
)
from gigastudy_api.services.engine.omr_results import mark_notes_as_omr
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile
from gigastudy_api.services.engine_queue import EngineQueueJob
from gigastudy_api.services.omr_pipeline import OmrPipelineError, run_omr_pipeline
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_documents import track_has_content
from gigastudy_api.services.upload_policy import guess_audio_mime_type
from gigastudy_api.services.voice_pipeline import run_voice_pipeline


class StudioEngineJobHandlers:
    def __init__(
        self,
        *,
        assets: StudioAssetService,
        repository: Any,
        root: Path,
        vector_parser: Callable[..., ParsedSymbolicFile],
    ) -> None:
        self._assets = assets
        self._repository = repository
        self._root = root
        self._vector_parser = vector_parser

    def process(self, record: EngineQueueJob) -> None:
        if record.job_type == "omr":
            self.process_omr(record)
            return
        if record.job_type == "voice":
            self.process_voice(record)
            return
        raise RuntimeError(f"Unsupported engine job type: {record.job_type}")

    def process_omr(self, record: EngineQueueJob) -> None:
        settings = get_settings()
        studio = self._repository.get_studio(record.studio_id)
        input_path = self._assets.resolve_data_asset_path(str(record.payload.get("input_path") or ""))
        source_label = str(record.payload.get("source_label") or "uploaded-score")
        try:
            result = run_omr_pipeline(
                audiveris_bin=settings.audiveris_bin,
                audiveris_runner=self._repository._run_audiveris_omr,
                backend=settings.omr_backend,
                input_path=input_path,
                job_output_dir=self._job_output_dir(record.studio_id, record.job_id),
                job_slot_id=record.slot_id,
                persist_generated_asset=self._assets.persist_generated_asset,
                record=record,
                source_label=source_label,
                studio=studio,
                timeout_seconds=settings.engine_processing_timeout_seconds,
                vector_parser=self._vector_parser,
            )
        except OmrPipelineError as error:
            self._repository._mark_job_failed(record.studio_id, record.job_id, message=str(error))
            return

        parsed_symbolic = result.parsed_symbolic
        mapped_notes = mark_notes_as_omr(
            parsed_symbolic.mapped_notes,
            extraction_method=result.extraction_method,
        )
        if not mapped_notes:
            self._repository._mark_job_failed(
                record.studio_id,
                record.job_id,
                message="OMR did not produce any track notes.",
            )
            return

        if parsed_symbolic.has_time_signature:
            self._repository._update_time_signature(
                record.studio_id,
                parsed_symbolic.time_signature_numerator,
                parsed_symbolic.time_signature_denominator,
            )
        self._repository._mark_job_completed(
            record.studio_id,
            record.job_id,
            output_path=result.output_reference,
            method=result.job_method,
        )
        diagnostics_by_slot = parsed_track_diagnostics_by_slot(
            parsed_symbolic,
            method=result.extraction_method,
            fallback_method=result.candidate_method,
        )
        confidence_by_slot = {
            slot_id: estimate_candidate_confidence(
                slot_id,
                notes,
                method=result.candidate_method,
                fallback_confidence=result.confidence,
                diagnostics=diagnostics_by_slot.get(slot_id),
            )
            for slot_id, notes in mapped_notes.items()
        }
        message_by_slot = {
            slot_id: candidate_review_message(
                slot_id,
                notes,
                method=result.candidate_method,
                diagnostics=candidate_diagnostics(
                    slot_id,
                    notes,
                    method=result.candidate_method,
                    confidence=confidence_by_slot[slot_id],
                    source_diagnostics=diagnostics_by_slot.get(slot_id),
                ),
                default_message=result.message,
            )
            for slot_id, notes in mapped_notes.items()
        }
        self._repository._add_extraction_candidates(
            record.studio_id,
            mapped_notes,
            source_kind="score",
            source_label=source_label,
            method=result.candidate_method,
            confidence=result.confidence,
            confidence_by_slot=confidence_by_slot,
            diagnostics_by_slot=diagnostics_by_slot,
            job_id=record.job_id,
            message=result.message,
            message_by_slot=message_by_slot,
        )

    def process_voice(self, record: EngineQueueJob) -> None:
        studio = self._repository.get_studio(record.studio_id)
        source_path = self._assets.resolve_data_asset_path(str(record.payload.get("input_path") or ""))
        source_label = str(record.payload.get("source_label") or "voice.wav")
        review_before_register = bool(record.payload.get("review_before_register"))
        allow_overwrite = bool(record.payload.get("allow_overwrite"))
        audio_mime_type = str(record.payload.get("audio_mime_type") or guess_audio_mime_type(source_label))
        result = run_voice_pipeline(
            audio_mime_type=audio_mime_type,
            record=record,
            replace_audio_asset_with_aligned_wav=self._assets.replace_audio_asset_with_aligned_wav,
            source_label=source_label,
            source_path=source_path,
            studio=studio,
            transcribe_with_alignment=self._repository._transcribe_voice_file_with_alignment,
        )
        if review_before_register:
            self._repository._add_extraction_candidates(
                record.studio_id,
                {record.slot_id: result.notes},
                source_kind="audio",
                source_label=result.source_label,
                method="voice_transcription_review",
                confidence=min((note.confidence for note in result.notes), default=0.45),
                diagnostics_by_slot={record.slot_id: result.diagnostics},
                message="Voice transcription is waiting for user approval.",
                job_id=record.job_id,
                audio_source_path=result.relative_audio_path,
                audio_source_label=result.source_label,
                audio_mime_type=result.audio_mime_type,
            )
            return

        track = self._repository._find_track(studio, record.slot_id)
        if track_has_content(track) and not allow_overwrite:
            self._repository._mark_job_failed(
                record.studio_id,
                record.job_id,
                message="Upload would overwrite an existing registered track.",
            )
            return
        self._repository._update_track(
            record.studio_id,
            record.slot_id,
            source_kind="audio",
            source_label=result.source_label,
            notes=result.notes,
            audio_source_path=result.relative_audio_path,
            audio_source_label=result.source_label,
            audio_mime_type=result.audio_mime_type,
            source_diagnostics=result.diagnostics,
        )
        self._repository._mark_job_completed(
            record.studio_id,
            record.job_id,
            output_path=result.relative_audio_path,
        )

    def _job_output_dir(self, studio_id: str, job_id: str) -> Path:
        return self._root / "jobs" / studio_id / job_id
