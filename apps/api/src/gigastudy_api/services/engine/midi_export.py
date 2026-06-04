from __future__ import annotations

from dataclasses import dataclass

from gigastudy_api.api.schemas.studios import PitchEvent, Studio, studio_arrangement_regions
from gigastudy_api.services.engine.music_theory import TRACKS

PPQ = 480
DEFAULT_VELOCITY = 78
CHOIR_AAHS_PROGRAM = 52
PERCUSSION_CHANNEL = 9
PERCUSSION_LABEL_PITCHES = {
    "kick": 36,
    "bass drum": 36,
    "snare": 38,
    "rim": 37,
    "clap": 39,
    "hat": 42,
    "hihat": 42,
    "hi hat": 42,
    "tom": 45,
    "ride": 51,
    "crash": 49,
    "cymbal": 49,
}


@dataclass(frozen=True)
class MidiNote:
    slot_id: int
    pitch: int
    start_seconds: float
    duration_seconds: float


def build_studio_midi_bytes(studio: Studio) -> bytes:
    notes = _collect_notes(studio)
    timeline_shift = _timeline_shift_seconds(notes)
    tracks = [_build_tempo_track(studio)]
    for slot_id, default_name in TRACKS:
        track = next((item for item in studio.tracks if item.slot_id == slot_id), None)
        track_name = track.name if track is not None else default_name
        slot_notes = [note for note in notes if note.slot_id == slot_id]
        tracks.append(
            _build_note_track(
                name=track_name,
                notes=slot_notes,
                bpm=studio.bpm,
                channel=_channel_for_slot(slot_id),
                timeline_shift_seconds=timeline_shift,
                is_percussion=slot_id == 6,
            )
        )
    header = b"MThd" + (6).to_bytes(4, "big") + (1).to_bytes(2, "big")
    header += len(tracks).to_bytes(2, "big") + PPQ.to_bytes(2, "big")
    return header + b"".join(tracks)


def _collect_notes(studio: Studio) -> list[MidiNote]:
    notes: list[MidiNote] = []
    for region in studio_arrangement_regions(studio):
        for event in region.pitch_events:
            pitch = _midi_pitch_for_event(event, slot_id=region.track_slot_id)
            if pitch is None:
                continue
            duration_seconds = max(
                0.02,
                event.duration_seconds,
                event.duration_beats * _seconds_per_beat(studio.bpm),
            )
            notes.append(
                MidiNote(
                    slot_id=region.track_slot_id,
                    pitch=pitch,
                    start_seconds=event.start_seconds,
                    duration_seconds=duration_seconds,
                )
            )
    return notes


def _midi_pitch_for_event(event: PitchEvent, *, slot_id: int) -> int | None:
    if event.is_rest:
        return None
    if event.pitch_midi is not None:
        return _clamp_midi_pitch(event.pitch_midi)
    if slot_id != 6:
        return None
    normalized_label = event.label.strip().lower()
    for label_fragment, pitch in PERCUSSION_LABEL_PITCHES.items():
        if label_fragment in normalized_label:
            return pitch
    return 42


def _timeline_shift_seconds(notes: list[MidiNote]) -> float:
    earliest_start = min((note.start_seconds for note in notes), default=0.0)
    return max(0.0, -earliest_start)


def _build_tempo_track(studio: Studio) -> bytes:
    tempo_microseconds = int(round(60_000_000 / max(1, studio.bpm)))
    numerator = max(1, min(255, studio.time_signature_numerator))
    denominator_power = _time_signature_denominator_power(studio.time_signature_denominator)
    data = b""
    data += _meta_event(0, 0x03, b"GigaStudy tempo")
    data += _meta_event(0, 0x51, tempo_microseconds.to_bytes(3, "big"))
    data += _meta_event(0, 0x58, bytes([numerator, denominator_power, 24, 8]))
    data += _meta_event(0, 0x2F, b"")
    return _track_chunk(data)


def _build_note_track(
    *,
    name: str,
    notes: list[MidiNote],
    bpm: int,
    channel: int,
    timeline_shift_seconds: float,
    is_percussion: bool,
) -> bytes:
    events: list[tuple[int, int, bytes]] = []
    for note in notes:
        start_tick = _seconds_to_tick(note.start_seconds + timeline_shift_seconds, bpm)
        duration_ticks = max(1, _seconds_to_tick(note.duration_seconds, bpm))
        end_tick = start_tick + duration_ticks
        pitch = _clamp_midi_pitch(note.pitch)
        events.append((end_tick, 0, bytes([0x80 | channel, pitch, 0])))
        events.append((start_tick, 1, bytes([0x90 | channel, pitch, DEFAULT_VELOCITY])))

    data = _meta_event(0, 0x03, _ascii_bytes(name))
    if not is_percussion:
        data += _channel_event(0, bytes([0xC0 | channel, CHOIR_AAHS_PROGRAM]))

    cursor = 0
    for tick, _priority, payload in sorted(events, key=lambda item: (item[0], item[1], item[2])):
        data += _channel_event(max(0, tick - cursor), payload)
        cursor = tick
    data += _meta_event(0, 0x2F, b"")
    return _track_chunk(data)


def _seconds_to_tick(seconds: float, bpm: int) -> int:
    beat_seconds = _seconds_per_beat(bpm)
    return int(round(max(0.0, seconds) / beat_seconds * PPQ))


def _seconds_per_beat(bpm: int) -> float:
    return 60 / max(1, bpm)


def _channel_for_slot(slot_id: int) -> int:
    if slot_id == 6:
        return PERCUSSION_CHANNEL
    channel = max(0, slot_id - 1)
    return channel if channel < PERCUSSION_CHANNEL else channel + 1


def _time_signature_denominator_power(denominator: int) -> int:
    value = max(1, denominator)
    power = 0
    while value > 1:
        value //= 2
        power += 1
    return max(0, min(7, power))


def _clamp_midi_pitch(value: int) -> int:
    return max(0, min(127, int(round(value))))


def _ascii_bytes(value: str) -> bytes:
    return value.encode("ascii", errors="replace")


def _channel_event(delta_ticks: int, payload: bytes) -> bytes:
    return _vlq(delta_ticks) + payload


def _meta_event(delta_ticks: int, meta_type: int, payload: bytes) -> bytes:
    return _vlq(delta_ticks) + bytes([0xFF, meta_type]) + _vlq(len(payload)) + payload


def _track_chunk(data: bytes) -> bytes:
    return b"MTrk" + len(data).to_bytes(4, "big") + data


def _vlq(value: int) -> bytes:
    if value <= 0:
        return b"\x00"
    buffer = value & 0x7F
    value >>= 7
    while value:
        buffer <<= 8
        buffer |= (value & 0x7F) | 0x80
        value >>= 7
    output = bytearray()
    while True:
        output.append(buffer & 0xFF)
        if buffer & 0x80:
            buffer >>= 8
            continue
        break
    return bytes(output)
