from pathlib import Path

from gigastudy_api.services.engine.symbolic import (
    parse_midi_file,
    parse_musicxml_file,
    parse_symbolic_file_with_metadata,
)
from gigastudy_api.services.engine.music_theory import infer_slot_id, note_from_pitch


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
    assert [note.label for note in parsed_tracks[0].notes] == ["C5", "E5"]
    assert parsed_tracks[0].notes[0].pitch_midi == 72
    assert parsed_tracks[0].notes[0].duration_seconds == 0.5
    assert parsed_tracks[1].notes[0].label == "A4"
    assert parsed_tracks[1].notes[0].duration_beats == 2


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
    notes = parsed.mapped_notes[1]

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
    assert len(parsed_tracks[0].notes) == 1
    assert parsed_tracks[0].notes[0].label == "C5"
    assert parsed_tracks[0].notes[0].beat == 1
    assert parsed_tracks[0].notes[0].duration_beats == 1


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

    assert parsed_tracks[0].notes[0].duration_beats == 1
    assert parsed_tracks[0].notes[0].duration_seconds == 0.5


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
    notes = parsed.mapped_notes[1]

    assert parsed.time_signature_numerator == 3
    assert parsed.time_signature_denominator == 4
    assert parsed.has_time_signature is True
    assert notes[2].beat_in_measure == 3
    assert notes[3].measure_index == 2
    assert notes[3].beat == 4
    assert notes[3].beat_in_measure == 1


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

    assert set(parsed.mapped_notes) == {1, 4, 5}
    assert [note.label for note in parsed.mapped_notes[1]] == ["E5", "G5"]
    assert [note.label for note in parsed.mapped_notes[4]] == ["G3", "B3"]
    assert [note.label for note in parsed.mapped_notes[5]] == ["C3", "E3"]
    assert all(note.pitch_register == "lower_voice" for note in parsed.mapped_notes[5])


def test_slot_inference_respects_bass_range_over_generic_order() -> None:
    notes = [
        note_from_pitch(beat=1, duration_beats=1, bpm=92, source="midi", extraction_method="test", pitch_midi=40),
        note_from_pitch(beat=2, duration_beats=1, bpm=92, source="midi", extraction_method="test", pitch_midi=43),
        note_from_pitch(beat=3, duration_beats=1, bpm=92, source="midi", extraction_method="test", pitch_midi=47),
    ]

    assert infer_slot_id("Track 1", notes, fallback=1) == 5
