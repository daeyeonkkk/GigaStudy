from gigastudy_api.services.engine.music_theory import note_from_pitch
from gigastudy_api.services.engine.notation import (
    accidental_for_key,
    estimate_key_signature,
    normalize_track_notes,
    spell_midi_label,
)


def test_notation_normalization_uses_studio_bpm_as_absolute_grid() -> None:
    note = note_from_pitch(
        beat=2.24,
        duration_beats=0.62,
        bpm=60,
        source="voice",
        extraction_method="test",
        pitch_midi=72,
        onset_seconds=999,
        duration_seconds=999,
    )

    normalized = normalize_track_notes([note], bpm=90, slot_id=1)

    assert len(normalized) == 1
    assert normalized[0].beat == 2.25
    assert normalized[0].duration_beats == 0.5
    assert normalized[0].onset_seconds == 0.8333
    assert normalized[0].duration_seconds == 0.3333
    assert normalized[0].quantization_grid == 0.25


def test_notation_normalization_splits_measure_crossing_notes_with_ties() -> None:
    note = note_from_pitch(
        beat=4.5,
        duration_beats=1,
        bpm=120,
        source="voice",
        extraction_method="test",
        pitch_midi=67,
    )

    normalized = normalize_track_notes([note], bpm=120, slot_id=2)

    assert [(entry.beat, entry.duration_beats, entry.measure_index) for entry in normalized] == [
        (4.5, 0.5, 1),
        (5.0, 0.5, 2),
    ]
    assert all(entry.is_tied for entry in normalized)
    assert all("measure_boundary_tie" in entry.notation_warnings for entry in normalized)


def test_notation_normalization_applies_track_clef_policy() -> None:
    tenor = note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=55)
    baritone = note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=50)

    tenor_note = normalize_track_notes([tenor], bpm=120, slot_id=3)[0]
    baritone_note = normalize_track_notes([baritone], bpm=120, slot_id=4)[0]

    assert tenor_note.clef == "treble_8vb"
    assert tenor_note.display_octave_shift == 12
    assert baritone_note.clef == "bass"
    assert baritone_note.display_octave_shift == 0


def test_notation_spelling_uses_key_signature_for_accidentals() -> None:
    assert spell_midi_label(70, spelling_mode="flat") == "Bb4"
    assert accidental_for_key("Bb4", "F") is None
    assert accidental_for_key("B4", "F") == "n"

    f_major_material = [
        note_from_pitch(beat=index + 1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=midi)
        for index, midi in enumerate([65, 67, 69, 70, 72, 74, 76, 77])
    ]
    assert estimate_key_signature(f_major_material) in {"F", "Bb"}
