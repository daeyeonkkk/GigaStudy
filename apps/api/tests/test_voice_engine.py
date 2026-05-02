import math
import random
import struct
import sys
import types
import wave
from io import BytesIO
from pathlib import Path

import pytest

from gigastudy_api.services.engine.music_theory import midi_to_frequency
from gigastudy_api.services.engine.extraction_plan import (
    apply_voice_extraction_instruction,
    default_voice_extraction_plan,
)
from gigastudy_api.services.engine.voice import (
    VoiceTranscriptionError,
    _estimate_metronome_phase_alignment,
    build_metronome_aligned_wav_bytes,
    transcribe_voice_file,
    transcribe_voice_file_with_alignment,
)


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

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=1, backend="local")

    assert [note.label for note in notes] == ["C5", "E5", "G5"]
    assert all(note.extraction_method == "wav_autocorrelation_v2" for note in notes)
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

    notes = transcribe_voice_file(wav_path, bpm=96, slot_id=2, backend="local")

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
        transcribe_voice_file(wav_path, bpm=120, slot_id=1, backend="local")


def test_voice_transcription_rejects_short_noisy_tonal_clicks(tmp_path: Path) -> None:
    wav_path = tmp_path / "clicky-room.wav"
    _write_mono_wav(
        wav_path,
        [
            (0.2, None, 0),
            (0.04, 72, 0.45),
            (0.16, None, 0),
            (0.04, 76, 0.42),
            (0.18, None, 0),
            (0.04, 79, 0.4),
            (0.4, None, 0),
        ],
        noise_amplitude=0.035,
    )

    with pytest.raises(VoiceTranscriptionError, match="No .*voiced|No stable voiced"):
        transcribe_voice_file(wav_path, bpm=120, slot_id=1, backend="local")


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

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=1, backend="local")

    assert [note.label for note in notes] == ["C5", "E5"]
    assert min(note.confidence for note in notes) > 0.5


def test_voice_transcription_estimates_pre_registration_metronome_alignment() -> None:
    alignment = _estimate_metronome_phase_alignment(
        [
            (0.13, 0.4, 0.9),
            (0.63, 0.4, 0.9),
            (1.13, 0.4, 0.9),
        ],
        bpm=120,
    )

    assert alignment.applied is True
    assert alignment.offset_seconds == pytest.approx(-0.13, abs=0.01)
    assert alignment.aligned_distance_beats < alignment.baseline_distance_beats


def test_voice_transcription_rejects_non_wav_input(tmp_path: Path) -> None:
    mp3_path = tmp_path / "voice.mp3"
    mp3_path.write_bytes(b"not really mp3")

    with pytest.raises(VoiceTranscriptionError, match="Only WAV"):
        transcribe_voice_file(mp3_path, bpm=120, slot_id=1)


def test_voice_transcription_can_use_optional_basic_pitch_backend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav_path = tmp_path / "basic-pitch.wav"
    _write_mono_wav(wav_path, [(1.0, None, 0)])

    package = types.ModuleType("basic_pitch")
    inference = types.ModuleType("basic_pitch.inference")

    def fake_predict(_path: str):
        return None, None, [(0.0, 0.48, 72, 0.91), (0.5, 0.98, 76, 0.87)]

    inference.predict = fake_predict  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "basic_pitch", package)
    monkeypatch.setitem(sys.modules, "basic_pitch.inference", inference)

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=1, backend="basic_pitch")

    assert [note.label for note in notes] == ["C5", "E5"]
    assert all(note.extraction_method == "basic_pitch_amt_v1" for note in notes)
    assert all(note.pitch_register == "upper_voice" for note in notes)


def test_basic_pitch_notes_are_aligned_before_quantization(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav_path = tmp_path / "basic-pitch-late.wav"
    _write_mono_wav(wav_path, [(1.0, None, 0)])

    package = types.ModuleType("basic_pitch")
    inference = types.ModuleType("basic_pitch.inference")

    def fake_predict(_path: str):
        return None, None, [(0.13, 0.48, 72, 0.91), (0.63, 0.98, 76, 0.87)]

    inference.predict = fake_predict  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "basic_pitch", package)
    monkeypatch.setitem(sys.modules, "basic_pitch.inference", inference)

    result = transcribe_voice_file_with_alignment(wav_path, bpm=120, slot_id=1, backend="basic_pitch")
    notes = result.events

    assert [note.label for note in notes] == ["C5", "E5"]
    assert [note.beat for note in notes] == [1, 2]
    assert result.alignment.offset_seconds == pytest.approx(-0.13, abs=0.01)


def test_pre_extraction_plan_controls_voice_quantization(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav_path = tmp_path / "basic-pitch-planned.wav"
    _write_mono_wav(wav_path, [(1.0, None, 0)])

    package = types.ModuleType("basic_pitch")
    inference = types.ModuleType("basic_pitch.inference")

    def fake_predict(_path: str):
        return None, None, [(0.14, 0.59, 72, 0.91), (0.88, 1.31, 76, 0.87)]

    inference.predict = fake_predict  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "basic_pitch", package)
    monkeypatch.setitem(sys.modules, "basic_pitch.inference", inference)

    plan = apply_voice_extraction_instruction(
        default_voice_extraction_plan(slot_id=1, bpm=120),
        confidence=0.86,
        provider="test_llm",
        model="unit",
        quantization_grid=0.5,
        min_segment_policy="strict",
        confidence_policy="strict",
        reasons=["Prefer score-readable half-beat placement."],
    )
    result = transcribe_voice_file_with_alignment(
        wav_path,
        bpm=120,
        slot_id=1,
        backend="basic_pitch",
        extraction_plan=plan,
    )

    assert [note.label for note in result.events] == ["C5", "E5"]
    assert all(note.quantization_grid == 0.5 for note in result.events)
    assert result.diagnostics is not None
    diagnostic_plan = result.diagnostics["voice_extraction_plan"]
    assert isinstance(diagnostic_plan, dict)
    assert diagnostic_plan["provider"] == "test_llm"
    assert diagnostic_plan["used_llm"] is True
    assert diagnostic_plan["quantization_grid"] == 0.5


def test_metronome_aligned_wav_bytes_trim_and_pad_source_audio(tmp_path: Path) -> None:
    wav_path = tmp_path / "align-source.wav"
    _write_mono_wav(wav_path, [(0.5, None, 0), (0.5, 72, 0.2)], sample_rate=8000)

    trimmed = build_metronome_aligned_wav_bytes(wav_path, -0.25)
    padded = build_metronome_aligned_wav_bytes(wav_path, 0.25)

    assert trimmed is not None
    assert padded is not None
    with wave.open(str(wav_path), "rb") as original_wav:
        original_frames = original_wav.getnframes()
    with wave.open(BytesIO(trimmed), "rb") as trimmed_wav:
        assert trimmed_wav.getnframes() == original_frames - 2000
    with wave.open(BytesIO(padded), "rb") as padded_wav:
        assert padded_wav.getnframes() == original_frames + 2000


def test_voice_transcription_can_use_librosa_pyin_backend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav_path = tmp_path / "pyin-soprano.wav"
    _write_mono_wav(wav_path, [(1.0, None, 0)])

    fake_librosa = types.ModuleType("librosa")
    fake_numpy = types.ModuleType("numpy")
    frame_frequencies = (
        [midi_to_frequency(72)] * 8
        + [float("nan")] * 4
        + [midi_to_frequency(76)] * 8
    )
    voiced_flags = [True] * 8 + [False] * 4 + [True] * 8
    probabilities = [0.86] * len(frame_frequencies)

    def fake_load(_path: str, *, sr: int, mono: bool):
        assert mono is True
        return [0.2] * sr, sr

    def fake_pyin(_samples, *, fmin, fmax, sr, frame_length, hop_length):
        assert fmin < midi_to_frequency(72) < fmax
        assert sr == 22_050
        assert frame_length == 2048
        assert hop_length == 512
        return frame_frequencies, voiced_flags, probabilities

    def fake_frames_to_time(frames, *, sr: int, hop_length: int):
        return [index * hop_length / sr for index in frames]

    def fake_arange(count: int):
        return list(range(count))

    def fake_isfinite(value: float):
        return math.isfinite(value)

    fake_feature = types.SimpleNamespace(rms=lambda **_kwargs: [[0.2] * len(frame_frequencies)])
    fake_librosa.load = fake_load  # type: ignore[attr-defined]
    fake_librosa.pyin = fake_pyin  # type: ignore[attr-defined]
    fake_librosa.frames_to_time = fake_frames_to_time  # type: ignore[attr-defined]
    fake_librosa.feature = fake_feature  # type: ignore[attr-defined]
    fake_numpy.arange = fake_arange  # type: ignore[attr-defined]
    fake_numpy.isfinite = fake_isfinite  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)
    monkeypatch.setitem(sys.modules, "numpy", fake_numpy)

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=1, backend="librosa")

    assert [note.label for note in notes] == ["C5", "E5"]
    assert all(note.extraction_method == "librosa_pyin_v1" for note in notes)
    assert all(note.quantization_grid == 0.25 for note in notes)
