from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.services.engine.extraction_plan import default_voice_extraction_plan
from gigastudy_api.services.engine.music_theory import TRACKS, infer_slot_id
from gigastudy_api.services.engine.event_normalization import annotate_track_events_for_slot
from gigastudy_api.services.engine.voice import VoiceTranscriptionError, VoiceTranscriptionResult

TranscribeWithAlignment = Callable[..., VoiceTranscriptionResult]


def extract_home_audio_candidate(
    studio: Studio,
    source_path: Path,
    *,
    transcribe_with_alignment: TranscribeWithAlignment,
) -> tuple[int, VoiceTranscriptionResult, float]:
    attempts: list[tuple[int, VoiceTranscriptionResult, float]] = []
    errors: list[str] = []
    for slot_id, _track_name in TRACKS:
        if slot_id == 6:
            continue
        try:
            transcription = transcribe_with_alignment(
                source_path,
                bpm=studio.bpm,
                slot_id=slot_id,
                time_signature_numerator=studio.time_signature_numerator,
                time_signature_denominator=studio.time_signature_denominator,
                extraction_plan=default_voice_extraction_plan(
                    slot_id=slot_id,
                    bpm=studio.bpm,
                    source_kind="music",
                ),
            )
        except VoiceTranscriptionError as error:
            errors.append(str(error))
            continue
        events = transcription.events
        confidence = sum(event.confidence for event in events) / len(events)
        attempts.append((slot_id, transcription, confidence))

    if not attempts:
        detail = errors[0] if errors else "No usable audio events were extracted."
        raise VoiceTranscriptionError(detail)

    source_slot_id, transcription, confidence = max(
        attempts,
        key=lambda attempt: (len(attempt[1].events), attempt[2]),
    )
    suggested_slot_id = infer_slot_id(None, transcription.events, fallback=source_slot_id)
    return (
        suggested_slot_id,
        VoiceTranscriptionResult(
            events=annotate_track_events_for_slot(
                transcription.events,
                slot_id=suggested_slot_id,
            ),
            alignment=transcription.alignment,
            diagnostics=transcription.diagnostics,
        ),
        confidence,
    )
