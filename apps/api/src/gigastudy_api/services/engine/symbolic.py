from __future__ import annotations

import math
import struct
import zipfile
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.music_theory import (
    DEFAULT_TIME_SIGNATURE,
    SLOT_COMFORT_CENTERS,
    infer_slot_id,
    midi_to_label,
    event_from_pitch,
    measure_index_from_beat,
    quarter_beats_per_measure,
    rank_slot_candidates,
    slot_id_from_name,
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


MIDI_VOCAL_PROGRAMS_ZERO_BASED = {52, 53, 54, 85, 91}
MIDI_GENERIC_TRACK_PREFIXES = ("midi track", "track", "part", "channel", "ch")
VOICE_SLOT_IDS = (1, 2, 3, 4, 5)
PERCUSSION_SLOT_ID = 6
MIDI_PERCUSSION_CHANNEL_ONE_BASED = 10
ROLE_ASSIGNMENT_NAME_HINT_REDUCTION = 6.5


@dataclass(frozen=True)
class TrackRoleStats:
    pitched_event_count: int
    median_pitch: float | None
    average_pitch: float | None
    min_pitch: int | None
    max_pitch: int | None
    pitch_span: int
    total_duration_beats: float
    max_same_onset: int
    polyphonic_onset_ratio: float


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


def symbolic_seed_review_reasons(parsed_symbolic: ParsedSymbolicFile, *, source_suffix: str) -> list[str]:
    """Return reasons a studio-start symbolic upload should stay reviewable.

    Names, channels, and MIDI programs are hints. Direct registration is allowed
    when the mapped parts behave like singer lines after track characterization;
    review is reserved for material that still looks like accompaniment,
    unpitched/percussion ambiguity, or an overly broad special-purpose track.
    """

    if source_suffix.lower() not in {".mid", ".midi"}:
        return []

    mapped_slots = set(parsed_symbolic.mapped_events)
    mapped_tracks = [
        track
        for track in parsed_symbolic.tracks
        if track.slot_id in mapped_slots and track.events
    ]
    reasons: list[str] = []
    for track in mapped_tracks:
        if track.diagnostics.get("midi_seed_review_required") is True:
            reason = str(track.diagnostics.get("midi_seed_review_reason") or "midi_track_ambiguous")
            if reason not in reasons:
                reasons.append(reason)

    return reasons


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

    assignments = _assign_tracks_by_musical_role(non_empty_tracks)
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


def _assign_tracks_by_musical_role(parsed_tracks: list[ParsedTrack]) -> list[tuple[ParsedTrack, int]]:
    tracks = [track for track in parsed_tracks if track.events]
    if not tracks:
        return []

    stats_by_track = {id(track): _track_role_stats(track) for track in tracks}
    percussion_tracks = [track for track in tracks if _track_has_percussion_identity(track)]
    percussion_track_ids = {id(track) for track in percussion_tracks}
    voice_tracks = [track for track in tracks if id(track) not in percussion_track_ids]

    assignments: list[tuple[ParsedTrack, int]] = []
    if percussion_tracks:
        percussion_track = max(
            percussion_tracks,
            key=lambda track: _percussion_track_priority(track, stats_by_track[id(track)]),
        )
        percussion_track.diagnostics.update(
            {
                "role_assignment_strategy": "percussion_identity",
                "midi_seed_review_required": False,
                "midi_seed_review_reason": None,
            }
        )
        assignments.append((percussion_track, PERCUSSION_SLOT_ID))

    selected_voice_tracks = sorted(
        voice_tracks,
        key=lambda track: _voice_track_priority(track, stats_by_track[id(track)]),
        reverse=True,
    )[: len(VOICE_SLOT_IDS)]
    selected_voice_tracks.sort(
        key=lambda track: (
            _pitch_sort_anchor(stats_by_track[id(track)]),
            -_source_track_index(track),
        ),
        reverse=True,
    )

    voice_slot_order = _best_voice_slot_order(selected_voice_tracks, stats_by_track)
    for rank_index, (track, slot_id) in enumerate(zip(selected_voice_tracks, voice_slot_order, strict=False), start=1):
        stats = stats_by_track[id(track)]
        track.diagnostics.update(
            {
                "role_assignment_strategy": "relative_voice_register",
                "role_assignment_rank": rank_index,
                "role_assignment_voice_count": len(selected_voice_tracks),
                "role_assignment_median_pitch": round(stats.median_pitch, 2)
                if stats.median_pitch is not None
                else None,
                "role_assignment_pitch_span": stats.pitch_span,
                "role_assignment_polyphonic_onset_ratio": round(stats.polyphonic_onset_ratio, 3),
            }
        )
        _finalize_midi_voice_review_state(track, stats)
        assignments.append((track, slot_id))

    return assignments


def _best_voice_slot_order(
    voice_tracks: list[ParsedTrack],
    stats_by_track: dict[int, TrackRoleStats],
) -> tuple[int, ...]:
    if not voice_tracks:
        return ()

    score_table = {
        id(track): {
            score.slot_id: _role_assignment_slot_score(score.score, name_match=score.name_match)
            for score in rank_slot_candidates(
                track.name,
                track.events,
                fallback=min(track_index + 1, len(VOICE_SLOT_IDS)),
                allowed_slots=VOICE_SLOT_IDS,
            )
        }
        for track_index, track in enumerate(voice_tracks)
    }

    best_assignment: tuple[float, tuple[int, ...]] | None = None
    for slot_order in combinations(VOICE_SLOT_IDS, len(voice_tracks)):
        score = _voice_ensemble_shape_bonus(slot_order, voice_tracks, stats_by_track)
        for track, slot_id in zip(voice_tracks, slot_order, strict=False):
            stats = stats_by_track[id(track)]
            score += score_table[id(track)].get(slot_id, -999)
            anchor = _pitch_sort_anchor(stats)
            center = SLOT_COMFORT_CENTERS[slot_id]
            if math.isfinite(anchor):
                score -= abs(anchor - center) * 0.025
        if best_assignment is None or score > best_assignment[0]:
            best_assignment = (score, slot_order)

    return best_assignment[1] if best_assignment is not None else ()


def _role_assignment_slot_score(score: float, *, name_match: bool) -> float:
    if not name_match:
        return score
    return score - ROLE_ASSIGNMENT_NAME_HINT_REDUCTION


def _voice_ensemble_shape_bonus(
    slot_order: tuple[int, ...],
    voice_tracks: list[ParsedTrack],
    stats_by_track: dict[int, TrackRoleStats],
) -> float:
    if not slot_order:
        return 0.0

    bonus = 0.0
    if len(slot_order) == len(VOICE_SLOT_IDS) and slot_order == VOICE_SLOT_IDS:
        bonus += 1.25
    elif len(slot_order) >= 4 and slot_order[0] == 1 and slot_order[-1] == 5:
        bonus += 0.75

    highest = stats_by_track[id(voice_tracks[0])]
    lowest = stats_by_track[id(voice_tracks[-1])]
    if (
        highest.median_pitch is not None
        and lowest.median_pitch is not None
        and highest.median_pitch - lowest.median_pitch >= 18
        and slot_order[0] == 1
        and slot_order[-1] == 5
    ):
        bonus += 0.8
    return bonus


def _track_role_stats(track: ParsedTrack) -> TrackRoleStats:
    pitched_events = [
        event
        for event in track.events
        if event.pitch_midi is not None and not event.is_rest
    ]
    if not pitched_events:
        return TrackRoleStats(
            pitched_event_count=0,
            median_pitch=None,
            average_pitch=None,
            min_pitch=None,
            max_pitch=None,
            pitch_span=0,
            total_duration_beats=0.0,
            max_same_onset=0,
            polyphonic_onset_ratio=0.0,
        )

    weighted = [
        (
            int(event.pitch_midi),
            max(0.05, event.duration_beats) * max(0.15, min(1.0, event.confidence)),
        )
        for event in pitched_events
    ]
    total_weight = sum(weight for _pitch, weight in weighted)
    average_pitch = sum(pitch * weight for pitch, weight in weighted) / total_weight
    median_pitch = _weighted_pitch_percentile(weighted, 0.5)
    pitches = [pitch for pitch, _weight in weighted]
    onset_counts: dict[float, int] = {}
    for event in pitched_events:
        onset_counts[round(event.beat, 4)] = onset_counts.get(round(event.beat, 4), 0) + 1
    chord_event_count = sum(count for count in onset_counts.values() if count > 1)
    return TrackRoleStats(
        pitched_event_count=len(pitched_events),
        median_pitch=median_pitch,
        average_pitch=average_pitch,
        min_pitch=min(pitches),
        max_pitch=max(pitches),
        pitch_span=max(pitches) - min(pitches),
        total_duration_beats=round(sum(event.duration_beats for event in pitched_events), 4),
        max_same_onset=max(onset_counts.values(), default=0),
        polyphonic_onset_ratio=chord_event_count / max(1, len(pitched_events)),
    )


def _weighted_pitch_percentile(weighted: list[tuple[int, float]], percentile: float) -> float | None:
    if not weighted:
        return None
    ordered = sorted(weighted)
    total_weight = sum(weight for _pitch, weight in ordered)
    if total_weight <= 0:
        return None
    threshold = total_weight * max(0.0, min(1.0, percentile))
    cursor = 0.0
    for pitch, weight in ordered:
        cursor += weight
        if cursor >= threshold:
            return float(pitch)
    return float(ordered[-1][0])


def _pitch_sort_anchor(stats: TrackRoleStats) -> float:
    if stats.median_pitch is not None:
        return stats.median_pitch
    if stats.average_pitch is not None:
        return stats.average_pitch
    return float("-inf")


def _voice_track_priority(track: ParsedTrack, stats: TrackRoleStats) -> tuple[float, float, int]:
    named_slot = slot_id_from_name(track.name)
    priority = 0.0
    if named_slot in VOICE_SLOT_IDS:
        priority += 5.0
    if track.diagnostics.get("midi_vocal_program_hint") is True:
        priority += 1.0
    if _is_generic_midi_track_name(track.name):
        priority -= 0.15
    priority += min(stats.pitched_event_count, 128) / 128
    priority += max(0.0, 1 - stats.polyphonic_onset_ratio) * 0.8
    if 4 <= stats.pitch_span <= 30:
        priority += 0.35
    elif stats.pitch_span > 42:
        priority -= 0.8
    return (priority, stats.total_duration_beats, -_source_track_index(track))


def _percussion_track_priority(track: ParsedTrack, stats: TrackRoleStats) -> tuple[int, float, int]:
    channels = set(track.diagnostics.get("midi_channels") or [])
    channel_hint = MIDI_PERCUSSION_CHANNEL_ONE_BASED in channels
    name_hint = slot_id_from_name(track.name) == PERCUSSION_SLOT_ID
    return (
        2 if channel_hint else 1 if name_hint else 0,
        stats.total_duration_beats,
        -_source_track_index(track),
    )


def _track_has_percussion_identity(track: ParsedTrack) -> bool:
    channels = set(track.diagnostics.get("midi_channels") or [])
    if MIDI_PERCUSSION_CHANNEL_ONE_BASED in channels:
        return True
    return slot_id_from_name(track.name) == PERCUSSION_SLOT_ID


def _finalize_midi_voice_review_state(track: ParsedTrack, stats: TrackRoleStats) -> None:
    if "midi_source_track_index" not in track.diagnostics:
        return

    review_required = False
    reason: str | None = None
    has_named_voice_role = slot_id_from_name(track.name) in VOICE_SLOT_IDS
    if stats.pitched_event_count == 0:
        review_required = True
        reason = "midi_track_has_no_pitched_voice"
    elif not has_named_voice_role and stats.max_same_onset >= 4:
        review_required = True
        reason = "midi_polyphonic_accompaniment"
    elif not has_named_voice_role and stats.polyphonic_onset_ratio >= 0.35:
        review_required = True
        reason = "midi_polyphonic_accompaniment"
    elif not has_named_voice_role and stats.pitch_span > 42:
        review_required = True
        reason = "midi_track_range_too_wide"

    track.diagnostics.update(
        {
            "midi_seed_review_required": review_required,
            "midi_seed_review_reason": reason,
            "midi_role_inferred_from_register": not has_named_voice_role,
        }
    )


def _source_track_index(track: ParsedTrack) -> int:
    value = track.diagnostics.get("midi_source_track_index")
    if isinstance(value, int):
        return value
    return 999


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
        events_by_channel: dict[int, list[TrackPitchEvent]] = {}
        channels_seen: set[int] = set()
        programs_by_channel: dict[int, set[int]] = {}
        current_time_signature = document_time_signature
        instrument_name: str | None = None

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
                elif meta_type == 0x04 and payload:
                    instrument_name = payload.decode("utf-8", errors="ignore").strip() or instrument_name
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
            if event_type == 0xC0:
                programs_by_channel.setdefault(channel, set()).add(event_data[0])
            elif event_type == 0x90:
                pitch_number = event_data[0]
                velocity = event_data[1]
                key = (channel, pitch_number)
                if velocity > 0:
                    active_midi_pitches[key] = absolute_tick
                else:
                    _append_midi_event(
                        events_by_channel.setdefault(channel, []),
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
                    events_by_channel.setdefault(channel, []),
                    key=key,
                    start_tick=active_midi_pitches.pop(key, absolute_tick),
                    end_tick=absolute_tick,
                    ticks_per_quarter=ticks_per_quarter,
                    bpm=bpm,
                    time_signature_numerator=current_time_signature[0],
                    time_signature_denominator=current_time_signature[1],
                )

        tracks.extend(
            _midi_parsed_tracks_from_channels(
                track_name=track_name,
                instrument_name=instrument_name,
                events_by_channel=events_by_channel,
                channels_seen=channels_seen,
                programs_by_channel=programs_by_channel,
                source_track_index=track_index,
            )
        )

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


def _midi_parsed_tracks_from_channels(
    *,
    track_name: str,
    instrument_name: str | None,
    events_by_channel: dict[int, list[TrackPitchEvent]],
    channels_seen: set[int],
    programs_by_channel: dict[int, set[int]],
    source_track_index: int,
) -> list[ParsedTrack]:
    non_empty_channels = [
        (channel, events)
        for channel, events in sorted(events_by_channel.items())
        if events
    ]
    if not non_empty_channels:
        return [
            ParsedTrack(
                name=track_name,
                events=[],
                slot_id=None,
                diagnostics={
                    "midi_source_track_index": source_track_index + 1,
                    "midi_channels": sorted(channel + 1 for channel in channels_seen),
                },
            )
        ]

    split_by_channel = len(non_empty_channels) > 1
    parsed_tracks: list[ParsedTrack] = []
    for split_index, (channel, events) in enumerate(non_empty_channels):
        channel_programs = programs_by_channel.get(channel, set())
        display_name = _midi_display_track_name(
            track_name=track_name,
            instrument_name=instrument_name,
            channel=channel,
            split_by_channel=split_by_channel,
        )
        fallback = min(source_track_index + split_index + 1, 6)
        slot_id = 6 if channel == 9 else infer_slot_id(display_name, events, fallback=fallback)
        parsed_tracks.append(
            ParsedTrack(
                name=display_name,
                events=events,
                slot_id=slot_id,
                diagnostics=_midi_track_diagnostics(
                    name=display_name,
                    events=events,
                    channels={channel},
                    programs=channel_programs,
                    source_track_index=source_track_index,
                    split_by_channel=split_by_channel,
                ),
            )
        )
    return parsed_tracks


def _midi_display_track_name(
    *,
    track_name: str,
    instrument_name: str | None,
    channel: int,
    split_by_channel: bool,
) -> str:
    base_name = instrument_name if _is_generic_midi_track_name(track_name) and instrument_name else track_name
    if not split_by_channel:
        return base_name
    return f"{base_name} ch {channel + 1}"


def _midi_track_diagnostics(
    *,
    name: str,
    events: list[TrackPitchEvent],
    channels: set[int],
    programs: set[int],
    source_track_index: int,
    split_by_channel: bool,
) -> dict[str, Any]:
    has_named_role = slot_id_from_name(name) is not None
    generic_name = _is_generic_midi_track_name(name)
    has_vocal_program = any(program in MIDI_VOCAL_PROGRAMS_ZERO_BASED for program in programs)
    review_required = not has_named_role and (generic_name or split_by_channel or not has_vocal_program)
    reason = "midi_track_ambiguous"
    if generic_name and not has_vocal_program:
        reason = "generic_midi_track_name"
    elif split_by_channel and not has_named_role:
        reason = "midi_channel_split_needs_review"
    elif programs and not has_vocal_program:
        reason = "midi_program_not_voice"

    return {
        "midi_source_track_index": source_track_index + 1,
        "midi_channels": sorted(channel + 1 for channel in channels),
        "midi_programs": sorted(program + 1 for program in programs),
        "midi_generic_track_name": generic_name,
        "midi_split_from_multichannel_track": split_by_channel,
        "midi_vocal_program_hint": has_vocal_program,
        "midi_named_voice_role": has_named_role,
        "midi_seed_review_required": review_required,
        "midi_seed_review_reason": reason if review_required else None,
        "midi_raw_event_count": len(events),
    }


def _is_generic_midi_track_name(name: str | None) -> bool:
    normalized = " ".join(
        "".join(character.lower() if character.isalnum() else " " for character in (name or "")).split()
    )
    if not normalized:
        return True
    tokens = normalized.split()
    if len(tokens) >= 2 and tokens[0] in MIDI_GENERIC_TRACK_PREFIXES and tokens[-1].isdigit():
        return True
    if len(tokens) >= 3 and tokens[0] == "midi" and tokens[1] == "track" and tokens[-1].isdigit():
        return True
    return normalized in {"midi", "track", "part", "untitled", "unknown"}


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
