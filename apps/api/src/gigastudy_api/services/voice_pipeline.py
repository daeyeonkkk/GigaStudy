from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.extraction_plan import default_voice_extraction_plan
from gigastudy_api.services.engine.timeline import registered_region_events_by_slot
from gigastudy_api.services.engine.voice import VoiceTranscriptionResult
from gigastudy_api.services.engine_queue import EngineQueueJob
from gigastudy_api.services.llm.extraction_plan import plan_voice_extraction_with_deepseek


@dataclass(frozen=True)
class VoicePipelineResult:
    events: list[TrackPitchEvent]
    relative_audio_path: str
    source_label: str
    audio_mime_type: str
    diagnostics: dict[str, Any]


def run_voice_pipeline(
    *,
    audio_mime_type: str,
    record: EngineQueueJob,
    replace_audio_asset_with_aligned_wav: Callable[..., Path],
    source_label: str,
    source_path: Path,
    studio: Studio,
    transcribe_with_alignment: Callable[..., VoiceTranscriptionResult],
) -> VoicePipelineResult:
    source_kind = str(getattr(record, "source_kind", None) or record.payload.get("source_kind") or "audio")
    context_tracks_by_slot = registered_region_events_by_slot(studio, exclude_slot_id=record.slot_id)
    settings = get_settings()
    extraction_plan = default_voice_extraction_plan(
        slot_id=record.slot_id,
        bpm=studio.bpm,
        source_kind=source_kind,
        context_tracks_by_slot=context_tracks_by_slot,
    )
    llm_plan = plan_voice_extraction_with_deepseek(
        settings=settings,
        base_plan=extraction_plan,
        title=studio.title,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        source_kind=source_kind,
        source_label=source_label,
        context_tracks_by_slot=context_tracks_by_slot,
    )
    if llm_plan is not None:
        extraction_plan = llm_plan

    transcription = transcribe_with_alignment(
        source_path,
        bpm=studio.bpm,
        slot_id=record.slot_id,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
        extraction_plan=extraction_plan,
    )
    relative_audio_path = str(record.payload.get("input_path") or "")
    replace_audio_asset_with_aligned_wav(
        relative_audio_path=relative_audio_path,
        source_path=source_path,
        source_label=source_label,
        audio_mime_type=audio_mime_type,
        transcription=transcription,
    )
    return VoicePipelineResult(
        events=transcription.events,
        relative_audio_path=relative_audio_path,
        source_label=source_label,
        audio_mime_type=audio_mime_type,
        diagnostics={
            **(transcription.diagnostics or {}),
            "context_track_count": len(context_tracks_by_slot),
        },
    )
