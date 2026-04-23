from __future__ import annotations

import math
import struct
import wave
from dataclasses import dataclass
from pathlib import Path
from statistics import median

from gigastudy_api.api.schemas.studios import TrackNote
from gigastudy_api.services.engine.music_theory import (
    SLOT_RANGES,
    frequency_to_midi,
    note_from_pitch,
    quantize,
)


class VoiceTranscriptionError(ValueError):
    pass


@dataclass(frozen=True)
class PitchFrame:
    time_seconds: float
    midi_float: float
    confidence: float


@dataclass(frozen=True)
class VoiceSegment:
    onset_seconds: float
    duration_seconds: float
    midi_float: float
    confidence: float
    frame_count: int
    pitch_std: float


def transcribe_voice_file(
    path: Path,
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
) -> list[TrackNote]:
    if path.suffix.lower() != ".wav":
        msg = "Only WAV voice transcription is available in the local MVP engine."
        raise VoiceTranscriptionError(msg)

    samples, sample_rate = _read_wav_mono(path)
    if not samples:
        raise VoiceTranscriptionError("Audio file is empty.")

    samples = _prepare_voice_samples(samples, sample_rate)
    frame_size = min(4096, max(1024, sample_rate // 20))
    hop_size = frame_size // 2
    hop_seconds = hop_size / sample_rate
    low_midi, high_midi = SLOT_RANGES.get(slot_id, (40, 81))
    fmin = 440 * 2 ** ((low_midi - 69) / 12)
    fmax = 440 * 2 ** ((high_midi - 69) / 12)
    frame_candidates: list[tuple[int, list[float], float]] = []

    for start in range(0, max(1, len(samples) - frame_size), hop_size):
        frame = samples[start : start + frame_size]
        if len(frame) < frame_size:
            break
        rms = math.sqrt(sum(sample * sample for sample in frame) / len(frame))
        frame_candidates.append((start, frame, rms))

    if not frame_candidates:
        raise VoiceTranscriptionError("Audio file is too short for transcription.")

    voice_threshold = _dynamic_voice_threshold([rms for _, _, rms in frame_candidates])
    frame_pitches: list[PitchFrame] = []

    for start, frame, rms in frame_candidates:
        if rms < voice_threshold:
            continue
        if _zero_crossing_rate(frame) > 0.24:
            continue

        frequency, confidence = _estimate_frequency(frame, sample_rate, fmin=fmin, fmax=fmax)
        if frequency is None:
            continue
        if confidence < 0.42:
            continue
        midi_float = 69 + 12 * math.log2(frequency / 440)
        midi_note = frequency_to_midi(frequency)
        if midi_note is None or midi_note < low_midi - 1 or midi_note > high_midi + 1:
            continue
        amplitude_confidence = min(1, rms / max(voice_threshold * 2.8, 0.0001))
        frame_pitches.append(
            PitchFrame(
                time_seconds=start / sample_rate,
                midi_float=midi_float,
                confidence=min(1, confidence * (0.45 + amplitude_confidence * 0.55)),
            )
        )

    stable_frame_pitches = _stabilize_pitch_frames(frame_pitches, low_midi=low_midi, high_midi=high_midi)

    return _frames_to_notes(
        stable_frame_pitches,
        bpm=bpm,
        hop_seconds=hop_seconds,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
    )


def _remove_dc_offset(samples: list[float]) -> list[float]:
    if not samples:
        return samples
    average = sum(samples) / len(samples)
    return [sample - average for sample in samples]


def _prepare_voice_samples(samples: list[float], sample_rate: int) -> list[float]:
    centered = _remove_dc_offset(samples)
    return _high_pass_filter(centered, sample_rate, cutoff_hz=70)


def _high_pass_filter(samples: list[float], sample_rate: int, *, cutoff_hz: float) -> list[float]:
    if len(samples) < 2 or sample_rate <= 0:
        return samples
    alpha = math.exp(-2 * math.pi * cutoff_hz / sample_rate)
    filtered: list[float] = []
    previous_input = samples[0]
    previous_output = 0.0
    for sample in samples:
        output = alpha * (previous_output + sample - previous_input)
        filtered.append(output)
        previous_input = sample
        previous_output = output
    return filtered


def _dynamic_voice_threshold(rms_values: list[float]) -> float:
    if not rms_values:
        return 0.006
    sorted_values = sorted(rms_values)
    noise_floor = _percentile(sorted_values, 0.25)
    peak = max(sorted_values)
    active_floor = _percentile(sorted_values, 0.7)
    adaptive_threshold = max(noise_floor * 4.5, active_floor * 0.7, peak * 0.16)
    return max(0.004, min(0.035, adaptive_threshold))


def _percentile(sorted_values: list[float], ratio: float) -> float:
    if not sorted_values:
        return 0
    bounded_ratio = min(1, max(0, ratio))
    index = round((len(sorted_values) - 1) * bounded_ratio)
    return sorted_values[index]


def _read_wav_mono(path: Path) -> tuple[list[float], int]:
    try:
        with wave.open(str(path), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            raw = wav_file.readframes(wav_file.getnframes())
    except wave.Error as error:
        raise VoiceTranscriptionError(str(error)) from error

    if sample_width != 2:
        raise VoiceTranscriptionError("Only 16-bit PCM WAV files are supported by the local MVP engine.")

    values = struct.unpack(f"<{len(raw) // 2}h", raw)
    samples: list[float] = []
    for index in range(0, len(values), channels):
        frame_values = values[index : index + channels]
        samples.append(sum(frame_values) / (channels * 32768))
    return samples, sample_rate


def _estimate_frequency(
    frame: list[float],
    sample_rate: int,
    *,
    fmin: float,
    fmax: float,
) -> tuple[float | None, float]:
    min_lag = max(1, int(sample_rate / fmax))
    max_lag = min(len(frame) // 2, int(sample_rate / fmin))
    if max_lag <= min_lag:
        return None, 0

    frame_mean = sum(frame) / len(frame)
    centered = [
        (sample - frame_mean) * (0.5 - 0.5 * math.cos(2 * math.pi * index / (len(frame) - 1)))
        for index, sample in enumerate(frame)
    ]
    energy = sum(sample * sample for sample in centered)
    if energy <= 0:
        return None, 0

    best_lag = min_lag
    best_score = 0.0
    scores: dict[int, float] = {}
    for lag in range(min_lag, max_lag + 1):
        score = 0.0
        left_energy = 0.0
        right_energy = 0.0
        for index in range(0, len(centered) - lag):
            left = centered[index]
            right = centered[index + lag]
            left_energy += left * left
            right_energy += right * right
            score += centered[index] * centered[index + lag]
        denominator = math.sqrt(left_energy * right_energy)
        normalized_score = score / denominator if denominator > 0 else 0
        scores[lag] = normalized_score
        if normalized_score > best_score:
            best_score = normalized_score
            best_lag = lag

    if best_score < 0.38:
        return None, best_score
    refined_lag = _parabolic_lag(best_lag, scores)
    return sample_rate / refined_lag, best_score


def _stabilize_pitch_frames(
    frames: list[PitchFrame],
    *,
    low_midi: int,
    high_midi: int,
) -> list[PitchFrame]:
    if len(frames) < 3:
        return frames

    stabilized: list[PitchFrame] = []
    for index, frame in enumerate(frames):
        window = [
            candidate
            for candidate in frames[max(0, index - 2) : min(len(frames), index + 3)]
            if abs(candidate.time_seconds - frame.time_seconds) <= 0.22
        ]
        midi_float = frame.midi_float
        if len(window) >= 3:
            local_median = median(candidate.midi_float for candidate in window)
            octave_candidates = [
                frame.midi_float + octave_shift
                for octave_shift in (-24, -12, 0, 12, 24)
                if low_midi - 1 <= frame.midi_float + octave_shift <= high_midi + 1
            ]
            if octave_candidates:
                corrected = min(octave_candidates, key=lambda candidate: abs(candidate - local_median))
                if (
                    abs(frame.midi_float - local_median) > 6
                    and abs(corrected - local_median) + 0.5 < abs(frame.midi_float - local_median)
                ):
                    midi_float = corrected

            neighbor_values = [
                candidate.midi_float
                for candidate in window
                if candidate.time_seconds != frame.time_seconds
            ]
            if len(neighbor_values) >= 2:
                neighbor_median = median(neighbor_values)
                if _pitch_std(neighbor_values) < 0.55 and abs(midi_float - neighbor_median) > 1.2 and frame.confidence < 0.72:
                    midi_float = neighbor_median

        stabilized.append(
            PitchFrame(
                time_seconds=frame.time_seconds,
                midi_float=midi_float,
                confidence=frame.confidence,
            )
        )
    return stabilized


def _zero_crossing_rate(frame: list[float]) -> float:
    if len(frame) < 2:
        return 0.0
    crossings = 0
    previous = frame[0]
    for sample in frame[1:]:
        if (previous < 0 <= sample) or (previous >= 0 > sample):
            crossings += 1
        previous = sample
    return crossings / (len(frame) - 1)


def _parabolic_lag(best_lag: int, scores: dict[int, float]) -> float:
    previous_score = scores.get(best_lag - 1)
    current_score = scores.get(best_lag)
    next_score = scores.get(best_lag + 1)
    if previous_score is None or current_score is None or next_score is None:
        return float(best_lag)
    denominator = previous_score - 2 * current_score + next_score
    if abs(denominator) < 1e-9:
        return float(best_lag)
    offset = 0.5 * (previous_score - next_score) / denominator
    return max(1.0, best_lag + max(-0.5, min(0.5, offset)))


def _frames_to_notes(
    frame_pitches: list[PitchFrame],
    *,
    bpm: int,
    hop_seconds: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> list[TrackNote]:
    if not frame_pitches:
        raise VoiceTranscriptionError("No voiced pitch contour was detected.")

    segments: list[VoiceSegment] = []
    current_start = frame_pitches[0].time_seconds
    previous_time = current_start
    midi_values = [frame_pitches[0].midi_float]
    confidence_values = [frame_pitches[0].confidence]
    max_gap_seconds = max(0.11, hop_seconds * 2.75)

    for frame in frame_pitches[1:]:
        current_midi = median(midi_values)
        gap = frame.time_seconds - previous_time
        if abs(frame.midi_float - current_midi) <= 0.75 and gap <= max_gap_seconds:
            previous_time = frame.time_seconds
            midi_values.append(frame.midi_float)
            confidence_values.append(frame.confidence)
            continue

        segments.append(_build_segment(current_start, previous_time, midi_values, confidence_values, hop_seconds))
        current_start = frame.time_seconds
        previous_time = frame.time_seconds
        midi_values = [frame.midi_float]
        confidence_values = [frame.confidence]

    segments.append(_build_segment(current_start, previous_time, midi_values, confidence_values, hop_seconds))
    segments = _clean_segments(segments, min_segment_seconds=max(0.15, hop_seconds * 3.5))
    if not segments:
        raise VoiceTranscriptionError("No stable voiced note was detected.")

    beat_seconds = 60 / bpm
    notes: list[TrackNote] = []
    for segment in segments:
        midi_note = round(segment.midi_float)
        beat = quantize(segment.onset_seconds / beat_seconds + 1, 0.25)
        duration_beats = max(0.5, quantize(segment.duration_seconds / beat_seconds, 0.25))
        notes.append(
            note_from_pitch(
                beat=beat,
                duration_beats=duration_beats,
                bpm=bpm,
                source="voice",
                extraction_method="wav_autocorrelation_v2",
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                pitch_midi=midi_note,
                onset_seconds=segment.onset_seconds,
                duration_seconds=segment.duration_seconds,
                confidence=segment.confidence,
            )
        )
    return notes


def _build_segment(
    current_start: float,
    previous_time: float,
    midi_values: list[float],
    confidence_values: list[float],
    hop_seconds: float,
) -> VoiceSegment:
    return VoiceSegment(
        onset_seconds=current_start,
        duration_seconds=max(0.08, previous_time - current_start + hop_seconds),
        midi_float=median(midi_values),
        confidence=sum(confidence_values) / len(confidence_values),
        frame_count=len(midi_values),
        pitch_std=_pitch_std(midi_values),
    )


def _clean_segments(segments: list[VoiceSegment], *, min_segment_seconds: float) -> list[VoiceSegment]:
    cleaned: list[VoiceSegment] = []
    for segment in segments:
        if segment.frame_count < 3:
            continue
        if segment.duration_seconds < min_segment_seconds:
            continue
        if segment.confidence < 0.46:
            continue
        if segment.pitch_std > 0.65:
            continue
        if cleaned:
            previous = cleaned[-1]
            previous_end = previous.onset_seconds + previous.duration_seconds
            if (
                segment.onset_seconds - previous_end <= 0.08
                and abs(segment.midi_float - previous.midi_float) <= 0.5
            ):
                cleaned[-1] = VoiceSegment(
                    onset_seconds=previous.onset_seconds,
                    duration_seconds=max(
                        previous.duration_seconds,
                        segment.onset_seconds + segment.duration_seconds - previous.onset_seconds,
                    ),
                    midi_float=median([previous.midi_float, segment.midi_float]),
                    confidence=(previous.confidence + segment.confidence) / 2,
                    frame_count=previous.frame_count + segment.frame_count,
                    pitch_std=max(previous.pitch_std, segment.pitch_std),
                )
                continue
        cleaned.append(segment)
    return cleaned


def _pitch_std(midi_values: list[float]) -> float:
    if len(midi_values) < 2:
        return 0.0
    average = sum(midi_values) / len(midi_values)
    variance = sum((value - average) ** 2 for value in midi_values) / len(midi_values)
    return math.sqrt(variance)
