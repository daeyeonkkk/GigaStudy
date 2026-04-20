from __future__ import annotations

import math
import re
from uuid import uuid4

from gigastudy_api.api.schemas.studios import TrackNote

TRACKS: tuple[tuple[int, str], ...] = (
    (1, "Soprano"),
    (2, "Alto"),
    (3, "Tenor"),
    (4, "Baritone"),
    (5, "Bass"),
    (6, "Percussion"),
)

SLOT_RANGES: dict[int, tuple[int, int]] = {
    1: (60, 81),
    2: (55, 74),
    3: (48, 67),
    4: (45, 64),
    5: (40, 60),
    6: (0, 127),
}

SLOT_NAME_ALIASES: dict[int, tuple[str, ...]] = {
    1: ("soprano", "sop", "s."),
    2: ("alto", "alt", "a."),
    3: ("tenor", "ten", "t."),
    4: ("baritone", "bari", "bar.", "bar"),
    5: ("bass", "basso", "bs.", "b."),
    6: ("percussion", "perc", "drum", "drums", "beat"),
}

NOTE_SEMITONES: dict[str, int] = {
    "C": 0,
    "D": 2,
    "E": 4,
    "F": 5,
    "G": 7,
    "A": 9,
    "B": 11,
}

MIDI_LABELS_SHARP = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
DEFAULT_TIME_SIGNATURE = (4, 4)

SEED_PATTERNS: dict[int, list[str]] = {
    1: ["C5", "D5", "E5", "G5"],
    2: ["A4", "B4", "C5", "E5"],
    3: ["E4", "G4", "A4", "C5"],
    4: ["C4", "E4", "F4", "A4"],
    5: ["C3", "G3", "C4", "G3"],
    6: ["Kick", "Hat", "Snare", "Hat"],
}


def track_name(slot_id: int) -> str:
    for candidate_slot_id, name in TRACKS:
        if candidate_slot_id == slot_id:
            return name
    msg = f"Unknown track slot: {slot_id}"
    raise ValueError(msg)


def seconds_per_beat(bpm: int) -> float:
    return 60 / bpm


def quarter_beats_per_measure(
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0],
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1],
) -> float:
    denominator = max(1, time_signature_denominator)
    return max(0.25, time_signature_numerator * (4 / denominator))


def measure_index_from_beat(
    beat: float,
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0],
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1],
) -> int:
    beats_per_measure = quarter_beats_per_measure(
        time_signature_numerator,
        time_signature_denominator,
    )
    return int((max(beat, 1) - 1) // beats_per_measure) + 1


def beat_in_measure_from_beat(
    beat: float,
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0],
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1],
) -> float:
    beats_per_measure = quarter_beats_per_measure(
        time_signature_numerator,
        time_signature_denominator,
    )
    return ((max(beat, 1) - 1) % beats_per_measure) + 1


def midi_to_label(midi_note: int) -> str:
    octave = midi_note // 12 - 1
    return f"{MIDI_LABELS_SHARP[midi_note % 12]}{octave}"


def label_to_midi(label: str) -> int | None:
    match = re.fullmatch(r"([A-G])([#b]?)(-?\d+)", label.strip())
    if not match:
        return None

    note_name, accidental, octave_text = match.groups()
    semitone = NOTE_SEMITONES[note_name]
    if accidental == "#":
        semitone += 1
    elif accidental == "b":
        semitone -= 1

    return (int(octave_text) + 1) * 12 + semitone


def midi_to_frequency(midi_note: int) -> float:
    return 440 * 2 ** ((midi_note - 69) / 12)


def frequency_to_midi(frequency_hz: float) -> int | None:
    if frequency_hz <= 0:
        return None
    return round(69 + 12 * math.log2(frequency_hz / 440))


def quantize(value: float, step: float = 0.25) -> float:
    if step <= 0:
        return value
    return round(round(value / step) * step, 4)


def infer_slot_id(name: str | None, notes: list[TrackNote] | None = None, fallback: int = 1) -> int:
    normalized_name = (name or "").strip().lower()
    for slot_id, aliases in SLOT_NAME_ALIASES.items():
        if any(alias in normalized_name for alias in aliases):
            return slot_id

    pitched_notes = [
        note.pitch_midi
        for note in notes or []
        if note.pitch_midi is not None and not note.is_rest
    ]
    if not pitched_notes:
        return fallback

    average_pitch = sum(pitched_notes) / len(pitched_notes)
    if average_pitch >= 70:
        return 1
    if average_pitch >= 63:
        return 2
    if average_pitch >= 56:
        return 3
    if average_pitch >= 50:
        return 4
    return 5


def note_from_pitch(
    *,
    beat: float,
    duration_beats: float,
    bpm: int,
    source: str,
    extraction_method: str,
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0],
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1],
    pitch_midi: int | None = None,
    label: str | None = None,
    onset_seconds: float | None = None,
    duration_seconds: float | None = None,
    confidence: float = 1,
    measure_index: int | None = None,
    beat_in_measure: float | None = None,
    voice_index: int | None = None,
    staff_index: int | None = None,
    is_rest: bool = False,
    is_tied: bool = False,
) -> TrackNote:
    resolved_label = label
    if not resolved_label and pitch_midi is not None:
        resolved_label = midi_to_label(pitch_midi)
    if resolved_label and pitch_midi is None:
        pitch_midi = label_to_midi(resolved_label)

    resolved_onset_seconds = onset_seconds
    if resolved_onset_seconds is None:
        resolved_onset_seconds = max(0, (beat - 1) * seconds_per_beat(bpm))

    resolved_duration_seconds = duration_seconds
    if resolved_duration_seconds is None:
        resolved_duration_seconds = max(0, duration_beats * seconds_per_beat(bpm))

    resolved_measure_index = measure_index
    if resolved_measure_index is None:
        resolved_measure_index = measure_index_from_beat(
            beat,
            time_signature_numerator,
            time_signature_denominator,
        )

    resolved_beat_in_measure = beat_in_measure
    if resolved_beat_in_measure is None:
        resolved_beat_in_measure = beat_in_measure_from_beat(
            beat,
            time_signature_numerator,
            time_signature_denominator,
        )

    pitch_hz = midi_to_frequency(pitch_midi) if pitch_midi is not None else None
    return TrackNote(
        id=uuid4().hex,
        pitch_midi=pitch_midi,
        pitch_hz=pitch_hz,
        label=resolved_label or ("Rest" if is_rest else "Unknown"),
        onset_seconds=round(resolved_onset_seconds, 4),
        duration_seconds=round(resolved_duration_seconds, 4),
        beat=round(beat, 4),
        duration_beats=round(duration_beats, 4),
        measure_index=resolved_measure_index,
        beat_in_measure=round(resolved_beat_in_measure, 4),
        confidence=max(0, min(1, confidence)),
        source=source,
        extraction_method=extraction_method,
        is_rest=is_rest,
        is_tied=is_tied,
        voice_index=voice_index,
        staff_index=staff_index,
    )


def seed_notes_for_slot(
    slot_id: int,
    bpm: int,
    bars: int = 2,
    *,
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0],
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1],
) -> list[TrackNote]:
    pattern = SEED_PATTERNS[slot_id]
    beats_per_measure = quarter_beats_per_measure(
        time_signature_numerator,
        time_signature_denominator,
    )
    notes_per_measure = max(1, int(round(beats_per_measure)))
    notes: list[TrackNote] = []
    for bar_index in range(bars):
        for note_index, label in enumerate(pattern[:notes_per_measure]):
            beat = bar_index * beats_per_measure + note_index + 1
            notes.append(
                note_from_pitch(
                    beat=beat,
                    duration_beats=1,
                    bpm=bpm,
                    time_signature_numerator=time_signature_numerator,
                    time_signature_denominator=time_signature_denominator,
                    source="fixture",
                    extraction_method="seed_pattern_v0",
                    label=label,
                    confidence=0.35,
                )
            )
    return notes
