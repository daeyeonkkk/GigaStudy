from gigastudy_api.services.engine.harmony import (
    generate_rule_based_harmony,
    generate_rule_based_harmony_candidates,
)
from gigastudy_api.services.engine.harmony_plan import (
    DeepSeekCandidateDirection,
    DeepSeekHarmonyPlan,
    MeasureHarmonyIntent,
)
from gigastudy_api.services.engine.music_theory import note_from_pitch


def _context_note(beat: float, label: str = "C5"):
    return note_from_pitch(
        beat=beat,
        duration_beats=1,
        bpm=120,
        source="musicxml",
        extraction_method="test_context",
        label=label,
        confidence=1,
        time_signature_numerator=3,
        time_signature_denominator=4,
    )


def test_percussion_generation_resets_pattern_on_each_measure_downbeat() -> None:
    notes = generate_rule_based_harmony(
        target_slot_id=6,
        context_tracks=[_context_note(beat) for beat in range(1, 7)],
        bpm=120,
        time_signature_numerator=3,
        time_signature_denominator=4,
    )

    assert [note.beat for note in notes[:6]] == [1, 2, 3, 4, 5, 6]
    assert [note.label for note in notes[:6]] == ["Kick", "Snare", "Hat", "Kick", "Snare", "Hat"]
    assert notes[3].measure_index == 2
    assert notes[3].beat_in_measure == 1


def test_percussion_generation_uses_denominator_pulses_for_compound_meter() -> None:
    notes = generate_rule_based_harmony(
        target_slot_id=6,
        context_tracks=[
            note_from_pitch(
                beat=1,
                duration_beats=3,
                bpm=120,
                source="musicxml",
                extraction_method="test_context",
                label="C5",
                confidence=1,
                time_signature_numerator=6,
                time_signature_denominator=8,
            )
        ],
        bpm=120,
        time_signature_numerator=6,
        time_signature_denominator=8,
    )

    assert [note.beat for note in notes[:6]] == [1, 1.5, 2, 2.5, 3, 3.5]
    assert [note.label for note in notes[:6]] == ["Kick", "Hat", "Hat", "Snare", "Hat", "Hat"]


def test_vocal_generation_keeps_target_range_and_meter_metadata() -> None:
    notes = generate_rule_based_harmony(
        target_slot_id=2,
        context_tracks=[_context_note(1, "C5"), _context_note(2, "D5"), _context_note(3, "E5")],
        bpm=120,
        time_signature_numerator=3,
        time_signature_denominator=4,
    )

    assert [note.beat for note in notes] == [1, 2, 3]
    assert all(55 <= (note.pitch_midi or 0) <= 74 for note in notes)
    assert [note.measure_index for note in notes] == [1, 1, 1]
    assert [note.beat_in_measure for note in notes] == [1, 2, 3]


def test_vocal_generation_uses_known_slots_to_avoid_voice_crossing() -> None:
    soprano = [_context_note(1, "C5"), _context_note(2, "D5"), _context_note(3, "E5"), _context_note(4, "F5")]
    tenor = [_context_note(1, "E4"), _context_note(2, "F4"), _context_note(3, "G4"), _context_note(4, "A4")]

    notes = generate_rule_based_harmony(
        target_slot_id=2,
        context_tracks=soprano + tenor,
        context_notes_by_slot={1: soprano, 3: tenor},
        bpm=120,
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [note.extraction_method for note in notes] == ["rule_based_voice_leading_v1"] * 4
    for generated, upper, lower in zip(notes, soprano, tenor, strict=True):
        assert lower.pitch_midi < generated.pitch_midi < upper.pitch_midi


def test_vocal_generation_uses_middle_gap_when_neighbor_voices_are_close() -> None:
    tenor = [_context_note(1, "F3")]
    bass = [_context_note(1, "D#3")]

    notes = generate_rule_based_harmony(
        target_slot_id=4,
        context_tracks=tenor + bass,
        context_notes_by_slot={3: tenor, 5: bass},
        bpm=120,
    )

    assert len(notes) == 1
    assert notes[0].label == "E3"
    assert bass[0].pitch_midi < notes[0].pitch_midi < tenor[0].pitch_midi


def test_vocal_generation_avoids_parallel_perfects_against_soprano() -> None:
    soprano = [
        _context_note(1, "C5"),
        _context_note(2, "D5"),
        _context_note(3, "E5"),
        _context_note(4, "F5"),
        _context_note(5, "G5"),
    ]

    notes = generate_rule_based_harmony(
        target_slot_id=2,
        context_tracks=soprano,
        context_notes_by_slot={1: soprano},
        bpm=120,
    )

    assert len(notes) == len(soprano)
    assert not _has_parallel_perfects(soprano, notes)


def test_vocal_generation_shapes_final_cadence_toward_tonic_chord() -> None:
    soprano = [
        _context_note(1, "C5"),
        _context_note(2, "D5"),
        _context_note(3, "E5"),
        _context_note(4, "G5"),
        _context_note(5, "C6"),
    ]

    notes = generate_rule_based_harmony(
        target_slot_id=2,
        context_tracks=soprano,
        context_notes_by_slot={1: soprano},
        bpm=120,
    )

    assert notes[-1].pitch_midi % 12 in {0, 4, 7}
    assert abs(notes[-1].pitch_midi - notes[-2].pitch_midi) <= 2


def test_vocal_generation_keeps_subbeat_rhythm_and_stepwise_connectors() -> None:
    soprano = [
        _context_note(1, "C5"),
        _context_note(1.5, "D5"),
        _context_note(2, "E5"),
        _context_note(2.5, "F5"),
        _context_note(3, "G5"),
        _context_note(4, "C6"),
    ]

    notes = generate_rule_based_harmony(
        target_slot_id=2,
        context_tracks=soprano,
        context_notes_by_slot={1: soprano},
        bpm=120,
    )

    assert [note.beat for note in notes] == [1, 1.5, 2, 2.5, 3, 4]
    assert all(
        abs(notes[index].pitch_midi - notes[index - 1].pitch_midi) <= 2
        for index in range(1, len(notes))
    )


def test_vocal_generation_candidates_are_distinct_arrangements() -> None:
    soprano = [
        _context_note(1, "C5"),
        _context_note(2, "D5"),
        _context_note(3, "E5"),
        _context_note(4, "G5"),
        _context_note(5, "C6"),
        _context_note(6, "B5"),
        _context_note(7, "A5"),
        _context_note(8, "G5"),
    ]

    candidates = generate_rule_based_harmony_candidates(
        target_slot_id=3,
        context_tracks=soprano,
        context_notes_by_slot={1: soprano},
        bpm=120,
        candidate_count=3,
    )

    assert len(candidates) == 3
    sequences = [tuple(note.pitch_midi for note in candidate) for candidate in candidates]
    assert len(set(sequences)) == 3
    assert any(
        _sequence_difference_score(sequences[0], sequence) >= 0.22
        for sequence in sequences[1:]
    )


def test_harmony_plan_changes_notes_and_rhythm_policy() -> None:
    soprano = [
        _context_note(1, "C5"),
        _context_note(1.5, "D5"),
        _context_note(2, "E5"),
        _context_note(2.5, "F5"),
        _context_note(3, "G5"),
        _context_note(3.5, "A5"),
        _context_note(4, "G5"),
    ]
    baseline = generate_rule_based_harmony_candidates(
        target_slot_id=3,
        context_tracks=soprano,
        context_notes_by_slot={1: soprano},
        bpm=120,
        candidate_count=1,
    )[0]
    plan = DeepSeekHarmonyPlan(
        key="C",
        mode="major",
        confidence=0.9,
        measures=[
            MeasureHarmonyIntent(
                measure_index=1,
                function="dominant",
                preferred_degrees=[5],
                target_motion="stable",
            )
        ],
        candidate_directions=[
            DeepSeekCandidateDirection(
                candidate_index=1,
                profile_name="lower_support",
                title="넓은 받침",
                goal="open_support",
                register_bias="low",
                motion_bias="stable",
                rhythm_policy="sustain_support",
                chord_tone_priority=["root", "fifth", "third"],
            )
        ],
    )

    planned = generate_rule_based_harmony_candidates(
        target_slot_id=3,
        context_tracks=soprano,
        context_notes_by_slot={1: soprano},
        bpm=120,
        candidate_count=1,
        profile_names=plan.profile_names(),
        harmony_plan=plan,
    )[0]

    assert tuple(note.pitch_midi for note in planned) != tuple(note.pitch_midi for note in baseline)
    assert len(planned) < len(baseline)
    assert planned[0].duration_beats > baseline[0].duration_beats


def _has_parallel_perfects(first_voice, second_voice) -> bool:
    for index in range(1, min(len(first_voice), len(second_voice))):
        previous_interval = abs(first_voice[index - 1].pitch_midi - second_voice[index - 1].pitch_midi) % 12
        current_interval = abs(first_voice[index].pitch_midi - second_voice[index].pitch_midi) % 12
        first_motion = first_voice[index].pitch_midi - first_voice[index - 1].pitch_midi
        second_motion = second_voice[index].pitch_midi - second_voice[index - 1].pitch_midi
        if (
            first_motion != 0
            and second_motion != 0
            and (first_motion > 0) == (second_motion > 0)
            and previous_interval in {0, 7}
            and current_interval in {0, 7}
        ):
            return True
    return False


def _sequence_difference_score(first, second) -> float:
    pair_count = min(len(first), len(second))
    changed_positions = sum(
        1
        for index in range(pair_count)
        if abs(first[index] - second[index]) >= 3
    )
    average_register_delta = abs((sum(first) / len(first)) - (sum(second) / len(second)))
    return (
        (changed_positions / pair_count) * 0.7
        + min(1.0, average_register_delta / 8) * 0.2
    )
