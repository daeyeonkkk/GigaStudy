from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from gigastudy_api.api.schemas.studios import Studio, TrackNote
from gigastudy_api.services.engine.voice import VoiceTranscriptionResult
from gigastudy_api.services.engine_queue import EngineQueueJob


@dataclass(frozen=True)
class VoicePipelineResult:
    notes: list[TrackNote]
    relative_audio_path: str
    source_label: str
    audio_mime_type: str


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
    transcription = transcribe_with_alignment(
        source_path,
        bpm=studio.bpm,
        slot_id=record.slot_id,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
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
        notes=transcription.notes,
        relative_audio_path=relative_audio_path,
        source_label=source_label,
        audio_mime_type=audio_mime_type,
    )
