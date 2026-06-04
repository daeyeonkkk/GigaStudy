from pathlib import Path

from gigastudy_api.services.engine.symbolic import (
    ParsedSymbolicFile,
    ParsedTrack,
    map_tracks_to_slots,
    midi_seed_empty_named_parts,
    parse_midi_file,
    parse_musicxml_file,
    parse_symbolic_file_with_metadata,
    symbolic_seed_review_reasons,
)
from gigastudy_api.services.engine.music_theory import infer_slot_id, event_from_pitch


MUSICXML_FIXTURE = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
    <score-part id="P2"><part-name>Alto</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def test_musicxml_parser_maps_named_parts_to_track_slots(tmp_path: Path) -> None:
    musicxml_path = tmp_path / "satb.musicxml"
    musicxml_path.write_text(MUSICXML_FIXTURE, encoding="utf-8")

    parsed_tracks = parse_musicxml_file(musicxml_path, bpm=120)

    assert [track.slot_id for track in parsed_tracks] == [1, 2]
    assert [note.label for note in parsed_tracks[0].events] == ["C5", "E5"]
    assert parsed_tracks[0].events[0].pitch_midi == 72
    assert parsed_tracks[0].events[0].duration_seconds == 0.5
    assert parsed_tracks[1].events[0].label == "A4"
    assert parsed_tracks[1].events[0].duration_beats == 2


def test_musicxml_parser_preserves_time_signature_for_measure_grid(tmp_path: Path) -> None:
    musicxml_path = tmp_path / "three-four.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    parsed = parse_symbolic_file_with_metadata(musicxml_path, bpm=120)
    notes = parsed.mapped_events[1]

    assert parsed.time_signature_numerator == 3
    assert parsed.time_signature_denominator == 4
    assert parsed.has_time_signature is True
    assert notes[0].measure_index == 1
    assert notes[2].beat_in_measure == 3
    assert notes[3].measure_index == 2
    assert notes[3].beat == 4
    assert notes[3].beat_in_measure == 1


def _vlq(value: int) -> bytes:
    values = [value & 0x7F]
    value >>= 7
    while value:
      values.insert(0, (value & 0x7F) | 0x80)
      value >>= 7
    return bytes(values)


def test_midi_parser_extracts_note_on_off_pairs(tmp_path: Path) -> None:
    track_events = b"".join(
        [
            b"\x00\xff\x03\x07Soprano",
            b"\x00\x90\x48\x64",
            _vlq(480) + b"\x80\x48\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    midi_payload = b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )
    midi_path = tmp_path / "soprano.mid"
    midi_path.write_bytes(midi_payload)

    parsed_tracks = parse_midi_file(midi_path, bpm=120)

    assert len(parsed_tracks) == 1
    assert parsed_tracks[0].slot_id == 1
    assert len(parsed_tracks[0].events) == 1
    assert parsed_tracks[0].events[0].label == "C5"
    assert parsed_tracks[0].events[0].beat == 1
    assert parsed_tracks[0].events[0].duration_beats == 1


def test_midi_parser_normalizes_seconds_to_studio_bpm(tmp_path: Path) -> None:
    track_events = b"".join(
        [
            b"\x00\xff\x03\x07Soprano",
            b"\x00\xff\x51\x03\x0f\x42\x40",  # 60 BPM in the source file.
            b"\x00\x90\x48\x64",
            _vlq(480) + b"\x80\x48\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    midi_payload = b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )
    midi_path = tmp_path / "tempo.mid"
    midi_path.write_bytes(midi_payload)

    parsed_tracks = parse_midi_file(midi_path, bpm=120)
    parsed = parse_symbolic_file_with_metadata(midi_path, bpm=120)

    assert parsed_tracks[0].events[0].duration_beats == 1
    assert parsed_tracks[0].events[0].duration_seconds == 0.5
    assert parsed.source_bpm == 60


def test_midi_parser_preserves_time_signature_for_measure_grid(tmp_path: Path) -> None:
    track_events = b"".join(
        [
            b"\x00\xff\x03\x07Soprano",
            b"\x00\xff\x58\x04\x03\x02\x18\x08",
            b"\x00\x90\x48\x64",
            _vlq(480) + b"\x80\x48\x40",
            b"\x00\x90\x4a\x64",
            _vlq(480) + b"\x80\x4a\x40",
            b"\x00\x90\x4c\x64",
            _vlq(480) + b"\x80\x4c\x40",
            b"\x00\x90\x4d\x64",
            _vlq(480) + b"\x80\x4d\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    midi_payload = b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )
    midi_path = tmp_path / "three-four.mid"
    midi_path.write_bytes(midi_payload)

    parsed = parse_symbolic_file_with_metadata(midi_path, bpm=120)
    notes = parsed.mapped_events[1]

    assert parsed.time_signature_numerator == 3
    assert parsed.time_signature_denominator == 4
    assert parsed.has_time_signature is True
    assert notes[2].beat_in_measure == 3
    assert notes[3].measure_index == 2
    assert notes[3].beat == 4
    assert notes[3].beat_in_measure == 1


def test_midi_mapping_collapses_vocal_tracks_to_monophonic_lines(tmp_path: Path) -> None:
    track_events = b"".join(
        [
            b"\x00\xff\x03\x07Soprano",
            b"\x00\x90\x48\x64",  # C5 chord tone.
            b"\x00\x90\x4c\x64",  # E5 starts at the same onset and should win for soprano.
            _vlq(240) + b"\x90\x4f\x64",  # G5 starts before the first notes end.
            _vlq(240) + b"\x80\x48\x40",
            b"\x00\x80\x4c\x40",
            _vlq(480) + b"\x80\x4f\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    midi_payload = b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (1).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )
    midi_path = tmp_path / "polyphonic-soprano.mid"
    midi_path.write_bytes(midi_payload)

    parsed = parse_symbolic_file_with_metadata(midi_path, bpm=120)
    notes = parsed.mapped_events[1]

    assert [note.label for note in notes] == ["E5", "G5"]
    assert notes[0].beat == 1
    assert notes[0].duration_beats == 0.5
    assert notes[1].beat == 1.5
    assert notes[0].beat + notes[0].duration_beats <= notes[1].beat
    assert "polyphonic_onset_collapsed" in notes[0].quality_warnings
    assert "monophonic_overlap_resolved" in notes[1].quality_warnings


def test_midi_parser_splits_generic_channel_packed_tracks_by_register(tmp_path: Path) -> None:
    track_events = b"".join(
        [
            b"\x00\xff\x03\x0cMIDI track 1",
            b"\x00\xc0\x00",  # Channel 1 acoustic piano program.
            b"\x00\xc1\x00",  # Channel 2 acoustic piano program.
            b"\x00\x90\x48\x64",
            b"\x00\x91\x30\x64",
            _vlq(480) + b"\x80\x48\x40",
            b"\x00\x81\x30\x40",
            b"\x00\xff\x2f\x00",
        ]
    )
    midi_payload = b"".join(
        [
            b"MThd",
            (6).to_bytes(4, "big"),
            (0).to_bytes(2, "big"),
            (1).to_bytes(2, "big"),
            (480).to_bytes(2, "big"),
            b"MTrk",
            len(track_events).to_bytes(4, "big"),
            track_events,
        ]
    )
    midi_path = tmp_path / "generic-type-zero.mid"
    midi_path.write_bytes(midi_payload)

    parsed = parse_symbolic_file_with_metadata(midi_path, bpm=120)
    parsed_tracks = [track for track in parsed.tracks if track.events]

    assert len(parsed_tracks) == 2
    assert {tuple(track.diagnostics["midi_channels"]) for track in parsed_tracks} == {(1,), (2,)}
    assert all(track.diagnostics["midi_split_from_multichannel_track"] is True for track in parsed_tracks)
    assert set(parsed.mapped_events) == {1, 5}
    assert [note.label for note in parsed.mapped_events[1]] == ["C5"]
    assert [note.label for note in parsed.mapped_events[5]] == ["C3"]
    assert symbolic_seed_review_reasons(parsed, source_suffix=".mid") == []


def test_symbolic_mapping_uses_pitch_range_when_part_names_are_generic(tmp_path: Path) -> None:
    musicxml_path = tmp_path / "generic-parts.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Part 1</part-name></score-part>
    <score-part id="P2"><part-name>Part 2</part-name></score-part>
    <score-part id="P3"><part-name>Part 3</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
    <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration></note>
    <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration></note>
  </measure></part>
  <part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes>
    <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration></note>
    <note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration></note>
  </measure></part>
  <part id="P3"><measure number="1"><attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration></note>
    <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration></note>
  </measure></part>
</score-partwise>
""",
        encoding="utf-8",
    )

    parsed = parse_symbolic_file_with_metadata(musicxml_path, bpm=92)

    assert set(parsed.mapped_events) == {1, 4, 5}
    assert [note.label for note in parsed.mapped_events[1]] == ["E5", "G5"]
    assert [note.label for note in parsed.mapped_events[4]] == ["G3", "B3"]
    assert [note.label for note in parsed.mapped_events[5]] == ["C3", "E3"]
    assert all(note.pitch_register == "lower_voice" for note in parsed.mapped_events[5])


def test_slot_inference_respects_bass_range_over_generic_order() -> None:
    notes = [
        event_from_pitch(beat=1, duration_beats=1, bpm=92, source="midi", extraction_method="test", pitch_midi=40),
        event_from_pitch(beat=2, duration_beats=1, bpm=92, source="midi", extraction_method="test", pitch_midi=43),
        event_from_pitch(beat=3, duration_beats=1, bpm=92, source="midi", extraction_method="test", pitch_midi=47),
    ]

    assert infer_slot_id("Track 1", notes, fallback=1) == 5


def test_symbolic_mapping_places_generic_voice_parts_by_relative_register() -> None:
    tracks = [
        ParsedTrack(
            name=f"Staff {index}",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=pitch,
                )
            ],
        )
        for index, pitch in enumerate([72, 65, 58, 53, 45], start=1)
    ]

    mapped = map_tracks_to_slots(tracks, bpm=113)

    assert set(mapped) == {1, 2, 3, 4, 5}
    assert [track.slot_id for track in tracks] == [1, 2, 3, 4, 5]
    assert all(track.diagnostics["role_assignment_strategy"] == "relative_voice_register" for track in tracks)


def test_symbolic_mapping_keeps_duplicate_tenor_parts_in_neighboring_voice_slots() -> None:
    tracks = [
        ParsedTrack(
            name=f"Tenor {suffix}",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=pitch,
                )
            ],
        )
        for suffix, pitch in [("I", 60), ("II", 55)]
    ]

    mapped = map_tracks_to_slots(tracks, bpm=113)

    assert set(mapped) == {3, 4}
    assert [track.slot_id for track in tracks] == [3, 4]


def test_symbolic_mapping_uses_register_over_conflicting_voice_names() -> None:
    tracks = [
        ParsedTrack(
            name="Baritone",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=72,
                )
            ],
        ),
        ParsedTrack(
            name="Soprano",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=48,
                )
            ],
        ),
    ]

    mapped = map_tracks_to_slots(tracks, bpm=113)

    assert set(mapped) == {1, 5}
    assert [track.slot_id for track in tracks] == [1, 5]


def test_symbolic_mapping_sends_channel_ten_to_percussion() -> None:
    track = ParsedTrack(
        name="Staff 6",
        events=[
            event_from_pitch(
                beat=1,
                duration_beats=0.25,
                bpm=113,
                source="midi",
                extraction_method="test",
                pitch_midi=35,
            )
        ],
        diagnostics={"midi_source_track_index": 6, "midi_channels": [10]},
    )

    mapped = map_tracks_to_slots([track], bpm=113)

    assert set(mapped) == {6}
    assert track.slot_id == 6
    assert track.diagnostics["role_assignment_strategy"] == "percussion_identity"


def test_symbolic_seed_review_keeps_generic_polyphonic_accompaniment_reviewable() -> None:
    track = ParsedTrack(
        name="Staff 1",
        events=[
            event_from_pitch(
                beat=1,
                duration_beats=1,
                bpm=113,
                source="midi",
                extraction_method="test",
                pitch_midi=pitch,
            )
            for pitch in [48, 55, 60, 64]
        ],
        diagnostics={"midi_source_track_index": 1, "midi_channels": [1]},
    )
    mapped = map_tracks_to_slots([track], bpm=113)
    parsed = ParsedSymbolicFile(tracks=[track], mapped_events=mapped)

    assert symbolic_seed_review_reasons(parsed, source_suffix=".mid") == ["midi_polyphonic_accompaniment"]


def test_symbolic_seed_review_flags_any_unmapped_named_source_part() -> None:
    tracks = [
        ParsedTrack(
            name="Soprano",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=72,
                )
            ],
        ),
        ParsedTrack(name="Alto", events=[]),
    ]
    mapped = map_tracks_to_slots([tracks[0]], bpm=113)
    parsed = ParsedSymbolicFile(tracks=tracks, mapped_events=mapped)

    assert "midi_named_part_unmapped" in symbolic_seed_review_reasons(parsed, source_suffix=".mid")


def test_midi_seed_empty_named_parts_describes_silent_named_tracks() -> None:
    tracks = [
        ParsedTrack(
            name="Soprano",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=72,
                )
            ],
        ),
        ParsedTrack(
            name="베이스",
            events=[],
            diagnostics={"midi_source_track_index": 5, "midi_channels": []},
        ),
    ]
    mapped = map_tracks_to_slots([tracks[0]], bpm=113)
    parsed = ParsedSymbolicFile(tracks=tracks, mapped_events=mapped)

    assert midi_seed_empty_named_parts(parsed) == [
        {
            "slot_id": 5,
            "track_name": "Bass",
            "source_label": "베이스",
            "source_track_index": 5,
            "midi_channels": [],
        }
    ]


def test_symbolic_seed_review_flags_any_silent_source_part_drop() -> None:
    tracks = [
        ParsedTrack(
            name=f"Staff {index}",
            events=[
                event_from_pitch(
                    beat=1,
                    duration_beats=1,
                    bpm=113,
                    source="midi",
                    extraction_method="test",
                    pitch_midi=pitch,
                )
            ],
        )
        for index, pitch in enumerate([76, 72, 67, 62, 57, 52, 47], start=1)
    ]
    mapped = map_tracks_to_slots(tracks, bpm=113)
    parsed = ParsedSymbolicFile(tracks=tracks, mapped_events=mapped)

    reasons = symbolic_seed_review_reasons(parsed, source_suffix=".mid")

    assert "midi_source_part_mapping_incomplete" in reasons
    assert len(mapped) == 5


def test_slot_inference_recognizes_nwc_and_korean_voice_names() -> None:
    neutral_notes = [
        event_from_pitch(beat=1, duration_beats=1, bpm=92, source="midi", extraction_method="test", pitch_midi=60),
    ]

    assert infer_slot_id("Bariton", neutral_notes, fallback=1) == 4
    assert infer_slot_id("바리톤", neutral_notes, fallback=1) == 4
    assert infer_slot_id("소프라노", neutral_notes, fallback=5) == 1
    assert infer_slot_id("알토", neutral_notes, fallback=5) == 2
    assert infer_slot_id("테너", neutral_notes, fallback=5) == 3
    assert infer_slot_id("베이스", neutral_notes, fallback=1) == 5
