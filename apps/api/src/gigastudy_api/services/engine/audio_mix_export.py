from __future__ import annotations

from array import array
from collections.abc import Callable
from dataclasses import dataclass
import math
from pathlib import Path
import random
import subprocess
import tempfile
import wave

from gigastudy_api.api.schemas.studios import (
    AudioExportRequest,
    ArrangementRegion,
    PitchEvent,
    Studio,
    TrackSlot,
    studio_arrangement_regions,
)


SAMPLE_RATE = 44_100
MELODIC_BASE_GAIN = 0.22
PERCUSSION_BASE_GAIN = 0.35
AUDIO_HEADROOM = 0.98


class AudioExportError(RuntimeError):
    pass


@dataclass(frozen=True)
class AudioExportRenderResult:
    wav_path: Path
    duration_seconds: float
    master_gain: float
    peak_before_master_gain: float
    sample_rate: int
    selected_track_count: int


@dataclass(frozen=True)
class _OriginalSegment:
    start_seconds: float
    samples: array
    volume: float


@dataclass(frozen=True)
class _GuideRegion:
    region: ArrangementRegion
    volume: float


def validate_audio_export_request(studio: Studio, request: AudioExportRequest) -> None:
    regions_by_slot = _regions_by_slot(studio)
    tracks_by_slot = {track.slot_id: track for track in studio.tracks}
    for selection in request.tracks:
        track = tracks_by_slot.get(selection.slot_id)
        if track is None:
            raise AudioExportError("선택한 트랙을 찾을 수 없습니다.")
        regions = regions_by_slot.get(selection.slot_id, [])
        if selection.source == "original" and not _has_original_audio(track, regions):
            raise AudioExportError(f"{track.name} 트랙에는 내보낼 원음이 없습니다.")
        if selection.source == "guide" and not _has_guide_events(regions):
            raise AudioExportError(f"{track.name} 트랙에는 내보낼 연주음이 없습니다.")


def render_audio_mix_wav(
    *,
    output_dir: Path,
    request: AudioExportRequest,
    resolve_asset_path: Callable[[str], Path],
    studio: Studio,
) -> AudioExportRenderResult:
    validate_audio_export_request(studio, request)
    output_dir.mkdir(parents=True, exist_ok=True)
    wav_path = output_dir / "mix.wav"
    regions_by_slot = _regions_by_slot(studio)
    tracks_by_slot = {track.slot_id: track for track in studio.tracks}

    original_segments: list[_OriginalSegment] = []
    guide_regions: list[_GuideRegion] = []
    min_start = 0.0
    max_end = 0.0

    for selection in request.tracks:
        track = tracks_by_slot[selection.slot_id]
        regions = regions_by_slot.get(selection.slot_id, [])
        if selection.source == "original":
            for region in _original_regions(track, regions):
                if region.audio_source_path is None:
                    continue
                source_path = resolve_asset_path(region.audio_source_path)
                samples = _decode_audio_to_float_samples(source_path)
                if len(samples) == 0:
                    continue
                if region.duration_seconds > 0:
                    max_samples = max(1, _seconds_to_sample(region.duration_seconds))
                    samples = samples[: min(len(samples), max_samples)]
                start_seconds = region.start_seconds
                min_start = min(min_start, start_seconds)
                max_end = max(max_end, start_seconds + (len(samples) / SAMPLE_RATE))
                original_segments.append(
                    _OriginalSegment(
                        start_seconds=start_seconds,
                        samples=samples,
                        volume=_volume_scale(region.volume_percent),
                    )
                )
        else:
            for region in regions:
                playable_events = [event for event in region.pitch_events if not event.is_rest]
                if not playable_events:
                    continue
                region_end = max(event.start_seconds + max(0.01, event.duration_seconds) for event in playable_events)
                region_start = min(event.start_seconds for event in playable_events)
                min_start = min(min_start, region_start)
                max_end = max(max_end, region_end + 0.2)
                guide_regions.append(
                    _GuideRegion(
                        region=region,
                        volume=_volume_scale(region.volume_percent),
                    )
                )

    if not original_segments and not guide_regions:
        raise AudioExportError("내보낼 오디오가 없습니다.")

    timeline_shift_seconds = max(0.0, -min_start)
    duration_seconds = max(0.1, max_end + timeline_shift_seconds + 0.25)
    total_samples = max(1, int(math.ceil(duration_seconds * SAMPLE_RATE)))
    mix = array("f", [0.0]) * total_samples

    for segment in original_segments:
        _mix_samples(
            mix,
            segment.samples,
            start_index=_seconds_to_sample(segment.start_seconds + timeline_shift_seconds),
            gain=segment.volume,
        )

    for guide in guide_regions:
        _render_guide_region(
            mix,
            guide.region,
            grid_unit_seconds=_sixteenth_seconds(studio.bpm),
            timeline_shift_seconds=timeline_shift_seconds,
            volume=guide.volume,
        )

    peak = max((abs(sample) for sample in mix), default=0.0)
    master_gain = AUDIO_HEADROOM / peak if peak > AUDIO_HEADROOM else 1.0
    if master_gain < 1.0:
        for index, sample in enumerate(mix):
            mix[index] = sample * master_gain
    _write_wav(wav_path, mix)
    return AudioExportRenderResult(
        wav_path=wav_path,
        duration_seconds=duration_seconds,
        master_gain=master_gain,
        peak_before_master_gain=peak,
        sample_rate=SAMPLE_RATE,
        selected_track_count=len(request.tracks),
    )


def encode_wav_to_mp3(wav_path: Path, mp3_path: Path) -> Path:
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(wav_path),
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "192k",
        str(mp3_path),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError) as error:
        raise AudioExportError("MP3 파일을 만들지 못했습니다. WAV 형식으로 다시 시도해 주세요.") from error
    return mp3_path


def _regions_by_slot(studio: Studio) -> dict[int, list[ArrangementRegion]]:
    result: dict[int, list[ArrangementRegion]] = {}
    for region in studio_arrangement_regions(studio):
        result.setdefault(region.track_slot_id, []).append(region)
    return result


def _has_original_audio(track: TrackSlot, regions: list[ArrangementRegion]) -> bool:
    return bool(track.audio_source_path or any(region.audio_source_path for region in regions))


def _has_guide_events(regions: list[ArrangementRegion]) -> bool:
    return any(any(not event.is_rest for event in region.pitch_events) for region in regions)


def _original_regions(track: TrackSlot, regions: list[ArrangementRegion]) -> list[ArrangementRegion]:
    audio_regions = [region for region in regions if region.audio_source_path]
    if audio_regions:
        return audio_regions
    if not track.audio_source_path:
        return []
    return [
        ArrangementRegion(
            region_id=f"track-{track.slot_id}-audio-export",
            track_slot_id=track.slot_id,
            track_name=track.name,
            source_kind=track.source_kind,
            source_label=track.source_label,
            audio_source_path=track.audio_source_path,
            audio_mime_type=track.audio_mime_type,
            start_seconds=track.sync_offset_seconds,
            duration_seconds=max(0.1, track.duration_seconds),
            sync_offset_seconds=track.sync_offset_seconds,
            volume_percent=track.volume_percent,
            pitch_events=[],
            diagnostics=track.diagnostics,
        )
    ]


def _decode_audio_to_float_samples(source_path: Path) -> array:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
        decoded_path = Path(temp_file.name)
    command = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(source_path),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "wav",
        str(decoded_path),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True)
        return _read_pcm16_wav(decoded_path)
    except (OSError, subprocess.CalledProcessError) as error:
        raise AudioExportError("원음 파일을 읽지 못했습니다. 연주음으로 내보내거나 다시 시도해 주세요.") from error
    finally:
        try:
            decoded_path.unlink()
        except OSError:
            pass


def _read_pcm16_wav(path: Path) -> array:
    with wave.open(str(path), "rb") as wav_file:
        sample_width = wav_file.getsampwidth()
        channels = wav_file.getnchannels()
        frame_count = wav_file.getnframes()
        raw = wav_file.readframes(frame_count)
    if sample_width != 2:
        raise AudioExportError("원음 파일을 읽지 못했습니다. 연주음으로 내보내거나 다시 시도해 주세요.")
    values = array("h")
    values.frombytes(raw)
    if channels <= 1:
        return array("f", (sample / 32768.0 for sample in values))
    mono = array("f")
    for index in range(0, len(values), channels):
        mono.append(sum(values[index : index + channels]) / (channels * 32768.0))
    return mono


def _render_guide_region(
    mix: array,
    region: ArrangementRegion,
    *,
    grid_unit_seconds: float,
    timeline_shift_seconds: float,
    volume: float,
) -> None:
    for event in sorted(region.pitch_events, key=lambda item: (item.start_seconds, item.event_id)):
        if event.is_rest:
            continue
        start_seconds = event.start_seconds + timeline_shift_seconds
        if region.track_slot_id == 6 or _percussion_kind(event.label) is not None:
            samples = _percussion_hit_samples(event)
            _mix_samples(
                mix,
                samples,
                start_index=_seconds_to_sample(start_seconds),
                gain=volume * PERCUSSION_BASE_GAIN,
            )
            continue
        frequency = _event_frequency(event)
        if frequency is None:
            continue
        samples = _melodic_event_samples(frequency, max(0.01, event.duration_seconds), grid_unit_seconds)
        _mix_samples(
            mix,
            samples,
            start_index=_seconds_to_sample(start_seconds),
            gain=volume * MELODIC_BASE_GAIN,
        )


def _melodic_event_samples(frequency: float, duration_seconds: float, grid_unit_seconds: float) -> array:
    release_seconds = min(0.08, max(0.02, duration_seconds * 0.12))
    total_seconds = duration_seconds + release_seconds
    total_samples = max(1, _seconds_to_sample(total_seconds))
    attack_seconds = min(max(duration_seconds * 0.08, 0.006), 0.018)
    sustain_end = max(attack_seconds, duration_seconds)
    end_gain = _melodic_end_gain(duration_seconds, grid_unit_seconds)
    result = array("f")
    phase = 0.0
    step = 2.0 * math.pi * frequency / SAMPLE_RATE
    for sample_index in range(total_samples):
        time_seconds = sample_index / SAMPLE_RATE
        if time_seconds <= attack_seconds:
            envelope = 0.001 + 1.099 * (time_seconds / max(attack_seconds, 0.001))
        elif time_seconds <= sustain_end:
            progress = (time_seconds - attack_seconds) / max(sustain_end - attack_seconds, 0.001)
            envelope = 1.10 + (end_gain - 1.10) * progress
        else:
            progress = (time_seconds - sustain_end) / max(release_seconds, 0.001)
            envelope = max(0.0, end_gain * (1.0 - progress))
        sine = math.sin(phase)
        triangle = (2.0 / math.pi) * math.asin(math.sin(phase))
        octave = math.sin(phase * 2.0)
        result.append((0.82 * sine + 0.18 * triangle + 0.05 * octave) * envelope)
        phase += step
    return result


def _melodic_end_gain(duration_seconds: float, grid_unit_seconds: float) -> float:
    beat_grid_units = max(1.0, duration_seconds / max(0.001, grid_unit_seconds))
    if beat_grid_units <= 1.2:
        return 0.9
    if beat_grid_units <= 3.2:
        return 0.78
    return 0.7


def _percussion_hit_samples(event: PitchEvent) -> array:
    kind = _percussion_kind(event.label) or "rim"
    if kind == "kick":
        return _kick_samples()
    if kind == "snare":
        return _noise_hit_samples(duration_seconds=0.12, tone_hz=180.0, high_pass=False, seed=event.event_id)
    if kind == "clap":
        return _noise_hit_samples(duration_seconds=0.14, tone_hz=320.0, high_pass=False, seed=event.event_id)
    if kind == "hat_open":
        return _noise_hit_samples(duration_seconds=0.22, tone_hz=7200.0, high_pass=True, seed=event.event_id)
    if kind == "hat_closed":
        return _noise_hit_samples(duration_seconds=0.06, tone_hz=7600.0, high_pass=True, seed=event.event_id)
    return _rim_samples()


def _kick_samples() -> array:
    duration_seconds = 0.16
    total_samples = _seconds_to_sample(duration_seconds)
    result = array("f")
    phase = 0.0
    for sample_index in range(total_samples):
        progress = sample_index / max(1, total_samples - 1)
        frequency = 140.0 + (48.0 - 140.0) * progress
        phase += 2.0 * math.pi * frequency / SAMPLE_RATE
        envelope = math.exp(-8.5 * progress)
        result.append(math.sin(phase) * envelope)
    return result


def _rim_samples() -> array:
    total_samples = _seconds_to_sample(0.055)
    result = array("f")
    phase = 0.0
    for sample_index in range(total_samples):
        progress = sample_index / max(1, total_samples - 1)
        phase += 2.0 * math.pi * 1800.0 / SAMPLE_RATE
        envelope = math.exp(-12.0 * progress)
        result.append(((2.0 / math.pi) * math.asin(math.sin(phase))) * envelope)
    return result


def _noise_hit_samples(*, duration_seconds: float, tone_hz: float, high_pass: bool, seed: str) -> array:
    total_samples = _seconds_to_sample(duration_seconds)
    rng = random.Random(seed)
    result = array("f")
    previous = 0.0
    phase = 0.0
    for sample_index in range(total_samples):
        progress = sample_index / max(1, total_samples - 1)
        noise = rng.uniform(-1.0, 1.0)
        if high_pass:
            filtered = noise - previous
            previous = noise
        else:
            phase += 2.0 * math.pi * tone_hz / SAMPLE_RATE
            filtered = 0.72 * noise + 0.28 * math.sin(phase)
        envelope = math.exp((-18.0 if high_pass else -9.0) * progress)
        result.append(filtered * envelope)
    return result


def _percussion_kind(label: str) -> str | None:
    normalized = label.strip().lower().replace(" ", "").replace("-", "")
    mapping = {
        "kick": "kick",
        "킥": "kick",
        "snare": "snare",
        "스네어": "snare",
        "clap": "clap",
        "박수": "clap",
        "hatclosed": "hat_closed",
        "closedhat": "hat_closed",
        "닫힌하이햇": "hat_closed",
        "hatopen": "hat_open",
        "openhat": "hat_open",
        "열린하이햇": "hat_open",
        "rim": "rim",
        "림": "rim",
    }
    return mapping.get(normalized)


def _event_frequency(event: PitchEvent) -> float | None:
    if event.pitch_hz is not None and math.isfinite(event.pitch_hz) and event.pitch_hz > 0:
        return event.pitch_hz
    if event.pitch_midi is None:
        return None
    return 440.0 * (2.0 ** ((event.pitch_midi - 69) / 12.0))


def _mix_samples(mix: array, samples: array, *, start_index: int, gain: float) -> None:
    if not samples:
        return
    write_start = max(0, start_index)
    source_start = max(0, -start_index)
    available = min(len(samples) - source_start, len(mix) - write_start)
    if available <= 0:
        return
    for offset in range(available):
        mix[write_start + offset] += samples[source_start + offset] * gain


def _write_wav(path: Path, samples: array) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        chunk_size = 4096
        for start in range(0, len(samples), chunk_size):
            chunk = samples[start : start + chunk_size]
            pcm = array("h", (_clamp_int16(sample) for sample in chunk))
            wav_file.writeframes(pcm.tobytes())


def _clamp_int16(sample: float) -> int:
    return max(-32768, min(32767, int(round(sample * 32767.0))))


def _seconds_to_sample(seconds: float) -> int:
    return int(round(seconds * SAMPLE_RATE))


def _volume_scale(volume_percent: int) -> float:
    return max(0.0, min(1.5, volume_percent / 100.0))


def _sixteenth_seconds(bpm: int) -> float:
    return (60.0 / max(1, bpm)) / 4.0
