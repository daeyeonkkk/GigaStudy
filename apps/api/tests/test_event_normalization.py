from pathlib import Path

import pytest

from gigastudy_api.services.engine.music_theory import event_from_pitch
from gigastudy_api.services.engine.event_normalization import (
    accidental_for_key,
    estimate_key_signature,
    measure_sixteenth_note_beats,
    normalize_track_events,
    spell_midi_label,
)
from gigastudy_api.services.engine.event_quality import prepare_events_for_track_registration
from gigastudy_api.services.engine.registration_policy import build_registration_grid_policy
from gigastudy_api.services.engine.symbolic import parse_symbolic_file_with_metadata


def _vlq(value: int) -> bytes:
    values = [value & 0x7F]
    value >>= 7
    while value:
        values.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(values)


def _midi_track(name: str, notes: list[tuple[int, int, int]], *, channel: int = 0) -> bytes:
    name_bytes = name.encode("utf-8")
    events: list[tuple[int, int, bytes]] = [(0, 0, b"\xff\x03" + _vlq(len(name_bytes)) + name_bytes)]
    for start_tick, duration_ticks, pitch in notes:
        events.append((start_tick, 1, bytes([0x90 + channel, pitch, 100])))
        events.append((start_tick + duration_ticks, 0, bytes([0x80 + channel, pitch, 64])))

    payload = bytearray()
    previous_tick = 0
    for tick, _order, event_payload in sorted(events):
        payload.extend(_vlq(tick - previous_tick))
        payload.extend(event_payload)
        previous_tick = tick
    payload.extend(b"\x00\xff\x2f\x00")
    return b"MTrk" + len(payload).to_bytes(4, "big") + bytes(payload)


def _midi_payload(tracks: list[bytes], *, ticks_per_quarter: int = 480) -> bytes:
    return b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            len(tracks).to_bytes(2, "big"),
            ticks_per_quarter.to_bytes(2, "big"),
            *tracks,
        ]
    )


def _is_on_grid(value: float, grid: float) -> bool:
    return abs(value - round(value / grid) * grid) <= 0.001


def _assert_registration_rhythm_contract(events, grid: float) -> None:
    assert events
    assert all(_is_on_grid(event.beat, grid) for event in events)
    assert all(_is_on_grid(event.duration_beats, grid) for event in events)
    assert all(event.duration_beats >= grid for event in events)
    ordered_events = sorted(events, key=lambda event: event.beat)
    for left, right in zip(ordered_events, ordered_events[1:], strict=False):
        gap = round(right.beat - (left.beat + left.duration_beats), 4)
        assert gap >= -0.001
        if gap > 0:
            assert _is_on_grid(gap, grid)


def _assert_optional_midi_sample_registration_uses_readable_grid(filename: str, *, bpm: int) -> None:
    sample_path = Path(__file__).parents[3] / "giga_sample" / filename
    if not sample_path.exists():
        pytest.skip(f"local giga_sample {filename} MIDI is not present")

    parsed = parse_symbolic_file_with_metadata(sample_path, bpm=bpm)
    resolved_bpm = parsed.source_bpm or bpm
    grid = measure_sixteenth_note_beats(
        parsed.time_signature_numerator,
        parsed.time_signature_denominator,
    )

    assert parsed.mapped_events
    for slot_id, events in parsed.mapped_events.items():
        result = prepare_events_for_track_registration(
            events,
            bpm=resolved_bpm,
            slot_id=slot_id,
            source_kind="midi",
            time_signature_numerator=parsed.time_signature_numerator,
            time_signature_denominator=parsed.time_signature_denominator,
        )
        _assert_registration_rhythm_contract(result.events, grid)
        assert result.diagnostics["event_contract"]["rhythm_grid_aligned"] is True


def test_optional_aroha_sample_registration_uses_readable_grid() -> None:
    _assert_optional_midi_sample_registration_uses_readable_grid("아로하(2ND).mid", bpm=113)


def test_optional_fish_sample_registration_uses_readable_grid() -> None:
    _assert_optional_midi_sample_registration_uses_readable_grid("물 만난 물고기(SATB) (1).mid", bpm=101)


def test_registration_policy_centralizes_grid_and_gap_rules() -> None:
    policy = build_registration_grid_policy(
        bpm=102,
        time_signature_numerator=3,
        time_signature_denominator=8,
    )

    assert policy.rhythm_grid_beats == 0.25
    assert policy.rhythm_grid_seconds == pytest.approx((60 / 102) * 0.25)
    assert policy.quantize_beat(1.13) == 1.25
    assert policy.quantize_duration(0.11) == 0.25
    assert policy.should_absorb_gap(0.249)
    assert not policy.should_absorb_gap(0.25)
    assert policy.diagnostics()["version"] == "registration_policy_v1"


def test_nwc_style_midi_seed_registers_generic_parts_without_overlaps(tmp_path: Path) -> None:
    midi_path = tmp_path / "nwc-style-generic.mid"
    midi_path.write_bytes(
        _midi_payload(
            [
                _midi_track(
                    "Staff 1",
                    [
                        (0, 230, 76),
                        (240, 230, 76),
                        (480, 520, 77),
                        (960, 240, 79),
                    ],
                    channel=0,
                ),
                _midi_track("Staff 2", [(0, 480, 69), (480, 480, 71)], channel=1),
                _midi_track("Staff 3", [(0, 480, 60), (480, 480, 60)], channel=2),
                _midi_track("Staff 4", [(0, 480, 48), (480, 480, 50)], channel=3),
            ]
        )
    )

    parsed = parse_symbolic_file_with_metadata(midi_path, bpm=113)

    assert set(parsed.mapped_events) == {1, 2, 3, 5}
    assert [event.pitch_midi for event in parsed.mapped_events[1]][0] == 76
    assert [event.pitch_midi for event in parsed.mapped_events[5]][0] == 48

    grid = measure_sixteenth_note_beats(
        parsed.time_signature_numerator,
        parsed.time_signature_denominator,
    )
    for slot_id, events in parsed.mapped_events.items():
        result = prepare_events_for_track_registration(
            events,
            bpm=113,
            slot_id=slot_id,
            source_kind="midi",
            time_signature_numerator=parsed.time_signature_numerator,
            time_signature_denominator=parsed.time_signature_denominator,
        )
        _assert_registration_rhythm_contract(result.events, grid)
        assert result.diagnostics["event_contract"]["non_overlapping"] is True
        assert result.diagnostics["event_contract"]["rhythm_gaps_aligned"] is True


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


def test_measure_sixteenth_note_beats_is_derived_from_meter() -> None:
    assert measure_sixteenth_note_beats(4, 4) == 0.25
    assert measure_sixteenth_note_beats(3, 4) == 0.25
    assert measure_sixteenth_note_beats(6, 8) == 0.25


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


def test_event_normalization_merges_only_touching_same_pitch_events() -> None:
    notes = [
        event_from_pitch(beat=1, duration_beats=0.5, bpm=120, source="midi", extraction_method="test", pitch_midi=60),
        event_from_pitch(beat=1.5, duration_beats=0.5, bpm=120, source="midi", extraction_method="test", pitch_midi=60),
        event_from_pitch(beat=2.25, duration_beats=0.5, bpm=120, source="midi", extraction_method="test", pitch_midi=60),
    ]

    normalized = normalize_track_events(notes, bpm=120, slot_id=1)

    assert [(entry.beat, entry.duration_beats) for entry in normalized] == [
        (1.0, 1.0),
        (2.25, 0.5),
    ]


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


def test_registration_quality_keeps_symbolic_sustain_continuous_and_annotated() -> None:
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

    assert [(entry.beat, entry.duration_beats, entry.measure_index) for entry in result.events] == [(4.5, 1.0, 1)]
    assert all(entry.pitch_register == "tenor_voice" for entry in result.events)
    assert all(entry.key_signature for entry in result.events)
    assert result.diagnostics["cross_measure_event_count"] == 1
    assert "symbolic_same_pitch_tie_merge" in result.diagnostics["actions"]


def test_registration_quality_preserves_repeated_symbolic_same_pitch_attacks() -> None:
    notes = [
        event_from_pitch(beat=1, duration_beats=0.5, bpm=120, source="midi", extraction_method="test", pitch_midi=60),
        event_from_pitch(beat=1.5, duration_beats=0.5, bpm=120, source="midi", extraction_method="test", pitch_midi=60),
        event_from_pitch(beat=2.25, duration_beats=0.5, bpm=120, source="midi", extraction_method="test", pitch_midi=60),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=120,
        slot_id=1,
        source_kind="midi",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(entry.beat, entry.duration_beats) for entry in result.events] == [
        (1.0, 0.5),
        (1.5, 0.5),
        (2.25, 0.5),
    ]
    assert "symbolic_same_pitch_tie_merge" not in result.diagnostics["actions"]


def test_registration_quality_preserves_generated_repeated_same_pitch_attacks() -> None:
    notes = [
        event_from_pitch(beat=1.02, duration_beats=0.23, bpm=113, source="ai", extraction_method="test", pitch_midi=64),
        event_from_pitch(beat=1.27, duration_beats=0.24, bpm=113, source="ai", extraction_method="test", pitch_midi=64),
        event_from_pitch(beat=1.52, duration_beats=0.24, bpm=113, source="ai", extraction_method="test", pitch_midi=64),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=113,
        slot_id=2,
        source_kind="ai",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(entry.beat, entry.duration_beats) for entry in result.events] == [
        (1.0, 0.25),
        (1.25, 0.25),
        (1.5, 0.25),
    ]
    assert "voice_sustain_merge" not in " ".join(result.diagnostics["actions"])


def test_registration_quality_quantizes_all_automatic_sources_to_rhythm_grid() -> None:
    for source_kind, event_source in [
        ("recording", "voice"),
        ("audio", "audio"),
        ("midi", "midi"),
        ("ai", "ai"),
    ]:
        notes = [
            event_from_pitch(
                beat=1.13,
                duration_beats=0.38,
                bpm=113,
                source=event_source,
                extraction_method=f"{source_kind}_off_grid",
                pitch_midi=60,
            ),
            event_from_pitch(
                beat=2.11,
                duration_beats=0.62,
                bpm=113,
                source=event_source,
                extraction_method=f"{source_kind}_off_grid",
                pitch_midi=62,
            ),
        ]

        result = prepare_events_for_track_registration(
            notes,
            bpm=113,
            slot_id=2,
            source_kind=source_kind,
            time_signature_numerator=4,
            time_signature_denominator=4,
        )

        grid = result.diagnostics["event_contract"]["rhythm_grid_beats"]
        assert grid == 0.25
        assert result.diagnostics["event_contract"]["rhythm_grid_aligned"] is True
        assert result.diagnostics["event_contract"]["rhythm_gaps_aligned"] is True
        assert result.diagnostics["event_contract"]["non_overlapping"] is True
        assert result.diagnostics["rhythmic_grid_ratio"] == 1
        _assert_registration_rhythm_contract(result.events, grid)


def test_registration_quality_absorbs_symbolic_micro_gaps_on_sixteenth_grid() -> None:
    notes = [
        event_from_pitch(beat=1, duration_beats=0.4896, bpm=113, source="midi", extraction_method="test", pitch_midi=60),
        event_from_pitch(beat=1.5, duration_beats=0.4896, bpm=113, source="midi", extraction_method="test", pitch_midi=60),
        event_from_pitch(beat=2.0, duration_beats=0.2396, bpm=113, source="midi", extraction_method="test", pitch_midi=62),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=113,
        slot_id=2,
        source_kind="midi",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert result.diagnostics["event_contract"]["minimum_note_beats"] == 0.25
    assert [(event.pitch_midi, event.beat, event.duration_beats) for event in result.events] == [
        (60, 1.0, 0.5),
        (60, 1.5, 0.5),
        (62, 2.0, 0.25),
    ]
    assert min(event.duration_beats for event in result.events) >= 0.25


def test_registration_quality_merges_symbolic_tied_same_pitch_fragments() -> None:
    notes = [
        event_from_pitch(
            beat=1,
            duration_beats=0.5,
            bpm=120,
            source="midi",
            extraction_method="test",
            pitch_midi=60,
            is_tied=True,
        ),
        event_from_pitch(
            beat=1.5,
            duration_beats=0.5,
            bpm=120,
            source="midi",
            extraction_method="test",
            pitch_midi=60,
            is_tied=True,
        ),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=120,
        slot_id=2,
        source_kind="midi",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(event.pitch_midi, event.beat, event.duration_beats) for event in result.events] == [
        (60, 1.0, 1.0),
    ]
    assert "symbolic_same_pitch_tie_merge" in result.diagnostics["actions"]


def test_registration_quality_fills_symbolic_rests_shorter_than_sixteenth_note() -> None:
    notes = [
        event_from_pitch(beat=1, duration_beats=0.43, bpm=113, source="midi", extraction_method="test", pitch_midi=60),
        event_from_pitch(beat=1.5, duration_beats=0.5, bpm=113, source="midi", extraction_method="test", pitch_midi=62),
    ]

    result = prepare_events_for_track_registration(
        notes,
        bpm=113,
        slot_id=2,
        source_kind="midi",
        time_signature_numerator=4,
        time_signature_denominator=4,
    )

    assert [(event.pitch_midi, event.beat, event.duration_beats) for event in result.events] == [
        (60, 1.0, 0.5),
        (62, 1.5, 0.5),
    ]
    assert result.diagnostics["event_contract"]["rhythm_grid_aligned"] is True
    assert result.diagnostics["event_contract"]["rhythm_gaps_aligned"] is True


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
