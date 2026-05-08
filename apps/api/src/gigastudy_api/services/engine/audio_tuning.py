from __future__ import annotations

from array import array
from collections.abc import Callable
from dataclasses import dataclass
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any
from uuid import uuid4

from gigastudy_api.api.schemas.studios import ArrangementRegion, PitchEvent
from gigastudy_api.services.engine.audio_mix_export import (
    SAMPLE_RATE,
    _decode_audio_to_float_samples,
    _seconds_to_sample,
    _write_wav,
)


class AudioTuningError(RuntimeError):
    pass


@dataclass(frozen=True)
class AudioTuningRenderResult:
    wav_path: Path
    duration_seconds: float
    event_count: int
    pitch_shifted_event_count: int
    time_stretched_event_count: int
    anchored_event_count: int
    fallback_anchored_event_count: int
    render_backend: str
    max_pitch_shift_semitones: float
    max_time_stretch_ratio: float


@dataclass(frozen=True)
class _AudioSourceAnchor:
    source_event_id: str
    source_start_seconds: float
    source_duration_seconds: float
    source_pitch_hz: float | None
    voiced_start_offset: float | None
    voiced_duration_seconds: float | None
    confidence: float | None


@dataclass(frozen=True)
class _EventRenderPlan:
    event: PitchEvent
    anchor: _AudioSourceAnchor | None
    source_start_seconds: float
    source_duration_seconds: float
    source_pitch_hz: float | None


@dataclass(frozen=True)
class _ProcessedSegment:
    samples: array
    backend: str
    pitch_shifted: bool
    time_stretched: bool
    pitch_shift_semitones: float
    time_stretch_ratio: float


def render_tuned_track_wav(
    *,
    output_dir: Path,
    regions: list[ArrangementRegion],
    resolve_asset_path: Callable[[str], Path],
) -> AudioTuningRenderResult:
    source_region = _first_audio_region(regions)
    if source_region is None or not source_region.audio_source_path:
        raise AudioTuningError("원본 녹음이 있는 트랙만 편집 반영본을 만들 수 있습니다.")

    anchors = _collect_audio_source_anchors(regions)
    playable_events = [
        event
        for region in regions
        for event in region.pitch_events
        if not event.is_rest and _event_frequency(event) is not None and event.duration_seconds > 0
    ]
    if not playable_events:
        raise AudioTuningError("편집을 반영할 음표가 없습니다.")

    source_path = resolve_asset_path(source_region.audio_source_path)
    source_samples = _decode_audio_to_float_samples(source_path)
    if len(source_samples) == 0:
        raise AudioTuningError("원본 녹음 파일을 읽지 못했습니다.")

    output_dir.mkdir(parents=True, exist_ok=True)
    plans = [
        _event_render_plan(event, anchors.get(event.event_id))
        for event in sorted(playable_events, key=lambda item: (item.start_seconds, item.event_id))
    ]
    min_start = min(0.0, *(plan.event.start_seconds for plan in plans))
    max_end = max(
        plan.event.start_seconds + max(0.01, plan.event.duration_seconds)
        for plan in plans
    )
    timeline_shift_seconds = max(0.0, -min_start)
    duration_seconds = max(0.1, max_end + timeline_shift_seconds + 0.2)
    mix = array("f", [0.0]) * max(1, _seconds_to_sample(duration_seconds))

    anchored_count = 0
    fallback_anchor_count = 0
    pitch_shifted_count = 0
    time_stretched_count = 0
    rubberband_count = 0
    fallback_backend_count = 0
    max_pitch_shift = 0.0
    max_time_stretch_ratio = 1.0

    with tempfile.TemporaryDirectory(dir=output_dir) as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        for plan in plans:
            if plan.anchor is None:
                fallback_anchor_count += 1
            else:
                anchored_count += 1
            segment = _source_segment_for_plan(
                source_samples,
                plan=plan,
                source_region_start_seconds=source_region.start_seconds,
            )
            if not segment:
                continue
            processed = _process_event_segment(segment, plan, temp_dir=temp_dir)
            if not processed.samples:
                continue
            if processed.backend == "rubberband":
                rubberband_count += 1
            else:
                fallback_backend_count += 1
            if processed.pitch_shifted:
                pitch_shifted_count += 1
            if processed.time_stretched:
                time_stretched_count += 1
            max_pitch_shift = max(max_pitch_shift, abs(processed.pitch_shift_semitones))
            max_time_stretch_ratio = max(
                max_time_stretch_ratio,
                processed.time_stretch_ratio,
                1.0 / processed.time_stretch_ratio if processed.time_stretch_ratio > 0 else 1.0,
            )
            _apply_short_fade(processed.samples)
            _mix_samples(
                mix,
                processed.samples,
                start_index=_seconds_to_sample(plan.event.start_seconds + timeline_shift_seconds),
            )

    if not any(abs(sample) > 0.00001 for sample in mix):
        raise AudioTuningError("편집을 반영할 수 있는 음성 구간을 찾지 못했습니다.")

    peak = max(abs(sample) for sample in mix)
    if peak > 0.98:
        gain = 0.98 / peak
        for index, sample in enumerate(mix):
            mix[index] = sample * gain

    wav_path = output_dir / "edit-applied-track.wav"
    _write_wav(wav_path, mix)
    return AudioTuningRenderResult(
        wav_path=wav_path,
        duration_seconds=duration_seconds,
        event_count=len(playable_events),
        pitch_shifted_event_count=pitch_shifted_count,
        time_stretched_event_count=time_stretched_count,
        anchored_event_count=anchored_count,
        fallback_anchored_event_count=fallback_anchor_count,
        render_backend="rubberband" if rubberband_count > 0 and fallback_backend_count == 0 else "librosa_fallback",
        max_pitch_shift_semitones=max_pitch_shift,
        max_time_stretch_ratio=max_time_stretch_ratio,
    )


def _first_audio_region(regions: list[ArrangementRegion]) -> ArrangementRegion | None:
    return next((region for region in regions if region.audio_source_path), None)


def _collect_audio_source_anchors(regions: list[ArrangementRegion]) -> dict[str, _AudioSourceAnchor]:
    anchors: dict[str, _AudioSourceAnchor] = {}
    for region in regions:
        raw_anchors = region.diagnostics.get("audio_source_anchors")
        if not isinstance(raw_anchors, dict):
            continue
        for event_id, payload in raw_anchors.items():
            if not isinstance(event_id, str) or not isinstance(payload, dict):
                continue
            anchor = _parse_anchor(event_id, payload)
            if anchor is not None:
                anchors[event_id] = anchor
    return anchors


def _parse_anchor(event_id: str, payload: dict[str, Any]) -> _AudioSourceAnchor | None:
    start_seconds = _float_or_none(payload.get("source_start_seconds"))
    duration_seconds = _float_or_none(payload.get("source_duration_seconds"))
    if start_seconds is None or duration_seconds is None or duration_seconds <= 0:
        return None
    return _AudioSourceAnchor(
        source_event_id=str(payload.get("source_event_id") or event_id),
        source_start_seconds=start_seconds,
        source_duration_seconds=duration_seconds,
        source_pitch_hz=_positive_float_or_none(payload.get("source_pitch_hz")),
        voiced_start_offset=_float_or_none(payload.get("voiced_start_offset")),
        voiced_duration_seconds=_float_or_none(payload.get("voiced_duration_seconds")),
        confidence=_float_or_none(payload.get("confidence")),
    )


def _event_render_plan(event: PitchEvent, anchor: _AudioSourceAnchor | None) -> _EventRenderPlan:
    source_start_seconds = anchor.source_start_seconds if anchor is not None else event.start_seconds
    source_duration_seconds = (
        anchor.source_duration_seconds
        if anchor is not None and anchor.source_duration_seconds > 0
        else event.duration_seconds
    )
    return _EventRenderPlan(
        event=event,
        anchor=anchor,
        source_start_seconds=source_start_seconds,
        source_duration_seconds=max(0.001, source_duration_seconds),
        source_pitch_hz=anchor.source_pitch_hz if anchor is not None else None,
    )


def _source_segment_for_plan(
    source_samples: array,
    *,
    plan: _EventRenderPlan,
    source_region_start_seconds: float,
) -> array:
    source_offset_seconds = max(0.0, plan.source_start_seconds - source_region_start_seconds)
    start_index = _seconds_to_sample(source_offset_seconds)
    source_length = max(1, _seconds_to_sample(plan.source_duration_seconds))
    if start_index >= len(source_samples):
        return array("f")
    return array("f", source_samples[start_index : min(len(source_samples), start_index + source_length)])


def _process_event_segment(segment: array, plan: _EventRenderPlan, *, temp_dir: Path) -> _ProcessedSegment:
    target_length = max(1, _seconds_to_sample(plan.event.duration_seconds))
    target_frequency = _event_frequency(plan.event)
    source_frequency = plan.source_pitch_hz or _estimate_segment_frequency(segment)
    semitone_shift = 0.0
    if target_frequency is not None and source_frequency is not None and source_frequency > 0:
        semitone_shift = 12.0 * math.log2(target_frequency / source_frequency)

    target_ratio = target_length / max(1, len(segment))
    pitch_shifted = abs(semitone_shift) >= 0.05
    time_stretched = abs(target_ratio - 1.0) >= 0.01
    if not pitch_shifted and not time_stretched:
        return _ProcessedSegment(
            samples=_resize_segment(segment, target_length),
            backend="librosa_fallback",
            pitch_shifted=False,
            time_stretched=False,
            pitch_shift_semitones=0.0,
            time_stretch_ratio=target_ratio,
        )

    lead, core, trail = _split_unvoiced_edges(segment, plan)
    lead_target, core_target, trail_target = _allocate_segment_targets(
        lead_length=len(lead),
        core_length=len(core),
        trail_length=len(trail),
        target_length=target_length,
    )
    try:
        processed_core = _process_segment_with_rubberband(
            core or segment,
            semitone_shift=semitone_shift,
            target_length=core_target if core else target_length,
            temp_dir=temp_dir,
        )
        backend = "rubberband"
    except Exception:
        processed_core = _process_segment_with_librosa(
            core or segment,
            semitone_shift=semitone_shift,
            target_length=core_target if core else target_length,
        )
        backend = "librosa_fallback"

    if core:
        processed = array("f")
        processed.extend(_resize_segment(lead, lead_target))
        processed.extend(processed_core)
        processed.extend(_resize_segment(trail, trail_target))
        samples = _resize_segment(processed, target_length)
    else:
        samples = _resize_segment(processed_core, target_length)
    return _ProcessedSegment(
        samples=samples,
        backend=backend,
        pitch_shifted=pitch_shifted,
        time_stretched=time_stretched,
        pitch_shift_semitones=semitone_shift,
        time_stretch_ratio=target_ratio,
    )


def _process_segment_with_rubberband(
    segment: array,
    *,
    semitone_shift: float,
    target_length: int,
    temp_dir: Path,
) -> array:
    executable = shutil.which("rubberband")
    if executable is None:
        raise RuntimeError("rubberband unavailable")
    input_path = temp_dir / f"rubberband-input-{uuid4().hex}.wav"
    output_path = temp_dir / f"rubberband-output-{uuid4().hex}.wav"
    _write_wav(input_path, segment)
    duration_ratio = target_length / max(1, len(segment))
    command = [
        executable,
        "-q",
        "-t",
        f"{duration_ratio:.8f}",
        "-p",
        f"{semitone_shift:.8f}",
        str(input_path),
        str(output_path),
    ]
    subprocess.run(command, check=True, capture_output=True, timeout=45)
    processed = _decode_audio_to_float_samples(output_path)
    return _resize_segment(processed, target_length)


def _process_segment_with_librosa(
    segment: array,
    *,
    semitone_shift: float,
    target_length: int,
) -> array:
    try:
        import numpy as np
        import librosa

        processed = np.asarray(segment, dtype=np.float32)
        if abs(semitone_shift) >= 0.05 and processed.size >= 64:
            processed = librosa.effects.pitch_shift(processed, sr=SAMPLE_RATE, n_steps=semitone_shift)
        if target_length > 0 and processed.size >= 64 and abs((target_length / max(1, processed.size)) - 1.0) >= 0.01:
            rate = max(0.01, processed.size / target_length)
            processed = librosa.effects.time_stretch(processed.astype(np.float32), rate=rate)
        return _resize_segment(array("f", (float(value) for value in processed)), target_length)
    except Exception:
        return _resize_segment(segment, target_length)


def _split_unvoiced_edges(segment: array, plan: _EventRenderPlan) -> tuple[array, array, array]:
    start_index: int | None = None
    end_index: int | None = None
    if plan.anchor is not None:
        voiced_start = plan.anchor.voiced_start_offset
        voiced_duration = plan.anchor.voiced_duration_seconds
        if voiced_start is not None and voiced_duration is not None and voiced_duration > 0:
            start_index = max(0, min(len(segment), _seconds_to_sample(voiced_start)))
            end_index = max(start_index, min(len(segment), start_index + _seconds_to_sample(voiced_duration)))
    if start_index is None or end_index is None or end_index <= start_index:
        detected = _estimate_voiced_sample_bounds(segment)
        if detected is None:
            return array("f"), segment, array("f")
        start_index, end_index = detected
    edge_floor = _seconds_to_sample(0.012)
    if start_index < edge_floor and len(segment) - end_index < edge_floor:
        return array("f"), segment, array("f")
    return (
        array("f", segment[:start_index]),
        array("f", segment[start_index:end_index]),
        array("f", segment[end_index:]),
    )


def _allocate_segment_targets(
    *,
    lead_length: int,
    core_length: int,
    trail_length: int,
    target_length: int,
) -> tuple[int, int, int]:
    if core_length <= 0:
        return 0, target_length, 0
    max_edge_length = max(0, target_length // 4)
    lead_target = min(lead_length, max_edge_length)
    trail_target = min(trail_length, max_edge_length)
    core_target = max(1, target_length - lead_target - trail_target)
    return lead_target, core_target, trail_target


def _estimate_segment_frequency(segment: array) -> float | None:
    try:
        import numpy as np
        import librosa

        samples = np.asarray(segment, dtype=np.float32)
        f0, _voiced_flag, _voiced_prob = librosa.pyin(
            samples,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C6"),
            sr=SAMPLE_RATE,
        )
        finite_values = f0[np.isfinite(f0)]
        if finite_values.size == 0:
            return None
        median_frequency = float(np.median(finite_values))
        return median_frequency if median_frequency > 0 else None
    except Exception:
        return None


def _estimate_voiced_sample_bounds(segment: array) -> tuple[int, int] | None:
    try:
        import numpy as np
        import librosa

        samples = np.asarray(segment, dtype=np.float32)
        hop_length = 256
        f0, voiced_flag, _voiced_prob = librosa.pyin(
            samples,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C6"),
            sr=SAMPLE_RATE,
            hop_length=hop_length,
        )
        voiced_indices = np.flatnonzero(voiced_flag & np.isfinite(f0))
        if voiced_indices.size == 0:
            return None
        start = max(0, int(voiced_indices[0] * hop_length))
        end = min(len(segment), int((voiced_indices[-1] + 1) * hop_length))
        if end <= start:
            return None
        return start, end
    except Exception:
        return None


def _resize_segment(segment: array, target_length: int) -> array:
    if target_length <= 0:
        return array("f")
    if len(segment) == target_length:
        return array("f", segment)
    if not segment:
        return array("f", [0.0]) * target_length
    if len(segment) == 1:
        return array("f", [segment[0]]) * target_length
    result = array("f")
    scale = (len(segment) - 1) / max(1, target_length - 1)
    for index in range(target_length):
        source_position = index * scale
        left = int(math.floor(source_position))
        right = min(len(segment) - 1, left + 1)
        fraction = source_position - left
        result.append(segment[left] * (1.0 - fraction) + segment[right] * fraction)
    return result


def _apply_short_fade(samples: array) -> None:
    if not samples:
        return
    fade_samples = min(len(samples) // 2, max(1, _seconds_to_sample(0.006)))
    for index in range(fade_samples):
        gain = index / fade_samples
        samples[index] *= gain
        samples[-index - 1] *= gain


def _mix_samples(mix: array, samples: array, *, start_index: int) -> None:
    write_start = max(0, start_index)
    source_start = max(0, -start_index)
    available = min(len(samples) - source_start, len(mix) - write_start)
    if available <= 0:
        return
    for offset in range(available):
        mix[write_start + offset] += samples[source_start + offset]


def _event_frequency(event: PitchEvent) -> float | None:
    if event.pitch_hz is not None and math.isfinite(event.pitch_hz) and event.pitch_hz > 0:
        return event.pitch_hz
    if event.pitch_midi is None:
        return None
    return 440.0 * (2.0 ** ((event.pitch_midi - 69) / 12.0))


def _float_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _positive_float_or_none(value: Any) -> float | None:
    number = _float_or_none(value)
    return number if number is not None and number > 0 else None
