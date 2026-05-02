from gigastudy_api.services.engine.music_theory import note_from_pitch
from gigastudy_api.services.engine.scoring import build_harmony_scoring_report, build_scoring_report


def test_scoring_aligns_global_recording_offset_before_comparison() -> None:
    answer_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=72),
        note_from_pitch(beat=2, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=74),
        note_from_pitch(beat=3, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=76),
    ]
    performance_events = [
        note_from_pitch(
            beat=note.beat,
            duration_beats=note.duration_beats,
            bpm=120,
            source="voice",
            extraction_method="test",
            pitch_midi=note.pitch_midi,
            onset_seconds=note.onset_seconds + 0.37,
        )
        for note in answer_events
    ]

    report = build_scoring_report(
        target_slot_id=1,
        target_track_name="Soprano",
        reference_slot_ids=[2],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        answer_events=answer_events,
        performance_events=performance_events,
        bpm=100,
    )

    assert report.alignment_offset_seconds == 0.37
    assert report.matched_event_count == 3
    assert report.missing_event_count == 0
    assert report.extra_event_count == 0
    assert report.mean_abs_timing_error_seconds == 0
    assert report.overall_score == 100


def test_scoring_reports_quantitative_pitch_and_rhythm_errors() -> None:
    answer_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=100, source="musicxml", extraction_method="test", pitch_midi=72),
        note_from_pitch(beat=2, duration_beats=1, bpm=100, source="musicxml", extraction_method="test", pitch_midi=74),
    ]
    performance_events = [
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
        answer_events=answer_events,
        performance_events=performance_events,
    )

    assert report.matched_event_count == 2
    assert report.pitch_score < 100
    assert report.rhythm_score < 100
    assert {issue.issue_type for issue in report.issues} == {"pitch", "rhythm"}
    assert all(issue.answer_region_id == "track-1-region-1" for issue in report.issues)
    assert all(issue.performance_region_id == "performance-1-region-1" for issue in report.issues)
    assert all(issue.answer_event_id == f"track-1-region-1-{issue.answer_source_event_id}" for issue in report.issues)
    assert all(
        issue.performance_event_id == f"performance-1-region-1-{issue.performance_source_event_id}"
        for issue in report.issues
    )
    assert {issue.expected_beat for issue in report.issues} == {1, 2}


def test_harmony_scoring_rates_consonant_added_part_without_answer_track() -> None:
    reference_notes = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=60),
        note_from_pitch(beat=2, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=65),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=64),
        note_from_pitch(beat=2, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=69),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=2,
        target_track_name="Alto",
        reference_slot_ids=[1],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={1: reference_notes},
        performance_events=performance_events,
        bpm=120,
    )

    assert report.score_mode == "harmony"
    assert report.harmony_score is not None
    assert report.harmony_score >= 90
    assert report.overall_score >= 85
    assert report.answer_event_count == 2
    assert report.performance_event_count == 2
    assert not [issue for issue in report.issues if issue.issue_type == "harmony"]


def test_harmony_scoring_flags_strong_dissonance_against_reference_tracks() -> None:
    reference_notes = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=60),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=61),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=2,
        target_track_name="Alto",
        reference_slot_ids=[1],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={1: reference_notes},
        performance_events=performance_events,
        bpm=120,
    )

    assert report.score_mode == "harmony"
    assert report.harmony_score is not None
    assert report.harmony_score < 60
    assert report.overall_score < 75
    assert any(issue.issue_type == "harmony" for issue in report.issues)


def test_harmony_scoring_tolerates_short_weak_beat_passing_tone() -> None:
    reference_notes = [
        note_from_pitch(
            beat=1.5,
            duration_beats=0.5,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=60,
            voice_index=3,
        ),
    ]
    performance_events = [
        note_from_pitch(
            beat=1.5,
            duration_beats=0.25,
            bpm=120,
            source="voice",
            extraction_method="test",
            pitch_midi=62,
        ),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=2,
        target_track_name="Alto",
        reference_slot_ids=[3],
        include_metronome=False,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={3: reference_notes},
        performance_events=performance_events,
        bpm=120,
    )

    issue_types = {issue.issue_type for issue in report.issues}
    assert report.chord_fit_score is not None
    assert report.chord_fit_score >= 65
    assert "harmony" not in issue_types
    assert "chord_fit" not in issue_types


def test_harmony_scoring_accepts_color_tone_over_clear_triad() -> None:
    reference_notes = [
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=67,
            voice_index=2,
        ),
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=64,
            voice_index=3,
        ),
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=60,
            voice_index=5,
        ),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=74),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=1,
        target_track_name="Soprano",
        reference_slot_ids=[2, 3, 5],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={2: [reference_notes[0]], 3: [reference_notes[1]], 5: [reference_notes[2]]},
        performance_events=performance_events,
        bpm=120,
    )

    issue_types = {issue.issue_type for issue in report.issues}
    assert report.chord_fit_score is not None
    assert report.chord_fit_score >= 70
    assert "harmony" not in issue_types
    assert "chord_fit" not in issue_types


def test_harmony_scoring_flags_unresolved_structural_tension() -> None:
    reference_notes = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=60),
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=64),
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=67),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=66),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=2,
        target_track_name="Alto",
        reference_slot_ids=[1, 3, 5],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={1: [reference_notes[2]], 3: [reference_notes[1]], 5: [reference_notes[0]]},
        performance_events=performance_events,
        bpm=120,
    )

    assert report.arrangement_score is not None
    assert report.arrangement_score < 70
    assert any(issue.issue_type == "tension_resolution" for issue in report.issues)


def test_harmony_scoring_accepts_stepwise_resolved_structural_tension() -> None:
    reference_notes = [
        note_from_pitch(beat=1, duration_beats=2, bpm=120, source="musicxml", extraction_method="test", pitch_midi=60),
        note_from_pitch(beat=1, duration_beats=2, bpm=120, source="musicxml", extraction_method="test", pitch_midi=64),
        note_from_pitch(beat=1, duration_beats=2, bpm=120, source="musicxml", extraction_method="test", pitch_midi=67),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=66),
        note_from_pitch(beat=2, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=67),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=2,
        target_track_name="Alto",
        reference_slot_ids=[1, 3, 5],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={1: [reference_notes[2]], 3: [reference_notes[1]], 5: [reference_notes[0]]},
        performance_events=performance_events,
        bpm=120,
    )

    assert not [issue for issue in report.issues if issue.issue_type == "tension_resolution"]


def test_harmony_scoring_flags_thin_structural_chord_coverage() -> None:
    reference_notes = [
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=60,
            voice_index=5,
        ),
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=67,
            voice_index=3,
        ),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=72),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=1,
        target_track_name="Soprano",
        reference_slot_ids=[3, 5],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={3: [reference_notes[1]], 5: [reference_notes[0]]},
        performance_events=performance_events,
        bpm=120,
    )

    assert any(issue.issue_type == "chord_coverage" for issue in report.issues)


def test_harmony_scoring_flags_high_bass_foundation_on_structural_beat() -> None:
    reference_notes = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=64),
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="musicxml", extraction_method="test", pitch_midi=67),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=57),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=5,
        target_track_name="Bass",
        reference_slot_ids=[2, 3],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={2: [reference_notes[1]], 3: [reference_notes[0]]},
        performance_events=performance_events,
        bpm=120,
    )

    assert report.range_score == 100
    assert any(issue.issue_type == "bass_foundation" for issue in report.issues)


def test_harmony_scoring_flags_parallel_fifths_like_arranger_review() -> None:
    reference_notes = [
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=48,
            voice_index=5,
        ),
        note_from_pitch(
            beat=2,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=50,
            voice_index=5,
        ),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=55),
        note_from_pitch(beat=2, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=57),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=4,
        target_track_name="Baritone",
        reference_slot_ids=[5],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={5: reference_notes},
        performance_events=performance_events,
        bpm=120,
    )

    assert report.voice_leading_score is not None
    assert report.voice_leading_score < 100
    assert report.arrangement_score is not None
    assert report.arrangement_score < 95
    assert any(issue.issue_type == "parallel_motion" for issue in report.issues)


def test_harmony_scoring_flags_wide_upper_voice_spacing() -> None:
    reference_notes = [
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=60,
            voice_index=2,
        ),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=84),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=1,
        target_track_name="Soprano",
        reference_slot_ids=[2],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={2: reference_notes},
        performance_events=performance_events,
        bpm=120,
    )

    assert report.spacing_score is not None
    assert report.spacing_score < 70
    assert any(issue.issue_type == "spacing" for issue in report.issues)


def test_harmony_scoring_does_not_flag_short_parallel_motion_as_structural() -> None:
    reference_notes = [
        note_from_pitch(
            beat=1,
            duration_beats=0.25,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=48,
            voice_index=5,
        ),
        note_from_pitch(
            beat=1.25,
            duration_beats=0.25,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=50,
            voice_index=5,
        ),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=0.25, bpm=120, source="voice", extraction_method="test", pitch_midi=55),
        note_from_pitch(
            beat=1.25,
            duration_beats=0.25,
            bpm=120,
            source="voice",
            extraction_method="test",
            pitch_midi=57,
        ),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=4,
        target_track_name="Baritone",
        reference_slot_ids=[5],
        include_metronome=False,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={5: reference_notes},
        performance_events=performance_events,
        bpm=120,
    )

    assert not [issue for issue in report.issues if issue.issue_type == "parallel_motion"]


def test_harmony_scoring_separates_chord_fit_from_simple_interval_check() -> None:
    reference_notes = [
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=60,
            voice_index=5,
        ),
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=64,
            voice_index=3,
        ),
        note_from_pitch(
            beat=1,
            duration_beats=1,
            bpm=120,
            source="musicxml",
            extraction_method="test",
            pitch_midi=67,
            voice_index=1,
        ),
    ]
    performance_events = [
        note_from_pitch(beat=1, duration_beats=1, bpm=120, source="voice", extraction_method="test", pitch_midi=66),
    ]

    report = build_harmony_scoring_report(
        target_slot_id=2,
        target_track_name="Alto",
        reference_slot_ids=[1, 3, 5],
        include_metronome=True,
        created_at="2026-04-20T00:00:00+00:00",
        reference_tracks_by_slot={1: [reference_notes[2]], 3: [reference_notes[1]], 5: [reference_notes[0]]},
        performance_events=performance_events,
        bpm=120,
    )

    assert report.chord_fit_score is not None
    assert report.chord_fit_score < 70
    assert any(issue.issue_type == "chord_fit" for issue in report.issues)
