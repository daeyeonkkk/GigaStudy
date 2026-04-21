from gigastudy_api.services.engine.music_theory import note_from_pitch
from gigastudy_api.services.engine.scoring import build_scoring_report


def test_scoring_aligns_global_recording_offset_before_comparison() -> None:
    answer_notes = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=72),
        note_from_pitch(beat=2, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=74),
        note_from_pitch(beat=3, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=76),
    ]
    performance_notes = [
        note_from_pitch(
            beat=note.beat,
            duration_beats=note.duration_beats,
            bpm=120,
            source="voice",
            extraction_method="test",
            pitch_midi=note.pitch_midi,
            onset_seconds=note.onset_seconds + 0.37,
        )
        for note in answer_notes
    ]

    report = build_scoring_report(
        target_slot_id=1,
        target_track_name="Soprano",
        reference_slot_ids=[2],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        answer_notes=answer_notes,
        performance_notes=performance_notes,
    )

    assert report.alignment_offset_seconds == 0.37
    assert report.matched_note_count == 3
    assert report.missing_note_count == 0
    assert report.extra_note_count == 0
    assert report.mean_abs_timing_error_seconds == 0
    assert report.overall_score == 100


def test_scoring_reports_quantitative_pitch_and_rhythm_errors() -> None:
    answer_notes = [
        note_from_pitch(beat=1, duration_beats=1, bpm=100, source="musicxml", extraction_method="test", pitch_midi=72),
        note_from_pitch(beat=2, duration_beats=1, bpm=100, source="musicxml", extraction_method="test", pitch_midi=74),
    ]
    performance_notes = [
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=100,
            source="voice",
            extraction_method="test",
            pitch_midi=73,
            onset_seconds=0.04,
        ),
        note_from_pitch(
            beat=2,
            duration_beats=1,
            bpm=100,
            source="voice",
            extraction_method="test",
            pitch_midi=74,
            onset_seconds=0.77,
        ),
    ]

    report = build_scoring_report(
        target_slot_id=1,
        target_track_name="Soprano",
        reference_slot_ids=[],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        answer_notes=answer_notes,
        performance_notes=performance_notes,
    )

    assert report.matched_note_count == 2
    assert report.pitch_score < 100
    assert report.rhythm_score < 100
    assert {issue.issue_type for issue in report.issues} == {"pitch", "rhythm"}
