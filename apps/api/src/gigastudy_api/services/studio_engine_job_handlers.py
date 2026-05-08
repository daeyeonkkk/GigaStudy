from __future__ import annotations

from collections.abc import Callable
import logging
from pathlib import Path
from time import perf_counter
from typing import Any

from gigastudy_api.config import get_settings
from gigastudy_api.api.schemas.studios import AudioExportRequest, GenerateTrackRequest, ScoreTrackRequest
from gigastudy_api.services.engine.candidate_diagnostics import (
    candidate_diagnostics,
    candidate_review_message,
    estimate_candidate_confidence,
    parsed_track_diagnostics_by_slot,
)
from gigastudy_api.services.engine.document_results import mark_events_as_document
from gigastudy_api.services.engine.audio_mix_export import (
    AudioExportError,
    encode_wav_to_mp3,
    render_audio_mix_wav,
)
from gigastudy_api.services.engine.event_normalization import annotate_track_events_for_slot
from gigastudy_api.services.engine.symbolic import (
    ParsedSymbolicFile,
    midi_seed_empty_named_parts,
    symbolic_seed_review_reasons,
)
from gigastudy_api.services.engine_queue import EngineQueueJob
from gigastudy_api.services.document_extraction_pipeline import (
    DocumentExtractionPipelineError,
    DocumentExtractionPipelineResult,
    run_document_extraction_pipeline,
)
from gigastudy_api.services.llm.midi_role_review import apply_midi_role_review_instruction
from gigastudy_api.services.llm.provider import review_midi_roles
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_documents import studio_has_active_track_material
from gigastudy_api.services.performance import record_metric
from gigastudy_api.services.upload_policy import guess_audio_mime_type
from gigastudy_api.services.voice_pipeline import run_voice_pipeline

logger = logging.getLogger("gigastudy_api.engine_jobs")


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
        started_at = perf_counter()
        outcome = "completed"
        try:
            if record.job_type == "document":
                self.process_document_extraction(record)
                return
            if record.job_type == "voice":
                self.process_voice(record)
                return
            if record.job_type == "generation":
                self.process_generation(record)
                return
            if record.job_type == "scoring":
                self.process_scoring(record)
                return
            if record.job_type == "export":
                self.process_audio_export(record)
                return
            raise RuntimeError(f"Unsupported engine job type: {record.job_type}")
        except Exception:
            outcome = "failed"
            raise
        finally:
            elapsed_ms = (perf_counter() - started_at) * 1000
            record_metric("engine_job_ms", elapsed_ms)
            logger.info(
                "engine_job_duration job_id=%s studio_id=%s slot_id=%s job_type=%s attempt=%s outcome=%s duration_ms=%.1f",
                record.job_id,
                record.studio_id,
                record.slot_id,
                record.job_type,
                record.attempt_count,
                outcome,
                elapsed_ms,
            )

    def process_generation(self, record: EngineQueueJob) -> None:
        request = GenerateTrackRequest.model_validate(record.payload.get("request") or {})
        self._repository._generation.generate_track_now(
            record.studio_id,
            record.slot_id,
            request,
            job_id=record.job_id,
        )
        if not request.review_before_register:
            self._repository._mark_job_completed(
                record.studio_id,
                record.job_id,
                output_path="",
                method="ai_generation",
            )

    def process_scoring(self, record: EngineQueueJob) -> None:
        request = ScoreTrackRequest.model_validate(record.payload.get("request") or {})
        self._repository._scoring.score_track_now(
            record.studio_id,
            record.slot_id,
            request,
            job_id=record.job_id,
        )
        self._repository._mark_job_completed(
            record.studio_id,
            record.job_id,
            output_path=request.performance_asset_path or "",
            method="practice_scoring",
        )

    def process_audio_export(self, record: EngineQueueJob) -> None:
        request = AudioExportRequest.model_validate(record.payload.get("request") or {})
        studio = self._repository.get_studio(record.studio_id)
        output_dir = self._job_output_dir(record.studio_id, record.job_id)
        try:
            render_result = render_audio_mix_wav(
                output_dir=output_dir,
                request=request,
                resolve_asset_path=self._assets.resolve_data_asset_path,
                studio=studio,
            )
            final_path = render_result.wav_path
            if request.format == "mp3":
                self._repository._update_job_progress(
                    record.studio_id,
                    record.job_id,
                    stage="encoding",
                    stage_label="MP3로 변환하는 중입니다.",
                )
                final_path = encode_wav_to_mp3(render_result.wav_path, output_dir / "mix.mp3")
        except AudioExportError as error:
            self._repository._mark_job_failed(
                record.studio_id,
                record.job_id,
                message=str(error),
            )
            return

        output_reference = self._assets.persist_generated_asset(final_path)
        self._repository._mark_job_completed(
            record.studio_id,
            record.job_id,
            diagnostics={
                "audio_export_format": request.format,
                "audio_export_duration_seconds": round(render_result.duration_seconds, 3),
                "audio_export_master_gain": round(render_result.master_gain, 4),
                "audio_export_peak_before_master_gain": round(render_result.peak_before_master_gain, 4),
                "audio_export_track_count": render_result.selected_track_count,
            },
            output_path=output_reference,
            method="audio_export",
        )

    def process_document_extraction(self, record: EngineQueueJob) -> None:
        settings = get_settings()
        studio = self._repository.get_studio(record.studio_id)
        input_path = self._assets.resolve_data_asset_path(str(record.payload.get("input_path") or ""))
        source_label = str(record.payload.get("source_label") or "uploaded-document")
        try:
            result = run_document_extraction_pipeline(
                audiveris_bin=settings.audiveris_bin,
                audiveris_runner=self._repository._run_audiveris_document_extraction,
                backend=settings.document_extraction_backend,
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
        except DocumentExtractionPipelineError as error:
            self._repository._mark_job_failed(
                record.studio_id,
                record.job_id,
                diagnostics=error.diagnostics,
                message=str(error),
            )
            return

        parsed_symbolic = result.parsed_symbolic
        if result.direct_register_when_clear:
            self._process_symbolic_seed_result(
                record,
                parsed_symbolic=parsed_symbolic,
                output_reference=result.output_reference,
                source_label=source_label,
                result=result,
                studio=studio,
            )
            return

        mapped_events = mark_events_as_document(
            parsed_symbolic.mapped_events,
            extraction_method=result.extraction_method,
        )
        if not mapped_events:
            self._repository._mark_job_failed(
                record.studio_id,
                record.job_id,
                diagnostics=result.diagnostics,
                message="Document extraction did not produce any track events.",
            )
            return

        self._repository._mark_job_completed(
            record.studio_id,
            record.job_id,
            diagnostics=result.diagnostics,
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
                events,
                method=result.candidate_method,
                fallback_confidence=result.confidence,
                diagnostics=diagnostics_by_slot.get(slot_id),
            )
            for slot_id, events in mapped_events.items()
        }
        message_by_slot = {
            slot_id: candidate_review_message(
                slot_id,
                events,
                method=result.candidate_method,
                diagnostics=candidate_diagnostics(
                    slot_id,
                    events,
                    method=result.candidate_method,
                    confidence=confidence_by_slot[slot_id],
                    source_diagnostics=diagnostics_by_slot.get(slot_id),
                ),
                default_message=result.message,
            )
            for slot_id, events in mapped_events.items()
        }
        self._repository._add_extraction_candidates(
            record.studio_id,
            mapped_events,
            source_kind="document",
            source_label=source_label,
            method=result.candidate_method,
            confidence=result.confidence,
            confidence_by_slot=confidence_by_slot,
            diagnostics_by_slot=diagnostics_by_slot,
            job_id=record.job_id,
            message=result.message,
            message_by_slot=message_by_slot,
        )

    def _process_symbolic_seed_result(
        self,
        record: EngineQueueJob,
        *,
        parsed_symbolic: ParsedSymbolicFile,
        output_reference: str,
        source_label: str,
        result: DocumentExtractionPipelineResult,
        studio: Any,
    ) -> None:
        source_suffix = Path(source_label).suffix.lower()
        if result.registered_source_kind == "midi":
            midi_role_instruction = review_midi_roles(
                settings=get_settings(),
                title=studio.title,
                source_label=source_label,
                parsed_symbolic=parsed_symbolic,
            )
            apply_midi_role_review_instruction(
                parsed_symbolic=parsed_symbolic,
                instruction=midi_role_instruction,
                bpm=parsed_symbolic.source_bpm or studio.bpm,
            )

        mapped_events = {
            slot_id: annotate_track_events_for_slot(
                [
                    event.model_copy(
                        update={
                            "source": result.registered_source_kind,
                            "extraction_method": result.extraction_method,
                        }
                    )
                    for event in events
                ],
                slot_id=slot_id,
            )
            for slot_id, events in parsed_symbolic.mapped_events.items()
        }
        if not mapped_events:
            self._repository._mark_job_failed(
                record.studio_id,
                record.job_id,
                message="Score import did not produce any track events.",
            )
            return

        self._repository._apply_symbolic_seed_clock(
            record.studio_id,
            bpm=None,
            time_signature_numerator=None,
            time_signature_denominator=None,
        )

        review_reasons = symbolic_seed_review_reasons(parsed_symbolic, source_suffix=source_suffix)
        if review_reasons:
            diagnostics_by_slot = _symbolic_seed_diagnostics_by_slot(
                parsed_symbolic,
                review_reasons,
                source_suffix,
            )
            confidence_by_slot = {
                slot_id: estimate_candidate_confidence(
                    slot_id,
                    events,
                    method=result.candidate_method,
                    fallback_confidence=result.confidence,
                    diagnostics=diagnostics_by_slot.get(slot_id),
                )
                for slot_id, events in mapped_events.items()
            }
            message = (
                "Score parts need review before registration because some material still "
                f"looks ambiguous ({', '.join(review_reasons)})."
            )
            message_by_slot = {
                slot_id: candidate_review_message(
                    slot_id,
                    events,
                    method=result.candidate_method,
                    diagnostics=candidate_diagnostics(
                        slot_id,
                        events,
                        method=result.candidate_method,
                        confidence=confidence_by_slot[slot_id],
                        source_diagnostics=diagnostics_by_slot.get(slot_id),
                    ),
                    default_message=message,
                )
                for slot_id, events in mapped_events.items()
            }
            self._repository._mark_job_completed(
                record.studio_id,
                record.job_id,
                output_path=output_reference,
                method=result.job_method,
            )
            self._repository._add_extraction_candidates(
                record.studio_id,
                mapped_events,
                source_kind=result.registered_source_kind,
                source_label=source_label,
                method=result.candidate_method,
                confidence=result.confidence,
                confidence_by_slot=confidence_by_slot,
                diagnostics_by_slot=diagnostics_by_slot,
                job_id=record.job_id,
                message=message,
                message_by_slot=message_by_slot,
            )
            return

        self._repository._apply_extracted_tracks(
            record.studio_id,
            mapped_events,
            source_kind=result.registered_source_kind,
            source_label=source_label,
            progress_job_id=record.job_id,
        )
        self._repository._clear_unmapped_extraction_placeholders(
            record.studio_id,
            record.job_id,
            mapped_slot_ids=set(mapped_events),
        )
        self._repository._mark_job_completed(
            record.studio_id,
            record.job_id,
            output_path=output_reference,
            method=result.job_method,
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
            persist_voice_analysis_wav=self._assets.persist_voice_analysis_wav,
            source_label=source_label,
            source_path=source_path,
            studio=studio,
            transcribe_with_alignment=self._repository._transcribe_voice_file_with_alignment,
        )
        if review_before_register:
            self._repository._add_extraction_candidates(
                record.studio_id,
                {record.slot_id: result.events},
                source_kind="audio",
                source_label=result.source_label,
                method="voice_transcription_review",
                confidence=min((event.confidence for event in result.events), default=0.45),
                diagnostics_by_slot={record.slot_id: result.diagnostics},
                message="Voice transcription is waiting for user approval.",
                job_id=record.job_id,
                audio_source_path=result.relative_audio_path,
                audio_source_label=result.source_label,
                audio_mime_type=result.audio_mime_type,
            )
            return

        if studio_has_active_track_material(studio, record.slot_id) and not allow_overwrite:
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
            events=result.events,
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


def _symbolic_seed_diagnostics_by_slot(
    parsed_symbolic: ParsedSymbolicFile,
    review_reasons: list[str],
    source_suffix: str,
) -> dict[int, dict[str, Any]]:
    empty_named_parts = midi_seed_empty_named_parts(parsed_symbolic)
    return {
        track.slot_id: {
            **dict(track.diagnostics),
            "seed_review_reasons": review_reasons,
            "source_suffix": source_suffix,
            "midi_named_empty_parts": empty_named_parts,
        }
        for track in parsed_symbolic.tracks
        if track.slot_id is not None and track.slot_id in parsed_symbolic.mapped_events
    }
