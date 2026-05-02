from __future__ import annotations

import math
import re
from dataclasses import dataclass
from uuid import uuid4

from gigastudy_api.domain.track_events import TrackNote

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

SLOT_COMFORT_CENTERS: dict[int, float] = {
    slot_id: (low + high) / 2
    for slot_id, (low, high) in SLOT_RANGES.items()
}

SLOT_NAME_ALIASES: dict[int, tuple[str, ...]] = {
    1: ("soprano", "sop", "s."),
    2: ("alto", "alt", "a."),
    3: ("tenor", "ten", "t."),
    4: ("baritone", "bari", "bar.", "bar"),
    5: ("bass", "basso", "bs.", "b."),
    6: ("percussion", "perc", "drum", "drums", "beat"),
}

PERCUSSION_LABEL_HINTS = ("kick", "snare", "hat", "clap", "rim", "tom", "cymbal", "ride", "crash")


@dataclass(frozen=True)
class SlotAssignmentScore:
    slot_id: int
    score: float
    name_match: bool
    range_fit_ratio: float
    median_pitch: float | None
    average_pitch: float | None

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
    ranked = rank_slot_candidates(name, notes or [], fallback=fallback)
    return ranked[0].slot_id if ranked else fallback


def slot_id_from_name(name: str | None) -> int | None:
    normalized_name = _normalize_assignment_name(name)
    if not normalized_name:
        return None
    tokens = set(normalized_name.split())
    for slot_id, aliases in SLOT_NAME_ALIASES.items():
        for alias in aliases:
            normalized_alias = _normalize_assignment_name(alias)
            if (
                normalized_alias == normalized_name
                or normalized_alias in tokens
                or normalized_name.startswith(f"{normalized_alias} ")
                or normalized_name.endswith(f" {normalized_alias}")
            ):
                return slot_id
    return None


def rank_slot_candidates(
    name: str | None,
    notes: list[TrackNote],
    *,
    fallback: int = 1,
    allowed_slots: tuple[int, ...] = (1, 2, 3, 4, 5, 6),
) -> list[SlotAssignmentScore]:
    name_slot_id = slot_id_from_name(name)
    pitched_notes = [
        note
        for note in notes
        if note.pitch_midi is not None and not note.is_rest
    ]
    percussion_hint = _has_percussion_label_hint(name, notes)
    median_pitch = _weighted_pitch_percentile(pitched_notes, 0.5)
    average_pitch = _weighted_average_pitch(pitched_notes)

    scores: list[SlotAssignmentScore] = []
    for slot_id in allowed_slots:
        range_fit_ratio = _slot_range_fit_ratio(slot_id, pitched_notes)
        name_match = name_slot_id == slot_id
        score = 0.0

        if name_slot_id is not None:
            score += 9.0 if name_match else -1.75
        elif slot_id == fallback:
            score += 0.18

        if slot_id == 6:
            if percussion_hint:
                score += 5.0
            if pitched_notes:
                score -= 4.0
            scores.append(
                SlotAssignmentScore(
                    slot_id=slot_id,
                    score=round(score, 4),
                    name_match=name_match,
                    range_fit_ratio=range_fit_ratio,
                    median_pitch=median_pitch,
                    average_pitch=average_pitch,
                )
            )
            continue

        if percussion_hint:
            score -= 1.2
        if pitched_notes:
            center = SLOT_COMFORT_CENTERS[slot_id]
            pitch_anchor = median_pitch if median_pitch is not None else average_pitch
            if pitch_anchor is not None:
                score += range_fit_ratio * 4.5
                score -= abs(pitch_anchor - center) * 0.085
            if average_pitch is not None:
                score -= abs(average_pitch - center) * 0.025
            score += _slot_percentile_overlap_bonus(slot_id, pitched_notes)
        else:
            score -= 0.25

        scores.append(
            SlotAssignmentScore(
                slot_id=slot_id,
                score=round(score, 4),
                name_match=name_match,
                range_fit_ratio=range_fit_ratio,
                median_pitch=median_pitch,
                average_pitch=average_pitch,
            )
        )

    return sorted(scores, key=lambda candidate: (candidate.score, candidate.name_match), reverse=True)


def slot_assignment_diagnostics(
    name: str | None,
    notes: list[TrackNote],
    *,
    assigned_slot_id: int,
    fallback: int = 1,
) -> dict[str, float | int | bool | str | None]:
    ranked = rank_slot_candidates(name, notes, fallback=fallback)
    selected = next((candidate for candidate in ranked if candidate.slot_id == assigned_slot_id), None)
    runner_up = next((candidate for candidate in ranked if candidate.slot_id != assigned_slot_id), None)
    if selected is None:
        return {"assigned_slot_id": assigned_slot_id, "slot_assignment_method": "fallback"}
    return {
        "assigned_slot_id": assigned_slot_id,
        "slot_assignment_method": "name_and_range_score",
        "slot_assignment_score": selected.score,
        "slot_assignment_margin": round(selected.score - (runner_up.score if runner_up else 0), 4),
        "slot_name_match": selected.name_match,
        "slot_range_fit_ratio": round(selected.range_fit_ratio, 3),
        "slot_median_pitch": round(selected.median_pitch, 2) if selected.median_pitch is not None else None,
        "slot_average_pitch": round(selected.average_pitch, 2) if selected.average_pitch is not None else None,
    }


def _normalize_assignment_name(name: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (name or "").strip().lower())).strip()


def _has_percussion_label_hint(name: str | None, notes: list[TrackNote]) -> bool:
    normalized_name = _normalize_assignment_name(name)
    if any(hint in normalized_name for hint in PERCUSSION_LABEL_HINTS):
        return True
    for note in notes:
        normalized_label = _normalize_assignment_name(note.label)
        if any(hint in normalized_label for hint in PERCUSSION_LABEL_HINTS):
            return True
    return False


def _weighted_note_value(note: TrackNote) -> float:
    return max(0.05, note.duration_beats) * max(0.15, min(1.0, note.confidence))


def _weighted_average_pitch(notes: list[TrackNote]) -> float | None:
    weighted = [
        (float(note.pitch_midi), _weighted_note_value(note))
        for note in notes
        if note.pitch_midi is not None
    ]
    total_weight = sum(weight for _pitch, weight in weighted)
    if total_weight <= 0:
        return None
    return sum(pitch * weight for pitch, weight in weighted) / total_weight


def _weighted_pitch_percentile(notes: list[TrackNote], percentile: float) -> float | None:
    weighted = sorted(
        (float(note.pitch_midi), _weighted_note_value(note))
        for note in notes
        if note.pitch_midi is not None
    )
    total_weight = sum(weight for _pitch, weight in weighted)
    if total_weight <= 0:
        return None
    threshold = total_weight * max(0, min(1, percentile))
    cursor = 0.0
    for pitch, weight in weighted:
        cursor += weight
        if cursor >= threshold:
            return pitch
    return weighted[-1][0]


def _slot_range_fit_ratio(slot_id: int, notes: list[TrackNote]) -> float:
    if not notes:
        return 0.0
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    total_weight = sum(_weighted_note_value(note) for note in notes)
    if total_weight <= 0:
        return 0.0
    in_range_weight = sum(
        _weighted_note_value(note)
        for note in notes
        if note.pitch_midi is not None and low <= note.pitch_midi <= high
    )
    return in_range_weight / total_weight


def _slot_percentile_overlap_bonus(slot_id: int, notes: list[TrackNote]) -> float:
    low, high = SLOT_RANGES.get(slot_id, (0, 127))
    low_percentile = _weighted_pitch_percentile(notes, 0.1)
    high_percentile = _weighted_pitch_percentile(notes, 0.9)
    if low_percentile is None or high_percentile is None:
        return 0.0
    expanded_low = low - 3
    expanded_high = high + 3
    bonus = 0.0
    if expanded_low <= low_percentile <= expanded_high:
        bonus += 0.35
    if expanded_low <= high_percentile <= expanded_high:
        bonus += 0.35
    if low <= low_percentile and high_percentile <= high:
        bonus += 0.35
    return bonus


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
    source_staff_index: int | None = None,
    is_rest: bool = False,
    is_tied: bool = False,
    spelled_label: str | None = None,
    accidental: str | None = None,
    pitch_register: str | None = None,
    key_signature: str | None = None,
    pitch_label_octave_shift: int = 0,
    quantization_grid: float | None = None,
    quality_warnings: list[str] | None = None,
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
        spelled_label=spelled_label,
        accidental=accidental,
        pitch_register=pitch_register,
        key_signature=key_signature,
        pitch_label_octave_shift=pitch_label_octave_shift,
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
        source_staff_index=source_staff_index,
        quantization_grid=quantization_grid,
        quality_warnings=quality_warnings or [],
    )
