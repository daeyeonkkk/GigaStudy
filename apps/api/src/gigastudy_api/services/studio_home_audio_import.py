from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.services.engine.extraction_plan import default_voice_extraction_plan
from gigastudy_api.services.engine.music_theory import TRACKS, infer_slot_id
from gigastudy_api.services.engine.notation import annotate_track_notes_for_slot
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
        notes = transcription.notes
        confidence = sum(note.confidence for note in notes) / len(notes)
        attempts.append((slot_id, transcription, confidence))

    if not attempts:
        detail = errors[0] if errors else "No usable audio notes were extracted."
        raise VoiceTranscriptionError(detail)

    source_slot_id, transcription, confidence = max(
        attempts,
        key=lambda attempt: (len(attempt[1].notes), attempt[2]),
    )
    suggested_slot_id = infer_slot_id(None, transcription.notes, fallback=source_slot_id)
    return (
        suggested_slot_id,
        VoiceTranscriptionResult(
            notes=annotate_track_notes_for_slot(
                transcription.notes,
                slot_id=suggested_slot_id,
            ),
            alignment=transcription.alignment,
            diagnostics=transcription.diagnostics,
        ),
        confidence,
    )
