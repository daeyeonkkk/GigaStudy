from gigastudy_api.services.engine.music_theory import event_from_pitch
from gigastudy_api.services.engine.event_normalization import (
    accidental_for_key,
    estimate_key_signature,
    normalize_track_events,
    spell_midi_label,
)
from gigastudy_api.services.engine.event_quality import prepare_events_for_track_registration


def test_event_normalization_uses_studio_bpm_as_absolute_grid() -> None:
    note = event_from_pitch(
        beat=2.24,
        duration_beats=0.62,
        bpm=60,
        source="voice",
        extraction_method="test",
        pitch_midi=72,
        onset_seconds=999,
        duration_seconds=999,
    )

    normalized = normalize_track_events([note], bpm=90, slot_id=1)

    assert len(normalized) == 1
    assert normalized[0].beat == 2.25
    assert normalized[0].duration_beats == 0.5
    assert normalized[0].onset_seconds == 0.8333
    assert normalized[0].duration_seconds == 0.3333
    assert normalized[0].quantization_grid == 0.25


def test_event_normalization_splits_measure_crossing_notes_with_ties() -> None:
    note = event_from_pitch(
        beat=4.5,
        duration_beats=1,
        bpm=120,
        source="voice",
        extraction_method="test",
        pitch_midi=67,
    )

    normalized = normalize_track_events([note], bpm=120, slot_id=2)

    assert [(entry.beat, entry.duration_beats, entry.measure_index) for entry in normalized] == [
        (4.5, 0.5, 1),
        (5.0, 0.5, 2),
    ]
    assert all(entry.is_tied for entry in normalized)
    assert all("measure_boundary_tie" in entry.quality_warnings for entry in normalized)


def test_event_normalization_applies_track_pitch_register_policy() -> None:
    tenor = event_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=55)
    baritone = event_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=50)

    tenor_note = normalize_track_events([tenor], bpm=120, slot_id=3)[0]
    baritone_note = normalize_track_events([baritone], bpm=120, slot_id=4)[0]

    assert tenor_note.pitch_register == "tenor_voice"
    assert tenor_note.pitch_label_octave_shift == 12
    assert baritone_note.pitch_register == "lower_voice"
    assert baritone_note.pitch_label_octave_shift == 0


def test_event_spelling_uses_key_signature_for_accidentals() -> None:
    assert spell_midi_label(70, spelling_mode="flat") == "Bb4"
    assert accidental_for_key("Bb4", "F") is None
    assert accidental_for_key("B4", "F") == "n"

    f_major_material = [
        event_from_pitch(beat=index + 1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=midi)
        for index, midi in enumerate([65, 67, 69, 70, 72, 74, 76, 77])
    ]
    assert estimate_key_signature(f_major_material) in {"F", "Bb"}


def test_registration_quality_simplifies_dense_voice_noise_to_event_grid() -> None:
    noisy_notes = [
        event_from_pitch(
            beat=1 + index * 0.13,
            duration_beats=0.11,
            bpm=80,
            source="voice",
            extraction_method="test_noise",
            pitch_midi=60 + (index % 8),
            confidence=0.72 if index % 3 else 0.28,
        )
        for index in range(28)
    ]

    result = prepare_events_for_track_registration(
        noisy_notes,
        bpm=92,
        slot_id=1,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert result.events
    assert result.diagnostics["source_kind"] == "recording"
    assert result.diagnostics["registered_event_count"] < len(noisy_notes)
    assert result.diagnostics["max_events_per_measure"] <= 8
    assert result.diagnostics["timing_grid_ratio"] == 1
    assert all(note.quantization_grid in {0.25, 0.5} for note in result.events)
    assert all(note.measure_index == 1 for note in result.events)


def test_registration_quality_keeps_symbolic_input_measure_owned_and_annotated() -> None:
    note = event_from_pitch(
        beat=4.5,
        duration_beats=1,
        bpm=120,
        source="musicxml",
        extraction_method="test_symbolic",
        pitch_midi=67,
    )

    result = prepare_events_for_track_registration(
        [note],
        bpm=90,
        slot_id=3,
        source_kind="document",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(entry.beat, entry.duration_beats, entry.measure_index) for entry in result.events] == [
        (4.5, 0.5, 1),
        (5.0, 0.5, 2),
    ]
    assert all(entry.pitch_register == "tenor_voice" for entry in result.events)
    assert all(entry.key_signature for entry in result.events)
    assert result.diagnostics["cross_measure_event_count"] == 0


def test_registration_quality_aligns_extracted_audio_to_existing_track_grid() -> None:
    reference = [
        event_from_pitch(beat=beat, duration_beats=1, bpm=92, source="musicxml", extraction_method="reference", pitch_midi=72)
        for beat in [1.25, 2.25, 3.25, 4.25]
    ]
    slightly_late_audio = [
        event_from_pitch(
            beat=beat,
            duration_beats=0.5,
            bpm=92,
            source="voice",
            extraction_method="late_take",
            pitch_midi=pitch_midi,
        )
        for beat, pitch_midi in zip([1.5, 2.5, 3.5, 4.5], [60, 62, 64, 65], strict=True)
    ]

    result = prepare_events_for_track_registration(
        slightly_late_audio,
        bpm=92,
        slot_id=2,
        source_kind="audio",
        time_signature_numerator=4,
        time_signature_denominator=4,
        reference_tracks=[reference],
    )

    assert [note.beat for note in result.events] == [1.25, 2.25, 3.25, 4.25]
    assert result.diagnostics["reference_alignment"]["applied"] is True
    assert result.diagnostics["reference_alignment"]["offset_beats"] == -0.25
    assert "reference_track_grid_alignment" in result.diagnostics["actions"]


def test_registration_quality_does_not_shift_explicit_symbolic_syncopation() -> None:
    reference = [
        event_from_pitch(beat=beat, duration_beats=1, bpm=92, source="musicxml", extraction_method="reference", pitch_midi=72)
        for beat in [1.25, 2.25, 3.25, 4.25]
    ]
    syncopated_symbolic = [
        event_from_pitch(beat=beat, duration_beats=0.5, bpm=92, source="musicxml", extraction_method="symbolic", pitch_midi=67)
        for beat in [1.5, 2.5, 3.5, 4.5]
    ]

    result = prepare_events_for_track_registration(
        syncopated_symbolic,
        bpm=92,
        slot_id=3,
        source_kind="document",
        time_signature_numerator=4,
        time_signature_denominator=4,
        reference_tracks=[reference],
    )

    assert [note.beat for note in result.events] == [1.5, 2.5, 3.5, 4.5]
    assert "reference_alignment" not in result.diagnostics
    assert "reference_track_grid_alignment" not in result.diagnostics["actions"]


def test_registration_quality_enforces_final_event_contract() -> None:
    note = event_from_pitch(
        beat=2.24,
        duration_beats=0.62,
        bpm=60,
        source="voice",
        extraction_method="rough_input",
        pitch_midi=55,
        onset_seconds=99,
        duration_seconds=99,
        pitch_register="upper_voice",
        key_signature="F#",
        voice_index=1,
    )

    result = prepare_events_for_track_registration(
        [note],
        bpm=90,
        slot_id=3,
        source_kind="recording",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    registered_note = result.events[0]
    assert registered_note.beat == 2.25
    assert registered_note.duration_beats == 0.5
    assert registered_note.onset_seconds == 0.8333
    assert registered_note.duration_seconds == 0.3333
    assert registered_note.measure_index == 1
    assert registered_note.beat_in_measure == 2.25
    assert registered_note.voice_index == 3
    assert registered_note.pitch_register == "tenor_voice"
    assert registered_note.pitch_label_octave_shift == 12
    assert registered_note.key_signature
    assert result.diagnostics["event_contract"]["single_voice_index"] is True
    assert result.diagnostics["event_contract"]["seconds_follow_beat_grid"] is True
    assert any(action.startswith("event_contract_enforced_") for action in result.diagnostics["actions"])
