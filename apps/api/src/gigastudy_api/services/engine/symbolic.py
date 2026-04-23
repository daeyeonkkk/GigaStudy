from __future__ import annotations

import struct
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from gigastudy_api.api.schemas.studios import TrackNote
from gigastudy_api.services.engine.music_theory import (
    DEFAULT_TIME_SIGNATURE,
    infer_slot_id,
    midi_to_label,
    note_from_pitch,
    quarter_beats_per_measure,
)


@dataclass
class ParsedTrack:
    name: str
    notes: list[TrackNote] = field(default_factory=list)
    slot_id: int | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass
class ParsedSymbolicFile:
    tracks: list[ParsedTrack]
    mapped_notes: dict[int, list[TrackNote]]
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0]
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1]
    has_time_signature: bool = False


class SymbolicParseError(ValueError):
    pass


def parse_symbolic_file(path: Path, *, bpm: int, target_slot_id: int | None = None) -> dict[int, list[TrackNote]]:
    return parse_symbolic_file_with_metadata(path, bpm=bpm, target_slot_id=target_slot_id).mapped_notes


def parse_symbolic_file_with_metadata(
    path: Path,
    *,
    bpm: int,
    target_slot_id: int | None = None,
) -> ParsedSymbolicFile:
    suffix = path.suffix.lower()
    if suffix in {".musicxml", ".xml", ".mxl"}:
        parsed_score = parse_musicxml_score(path, bpm=bpm)
    elif suffix in {".mid", ".midi"}:
        parsed_score = parse_midi_score(path, bpm=bpm)
    else:
        msg = f"Unsupported symbolic file type: {suffix}"
        raise SymbolicParseError(msg)

    return ParsedSymbolicFile(
        tracks=parsed_score.tracks,
        mapped_notes=map_tracks_to_slots(parsed_score.tracks, target_slot_id=target_slot_id),
        time_signature_numerator=parsed_score.time_signature_numerator,
        time_signature_denominator=parsed_score.time_signature_denominator,
        has_time_signature=parsed_score.has_time_signature,
    )


def map_tracks_to_slots(
    parsed_tracks: list[ParsedTrack],
    *,
    target_slot_id: int | None = None,
) -> dict[int, list[TrackNote]]:
    non_empty_tracks = [track for track in parsed_tracks if track.notes]
    if not non_empty_tracks:
        raise SymbolicParseError("No notes were found in the symbolic file.")

    if target_slot_id is not None:
        exact = [track for track in non_empty_tracks if track.slot_id == target_slot_id]
        selected = exact[0] if exact else non_empty_tracks[0]
        return {target_slot_id: selected.notes}

    mapped: dict[int, list[TrackNote]] = {}
    fallback_slot = 1
    for track in non_empty_tracks:
        slot_id = track.slot_id or infer_slot_id(track.name, track.notes, fallback=fallback_slot)
        while slot_id in mapped and fallback_slot <= 6:
            fallback_slot += 1
            slot_id = fallback_slot
        if 1 <= slot_id <= 6:
            mapped[slot_id] = track.notes
    return mapped


def parse_musicxml_file(path: Path, *, bpm: int) -> list[ParsedTrack]:
    return parse_musicxml_score(path, bpm=bpm).tracks


def parse_musicxml_score(path: Path, *, bpm: int) -> ParsedSymbolicFile:
    root = _read_musicxml_root(path)
    part_names = _musicxml_part_names(root)
    parsed_tracks: list[ParsedTrack] = []
    score_time_signature = DEFAULT_TIME_SIGNATURE
    has_time_signature = False

    for part in _children(root, "part"):
        part_id = part.attrib.get("id", "")
        part_name = part_names.get(part_id, part_id or "MusicXML part")
        notes: list[TrackNote] = []
        divisions = 1
        current_time_signature = score_time_signature
        quarter_cursor = 0.0
        previous_onset_quarter = 0.0

        for measure_index, measure in enumerate(_children(part, "measure"), start=1):
            measure_number = _safe_int(measure.attrib.get("number"), default=measure_index)
            measure_start_quarter = quarter_cursor
            for item in list(measure):
                tag = _local_name(item.tag)
                if tag == "attributes":
                    divisions_text = _child_text(item, "divisions")
                    if divisions_text:
                        divisions = max(1, _safe_int(divisions_text, default=divisions))
                    next_time_signature = _musicxml_time_signature(item)
                    if next_time_signature is not None:
                        current_time_signature = next_time_signature
                        if not has_time_signature:
                            score_time_signature = next_time_signature
                            has_time_signature = True
                elif tag == "backup":
                    duration = _duration_quarters(item, divisions)
                    quarter_cursor = max(measure_start_quarter, quarter_cursor - duration)
                elif tag == "forward":
                    quarter_cursor += _duration_quarters(item, divisions)
                elif tag == "note":
                    duration_quarters = _duration_quarters(item, divisions)
                    is_chord = _first_child(item, "chord") is not None
                    onset_quarter = previous_onset_quarter if is_chord else quarter_cursor
                    previous_onset_quarter = onset_quarter

                    is_rest = _first_child(item, "rest") is not None
                    pitch_midi = None
                    label = "Rest"
                    if not is_rest:
                        pitch_midi = _musicxml_pitch_to_midi(item)
                        if pitch_midi is None:
                            continue
                        label = midi_to_label(pitch_midi)

                    voice_index = _safe_int(_child_text(item, "voice"), default=None)
                    staff_index = _safe_int(_child_text(item, "staff"), default=None)
                    is_tied = any(_local_name(tie.tag) == "tie" for tie in item.iter())
                    notes.append(
                        note_from_pitch(
                            beat=onset_quarter + 1,
                            duration_beats=max(0.0001, duration_quarters),
                            bpm=bpm,
                            source="musicxml",
                            extraction_method="musicxml_parser_v0",
                            pitch_midi=pitch_midi,
                            label=label,
                            confidence=0.98 if not is_rest else 1,
                            time_signature_numerator=current_time_signature[0],
                            time_signature_denominator=current_time_signature[1],
                            measure_index=measure_number,
                            beat_in_measure=(onset_quarter - measure_start_quarter) + 1,
                            voice_index=voice_index,
                            staff_index=staff_index,
                            is_rest=is_rest,
                            is_tied=is_tied,
                        )
                    )

                    if not is_chord:
                        quarter_cursor += duration_quarters

            measure_quarters = quarter_beats_per_measure(*current_time_signature)
            quarter_cursor = max(quarter_cursor, measure_start_quarter + measure_quarters)

        parsed_tracks.append(
            ParsedTrack(
                name=part_name,
                notes=notes,
                slot_id=infer_slot_id(part_name, notes),
            )
        )

    return ParsedSymbolicFile(
        tracks=parsed_tracks,
        mapped_notes={},
        time_signature_numerator=score_time_signature[0],
        time_signature_denominator=score_time_signature[1],
        has_time_signature=has_time_signature,
    )


def parse_midi_file(path: Path, *, bpm: int) -> list[ParsedTrack]:
    return parse_midi_score(path, bpm=bpm).tracks


def parse_midi_score(path: Path, *, bpm: int) -> ParsedSymbolicFile:
    data = path.read_bytes()
    if data[:4] != b"MThd":
        raise SymbolicParseError("Invalid MIDI header.")

    header_length = struct.unpack(">I", data[4:8])[0]
    header = data[8 : 8 + header_length]
    if len(header) < 6:
        raise SymbolicParseError("Invalid MIDI header length.")

    _, track_count, ticks_per_quarter = struct.unpack(">HHH", header[:6])
    if ticks_per_quarter & 0x8000:
        raise SymbolicParseError("SMPTE MIDI timing is not supported yet.")

    offset = 8 + header_length
    tracks: list[ParsedTrack] = []
    score_time_signature = DEFAULT_TIME_SIGNATURE
    has_time_signature = False

    for track_index in range(track_count):
        if data[offset : offset + 4] != b"MTrk":
            raise SymbolicParseError("Invalid MIDI track chunk.")
        chunk_length = struct.unpack(">I", data[offset + 4 : offset + 8])[0]
        chunk = data[offset + 8 : offset + 8 + chunk_length]
        offset += 8 + chunk_length

        track_name = f"MIDI track {track_index + 1}"
        running_status: int | None = None
        position = 0
        absolute_tick = 0
        active_notes: dict[tuple[int, int], int] = {}
        notes: list[TrackNote] = []
        channels_seen: set[int] = set()
        current_time_signature = score_time_signature

        while position < len(chunk):
            delta, position = _read_vlq(chunk, position)
            absolute_tick += delta
            if position >= len(chunk):
                break

            status = chunk[position]
            if status < 0x80:
                if running_status is None:
                    raise SymbolicParseError("MIDI running status used before a status byte.")
                status = running_status
            else:
                position += 1
                if status < 0xF0:
                    running_status = status

            if status == 0xFF:
                if position >= len(chunk):
                    break
                meta_type = chunk[position]
                position += 1
                length, position = _read_vlq(chunk, position)
                payload = chunk[position : position + length]
                position += length
                if meta_type == 0x03 and payload:
                    track_name = payload.decode("utf-8", errors="ignore").strip() or track_name
                elif meta_type == 0x58 and len(payload) >= 2:
                    current_time_signature = _normalize_time_signature(payload[0], 2 ** payload[1])
                    if not has_time_signature:
                        score_time_signature = current_time_signature
                        has_time_signature = True
                elif meta_type == 0x2F:
                    break
                continue

            if status in {0xF0, 0xF7}:
                length, position = _read_vlq(chunk, position)
                position += length
                continue

            event_type = status & 0xF0
            channel = status & 0x0F
            data_length = 1 if event_type in {0xC0, 0xD0} else 2
            event_data = chunk[position : position + data_length]
            position += data_length
            if len(event_data) < data_length:
                break

            channels_seen.add(channel)
            if event_type == 0x90:
                note_number = event_data[0]
                velocity = event_data[1]
                key = (channel, note_number)
                if velocity > 0:
                    active_notes[key] = absolute_tick
                else:
                    _append_midi_note(
                        notes,
                        key=key,
                        start_tick=active_notes.pop(key, absolute_tick),
                        end_tick=absolute_tick,
                        ticks_per_quarter=ticks_per_quarter,
                        bpm=bpm,
                        time_signature_numerator=current_time_signature[0],
                        time_signature_denominator=current_time_signature[1],
                    )
            elif event_type == 0x80:
                note_number = event_data[0]
                key = (channel, note_number)
                _append_midi_note(
                    notes,
                    key=key,
                    start_tick=active_notes.pop(key, absolute_tick),
                    end_tick=absolute_tick,
                    ticks_per_quarter=ticks_per_quarter,
                    bpm=bpm,
                    time_signature_numerator=current_time_signature[0],
                    time_signature_denominator=current_time_signature[1],
                )

        slot_id = 6 if 9 in channels_seen else infer_slot_id(track_name, notes, fallback=track_index + 1)
        tracks.append(ParsedTrack(name=track_name, notes=notes, slot_id=slot_id))

    return ParsedSymbolicFile(
        tracks=tracks,
        mapped_notes={},
        time_signature_numerator=score_time_signature[0],
        time_signature_denominator=score_time_signature[1],
        has_time_signature=has_time_signature,
    )


def _append_midi_note(
    notes: list[TrackNote],
    *,
    key: tuple[int, int],
    start_tick: int,
    end_tick: int,
    ticks_per_quarter: int,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> None:
    if end_tick <= start_tick:
        return

    _, note_number = key
    onset_beats = start_tick / ticks_per_quarter
    duration_beats = (end_tick - start_tick) / ticks_per_quarter
    notes.append(
        note_from_pitch(
            beat=onset_beats + 1,
            duration_beats=duration_beats,
            bpm=bpm,
            source="midi",
            extraction_method="midi_parser_v0",
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            pitch_midi=note_number,
            confidence=1,
        )
    )


def _read_musicxml_root(path: Path) -> ElementTree.Element:
    if path.suffix.lower() != ".mxl":
        return ElementTree.fromstring(path.read_bytes())

    with zipfile.ZipFile(path) as archive:
        rootfile = _mxl_rootfile(archive)
        return ElementTree.fromstring(archive.read(rootfile))


def _mxl_rootfile(archive: zipfile.ZipFile) -> str:
    try:
        container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
    except KeyError:
        container = None

    if container is not None:
        for element in container.iter():
            if _local_name(element.tag) == "rootfile":
                full_path = element.attrib.get("full-path")
                if full_path:
                    return full_path

    for name in archive.namelist():
        normalized = name.lower()
        if normalized.endswith(".xml") and not normalized.startswith("meta-inf/"):
            return name
    raise SymbolicParseError("MXL archive does not contain a MusicXML root file.")


def _musicxml_part_names(root: ElementTree.Element) -> dict[str, str]:
    part_names: dict[str, str] = {}
    for score_part in root.iter():
        if _local_name(score_part.tag) != "score-part":
            continue
        part_id = score_part.attrib.get("id")
        if not part_id:
            continue
        part_name = _child_text(score_part, "part-name") or _child_text(score_part, "part-abbreviation")
        part_names[part_id] = part_name or part_id
    return part_names


def _musicxml_pitch_to_midi(note_element: ElementTree.Element) -> int | None:
    pitch = _first_child(note_element, "pitch")
    if pitch is None:
        return None
    step = _child_text(pitch, "step")
    octave = _child_text(pitch, "octave")
    if step is None or octave is None:
        return None
    alter = _safe_int(_child_text(pitch, "alter"), default=0)
    semitone_map = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    return (int(octave) + 1) * 12 + semitone_map[step] + alter


def _musicxml_time_signature(attributes_element: ElementTree.Element) -> tuple[int, int] | None:
    time_element = _first_child(attributes_element, "time")
    if time_element is None:
        return None
    beats = _safe_int(_child_text(time_element, "beats"), default=None)
    beat_type = _safe_int(_child_text(time_element, "beat-type"), default=None)
    if beats is None or beat_type is None:
        return None
    return _normalize_time_signature(beats, beat_type)


def _normalize_time_signature(numerator: int, denominator: int) -> tuple[int, int]:
    supported_denominators = {1, 2, 4, 8, 16, 32}
    resolved_denominator = denominator if denominator in supported_denominators else 4
    return max(1, min(32, numerator)), resolved_denominator


def _duration_quarters(element: ElementTree.Element, divisions: int) -> float:
    duration = _safe_int(_child_text(element, "duration"), default=0)
    if duration <= 0:
        return 1
    return duration / max(1, divisions)


def _children(element: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in list(element) if _local_name(child.tag) == name]


def _first_child(element: ElementTree.Element, name: str) -> ElementTree.Element | None:
    for child in list(element):
        if _local_name(child.tag) == name:
            return child
    return None


def _child_text(element: ElementTree.Element, name: str) -> str | None:
    child = _first_child(element, name)
    if child is None or child.text is None:
        return None
    return child.text.strip()


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _safe_int(value: str | None, default: int | None) -> int | None:
    if value is None:
        return default
    try:
        return int(float(value.strip()))
    except ValueError:
        return default


def _read_vlq(data: bytes, position: int) -> tuple[int, int]:
    value = 0
    while position < len(data):
        byte = data[position]
        position += 1
        value = (value << 7) | (byte & 0x7F)
        if byte < 0x80:
            return value, position
    raise SymbolicParseError("Unexpected end of MIDI variable-length quantity.")
