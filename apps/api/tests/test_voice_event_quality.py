import math
import random
import struct
import wave
from dataclasses import dataclass
from pathlib import Path

from gigastudy_api.services.engine.music_theory import midi_to_frequency
from gigastudy_api.services.engine.voice import transcribe_voice_file


@dataclass(frozen=True)
class VocalEvent:
    duration_seconds: float
    midi_note: int | None
    amplitude: float = 0.22
    vibrato_cents: float = 0
    vibrato_hz: float = 5.4
    detune_cents: float = 0
    scoop_cents: float = 0
    local_noise: float = 0


def _write_vocal_fixture(
    path: Path,
    events: list[VocalEvent],
    *,
    sample_rate: int = 16_000,
    room_noise: float = 0,
    hum_hz: float | None = None,
) -> None:
    rng = random.Random(20260427)
    samples: list[int] = []

    for event in events:
        frame_count = round(event.duration_seconds * sample_rate)
        base_frequency = midi_to_frequency(event.midi_note) if event.midi_note is not None else None
        phase = 0.0
        for index in range(frame_count):
            time_seconds = index / sample_rate
            if base_frequency is None:
                sample = 0.0
            else:
                scoop = event.scoop_cents * max(0.0, 1.0 - time_seconds / 0.18)
                vibrato = event.vibrato_cents * math.sin(2 * math.pi * event.vibrato_hz * time_seconds)
                frequency = base_frequency * 2 ** ((event.detune_cents + scoop + vibrato) / 1200)
                phase += 2 * math.pi * frequency / sample_rate
                fade = min(1.0, index / 180, (frame_count - index) / 180)
                sample = event.amplitude * fade * (
                    math.sin(phase)
                    + 0.16 * math.sin(phase * 2)
                    + 0.05 * math.sin(phase * 3)
                )

            if hum_hz is not None:
                absolute_time = len(samples) / sample_rate
                sample += 0.018 * math.sin(2 * math.pi * hum_hz * absolute_time)
            if room_noise > 0:
                sample += rng.uniform(-room_noise, room_noise)
            if event.local_noise > 0:
                sample += rng.uniform(-event.local_noise, event.local_noise)

            samples.append(round(max(-1.0, min(1.0, sample)) * 32767))

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def test_voice_event_quantizes_human_timing_to_fixed_bpm_grid(tmp_path: Path) -> None:
    wav_path = tmp_path / "late-but-on-grid.wav"
    _write_vocal_fixture(
        wav_path,
        [
            VocalEvent(0.04, None),
            VocalEvent(0.48, 72),
            VocalEvent(0.03, None),
            VocalEvent(0.47, 74),
            VocalEvent(0.05, None),
            VocalEvent(0.46, 76),
        ],
        room_noise=0.01,
    )

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=1, backend="local")

    assert [note.label for note in notes] == ["C5", "D5", "E5"]
    assert [note.beat for note in notes] == [1.0, 2.0, 3.0]
    assert all(note.quantization_grid == 0.25 for note in notes)
    assert all(note.onset_seconds == round((note.beat - 1) * 0.5, 4) for note in notes)


def test_voice_event_splits_sustained_note_at_measure_boundary(tmp_path: Path) -> None:
    wav_path = tmp_path / "measure-crossing-note.wav"
    _write_vocal_fixture(
        wav_path,
        [
            VocalEvent(1.75, None),
            VocalEvent(0.56, 67, vibrato_cents=10),
        ],
        room_noise=0.008,
    )

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=2, backend="local")

    assert [note.label for note in notes] == ["G4", "G4"]
    assert [(note.beat, note.duration_beats, note.measure_index) for note in notes] == [
        (4.5, 0.5, 1),
        (5.0, 0.5, 2),
    ]
    assert all(note.is_tied for note in notes)
    assert all("measure_boundary_tie" in note.notation_warnings for note in notes)


def test_voice_event_tolerates_vibrato_and_attack_scoop(tmp_path: Path) -> None:
    wav_path = tmp_path / "vibrato-scoop.wav"
    _write_vocal_fixture(
        wav_path,
        [
            VocalEvent(0.18, None),
            VocalEvent(0.72, 76, vibrato_cents=22, scoop_cents=-65, local_noise=0.006),
        ],
        room_noise=0.012,
        hum_hz=60,
    )

    notes = transcribe_voice_file(wav_path, bpm=96, slot_id=1, backend="local")

    assert len(notes) == 1
    assert notes[0].label == "E5"
    assert notes[0].beat in {1.25, 1.5}
    assert notes[0].duration_beats >= 1.0
    assert notes[0].clef == "treble"
    assert notes[0].key_signature


def test_voice_event_keeps_track_display_policy_consistent(tmp_path: Path) -> None:
    wav_path = tmp_path / "tenor-line.wav"
    _write_vocal_fixture(
        wav_path,
        [
            VocalEvent(0.2, None),
            VocalEvent(0.52, 55, vibrato_cents=8),
            VocalEvent(0.08, None),
            VocalEvent(0.52, 59, vibrato_cents=8),
        ],
        room_noise=0.01,
    )

    notes = transcribe_voice_file(wav_path, bpm=120, slot_id=3, backend="local")

    assert [note.label for note in notes] == ["G3", "B3"]
    assert all(note.clef == "treble_8vb" for note in notes)
    assert all(note.display_octave_shift == 12 for note in notes)
    assert [note.beat for note in notes] == [1.5, 2.5]
