import math
import random
import struct
import wave
from pathlib import Path

import pytest

from gigastudy_api.services.engine.music_theory import midi_to_frequency
from gigastudy_api.services.engine.voice import VoiceTranscriptionError, transcribe_voice_file


def _write_mono_wav(
    path: Path,
    events: list[tuple[float, int | None, float]],
    *,
    noise_amplitude: float = 0,
    sample_rate: int = 16_000,
) -> None:
    rng = random.Random(17)
    samples: list[int] = []
    for duration_seconds, midi_note, amplitude in events:
        frame_count = round(duration_seconds * sample_rate)
        frequency = midi_to_frequency(midi_note) if midi_note is not None else None
        for index in range(frame_count):
            if frequency is None:
                sample = 0.0
            else:
                time_seconds = index / sample_rate
                fade = min(1.0, index / 160, (frame_count - index) / 160)
                sample = amplitude * fade * (
                    math.sin(2 * math.pi * frequency * time_seconds)
                    + 0.18 * math.sin(2 * math.pi * frequency * 2 * time_seconds)
                )
            if noise_amplitude > 0:
                sample += rng.uniform(-noise_amplitude, noise_amplitude)
            samples.append(round(max(-1.0, min(1.0, sample)) * 32767))

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def test_voice_transcription_detects_separated_notes_with_silence(tmp_path: Path) -> None:
    wav_path = tmp_path / "soprano-take.wav"
    _write_mono_wav(
        wav_path,
        [
            (0.2, None, 0),
            (0.45, 72, 0.22),
            (0.16, None, 0),
            (0.45, 76, 0.2),
            (0.14, None, 0),
            (0.5, 79, 0.2),
        ],
    )

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=1)

    assert [note.label for note in notes] == ["C5", "E5", "G5"]
    assert all(note.extraction_method == "wav_autocorrelation_v1" for note in notes)
    assert all(note.duration_beats >= 0.75 for note in notes)
    assert min(note.confidence for note in notes) > 0.55


def test_voice_transcription_uses_dynamic_threshold_for_quiet_takes(tmp_path: Path) -> None:
    wav_path = tmp_path / "quiet-alto-take.wav"
    _write_mono_wav(
        wav_path,
        [
            (0.3, None, 0),
            (0.55, 69, 0.028),
            (0.2, None, 0),
        ],
    )

    notes = transcribe_voice_file(wav_path, bpm=96, slot_id=2)

    assert [note.label for note in notes] == ["A4"]
    assert notes[0].confidence > 0.4


def test_voice_transcription_rejects_noise_without_stable_singing(tmp_path: Path) -> None:
    wav_path = tmp_path / "noisy-room.wav"
    _write_mono_wav(
        wav_path,
        [
            (1.6, None, 0),
        ],
        noise_amplitude=0.18,
    )

    with pytest.raises(VoiceTranscriptionError, match="No .*voiced|No stable voiced"):
        transcribe_voice_file(wav_path, bpm=120, slot_id=1)


def test_voice_transcription_tracks_singing_under_noise(tmp_path: Path) -> None:
    wav_path = tmp_path / "noisy-soprano-take.wav"
    _write_mono_wav(
        wav_path,
        [
            (0.2, None, 0),
            (0.5, 72, 0.24),
            (0.12, None, 0),
            (0.52, 76, 0.22),
        ],
        noise_amplitude=0.025,
    )

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=1)

    assert [note.label for note in notes] == ["C5", "E5"]
    assert min(note.confidence for note in notes) > 0.5


def test_voice_transcription_rejects_non_wav_input(tmp_path: Path) -> None:
    mp3_path = tmp_path / "voice.mp3"
    mp3_path.write_bytes(b"not really mp3")

    with pytest.raises(VoiceTranscriptionError, match="Only WAV"):
        transcribe_voice_file(mp3_path, bpm=120, slot_id=1)
