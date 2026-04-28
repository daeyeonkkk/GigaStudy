from gigastudy_api.services.engine.arrangement import (
    prepare_ensemble_registration,
    validate_ensemble_registration,
)
from gigastudy_api.services.engine.music_theory import note_from_pitch


def _note(beat: float, label: str, *, slot_source: str = "musicxml"):
    return note_from_pitch(
        beat=beat,
        duration_beats=1,
        bpm=120,
        source=slot_source,
        extraction_method="arrangement_test",
        label=label,
        confidence=1,
    )


def test_ensemble_validation_flags_voice_crossing_before_registration() -> None:
    soprano = [_note(1, "C5"), _note(2, "D5")]
    alto_candidate = [_note(1, "D5"), _note(2, "E5")]

    result = validate_ensemble_registration(
        target_slot_id=2,
        candidate_notes=alto_candidate,
        existing_tracks_by_slot={1: soprano},
        bpm=120,
    )

    diagnostics = result.diagnostics
    assert diagnostics["evaluated"] is True
    assert diagnostics["passed"] is False
    assert diagnostics["issue_code_counts"]["voice_crossing"] >= 2
    assert all("ensemble_voice_crossing" in note.notation_warnings for note in result.notes)


def test_ensemble_validation_flags_wide_adjacent_voice_spacing() -> None:
    soprano = [_note(1, "G5")]
    alto_candidate = [_note(1, "C4")]

    result = validate_ensemble_registration(
        target_slot_id=2,
        candidate_notes=alto_candidate,
        existing_tracks_by_slot={1: soprano},
        bpm=120,
    )

    assert result.diagnostics["passed"] is True
    assert result.diagnostics["issue_code_counts"]["spacing_too_wide"] == 1
    assert "ensemble_spacing_too_wide" in result.notes[0].notation_warnings


def test_ensemble_validation_flags_parallel_perfect_motion() -> None:
    soprano = [_note(1, "C5"), _note(2, "D5")]
    alto_candidate = [_note(1, "F4"), _note(2, "G4")]

    result = validate_ensemble_registration(
        target_slot_id=2,
        candidate_notes=alto_candidate,
        existing_tracks_by_slot={1: soprano},
        bpm=120,
    )

    assert result.diagnostics["issue_code_counts"]["parallel_perfect_interval"] == 1
    assert "ensemble_parallel_perfect_interval" in result.notes[1].notation_warnings


def test_ensemble_preparation_repairs_extractable_octave_crossing() -> None:
    soprano = [_note(1, "C5"), _note(2, "D5")]
    alto_candidate = [_note(1, "C5", slot_source="voice"), _note(2, "D5", slot_source="voice")]

    result = prepare_ensemble_registration(
        target_slot_id=2,
        candidate_notes=alto_candidate,
        existing_tracks_by_slot={1: soprano},
        bpm=120,
        source_kind="audio",
    )

    assert [note.label for note in result.notes] == ["C4", "D4"]
    assert result.diagnostics["repair"]["applied"] is True
    assert result.diagnostics["issue_code_counts"].get("voice_crossing", 0) == 0
    assert all("ensemble_octave_repaired" in note.notation_warnings for note in result.notes)


def test_ensemble_preparation_preserves_symbolic_octaves() -> None:
    soprano = [_note(1, "C5")]
    alto_candidate = [_note(1, "C5")]

    result = prepare_ensemble_registration(
        target_slot_id=2,
        candidate_notes=alto_candidate,
        existing_tracks_by_slot={1: soprano},
        bpm=120,
        source_kind="score",
    )

    assert result.notes[0].label == "C5"
    assert result.diagnostics["repair"]["applied"] is False
    assert result.diagnostics["issue_code_counts"]["voice_crossing"] == 1


def test_ensemble_validation_flags_unsingable_large_leaps() -> None:
    tenor_candidate = [_note(1, "C3"), _note(2, "E4")]

    result = validate_ensemble_registration(
        target_slot_id=3,
        candidate_notes=tenor_candidate,
        existing_tracks_by_slot={},
        bpm=120,
    )

    assert result.diagnostics["issue_code_counts"]["large_melodic_leap"] == 1
    assert "ensemble_large_melodic_leap" in result.notes[1].notation_warnings
