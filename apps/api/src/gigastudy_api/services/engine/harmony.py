from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

from gigastudy_api.api.schemas.studios import TrackNote
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    note_from_pitch,
    quarter_beats_per_measure,
)
from gigastudy_api.services.engine.notation import normalize_track_notes

VOICE_LEADING_METHOD = "rule_based_voice_leading_v1"
PERCUSSION_METHOD = "rule_based_percussion_v0"

MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)

SCALE_STEPS: dict[str, tuple[int, ...]] = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "minor": (0, 2, 3, 5, 7, 8, 11),
}

CHORD_QUALITIES: dict[str, tuple[int, ...]] = {
    "major": (0, 4, 7),
    "minor": (0, 3, 7),
    "diminished": (0, 3, 6),
}

DIATONIC_TRIADS: dict[str, tuple[tuple[int, str, str, int], ...]] = {
    "major": (
        (0, "major", "tonic", 1),
        (2, "minor", "predominant", 2),
        (4, "minor", "tonic", 3),
        (5, "major", "predominant", 4),
        (7, "major", "dominant", 5),
        (9, "minor", "tonic", 6),
        (11, "diminished", "dominant", 7),
    ),
    "minor": (
        (0, "minor", "tonic", 1),
        (2, "diminished", "predominant", 2),
        (3, "major", "tonic", 3),
        (5, "minor", "predominant", 4),
        (7, "major", "dominant", 5),
        (8, "major", "predominant", 6),
        (11, "diminished", "dominant", 7),
    ),
}

VOICE_COMFORT_CENTER = {
    1: 72,
    2: 65,
    3: 58,
    4: 53,
    5: 48,
}

BEAM_SIZE = 10
DIVERSE_PATH_DIFFERENCE_THRESHOLD = 0.22


@dataclass(frozen=True)
class KeyEstimate:
    tonic: int
    mode: str
    scale: tuple[int, ...]
    confidence: float


@dataclass(frozen=True)
class ChordCandidate:
    root: int
    quality: str
    function: str
    degree: int
    tones: tuple[int, ...]
    base_cost: float


@dataclass(frozen=True)
class HarmonyEvent:
    beat: float
    duration_beats: float
    reference: TrackNote
    active_by_slot: dict[int, TrackNote]
    active_notes: tuple[TrackNote, ...]
    strength: float


@dataclass(frozen=True)
class HarmonyPath:
    cost: float
    pitches: tuple[int, ...]
    chords: tuple[ChordCandidate, ...]
    previous_pitch: int | None = None
    previous_leap: int = 0
    previous_move: int = 0


@dataclass(frozen=True)
class VoiceLeadingProfile:
    name: str
    center_shift: int = 0
    register_focus: float = 1.0
    stepwise_bonus: float = 0.0
    contrary_motion_bonus: float = 0.0
    passing_tone_delta: float = 0.0
    root_delta: float = 0.0
    third_delta: float = 0.0
    fifth_delta: float = 0.0


DEFAULT_VOICE_LEADING_PROFILE = VoiceLeadingProfile(
    name="balanced",
    third_delta=-0.04,
    contrary_motion_bonus=0.08,
)

VOICE_LEADING_PROFILES: tuple[VoiceLeadingProfile, ...] = (
    DEFAULT_VOICE_LEADING_PROFILE,
    VoiceLeadingProfile(
        name="lower_support",
        center_shift=-8,
        register_focus=3.0,
        stepwise_bonus=0.04,
        root_delta=-0.24,
        fifth_delta=-0.02,
    ),
    VoiceLeadingProfile(
        name="moving_counterline",
        center_shift=2,
        stepwise_bonus=0.18,
        contrary_motion_bonus=0.34,
        passing_tone_delta=-0.18,
        third_delta=-0.08,
    ),
    VoiceLeadingProfile(
        name="upper_blend",
        center_shift=5,
        register_focus=2.4,
        stepwise_bonus=0.08,
        contrary_motion_bonus=0.16,
        third_delta=-0.18,
    ),
    VoiceLeadingProfile(
        name="open_voicing",
        center_shift=-8,
        register_focus=2.2,
        root_delta=-0.08,
        fifth_delta=-0.1,
    ),
)


def generate_rule_based_harmony(
    *,
    target_slot_id: int,
    context_tracks: list[TrackNote],
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    context_notes_by_slot: dict[int, list[TrackNote]] | None = None,
) -> list[TrackNote]:
    if target_slot_id == 6:
        return normalize_track_notes(
            _generate_percussion(
                context_tracks=context_tracks,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            ),
            bpm=bpm,
            slot_id=target_slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            merge_adjacent_same_pitch=False,
        )
    if not context_tracks:
        return []

    candidates = generate_rule_based_harmony_candidates(
        target_slot_id=target_slot_id,
        context_tracks=context_tracks,
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        context_notes_by_slot=context_notes_by_slot,
        candidate_count=1,
    )
    return candidates[0] if candidates else []


def generate_rule_based_harmony_candidates(
    *,
    target_slot_id: int,
    context_tracks: list[TrackNote],
    bpm: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    context_notes_by_slot: dict[int, list[TrackNote]] | None = None,
    candidate_count: int = 3,
) -> list[list[TrackNote]]:
    resolved_candidate_count = max(1, min(5, candidate_count))
    if target_slot_id == 6:
        return [
            normalize_track_notes(
                _generate_percussion(
                    context_tracks=context_tracks,
                    bpm=bpm,
                    time_signature_numerator=time_signature_numerator,
                    time_signature_denominator=time_signature_denominator,
                    variant_index=variant_index,
                ),
                bpm=bpm,
                slot_id=target_slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                merge_adjacent_same_pitch=False,
            )
            for variant_index in range(resolved_candidate_count)
        ]
    if not context_tracks:
        return []

    context_by_slot = _normalize_context_map(context_tracks, context_notes_by_slot)
    events = _build_harmony_events(
        context_by_slot,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )
    if not events:
        return []

    key = _estimate_key(events)
    selected_paths = _select_voice_leading_paths(
        target_slot_id=target_slot_id,
        events=events,
        key=key,
        candidate_count=resolved_candidate_count,
    )
    if not selected_paths:
        return []

    generated_candidates = [
        [
            note_from_pitch(
                beat=event.beat,
                duration_beats=event.duration_beats,
                bpm=bpm,
                source="ai",
                extraction_method=VOICE_LEADING_METHOD,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                pitch_midi=pitch,
                confidence=_generation_confidence(path.cost, len(events), key.confidence),
                measure_index=event.reference.measure_index,
                beat_in_measure=event.reference.beat_in_measure,
            )
            for event, pitch in zip(events, path.pitches, strict=False)
        ]
        for path in selected_paths
    ]
    return [
        normalize_track_notes(
            notes,
            bpm=bpm,
            slot_id=target_slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            merge_adjacent_same_pitch=False,
        )
        for notes in generated_candidates
    ]


def _normalize_context_map(
    context_tracks: list[TrackNote],
    context_notes_by_slot: dict[int, list[TrackNote]] | None,
) -> dict[int, list[TrackNote]]:
    if context_notes_by_slot:
        normalized = {
            slot_id: _pitched_notes(notes)
            for slot_id, notes in context_notes_by_slot.items()
            if 1 <= slot_id <= 5
        }
        if any(normalized.values()):
            return normalized
    return {0: _pitched_notes(context_tracks)}


def _pitched_notes(notes: list[TrackNote]) -> list[TrackNote]:
    return sorted(
        [note for note in notes if note.pitch_midi is not None and not note.is_rest],
        key=lambda note: (note.beat, note.pitch_midi or 0),
    )


def _build_harmony_events(
    context_by_slot: dict[int, list[TrackNote]],
    *,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[HarmonyEvent]:
    starts = sorted(
        {
            round(note.beat, 4)
            for notes in context_by_slot.values()
            for note in notes
            if note.pitch_midi is not None
        }
    )
    events: list[HarmonyEvent] = []
    for index, beat in enumerate(starts):
        active_by_slot = _active_notes_at_beat(context_by_slot, beat)
        active_notes = tuple(active_by_slot.values())
        if not active_notes:
            continue

        next_beat = starts[index + 1] if index + 1 < len(starts) else None
        reference = max(
            active_notes,
            key=lambda note: (
                _event_strength(note, time_signature_numerator, time_signature_denominator),
                note.duration_beats,
                note.pitch_midi or 0,
            ),
        )
        reference_end = reference.beat + max(0.25, reference.duration_beats)
        if next_beat is None:
            duration_beats = max(0.25, reference.duration_beats)
        else:
            duration_beats = max(0.25, min(reference_end, next_beat) - beat)

        events.append(
            HarmonyEvent(
                beat=beat,
                duration_beats=round(duration_beats, 4),
                reference=reference,
                active_by_slot=active_by_slot,
                active_notes=active_notes,
                strength=_event_strength(
                    reference,
                    time_signature_numerator,
                    time_signature_denominator,
                ),
            )
        )
    return events


def _active_notes_at_beat(
    context_by_slot: dict[int, list[TrackNote]],
    beat: float,
) -> dict[int, TrackNote]:
    active_by_slot: dict[int, TrackNote] = {}
    for slot_id, notes in context_by_slot.items():
        candidates = [
            note
            for note in notes
            if note.beat <= beat + 0.0001 and beat < note.beat + max(0.25, note.duration_beats) - 0.0001
        ]
        if candidates:
            active_by_slot[slot_id] = max(candidates, key=lambda note: (note.beat, note.duration_beats))
    return active_by_slot


def _event_strength(
    note: TrackNote,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> float:
    beat_in_measure = note.beat_in_measure
    if beat_in_measure is None:
        beats_per_measure = quarter_beats_per_measure(
            time_signature_numerator,
            time_signature_denominator,
        )
        beat_in_measure = ((max(note.beat, 1) - 1) % beats_per_measure) + 1
    if abs(beat_in_measure - 1) < 0.001:
        return 1.5
    if abs((beat_in_measure % 1) - 0) < 0.001:
        return 1.0
    return 0.72


def _estimate_key(events: list[HarmonyEvent]) -> KeyEstimate:
    histogram = [0.0] * 12
    for event in events:
        for note in event.active_notes:
            if note.pitch_midi is None:
                continue
            histogram[note.pitch_midi % 12] += max(0.25, event.duration_beats) * event.strength

    scored_keys: list[tuple[float, int, str]] = []
    for tonic in range(12):
        major_score = _profile_score(histogram, tonic, MAJOR_PROFILE)
        minor_score = _profile_score(histogram, tonic, MINOR_PROFILE)
        scored_keys.append((major_score, tonic, "major"))
        scored_keys.append((minor_score, tonic, "minor"))

    scored_keys.sort(reverse=True)
    best_score, tonic, mode = scored_keys[0]
    second_score = scored_keys[1][0] if len(scored_keys) > 1 else 0
    total_weight = max(1.0, sum(histogram))
    confidence = max(0.45, min(0.9, 0.52 + ((best_score - second_score) / total_weight) * 0.08))
    scale = tuple((tonic + step) % 12 for step in SCALE_STEPS[mode])
    return KeyEstimate(tonic=tonic, mode=mode, scale=scale, confidence=confidence)


def _profile_score(histogram: list[float], tonic: int, profile: tuple[float, ...]) -> float:
    return sum(histogram[(tonic + step) % 12] * profile[step] for step in range(12))


def _chord_candidates_for_event(
    event: HarmonyEvent,
    key: KeyEstimate,
    previous_chord: ChordCandidate | None,
    event_index: int,
    event_count: int,
) -> list[ChordCandidate]:
    pitch_class_weights = _event_pitch_class_weights(event)
    candidates: list[ChordCandidate] = []
    for root_offset, quality, function, degree in DIATONIC_TRIADS[key.mode]:
        root = (key.tonic + root_offset) % 12
        tones = tuple((root + interval) % 12 for interval in CHORD_QUALITIES[quality])
        cost = _chord_fit_cost(
            tones=tones,
            degree=degree,
            function=function,
            pitch_class_weights=pitch_class_weights,
            event=event,
            key=key,
            previous_chord=previous_chord,
            event_index=event_index,
            event_count=event_count,
        )
        candidates.append(
            ChordCandidate(
                root=root,
                quality=quality,
                function=function,
                degree=degree,
                tones=tones,
                base_cost=cost,
            )
        )
    return sorted(candidates, key=lambda candidate: candidate.base_cost)[:5]


def _event_pitch_class_weights(event: HarmonyEvent) -> dict[int, float]:
    weights: dict[int, float] = {}
    for note in event.active_notes:
        if note.pitch_midi is None:
            continue
        weights[note.pitch_midi % 12] = weights.get(note.pitch_midi % 12, 0.0) + event.strength
    return weights


def _chord_fit_cost(
    *,
    tones: tuple[int, ...],
    degree: int,
    function: str,
    pitch_class_weights: dict[int, float],
    event: HarmonyEvent,
    key: KeyEstimate,
    previous_chord: ChordCandidate | None,
    event_index: int,
    event_count: int,
) -> float:
    cost = 0.0
    for pitch_class, weight in pitch_class_weights.items():
        if pitch_class in tones:
            cost -= 1.25 * weight
        elif pitch_class in key.scale:
            cost += 0.72 * weight
        else:
            cost += 1.85 * weight

    if event.strength >= 1.45 and degree in {1, 4, 5, 6}:
        cost -= 0.3
    if event.strength >= 1.45 and degree == 7:
        cost += 0.6

    cost += _structural_chord_cost(
        degree=degree,
        function=function,
        event=event,
        event_index=event_index,
        event_count=event_count,
    )

    if previous_chord is not None:
        if previous_chord.degree == degree:
            cost += 0.12
        elif previous_chord.function == "dominant" and function == "tonic":
            cost -= 0.7
        elif previous_chord.function == "predominant" and function == "dominant":
            cost -= 0.45
        elif previous_chord.function == "tonic" and function in {"predominant", "dominant"}:
            cost -= 0.18
        elif previous_chord.function == "dominant" and function == "predominant":
            cost += 0.45
    return cost


def _structural_chord_cost(
    *,
    degree: int,
    function: str,
    event: HarmonyEvent,
    event_index: int,
    event_count: int,
) -> float:
    cost = 0.0
    is_first_event = event_index == 0
    is_final_event = event_index == event_count - 1
    is_penultimate_event = event_count >= 3 and event_index == event_count - 2

    if is_first_event:
        if function == "tonic":
            cost -= 0.45
        if degree == 1:
            cost -= 0.35

    if is_penultimate_event:
        if degree == 5:
            cost -= 0.95
        elif function == "predominant":
            cost -= 0.25
        elif function == "tonic":
            cost += 0.28

    if is_final_event:
        if degree == 1:
            cost -= 1.65
        elif function == "tonic":
            cost -= 0.35
        elif function == "dominant":
            cost += 0.85
        else:
            cost += 0.45

    if event.strength >= 1.45 and degree == 7:
        cost += 0.35
    return cost


def _select_voice_leading_paths(
    *,
    target_slot_id: int,
    events: list[HarmonyEvent],
    key: KeyEstimate,
    candidate_count: int,
) -> list[HarmonyPath]:
    selected: list[HarmonyPath] = []
    profiles = _voice_leading_profiles_for_count(candidate_count)
    pool_size = max(8, candidate_count * 4)

    for profile in profiles:
        profile_paths = _search_voice_leading_paths(
            target_slot_id=target_slot_id,
            events=events,
            key=key,
            max_paths=pool_size,
            profile=profile,
        )
        path = _pick_distinct_path(profile_paths, selected)
        if path is not None:
            selected.append(path)
        if len(selected) >= candidate_count:
            return selected

    fallback_paths = _search_voice_leading_paths(
        target_slot_id=target_slot_id,
        events=events,
        key=key,
        max_paths=max(pool_size, candidate_count * 8),
        profile=DEFAULT_VOICE_LEADING_PROFILE,
    )
    for path in fallback_paths:
        distinct_path = _pick_distinct_path([path], selected)
        if distinct_path is not None:
            selected.append(distinct_path)
        if len(selected) >= candidate_count:
            break

    return selected


def _voice_leading_profiles_for_count(candidate_count: int) -> tuple[VoiceLeadingProfile, ...]:
    if candidate_count <= len(VOICE_LEADING_PROFILES):
        return VOICE_LEADING_PROFILES[:candidate_count]
    extra_count = candidate_count - len(VOICE_LEADING_PROFILES)
    return VOICE_LEADING_PROFILES + VOICE_LEADING_PROFILES[:extra_count]


def _pick_distinct_path(paths: list[HarmonyPath], selected: list[HarmonyPath]) -> HarmonyPath | None:
    for path in paths:
        is_distinct = all(
            _path_difference_score(path.pitches, current.pitches) >= DIVERSE_PATH_DIFFERENCE_THRESHOLD
            for current in selected
        )
        if is_distinct:
            return path

    for path in paths:
        if all(path.pitches != current.pitches for current in selected):
            return path
    return None


def _path_difference_score(first: tuple[int, ...], second: tuple[int, ...]) -> float:
    if not first or not second:
        return 1.0 if first != second else 0.0

    pair_count = min(len(first), len(second))
    changed_positions = sum(1 for index in range(pair_count) if abs(first[index] - second[index]) >= 3)
    average_register_delta = abs((sum(first) / len(first)) - (sum(second) / len(second)))
    contour_delta = _contour_difference_score(first, second)
    length_delta = abs(len(first) - len(second)) / max(len(first), len(second))
    return (
        (changed_positions / pair_count) * 0.7
        + min(1.0, average_register_delta / 8) * 0.2
        + contour_delta * 0.08
        + length_delta * 0.02
    )


def _contour_difference_score(first: tuple[int, ...], second: tuple[int, ...]) -> float:
    first_contour = _contour_signature(first)
    second_contour = _contour_signature(second)
    if not first_contour or not second_contour:
        return 0.0
    pair_count = min(len(first_contour), len(second_contour))
    return sum(1 for index in range(pair_count) if first_contour[index] != second_contour[index]) / pair_count


def _contour_signature(pitches: tuple[int, ...]) -> tuple[int, ...]:
    return tuple(
        _motion_direction(pitches[index - 1], pitches[index])
        for index in range(1, len(pitches))
    )


def _search_voice_leading_paths(
    *,
    target_slot_id: int,
    events: list[HarmonyEvent],
    key: KeyEstimate,
    max_paths: int,
    profile: VoiceLeadingProfile,
) -> list[HarmonyPath]:
    paths = [HarmonyPath(cost=0.0, pitches=(), chords=())]
    previous_event: HarmonyEvent | None = None
    beam_size = max(BEAM_SIZE, max_paths * 4)

    for event_index, event in enumerate(events):
        next_paths: list[HarmonyPath] = []
        for path in paths:
            previous_chord = path.chords[-1] if path.chords else None
            for chord in _chord_candidates_for_event(event, key, previous_chord, event_index, len(events)):
                pitch_candidates = _candidate_pitches_for_slot(
                    target_slot_id=target_slot_id,
                    chord=chord,
                    key=key,
                    event=event,
                    is_final_event=event_index == len(events) - 1,
                    profile=profile,
                )
                for pitch in pitch_candidates:
                    local_cost = _pitch_cost(
                        target_slot_id=target_slot_id,
                        pitch=pitch,
                        chord=chord,
                        key=key,
                        event=event,
                        profile=profile,
                    )
                    if math.isinf(local_cost):
                        continue
                    transition_cost, leap = _transition_cost(
                        pitch=pitch,
                        path=path,
                        key=key,
                        previous_event=previous_event,
                        event=event,
                        target_slot_id=target_slot_id,
                        profile=profile,
                    )
                    if math.isinf(transition_cost):
                        continue
                    move = 0 if path.previous_pitch is None else pitch - path.previous_pitch
                    next_paths.append(
                        HarmonyPath(
                            cost=path.cost + chord.base_cost + local_cost + transition_cost,
                            pitches=path.pitches + (pitch,),
                            chords=path.chords + (chord,),
                            previous_pitch=pitch,
                            previous_leap=leap,
                            previous_move=move,
                        )
                    )

        if not next_paths:
            return []
        paths = sorted(next_paths, key=lambda candidate: candidate.cost)[:beam_size]
        previous_event = event
    return _unique_paths_by_pitch(paths, max_paths)


def _unique_paths_by_pitch(paths: list[HarmonyPath], max_paths: int) -> list[HarmonyPath]:
    unique_paths: list[HarmonyPath] = []
    seen_pitch_sequences: set[tuple[int, ...]] = set()
    for path in sorted(paths, key=lambda candidate: candidate.cost):
        if path.pitches in seen_pitch_sequences:
            continue
        seen_pitch_sequences.add(path.pitches)
        unique_paths.append(path)
        if len(unique_paths) >= max_paths:
            break
    return unique_paths


def _candidate_pitches_for_slot(
    *,
    target_slot_id: int,
    chord: ChordCandidate,
    key: KeyEstimate,
    event: HarmonyEvent,
    is_final_event: bool,
    profile: VoiceLeadingProfile,
) -> list[int]:
    low, high = SLOT_RANGES[target_slot_id]
    chord_tones = [pitch for pitch in range(low, high + 1) if pitch % 12 in chord.tones]
    melodic_connectors: list[int] = []
    if event.strength < 0.95 and not is_final_event:
        melodic_connectors = [
            pitch
            for pitch in range(low, high + 1)
            if pitch % 12 in key.scale and pitch % 12 not in chord.tones
        ]
    if is_final_event:
        tonic_tones = [pitch for pitch in chord_tones if pitch % 12 == key.tonic]
        if tonic_tones:
            chord_tones.extend(tonic_tones)
    candidates = chord_tones + melodic_connectors
    if not candidates:
        return [max(low, min(high, VOICE_COMFORT_CENTER.get(target_slot_id, (low + high) // 2)))]

    center = _profile_center(target_slot_id, profile)
    return sorted(set(candidates), key=lambda pitch: (abs(pitch - center), pitch))


def _pitch_cost(
    *,
    target_slot_id: int,
    pitch: int,
    chord: ChordCandidate,
    key: KeyEstimate,
    event: HarmonyEvent,
    profile: VoiceLeadingProfile,
) -> float:
    if _crosses_known_voice(target_slot_id, pitch, event):
        return math.inf

    cost = 0.0
    center = _profile_center(target_slot_id, profile)
    cost += abs(pitch - center) * 0.055 * profile.register_focus
    cost += _spacing_cost(target_slot_id, pitch, event)

    target_pitch_class = pitch % 12
    if target_pitch_class not in chord.tones:
        if target_pitch_class in key.scale:
            cost += (0.52 if event.strength < 0.95 else 1.35) + profile.passing_tone_delta
        else:
            cost += 2.4

    chord_tone_counts = _chord_tone_counts(event, chord)
    chord_degree = _tone_degree(target_pitch_class, chord)
    if chord_degree == "third":
        cost -= 0.35 if chord_tone_counts["third"] == 0 else 0.05
        cost += profile.third_delta
    elif chord_degree == "root":
        cost -= 0.2 if target_slot_id in {4, 5} else 0.08
        cost += profile.root_delta
    elif chord_degree == "fifth":
        cost += 0.18 if chord_tone_counts["third"] == 0 else 0.02
        cost += profile.fifth_delta

    if target_pitch_class == _leading_tone(key):
        cost += 0.7
    if chord.quality == "diminished":
        cost += 0.25
    if _duplicates_exact_context_pitch(pitch, event):
        cost += 0.8
    return cost


def _crosses_known_voice(target_slot_id: int, pitch: int, event: HarmonyEvent) -> bool:
    if 0 in event.active_by_slot:
        return False
    higher_pitches = [
        note.pitch_midi
        for slot_id, note in event.active_by_slot.items()
        if slot_id < target_slot_id and note.pitch_midi is not None
    ]
    lower_pitches = [
        note.pitch_midi
        for slot_id, note in event.active_by_slot.items()
        if target_slot_id < slot_id <= 5 and note.pitch_midi is not None
    ]
    if higher_pitches and pitch >= min(higher_pitches):
        return True
    if lower_pitches and pitch <= max(lower_pitches):
        return True
    return False


def _spacing_cost(target_slot_id: int, pitch: int, event: HarmonyEvent) -> float:
    cost = 0.0
    higher_neighbor = _nearest_known_voice_pitch(target_slot_id, event, direction=-1)
    lower_neighbor = _nearest_known_voice_pitch(target_slot_id, event, direction=1)
    if higher_neighbor is not None:
        gap = higher_neighbor - pitch
        if target_slot_id in {2, 3, 4} and gap > 12:
            cost += (gap - 12) * 0.22
        if gap < 3:
            cost += 0.8
    if lower_neighbor is not None:
        gap = pitch - lower_neighbor
        if target_slot_id in {1, 2, 3} and gap > 12:
            cost += (gap - 12) * 0.2
        if gap < 3:
            cost += 0.8
    return cost


def _nearest_known_voice_pitch(
    target_slot_id: int,
    event: HarmonyEvent,
    *,
    direction: int,
) -> int | None:
    if direction < 0:
        slots = sorted((slot_id for slot_id in event.active_by_slot if slot_id < target_slot_id), reverse=True)
    else:
        slots = sorted(slot_id for slot_id in event.active_by_slot if target_slot_id < slot_id <= 5)
    for slot_id in slots:
        pitch = event.active_by_slot[slot_id].pitch_midi
        if pitch is not None:
            return pitch
    return None


def _chord_tone_counts(event: HarmonyEvent, chord: ChordCandidate) -> Counter[str]:
    counts: Counter[str] = Counter()
    for note in event.active_notes:
        if note.pitch_midi is None:
            continue
        counts[_tone_degree(note.pitch_midi % 12, chord)] += 1
    return counts


def _tone_degree(pitch_class: int, chord: ChordCandidate) -> str:
    root_interval = (pitch_class - chord.root) % 12
    if root_interval == 0:
        return "root"
    if root_interval in {3, 4}:
        return "third"
    if root_interval in {6, 7}:
        return "fifth"
    return "other"


def _leading_tone(key: KeyEstimate) -> int:
    return (key.tonic - 1) % 12


def _duplicates_exact_context_pitch(pitch: int, event: HarmonyEvent) -> bool:
    return any(note.pitch_midi == pitch for note in event.active_notes)


def _profile_center(target_slot_id: int, profile: VoiceLeadingProfile) -> int:
    low, high = SLOT_RANGES[target_slot_id]
    center = VOICE_COMFORT_CENTER.get(target_slot_id, (low + high) // 2) + profile.center_shift
    return max(low, min(high, center))


def _transition_cost(
    *,
    pitch: int,
    path: HarmonyPath,
    key: KeyEstimate,
    previous_event: HarmonyEvent | None,
    event: HarmonyEvent,
    target_slot_id: int,
    profile: VoiceLeadingProfile,
) -> tuple[float, int]:
    if path.previous_pitch is None:
        return 0.0, 0

    move = pitch - path.previous_pitch
    leap = abs(move)
    if leap > 12:
        return math.inf, leap

    cost = 0.0
    if leap == 0:
        cost += 0.08
    elif leap <= 2:
        cost -= 0.18 + profile.stepwise_bonus
    elif leap <= 4:
        cost += 0.05
    elif leap <= 7:
        cost += 0.45
    else:
        cost += 1.15

    if path.previous_leap > 5 and leap > 2 and _same_direction(move, path.previous_move):
        cost += 0.85

    previous_pitch_class = path.previous_pitch % 12
    if previous_pitch_class == _leading_tone(key) and pitch % 12 != key.tonic:
        cost += 0.85

    if previous_event is not None:
        cost += _contrary_motion_cost(
            previous_target_pitch=path.previous_pitch,
            target_pitch=pitch,
            previous_event=previous_event,
            event=event,
            profile=profile,
        )
        cost += _parallel_perfect_cost(
            previous_target_pitch=path.previous_pitch,
            target_pitch=pitch,
            previous_event=previous_event,
            event=event,
            target_slot_id=target_slot_id,
        )
    return cost, leap


def _same_direction(current_move: int, previous_move: int) -> bool:
    return current_move != 0 and previous_move != 0 and _motion_direction(0, current_move) == _motion_direction(0, previous_move)


def _contrary_motion_cost(
    *,
    previous_target_pitch: int,
    target_pitch: int,
    previous_event: HarmonyEvent,
    event: HarmonyEvent,
    profile: VoiceLeadingProfile,
) -> float:
    if profile.contrary_motion_bonus <= 0:
        return 0.0

    target_motion = _motion_direction(previous_target_pitch, target_pitch)
    reference_motion = _reference_motion(previous_event, event)
    if target_motion == 0 or reference_motion == 0:
        return 0.0
    if target_motion == -reference_motion:
        return -profile.contrary_motion_bonus
    if target_motion == reference_motion:
        return profile.contrary_motion_bonus * 0.45
    return 0.0


def _reference_motion(previous_event: HarmonyEvent, event: HarmonyEvent) -> int:
    scored_motions: list[tuple[float, int]] = []
    for slot_id, current_note in event.active_by_slot.items():
        if current_note.pitch_midi is None:
            continue
        previous_note = previous_event.active_by_slot.get(slot_id)
        if previous_note is None or previous_note.pitch_midi is None:
            continue
        motion = _motion_direction(previous_note.pitch_midi, current_note.pitch_midi)
        if motion != 0:
            scored_motions.append((event.strength, motion))

    if scored_motions:
        return max(scored_motions, key=lambda item: item[0])[1]

    if previous_event.reference.pitch_midi is None or event.reference.pitch_midi is None:
        return 0
    return _motion_direction(previous_event.reference.pitch_midi, event.reference.pitch_midi)


def _parallel_perfect_cost(
    *,
    previous_target_pitch: int,
    target_pitch: int,
    previous_event: HarmonyEvent,
    event: HarmonyEvent,
    target_slot_id: int,
) -> float:
    cost = 0.0
    for slot_id, current_context_note in event.active_by_slot.items():
        if slot_id == 0 or slot_id == target_slot_id or current_context_note.pitch_midi is None:
            continue
        previous_context_note = previous_event.active_by_slot.get(slot_id)
        if previous_context_note is None or previous_context_note.pitch_midi is None:
            continue
        target_motion = _motion_direction(previous_target_pitch, target_pitch)
        context_motion = _motion_direction(previous_context_note.pitch_midi, current_context_note.pitch_midi)
        if target_motion == 0 or context_motion == 0:
            continue

        previous_interval = _vertical_interval_class(previous_target_pitch, previous_context_note.pitch_midi)
        current_interval = _vertical_interval_class(target_pitch, current_context_note.pitch_midi)
        similar_motion = target_motion == context_motion
        outer_pair = {target_slot_id, slot_id} in ({1, 5}, {1, 4})

        if similar_motion and previous_interval in {0, 7} and current_interval in {0, 7}:
            cost += 80
        elif similar_motion and current_interval in {0, 7} and outer_pair:
            cost += 3.5
        elif similar_motion and previous_interval == 5 and current_interval == 5:
            cost += 0.75
    return cost


def _motion_direction(previous_pitch: int, current_pitch: int) -> int:
    if current_pitch > previous_pitch:
        return 1
    if current_pitch < previous_pitch:
        return -1
    return 0


def _vertical_interval_class(first_pitch: int, second_pitch: int) -> int:
    return abs(first_pitch - second_pitch) % 12


def _generation_confidence(total_cost: float, event_count: int, key_confidence: float) -> float:
    average_cost = total_cost / max(1, event_count)
    return round(max(0.58, min(0.9, 0.78 + key_confidence * 0.08 - average_cost * 0.015)), 4)


def _generate_percussion(
    *,
    context_tracks: list[TrackNote],
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    variant_index: int = 0,
) -> list[TrackNote]:
    max_beat = max(
        (note.beat + max(0.25, note.duration_beats) - 1 for note in context_tracks),
        default=8,
    )
    beats_per_measure = quarter_beats_per_measure(
        time_signature_numerator,
        time_signature_denominator,
    )
    pulse_quarter_beats = max(0.25, 4 / max(1, time_signature_denominator))
    pulses_per_measure = max(1, round(beats_per_measure / pulse_quarter_beats))
    measure_count = max(1, math.floor((max_beat - 1) / beats_per_measure) + 1)
    total_pulses = max(1, round((measure_count * beats_per_measure) / pulse_quarter_beats))
    generated: list[TrackNote] = []

    for pulse_index in range(total_pulses):
        measure_pulse_index = pulse_index % pulses_per_measure
        beat = pulse_index * pulse_quarter_beats + 1
        label = _percussion_label_for_pulse(
            measure_pulse_index,
            pulses_per_measure,
            variant_index=variant_index,
        )
        generated.append(
            note_from_pitch(
                beat=beat,
                duration_beats=min(1, pulse_quarter_beats),
                bpm=bpm,
                source="ai",
                extraction_method=PERCUSSION_METHOD,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                label=label,
                confidence=0.7,
            )
        )
    return generated


def _percussion_label_for_pulse(
    measure_pulse_index: int,
    pulses_per_measure: int,
    *,
    variant_index: int = 0,
) -> str:
    if variant_index % 3 == 1:
        if measure_pulse_index == 0:
            return "Kick"
        if measure_pulse_index in {max(1, pulses_per_measure // 2), pulses_per_measure - 1}:
            return "Snare"
        return "Hat"
    if variant_index % 3 == 2:
        if measure_pulse_index in {0, max(1, pulses_per_measure // 2)}:
            return "Kick"
        if measure_pulse_index == max(1, pulses_per_measure - 1):
            return "Snare"
        return "Hat"
    if measure_pulse_index == 0:
        return "Kick"
    if measure_pulse_index == max(1, pulses_per_measure // 2):
        return "Snare"
    return "Hat"
