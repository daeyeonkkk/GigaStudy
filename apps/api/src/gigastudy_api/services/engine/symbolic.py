from __future__ import annotations

import struct
import zipfile
from dataclasses import dataclass, field
from itertools import permutations
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import (
    DEFAULT_TIME_SIGNATURE,
    infer_slot_id,
    midi_to_label,
    event_from_pitch,
    measure_index_from_beat,
    quarter_beats_per_measure,
    rank_slot_candidates,
    slot_assignment_diagnostics,
)
from gigastudy_api.services.engine.event_normalization import (
    annotate_track_events_for_slot,
    enforce_monophonic_vocal_events,
)


@dataclass
class ParsedTrack:
    name: str
    events: list[TrackPitchEvent] = field(default_factory=list)
    slot_id: int | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ParsedTempoChange:
    measure_index: int
    bpm: int


@dataclass
class ParsedSymbolicFile:
    tracks: list[ParsedTrack]
    mapped_events: dict[int, list[TrackPitchEvent]]
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0]
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1]
    has_time_signature: bool = False
    source_bpm: int | None = None
    tempo_changes: list[ParsedTempoChange] = field(default_factory=list)


class SymbolicParseError(ValueError):
    pass


def parse_symbolic_file(path: Path, *, bpm: int, target_slot_id: int | None = None) -> dict[int, list[TrackPitchEvent]]:
    return parse_symbolic_file_with_metadata(path, bpm=bpm, target_slot_id=target_slot_id).mapped_events


def parse_symbolic_file_with_metadata(
    path: Path,
    *,
    bpm: int,
    target_slot_id: int | None = None,
) -> ParsedSymbolicFile:
    suffix = path.suffix.lower()
    if suffix in {".musicxml", ".xml", ".mxl"}:
        parsed_document = parse_musicxml_document(path, bpm=bpm)
    elif suffix in {".mid", ".midi"}:
        parsed_document = parse_midi_document(path, bpm=bpm)
    else:
        msg = f"Unsupported symbolic file type: {suffix}"
        raise SymbolicParseError(msg)

    return ParsedSymbolicFile(
        tracks=parsed_document.tracks,
        mapped_events=map_tracks_to_slots(
            parsed_document.tracks,
            target_slot_id=target_slot_id,
            bpm=bpm,
            time_signature_numerator=parsed_document.time_signature_numerator,
            time_signature_denominator=parsed_document.time_signature_denominator,
        ),
        time_signature_numerator=parsed_document.time_signature_numerator,
        time_signature_denominator=parsed_document.time_signature_denominator,
        has_time_signature=parsed_document.has_time_signature,
        source_bpm=parsed_document.source_bpm,
        tempo_changes=parsed_document.tempo_changes,
    )


def map_tracks_to_slots(
    parsed_tracks: list[ParsedTrack],
    *,
    target_slot_id: int | None = None,
    bpm: int = 120,
    time_signature_numerator: int = DEFAULT_TIME_SIGNATURE[0],
    time_signature_denominator: int = DEFAULT_TIME_SIGNATURE[1],
) -> dict[int, list[TrackPitchEvent]]:
    non_empty_tracks = [track for track in parsed_tracks if track.events]
    if not non_empty_tracks:
        raise SymbolicParseError("No pitch events were found in the symbolic file.")

    if target_slot_id is not None:
        exact = [track for track in non_empty_tracks if track.slot_id == target_slot_id]
        selected = exact[0] if exact else non_empty_tracks[0]
        selected.slot_id = target_slot_id
        selected.diagnostics.update(
            slot_assignment_diagnostics(
                selected.name,
                selected.events,
                assigned_slot_id=target_slot_id,
                fallback=target_slot_id,
            )
        )
        return {
            target_slot_id: _prepare_slot_events(
                selected.events,
                slot_id=target_slot_id,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
        }

    assignments = _assign_tracks_by_name_and_range(non_empty_tracks)
    mapped: dict[int, list[TrackPitchEvent]] = {}
    for track, slot_id in assignments:
        if 1 <= slot_id <= 6:
            track.slot_id = slot_id
            track.diagnostics.update(
                slot_assignment_diagnostics(
                    track.name,
                    track.events,
                    assigned_slot_id=slot_id,
                    fallback=slot_id,
                )
            )
            mapped[slot_id] = _prepare_slot_events(
                track.events,
                slot_id=slot_id,
                bpm=bpm,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
            )
    return mapped


def _prepare_slot_events(
    events: list[TrackPitchEvent],
    *,
    slot_id: int,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackPitchEvent]:
    annotated = annotate_track_events_for_slot(events, slot_id=slot_id)
    return enforce_monophonic_vocal_events(
        annotated,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _assign_tracks_by_name_and_range(parsed_tracks: list[ParsedTrack]) -> list[tuple[ParsedTrack, int]]:
    tracks = parsed_tracks[:6]
    if not tracks:
        return []

    allowed_slots = (1, 2, 3, 4, 5, 6)
    score_table = {
        id(track): {
            score.slot_id: score.score
            for score in rank_slot_candidates(
                track.name,
                track.events,
                fallback=min(track_index + 1, 6),
                allowed_slots=allowed_slots,
            )
        }
        for track_index, track in enumerate(tracks)
    }

    best_assignment: tuple[float, tuple[int, ...]] | None = None
    for slot_order in permutations(allowed_slots, len(tracks)):
        score = 0.0
        for track_index, (track, slot_id) in enumerate(zip(tracks, slot_order, strict=False)):
            score += score_table[id(track)].get(slot_id, -999)
            if 1 <= slot_id <= 5:
                # Preserve visible score order as a weak tie-breaker only; pitch/name evidence dominates.
                score -= abs(slot_id - (track_index + 1)) * 0.05
        if best_assignment is None or score > best_assignment[0]:
            best_assignment = (score, slot_order)

    if best_assignment is None:
        return []
    return list(zip(tracks, best_assignment[1], strict=False))


def parse_musicxml_file(path: Path, *, bpm: int) -> list[ParsedTrack]:
    return parse_musicxml_document(path, bpm=bpm).tracks


def parse_musicxml_document(path: Path, *, bpm: int) -> ParsedSymbolicFile:
    root = _read_musicxml_root(path)
    part_names = _musicxml_part_names(root)
    parsed_tracks: list[ParsedTrack] = []
    document_time_signature = DEFAULT_TIME_SIGNATURE
    has_time_signature = False

    for part in _children(root, "part"):
        part_id = part.attrib.get("id", "")
        part_name = part_names.get(part_id, part_id or "MusicXML part")
        events: list[TrackPitchEvent] = []
        divisions = 1
        current_time_signature = document_time_signature
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
                            document_time_signature = next_time_signature
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
                    is_tied = any(_local_name(tie.tag) == "tie" for tie in item.iter())
                    events.append(
                        event_from_pitch(
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
                events=events,
                slot_id=infer_slot_id(part_name, events),
            )
        )

    return ParsedSymbolicFile(
        tracks=parsed_tracks,
        mapped_events={},
        time_signature_numerator=document_time_signature[0],
        time_signature_denominator=document_time_signature[1],
        has_time_signature=has_time_signature,
    )


def parse_midi_file(path: Path, *, bpm: int) -> list[ParsedTrack]:
    return parse_midi_document(path, bpm=bpm).tracks


def parse_midi_document(path: Path, *, bpm: int) -> ParsedSymbolicFile:
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
    document_time_signature = DEFAULT_TIME_SIGNATURE
    has_time_signature = False
    raw_tempo_events: list[tuple[int, int]] = []

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
        active_midi_pitches: dict[tuple[int, int], int] = {}
        events: list[TrackPitchEvent] = []
        channels_seen: set[int] = set()
        current_time_signature = document_time_signature

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
                elif meta_type == 0x51 and len(payload) == 3:
                    raw_tempo_events.append((absolute_tick, _tempo_payload_to_bpm(payload)))
                elif meta_type == 0x58 and len(payload) >= 2:
                    current_time_signature = _normalize_time_signature(payload[0], 2 ** payload[1])
                    if not has_time_signature:
                        document_time_signature = current_time_signature
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
                pitch_number = event_data[0]
                velocity = event_data[1]
                key = (channel, pitch_number)
                if velocity > 0:
                    active_midi_pitches[key] = absolute_tick
                else:
                    _append_midi_event(
                        events,
                        key=key,
                        start_tick=active_midi_pitches.pop(key, absolute_tick),
                        end_tick=absolute_tick,
                        ticks_per_quarter=ticks_per_quarter,
                        bpm=bpm,
                        time_signature_numerator=current_time_signature[0],
                        time_signature_denominator=current_time_signature[1],
                    )
            elif event_type == 0x80:
                pitch_number = event_data[0]
                key = (channel, pitch_number)
                _append_midi_event(
                    events,
                    key=key,
                    start_tick=active_midi_pitches.pop(key, absolute_tick),
                    end_tick=absolute_tick,
                    ticks_per_quarter=ticks_per_quarter,
                    bpm=bpm,
                    time_signature_numerator=current_time_signature[0],
                    time_signature_denominator=current_time_signature[1],
                )

        slot_id = 6 if 9 in channels_seen else infer_slot_id(track_name, events, fallback=track_index + 1)
        tracks.append(ParsedTrack(name=track_name, events=events, slot_id=slot_id))

    source_bpm, tempo_changes = _midi_tempo_map_from_events(
        raw_tempo_events,
        ticks_per_quarter=ticks_per_quarter,
        time_signature_numerator=document_time_signature[0],
        time_signature_denominator=document_time_signature[1],
    )
    return ParsedSymbolicFile(
        tracks=tracks,
        mapped_events={},
        time_signature_numerator=document_time_signature[0],
        time_signature_denominator=document_time_signature[1],
        has_time_signature=has_time_signature,
        source_bpm=source_bpm,
        tempo_changes=tempo_changes,
    )


def _append_midi_event(
    events: list[TrackPitchEvent],
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

    _, pitch_number = key
    onset_beats = start_tick / ticks_per_quarter
    duration_beats = (end_tick - start_tick) / ticks_per_quarter
    events.append(
        event_from_pitch(
            beat=onset_beats + 1,
            duration_beats=duration_beats,
            bpm=bpm,
            source="midi",
            extraction_method="midi_parser_v0",
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            pitch_midi=pitch_number,
            confidence=1,
        )
    )


def _tempo_payload_to_bpm(payload: bytes) -> int:
    microseconds_per_quarter = max(1, int.from_bytes(payload, "big"))
    return max(40, min(240, round(60_000_000 / microseconds_per_quarter)))


def _midi_tempo_map_from_events(
    raw_tempo_events: list[tuple[int, int]],
    *,
    ticks_per_quarter: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> tuple[int | None, list[ParsedTempoChange]]:
    if not raw_tempo_events:
        return None, []
    tempo_by_tick: dict[int, int] = {}
    for tick, bpm in raw_tempo_events:
        tempo_by_tick[max(0, tick)] = bpm
    sorted_events = sorted(tempo_by_tick.items())
    source_bpm = sorted_events[0][1]
    changes: list[ParsedTempoChange] = []
    latest_measure_bpm: dict[int, int] = {}
    for tick, bpm in sorted_events[1:]:
        beat = (tick / ticks_per_quarter) + 1
        measure_index = measure_index_from_beat(
            beat,
            time_signature_numerator,
            time_signature_denominator,
        )
        if measure_index <= 1 or bpm == source_bpm:
            continue
        latest_measure_bpm[measure_index] = bpm
    for measure_index, bpm in sorted(latest_measure_bpm.items()):
        changes.append(ParsedTempoChange(measure_index=measure_index, bpm=bpm))
    return source_bpm, changes


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


def _musicxml_pitch_to_midi(event_element: ElementTree.Element) -> int | None:
    pitch = _first_child(event_element, "pitch")
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
