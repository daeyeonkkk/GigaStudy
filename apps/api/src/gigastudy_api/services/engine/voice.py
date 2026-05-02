from __future__ import annotations

import math
import struct
import wave
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from statistics import median

from gigastudy_api.domain.track_events import TrackNote
from gigastudy_api.config import get_settings
from gigastudy_api.services.engine.music_theory import (
    frequency_to_midi,
    note_from_pitch,
    quantize,
)
from gigastudy_api.services.engine.extraction_plan import VoiceExtractionPlan, default_voice_extraction_plan
from gigastudy_api.services.engine.event_normalization import normalize_track_notes


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


@dataclass(frozen=True)
class MetronomeAlignment:
    applied: bool
    offset_seconds: float
    offset_beats: float
    baseline_distance_beats: float
    aligned_distance_beats: float
    event_count: int


@dataclass(frozen=True)
class VoiceTranscriptionResult:
    notes: list[TrackNote]
    alignment: MetronomeAlignment
    diagnostics: dict[str, object] | None = None


METRONOME_ALIGNMENT_FINE_STEP_BEATS = 0.01
METRONOME_ALIGNMENT_MAX_OFFSET_BEATS = 0.3
METRONOME_ALIGNMENT_STRONG_GRID_BEATS = 0.5
METRONOME_ALIGNMENT_DETAIL_GRID_BEATS = 0.25
METRONOME_ALIGNMENT_MIN_EVENTS = 2
METRONOME_ALIGNMENT_MIN_IMPROVEMENT_BEATS = 0.035
METRONOME_ALIGNMENT_MIN_OFFSET_SECONDS = 0.018
NO_METRONOME_ALIGNMENT = MetronomeAlignment(False, 0.0, 0.0, 0.0, 0.0, 0)


def transcribe_voice_file(
    path: Path,
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    backend: str | None = None,
    extraction_plan: VoiceExtractionPlan | None = None,
) -> list[TrackNote]:
    return transcribe_voice_file_with_alignment(
        path,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        backend=backend,
        extraction_plan=extraction_plan,
    ).notes


def transcribe_voice_file_with_alignment(
    path: Path,
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int = 4,
    time_signature_denominator: int = 4,
    backend: str | None = None,
    extraction_plan: VoiceExtractionPlan | None = None,
) -> VoiceTranscriptionResult:
    if path.suffix.lower() != ".wav":
        msg = "Only WAV voice transcription is available in the local MVP engine."
        raise VoiceTranscriptionError(msg)

    resolved_backend = (backend or get_settings().voice_transcription_backend).strip().lower()
    if resolved_backend in {"auto", "basic_pitch"}:
        try:
            return _transcribe_with_basic_pitch(
                path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                extraction_plan=extraction_plan,
            )
        except VoiceTranscriptionError:
            if resolved_backend == "basic_pitch":
                raise
        except Exception as error:  # pragma: no cover - depends on optional model packages.
            if resolved_backend == "basic_pitch":
                raise VoiceTranscriptionError(f"Basic Pitch transcription failed: {error}") from error

    if resolved_backend in {"auto", "librosa", "pyin", "librosa_pyin"}:
        try:
            return _transcribe_with_librosa_pyin(
                path,
                bpm=bpm,
                slot_id=slot_id,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                extraction_plan=extraction_plan,
            )
        except VoiceTranscriptionError:
            if resolved_backend in {"librosa", "pyin", "librosa_pyin"}:
                raise
        except Exception as error:  # pragma: no cover - depends on optional audio packages.
            if resolved_backend in {"librosa", "pyin", "librosa_pyin"}:
                raise VoiceTranscriptionError(f"librosa pYIN transcription failed: {error}") from error

    return _transcribe_with_local_autocorrelation(
        path,
        bpm=bpm,
        slot_id=slot_id,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        extraction_plan=extraction_plan,
    )


def _transcribe_with_local_autocorrelation(
    path: Path,
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    extraction_plan: VoiceExtractionPlan | None = None,
) -> VoiceTranscriptionResult:
    plan = extraction_plan or default_voice_extraction_plan(slot_id=slot_id, bpm=bpm)
    samples, sample_rate = _read_wav_mono(path)
    if not samples:
        raise VoiceTranscriptionError("Audio file is empty.")

    samples = _prepare_voice_samples(samples, sample_rate)
    frame_size = min(4096, max(1024, sample_rate // 20))
    hop_size = frame_size // 2
    hop_seconds = hop_size / sample_rate
    low_midi, high_midi = plan.low_midi, plan.high_midi
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
        if confidence < plan.min_frame_confidence:
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
        slot_id=slot_id,
        hop_seconds=hop_seconds,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        extraction_method="wav_autocorrelation_v2",
        extraction_plan=plan,
        frame_count=len(stable_frame_pitches),
    )


def _transcribe_with_basic_pitch(
    path: Path,
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    extraction_plan: VoiceExtractionPlan | None = None,
) -> VoiceTranscriptionResult:
    plan = extraction_plan or default_voice_extraction_plan(slot_id=slot_id, bpm=bpm)
    try:
        from basic_pitch.inference import predict  # type: ignore[import-not-found]
    except Exception as error:  # pragma: no cover - optional dependency.
        raise VoiceTranscriptionError("Basic Pitch is not installed.") from error

    try:
        prediction = predict(str(path))
    except TypeError:
        prediction = predict(path)
    except Exception as error:  # pragma: no cover - optional dependency.
        raise VoiceTranscriptionError(f"Basic Pitch could not analyze the audio: {error}") from error

    note_events = _extract_basic_pitch_note_events(prediction)
    if not note_events:
        raise VoiceTranscriptionError("Basic Pitch did not produce any note events.")

    low_midi, high_midi = plan.low_midi, plan.high_midi
    beat_seconds = 60 / max(1, bpm)
    parsed_events: list[tuple[float, float, int, float]] = []
    for event in note_events:
        parsed = _parse_basic_pitch_event(event)
        if parsed is None:
            continue
        onset_seconds, end_seconds, midi_note, amplitude = parsed
        if midi_note < low_midi - 1 or midi_note > high_midi + 1:
            continue
        duration_seconds = max(0.05, end_seconds - onset_seconds)
        parsed_events.append((onset_seconds, duration_seconds, midi_note, amplitude))

    if not parsed_events:
        raise VoiceTranscriptionError("Basic Pitch did not produce notes in the target track range.")

    alignment = _estimate_metronome_phase_alignment(
        [(onset, duration, confidence) for onset, duration, _midi, confidence in parsed_events],
        bpm=bpm,
    )
    notes: list[TrackNote] = []
    for onset_seconds, duration_seconds, midi_note, amplitude in parsed_events:
        aligned_onset_seconds = max(0, onset_seconds + alignment.offset_seconds) if alignment.applied else onset_seconds
        warnings = ["metronome_phase_aligned"] if alignment.applied else []
        notes.append(
            note_from_pitch(
                beat=quantize(aligned_onset_seconds / beat_seconds + 1, plan.quantization_grid),
                duration_beats=max(
                    plan.quantization_grid,
                    quantize(duration_seconds / beat_seconds, plan.quantization_grid),
                ),
                bpm=bpm,
                source="voice",
                extraction_method="basic_pitch_amt_v1",
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                pitch_midi=midi_note,
                onset_seconds=aligned_onset_seconds,
                duration_seconds=duration_seconds,
                confidence=max(0.25, min(0.98, amplitude)),
                notation_warnings=warnings,
            )
        )

    return VoiceTranscriptionResult(
        notes=normalize_track_notes(
            notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=plan.quantization_grid,
            merge_adjacent_same_pitch=plan.merge_adjacent_same_pitch,
        ),
        alignment=alignment,
        diagnostics=_voice_transcription_diagnostics(
            plan,
            extraction_method="basic_pitch_amt_v1",
            frame_count=0,
            segment_count=len(parsed_events),
            note_count=len(notes),
        ),
    )


def _extract_basic_pitch_note_events(prediction: object) -> list[object]:
    if isinstance(prediction, tuple) and len(prediction) >= 3:
        candidate = prediction[2]
        return list(candidate) if isinstance(candidate, list | tuple) else []
    if isinstance(prediction, dict):
        candidate = prediction.get("note_events") or prediction.get("notes")
        return list(candidate) if isinstance(candidate, list | tuple) else []
    candidate = getattr(prediction, "note_events", None)
    return list(candidate) if isinstance(candidate, list | tuple) else []


def _parse_basic_pitch_event(event: object) -> tuple[float, float, int, float] | None:
    if isinstance(event, dict):
        onset = event.get("start_time_s", event.get("start_time", event.get("onset_seconds", event.get("start"))))
        end = event.get("end_time_s", event.get("end_time", event.get("offset_seconds", event.get("end"))))
        midi = event.get("pitch_midi", event.get("pitch", event.get("midi_note")))
        amplitude = event.get("amplitude", event.get("confidence", event.get("velocity", 0.75)))
    elif isinstance(event, list | tuple) and len(event) >= 3:
        onset, end, midi = event[:3]
        amplitude = event[3] if len(event) >= 4 and isinstance(event[3], int | float) else 0.75
    else:
        return None

    try:
        onset_seconds = float(onset)
        end_seconds = float(end)
        midi_note = round(float(midi))
        confidence = float(amplitude)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(onset_seconds) or not math.isfinite(end_seconds) or end_seconds <= onset_seconds:
        return None
    if confidence > 1:
        confidence = min(1.0, confidence / 127)
    return onset_seconds, end_seconds, midi_note, confidence


def _transcribe_with_librosa_pyin(
    path: Path,
    *,
    bpm: int,
    slot_id: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
    extraction_plan: VoiceExtractionPlan | None = None,
) -> VoiceTranscriptionResult:
    plan = extraction_plan or default_voice_extraction_plan(slot_id=slot_id, bpm=bpm)
    try:
        import librosa  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except Exception as error:  # pragma: no cover - optional dependency.
        raise VoiceTranscriptionError("librosa is not installed.") from error

    low_midi, high_midi = plan.low_midi, plan.high_midi
    fmin = 440 * 2 ** ((max(0, low_midi - 2) - 69) / 12)
    fmax = 440 * 2 ** ((min(127, high_midi + 2) - 69) / 12)
    sample_rate = 22_050
    frame_length = 4096 if low_midi < 50 else 2048
    hop_length = 512

    try:
        samples, loaded_sample_rate = librosa.load(str(path), sr=sample_rate, mono=True)
    except Exception as error:  # pragma: no cover - depends on audio backend.
        raise VoiceTranscriptionError(f"librosa could not load the WAV file: {error}") from error

    if len(samples) == 0:
        raise VoiceTranscriptionError("Audio file is empty.")

    try:
        f0_values, voiced_flags, voiced_probabilities = librosa.pyin(
            samples,
            fmin=fmin,
            fmax=fmax,
            sr=loaded_sample_rate,
            frame_length=frame_length,
            hop_length=hop_length,
        )
        rms_values = librosa.feature.rms(
            y=samples,
            frame_length=frame_length,
            hop_length=hop_length,
            center=True,
        )[0]
    except Exception as error:
        raise VoiceTranscriptionError(f"librosa pYIN could not track pitch: {error}") from error

    frame_count = min(len(f0_values), len(voiced_flags), len(voiced_probabilities), len(rms_values))
    if frame_count == 0:
        raise VoiceTranscriptionError("librosa pYIN did not produce pitch frames.")

    rms_list = [float(value) for value in rms_values[:frame_count]]
    voice_threshold = _dynamic_voice_threshold(rms_list)
    times = librosa.frames_to_time(np.arange(frame_count), sr=loaded_sample_rate, hop_length=hop_length)
    frame_pitches: list[PitchFrame] = []

    for index in range(frame_count):
        frequency = float(f0_values[index]) if np.isfinite(f0_values[index]) else 0.0
        if frequency <= 0:
            continue
        if not bool(voiced_flags[index]):
            continue
        rms = rms_list[index]
        if rms < voice_threshold:
            continue
        probability = float(voiced_probabilities[index])
        if probability < plan.min_voiced_probability:
            continue

        midi_float = 69 + 12 * math.log2(frequency / 440)
        midi_note = round(midi_float)
        if midi_note < low_midi - 1 or midi_note > high_midi + 1:
            continue
        amplitude_confidence = min(1, rms / max(voice_threshold * 2.5, 0.0001))
        frame_pitches.append(
            PitchFrame(
                time_seconds=max(0, float(times[index])),
                midi_float=midi_float,
                confidence=max(0.2, min(0.98, probability * 0.78 + amplitude_confidence * 0.22)),
            )
        )

    stable_frame_pitches = _stabilize_pitch_frames(frame_pitches, low_midi=low_midi, high_midi=high_midi)
    return _frames_to_notes(
        stable_frame_pitches,
        bpm=bpm,
        slot_id=slot_id,
        hop_seconds=hop_length / loaded_sample_rate,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        extraction_method="librosa_pyin_v1",
        extraction_plan=plan,
        frame_count=len(stable_frame_pitches),
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


def build_metronome_aligned_wav_bytes(path: Path, offset_seconds: float) -> bytes | None:
    if abs(offset_seconds) < 0.001:
        return None
    try:
        with wave.open(str(path), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            raw_frames = wav_file.readframes(frame_count)
            params = wav_file.getparams()
    except wave.Error as error:
        raise VoiceTranscriptionError(str(error)) from error

    bytes_per_frame = max(1, channels * sample_width)
    shift_frames = round(abs(offset_seconds) * sample_rate)
    if shift_frames <= 0:
        return None
    if offset_seconds < 0:
        if shift_frames >= frame_count:
            return None
        aligned_frames = raw_frames[shift_frames * bytes_per_frame :]
    else:
        aligned_frames = b"\x00" * shift_frames * bytes_per_frame + raw_frames

    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setparams(params)
        wav_file.writeframes(aligned_frames)
    return output.getvalue()


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
    slot_id: int,
    hop_seconds: float,
    time_signature_numerator: int,
    time_signature_denominator: int,
    extraction_method: str,
    extraction_plan: VoiceExtractionPlan | None = None,
    frame_count: int | None = None,
) -> VoiceTranscriptionResult:
    if not frame_pitches:
        raise VoiceTranscriptionError("No voiced pitch contour was detected.")
    plan = extraction_plan or default_voice_extraction_plan(slot_id=slot_id, bpm=bpm)

    segments: list[VoiceSegment] = []
    current_start = frame_pitches[0].time_seconds
    previous_time = current_start
    midi_values = [frame_pitches[0].midi_float]
    confidence_values = [frame_pitches[0].confidence]
    max_gap_seconds = max(plan.max_gap_seconds, hop_seconds * 2.75)

    for frame in frame_pitches[1:]:
        current_midi = median(midi_values)
        gap = frame.time_seconds - previous_time
        if abs(frame.midi_float - current_midi) <= plan.segment_pitch_tolerance and gap <= max_gap_seconds:
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
    segments = _clean_segments(
        segments,
        min_segment_seconds=max(plan.min_segment_seconds, hop_seconds * 3.5),
        min_segment_confidence=plan.min_segment_confidence,
        max_pitch_std=plan.max_pitch_std,
        suppress_unstable_notes=plan.suppress_unstable_notes,
    )
    if not segments:
        raise VoiceTranscriptionError("No stable voiced note was detected.")

    beat_seconds = 60 / bpm
    alignment = _estimate_metronome_phase_alignment(
        [
            (segment.onset_seconds, segment.duration_seconds, segment.confidence)
            for segment in segments
        ],
        bpm=bpm,
    )
    notes: list[TrackNote] = []
    for segment in segments:
        midi_note = round(segment.midi_float)
        aligned_onset_seconds = max(0, segment.onset_seconds + alignment.offset_seconds) if alignment.applied else segment.onset_seconds
        beat = quantize(aligned_onset_seconds / beat_seconds + 1, plan.quantization_grid)
        duration_beats = max(
            0.5,
            quantize(segment.duration_seconds / beat_seconds, plan.quantization_grid),
        )
        warnings = ["metronome_phase_aligned"] if alignment.applied else []
        notes.append(
            note_from_pitch(
                beat=beat,
                duration_beats=duration_beats,
                bpm=bpm,
                source="voice",
                extraction_method=extraction_method,
                time_signature_numerator=time_signature_numerator,
                time_signature_denominator=time_signature_denominator,
                pitch_midi=midi_note,
                onset_seconds=aligned_onset_seconds,
                duration_seconds=segment.duration_seconds,
                confidence=segment.confidence,
                notation_warnings=warnings,
            )
        )
    return VoiceTranscriptionResult(
        notes=normalize_track_notes(
            notes,
            bpm=bpm,
            slot_id=slot_id,
            time_signature_numerator=time_signature_numerator,
            time_signature_denominator=time_signature_denominator,
            quantization_grid=plan.quantization_grid,
            merge_adjacent_same_pitch=plan.merge_adjacent_same_pitch,
        ),
        alignment=alignment,
        diagnostics=_voice_transcription_diagnostics(
            plan,
            extraction_method=extraction_method,
            frame_count=frame_count if frame_count is not None else len(frame_pitches),
            segment_count=len(segments),
            note_count=len(notes),
        ),
    )


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


def _clean_segments(
    segments: list[VoiceSegment],
    *,
    min_segment_seconds: float,
    min_segment_confidence: float,
    max_pitch_std: float,
    suppress_unstable_notes: bool,
) -> list[VoiceSegment]:
    cleaned: list[VoiceSegment] = []
    for segment in segments:
        if segment.frame_count < 3:
            continue
        if segment.duration_seconds < min_segment_seconds:
            continue
        if segment.confidence < min_segment_confidence:
            continue
        if suppress_unstable_notes and segment.pitch_std > max_pitch_std:
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


def _voice_transcription_diagnostics(
    plan: VoiceExtractionPlan,
    *,
    extraction_method: str,
    frame_count: int,
    segment_count: int,
    note_count: int,
) -> dict[str, object]:
    return {
        "engine": extraction_method,
        "voice_extraction_plan": plan.diagnostics(),
        "pre_registration_frame_count": frame_count,
        "pre_registration_segment_count": segment_count,
        "pre_normalization_note_count": note_count,
        "bpm_is_absolute": True,
    }


def _estimate_metronome_phase_alignment(
    events: list[tuple[float, float, float]],
    *,
    bpm: int,
) -> MetronomeAlignment:
    beat_seconds = 60 / max(1, bpm)
    weighted_beats: list[tuple[float, float]] = []
    for onset_seconds, duration_seconds, confidence in events:
        if not math.isfinite(onset_seconds) or onset_seconds < 0:
            continue
        beat = onset_seconds / beat_seconds + 1
        confidence_weight = max(0.2, min(1.0, confidence))
        duration_weight = max(0.6, min(1.6, duration_seconds / max(beat_seconds * 0.5, 0.001)))
        weighted_beats.append((beat, confidence_weight * duration_weight))

    if len(weighted_beats) < METRONOME_ALIGNMENT_MIN_EVENTS:
        return MetronomeAlignment(False, 0.0, 0.0, 0.0, 0.0, len(weighted_beats))

    baseline_distance = _metronome_phase_distance(weighted_beats, 0.0)
    max_steps = round(METRONOME_ALIGNMENT_MAX_OFFSET_BEATS / METRONOME_ALIGNMENT_FINE_STEP_BEATS)
    candidates = [
        step * METRONOME_ALIGNMENT_FINE_STEP_BEATS
        for step in range(-max_steps, max_steps + 1)
    ]
    first_beat = min(beat for beat, _weight in weighted_beats)
    prefer_downbeat_entry = first_beat <= 1 + METRONOME_ALIGNMENT_MAX_OFFSET_BEATS + 0.05

    def candidate_rank(offset_beats: float) -> tuple[float, float, float]:
        distance = _metronome_phase_distance(weighted_beats, offset_beats)
        downbeat_distance = abs(first_beat + offset_beats - 1) if prefer_downbeat_entry else 0.0
        return round(distance, 6), downbeat_distance, abs(offset_beats)

    best_offset_beats, best_distance = min(
        ((offset_beats, _metronome_phase_distance(weighted_beats, offset_beats)) for offset_beats in candidates),
        key=lambda candidate: candidate_rank(candidate[0]),
    )
    offset_seconds = best_offset_beats * beat_seconds
    improvement = baseline_distance - best_distance
    applied = (
        abs(offset_seconds) >= METRONOME_ALIGNMENT_MIN_OFFSET_SECONDS
        and improvement >= METRONOME_ALIGNMENT_MIN_IMPROVEMENT_BEATS
    )
    return MetronomeAlignment(
        applied=applied,
        offset_seconds=round(offset_seconds if applied else 0.0, 4),
        offset_beats=round(best_offset_beats if applied else 0.0, 4),
        baseline_distance_beats=round(baseline_distance, 4),
        aligned_distance_beats=round(best_distance if applied else baseline_distance, 4),
        event_count=len(weighted_beats),
    )


def _metronome_phase_distance(weighted_beats: list[tuple[float, float]], offset_beats: float) -> float:
    if not weighted_beats:
        return 0.0
    total_weight = sum(weight for _beat, weight in weighted_beats)
    if total_weight <= 0:
        return 0.0
    weighted_distance = 0.0
    for beat, weight in weighted_beats:
        aligned_beat = beat + offset_beats
        strong_distance = _distance_to_beat_grid(aligned_beat, METRONOME_ALIGNMENT_STRONG_GRID_BEATS)
        detail_distance = _distance_to_beat_grid(aligned_beat, METRONOME_ALIGNMENT_DETAIL_GRID_BEATS)
        weighted_distance += weight * (strong_distance * 0.72 + detail_distance * 0.28)
    return weighted_distance / total_weight


def _distance_to_beat_grid(beat: float, grid_beats: float) -> float:
    if grid_beats <= 0:
        return 0.0
    nearest = 1 + round((beat - 1) / grid_beats) * grid_beats
    return abs(beat - nearest)


def _pitch_std(midi_values: list[float]) -> float:
    if len(midi_values) < 2:
        return 0.0
    average = sum(midi_values) / len(midi_values)
    variance = sum((value - average) ** 2 for value in midi_values) / len(midi_values)
    return math.sqrt(variance)
