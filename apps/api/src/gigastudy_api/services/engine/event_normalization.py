from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    label_to_midi,
    event_from_pitch,
    quarter_beats_per_measure,
    quantize,
)

TrackPitchRegister = Literal["upper_voice", "tenor_voice", "lower_voice", "percussion"]

VOICE_QUANTIZATION_GRID_BEATS = 0.25
MIN_EVENT_DURATION_BEATS = 0.25
MERGE_GAP_BEATS = 0.125
OVERLAP_EPSILON_BEATS = 0.001

SHARP_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
FLAT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")

MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)

MAJOR_KEY_BY_TONIC: dict[int, str] = {
    0: "C",
    1: "Db",
    2: "D",
    3: "Eb",
    4: "E",
    5: "F",
    6: "F#",
    7: "G",
    8: "Ab",
    9: "A",
    10: "Bb",
    11: "B",
}

KEY_FIFTHS: dict[str, int] = {
    "Cb": -7,
    "Gb": -6,
    "Db": -5,
    "Ab": -4,
    "Eb": -3,
    "Bb": -2,
    "F": -1,
    "C": 0,
    "G": 1,
    "D": 2,
    "A": 3,
    "E": 4,
    "B": 5,
    "F#": 6,
    "C#": 7,
}

SHARP_ORDER = ("F", "C", "G", "D", "A", "E", "B")
FLAT_ORDER = ("B", "E", "A", "D", "G", "C", "F")


@dataclass
class _EventInterval:
    event: TrackPitchEvent
    start_beat: float
    end_beat: float
    pitch_midi: int | None
    confidence: float


def pitch_register_for_slot(slot_id: int) -> TrackPitchRegister:
    if slot_id == 3:
        return "tenor_voice"
    if slot_id in {4, 5}:
        return "lower_voice"
    if slot_id == 6:
        return "percussion"
    return "upper_voice"


def pitch_label_octave_shift_for_slot(slot_id: int) -> int:
    return 12 if slot_id == 3 else 0


def normalize_track_events(
    events: list[TrackPitchEvent],
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    quantization_grid: float = VOICE_QUANTIZATION_GRID_BEATS,
    merge_adjacent_same_pitch: bool = True,
) -> list[TrackPitchEvent]:
    """Convert extracted event material into a measure-owned event timeline.

    The studio BPM and meter are the fixed grid. This function never estimates or
    rewrites tempo from the audio; it only quantizes extracted onsets/durations
    onto the existing grid, resolves monophonic overlaps, splits measure-crossing
    events, and attaches pitch spelling/range metadata for region consumers.
    """

    if not events:
        return []

    safe_bpm = max(1, bpm)
    safe_grid = max(0.0625, quantization_grid)
    beats_per_measure = quarter_beats_per_measure(time_signature_numerator, time_signature_denominator)
    pitch_register = pitch_register_for_slot(slot_id)
    pitch_label_octave_shift = pitch_label_octave_shift_for_slot(slot_id)
    key_signature = estimate_key_signature(events)
    spelling_mode = "flat" if KEY_FIFTHS.get(key_signature, 0) < 0 else "sharp"

    intervals = _normalize_intervals(events, safe_grid)
    intervals = _merge_and_resolve_intervals(
        intervals,
        safe_grid,
        merge_adjacent_same_pitch=merge_adjacent_same_pitch,
    )

    normalized: list[TrackPitchEvent] = []
    for interval in intervals:
        normalized.extend(
            _split_interval_at_measure_boundaries(
                interval,
                bpm=safe_bpm,
                beats_per_measure=beats_per_measure,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                key_signature=key_signature,
                spelling_mode=spelling_mode,
                pitch_register=pitch_register,
                pitch_label_octave_shift=pitch_label_octave_shift,
                quantization_grid=safe_grid,
            )
        )

    return normalized


def annotate_track_events_for_slot(
    events: list[TrackPitchEvent],
    *,
    slot_id: int,
    key_signature: str | None = None,
) -> list[TrackPitchEvent]:
    """Attach event display metadata without rewriting imported rhythm.

    Symbolic imports and document extraction exports often already contain trustworthy beat and
    duration values. They still need the same register, key, spelling, and range
    policy as voice-derived events so all six tracks share the same event conventions.
    """

    if not events:
        return []

    resolved_key_signature = key_signature or estimate_key_signature(events)
    spelling_mode = "flat" if KEY_FIFTHS.get(resolved_key_signature, 0) < 0 else "sharp"
    pitch_register = pitch_register_for_slot(slot_id)
    pitch_label_octave_shift = pitch_label_octave_shift_for_slot(slot_id)
    low, high = SLOT_RANGES.get(slot_id, (0, 127))

    annotated: list[TrackPitchEvent] = []
    for event in events:
        pitch_midi = _resolve_pitch_midi(event)
        spelled_label = event.spelled_label
        accidental = event.accidental
        if not event.is_rest and pitch_midi is not None:
            spelled_label = spelled_label or spell_midi_label(pitch_midi, spelling_mode=spelling_mode)
            accidental = accidental_for_key(spelled_label, resolved_key_signature)

        warnings = list(event.quality_warnings)
        if pitch_midi is not None and not low <= pitch_midi <= high:
            warnings.append("range_outlier_for_assigned_slot")

        annotated.append(
            event.model_copy(
                update={
                    "pitch_midi": pitch_midi,
                    "spelled_label": spelled_label,
                    "accidental": accidental,
                    "pitch_register": event.pitch_register or pitch_register,
                    "key_signature": event.key_signature or resolved_key_signature,
                    "pitch_label_octave_shift": event.pitch_label_octave_shift or pitch_label_octave_shift,
                    "quality_warnings": warnings,
                }
            )
        )
    return annotated


def estimate_key_signature(events: list[TrackPitchEvent]) -> str:
    pitch_weights = [0.0] * 12
    for event in events:
        if event.is_rest:
            continue
        pitch_midi = _resolve_pitch_midi(event)
        if pitch_midi is None:
            continue
        duration_weight = max(0.25, event.duration_beats)
        confidence_weight = max(0.2, min(1.0, event.confidence))
        pitch_weights[pitch_midi % 12] += duration_weight * confidence_weight

    if sum(pitch_weights) <= 0:
        return "C"

    candidates: list[tuple[float, str]] = []
    for tonic in range(12):
        major_key = MAJOR_KEY_BY_TONIC[tonic]
        major_score = _profile_score(pitch_weights, MAJOR_PROFILE, tonic)
        candidates.append((_key_score_with_penalty(major_score, major_key), major_key))

        relative_major_tonic = (tonic + 3) % 12
        relative_major_key = MAJOR_KEY_BY_TONIC[relative_major_tonic]
        minor_score = _profile_score(pitch_weights, MINOR_PROFILE, tonic)
        candidates.append((_key_score_with_penalty(minor_score, relative_major_key), relative_major_key))

    candidates.sort(key=lambda candidate: candidate[0], reverse=True)
    best_score, best_key = candidates[0]
    c_score = next(score for score, key in candidates if key == "C")
    if best_key != "C" and best_score < c_score * 1.035:
        return "C"
    return best_key


def spell_midi_label(midi_pitch: int, *, spelling_mode: Literal["sharp", "flat"]) -> str:
    octave = midi_pitch // 12 - 1
    names = FLAT_NAMES if spelling_mode == "flat" else SHARP_NAMES
    return f"{names[midi_pitch % 12]}{octave}"


def accidental_for_key(spelled_label: str, key_signature: str) -> str | None:
    parsed = _parse_spelled_label(spelled_label)
    if parsed is None:
        return None
    letter, accidental, _octave = parsed
    key_accidental = _key_accidental_map(key_signature).get(letter)
    if accidental == key_accidental:
        return None
    if not accidental and key_accidental:
        return "n"
    return accidental or None


def _normalize_intervals(events: list[TrackPitchEvent], quantization_grid: float) -> list[_EventInterval]:
    intervals: list[_EventInterval] = []
    minimum_duration = max(MIN_EVENT_DURATION_BEATS, quantization_grid)
    for event in events:
        start_beat = max(1.0, quantize(event.beat, quantization_grid))
        duration_beats = max(minimum_duration, quantize(event.duration_beats, quantization_grid))
        end_beat = max(start_beat + minimum_duration, quantize(start_beat + duration_beats, quantization_grid))
        intervals.append(
            _EventInterval(
                event=event,
                start_beat=start_beat,
                end_beat=end_beat,
                pitch_midi=_resolve_pitch_midi(event),
                confidence=event.confidence,
            )
        )
    return sorted(intervals, key=lambda interval: (interval.start_beat, -(interval.confidence), interval.event.id))


def _merge_and_resolve_intervals(
    intervals: list[_EventInterval],
    quantization_grid: float,
    *,
    merge_adjacent_same_pitch: bool,
) -> list[_EventInterval]:
    resolved: list[_EventInterval] = []
    for interval in intervals:
        if not resolved:
            resolved.append(interval)
            continue

        previous = resolved[-1]
        if (
            merge_adjacent_same_pitch
            and _same_pitch(previous, interval)
            and interval.start_beat <= previous.end_beat + MERGE_GAP_BEATS
        ):
            resolved[-1] = _EventInterval(
                event=previous.event,
                start_beat=previous.start_beat,
                end_beat=max(previous.end_beat, interval.end_beat),
                pitch_midi=previous.pitch_midi,
                confidence=max(previous.confidence, interval.confidence),
            )
            continue

        if interval.start_beat < previous.end_beat - OVERLAP_EPSILON_BEATS:
            previous_can_trim = interval.start_beat - previous.start_beat >= quantization_grid
            current_can_shift = previous.end_beat + quantization_grid <= interval.end_beat
            if interval.confidence > previous.confidence + 0.08:
                if previous_can_trim:
                    resolved[-1] = _EventInterval(
                        event=previous.event,
                        start_beat=previous.start_beat,
                        end_beat=interval.start_beat,
                        pitch_midi=previous.pitch_midi,
                        confidence=previous.confidence,
                    )
                    resolved.append(interval)
                else:
                    resolved[-1] = interval
                continue

            if current_can_shift:
                resolved.append(
                    _EventInterval(
                        event=interval.event,
                        start_beat=previous.end_beat,
                        end_beat=interval.end_beat,
                        pitch_midi=interval.pitch_midi,
                        confidence=interval.confidence,
                    )
                )
            continue

        resolved.append(interval)
    return resolved


def _split_interval_at_measure_boundaries(
    interval: _EventInterval,
    *,
    bpm: int,
    beats_per_measure: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
    key_signature: str,
    spelling_mode: Literal["sharp", "flat"],
    pitch_register: TrackPitchRegister,
    pitch_label_octave_shift: int,
    quantization_grid: float,
) -> list[TrackPitchEvent]:
    source_event = interval.event
    pieces: list[tuple[float, float]] = []
    cursor = interval.start_beat
    minimum_duration = max(MIN_EVENT_DURATION_BEATS, quantization_grid)
    while cursor < interval.end_beat - OVERLAP_EPSILON_BEATS:
        measure_index = int((cursor - 1) // beats_per_measure)
        measure_end = 1 + (measure_index + 1) * beats_per_measure
        piece_end = min(interval.end_beat, measure_end)
        piece_duration = max(minimum_duration, quantize(piece_end - cursor, quantization_grid))
        pieces.append((cursor, piece_duration))
        next_cursor = quantize(cursor + piece_duration, quantization_grid)
        if next_cursor <= cursor + OVERLAP_EPSILON_BEATS:
            next_cursor = round(cursor + piece_duration, 4)
        cursor = next_cursor

    if not pieces:
        return []

    split_tie = source_event.is_tied or len(pieces) > 1
    normalized: list[TrackPitchEvent] = []
    for index, (piece_start, piece_duration) in enumerate(pieces):
        pitch_midi = interval.pitch_midi
        spelled_label = spell_midi_label(pitch_midi, spelling_mode=spelling_mode) if pitch_midi is not None else source_event.label
        accidental = None if source_event.is_rest else accidental_for_key(spelled_label, key_signature)
        event = event_from_pitch(
            beat=piece_start,
            duration_beats=piece_duration,
            bpm=bpm,
            source=source_event.source,
            extraction_method=source_event.extraction_method,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            pitch_midi=pitch_midi,
            label=spelled_label,
            confidence=interval.confidence,
            voice_index=source_event.voice_index,
            is_rest=source_event.is_rest,
            is_tied=split_tie,
            spelled_label=spelled_label,
            accidental=accidental,
            pitch_register=pitch_register,
            key_signature=key_signature,
            pitch_label_octave_shift=pitch_label_octave_shift,
            quantization_grid=quantization_grid,
            quality_warnings=_quality_warnings(source_event, pitch_register, split_tie),
        )
        event.id = f"{source_event.id}-q{index + 1}" if len(pieces) > 1 else source_event.id
        normalized.append(event)
    return normalized


def _profile_score(pitch_weights: list[float], profile: tuple[float, ...], tonic: int) -> float:
    return sum(weight * profile[(pitch_class - tonic) % 12] for pitch_class, weight in enumerate(pitch_weights))


def _key_score_with_penalty(score: float, key_signature: str) -> float:
    return score - abs(KEY_FIFTHS.get(key_signature, 0)) * 0.18


def _key_accidental_map(key_signature: str) -> dict[str, str]:
    fifths = KEY_FIFTHS.get(key_signature, 0)
    if fifths > 0:
        return {letter: "#" for letter in SHARP_ORDER[:fifths]}
    if fifths < 0:
        return {letter: "b" for letter in FLAT_ORDER[: abs(fifths)]}
    return {}


def _parse_spelled_label(label: str) -> tuple[str, str | None, int] | None:
    if len(label) < 2:
        return None
    letter = label[0]
    if letter not in {"A", "B", "C", "D", "E", "F", "G"}:
        return None
    rest = label[1:]
    accidental: str | None = None
    if rest.startswith("#") or rest.startswith("b"):
        accidental = rest[0]
        rest = rest[1:]
    try:
        octave = int(rest)
    except ValueError:
        return None
    return letter, accidental, octave


def _resolve_pitch_midi(event: TrackPitchEvent) -> int | None:
    if event.pitch_midi is not None:
        return round(event.pitch_midi)
    if event.is_rest:
        return None
    return label_to_midi(event.label)


def _same_pitch(left: _EventInterval, right: _EventInterval) -> bool:
    if left.event.is_rest or right.event.is_rest:
        return left.event.is_rest and right.event.is_rest
    if left.pitch_midi is not None and right.pitch_midi is not None:
        return left.pitch_midi == right.pitch_midi
    return left.event.label == right.event.label


def _quality_warnings(event: TrackPitchEvent, pitch_register: TrackPitchRegister, is_split_tie: bool) -> list[str]:
    warnings = list(event.quality_warnings)
    if is_split_tie:
        warnings.append("measure_boundary_tie")
    if event.pitch_midi is not None and event.pitch_hz is None:
        warnings.append("pitch_frequency_recomputed")
    if pitch_register == "percussion" and event.pitch_midi is not None:
        warnings.append("pitched_event_on_percussion_track")
    return warnings
