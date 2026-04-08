from dataclasses import dataclass
from math import ceil

import librosa
import numpy as np


PYIN_FRAME_LENGTH = 2048
PYIN_HOP_LENGTH = 160
DEFAULT_MIN_FREQUENCY_HZ = 80.0
DEFAULT_MAX_FREQUENCY_HZ = 1100.0
DEFAULT_CONTOUR_POINTS = 64
ONSET_HOP_LENGTH = 160


@dataclass(frozen=True)
class PitchFrame:
    start_ms: int
    end_ms: int
    frequency_hz: float | None
    pitch_midi: int | None
    voiced: bool
    voiced_prob: float | None
    rms: float | None


def _normalize_samples(samples: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(samples, dtype=np.float32).reshape(-1))


def _fit_feature_length(
    values: np.ndarray | list[float] | list[bool] | None,
    target_length: int,
    *,
    fill_value: float | bool,
    dtype: np.dtype,
) -> np.ndarray:
    if values is None:
        return np.full(target_length, fill_value, dtype=dtype)

    array = np.asarray(values, dtype=dtype).reshape(-1)
    if array.size == target_length:
        return array
    if array.size > target_length:
        return array[:target_length]
    if array.size == 0:
        return np.full(target_length, fill_value, dtype=dtype)

    pad_width = target_length - array.size
    return np.pad(array, (0, pad_width), mode="constant", constant_values=fill_value)


def extract_pitch_frames(
    samples: np.ndarray,
    sample_rate: int,
    *,
    min_frequency_hz: float = DEFAULT_MIN_FREQUENCY_HZ,
    max_frequency_hz: float = DEFAULT_MAX_FREQUENCY_HZ,
    frame_length: int = PYIN_FRAME_LENGTH,
    hop_length: int = PYIN_HOP_LENGTH,
) -> list[PitchFrame]:
    normalized_samples = _normalize_samples(samples)
    if normalized_samples.size == 0 or sample_rate <= 0:
        return []

    original_duration_ms = max(1, round((normalized_samples.size / sample_rate) * 1000))
    if normalized_samples.size < frame_length:
        normalized_samples = np.pad(
            normalized_samples,
            (0, frame_length - normalized_samples.size),
            mode="constant",
        )

    f0, voiced_flag, voiced_prob = librosa.pyin(
        normalized_samples,
        sr=sample_rate,
        fmin=min_frequency_hz,
        fmax=max_frequency_hz,
        frame_length=frame_length,
        hop_length=hop_length,
    )
    rms = librosa.feature.rms(
        y=normalized_samples,
        frame_length=frame_length,
        hop_length=hop_length,
    ).reshape(-1)
    frame_count = len(f0)
    voiced_flag_array = _fit_feature_length(
        voiced_flag,
        frame_count,
        fill_value=False,
        dtype=np.bool_,
    )
    voiced_prob_array = _fit_feature_length(
        voiced_prob,
        frame_count,
        fill_value=np.nan,
        dtype=np.float32,
    )
    rms_array = _fit_feature_length(
        rms,
        frame_count,
        fill_value=0.0,
        dtype=np.float32,
    )

    frame_times_ms = librosa.frames_to_time(
        np.arange(len(f0)),
        sr=sample_rate,
        hop_length=hop_length,
    )
    hop_ms = max(1, round((hop_length / sample_rate) * 1000))
    frames: list[PitchFrame] = []

    for index, raw_frequency in enumerate(f0):
        start_ms = min(original_duration_ms, round(float(frame_times_ms[index]) * 1000))
        end_ms = min(original_duration_ms, max(start_ms + hop_ms, start_ms))
        if start_ms >= original_duration_ms:
            break

        frequency_hz: float | None
        pitch_midi: int | None
        if raw_frequency is None or np.isnan(raw_frequency):
            frequency_hz = None
            pitch_midi = None
        else:
            frequency_hz = round(float(raw_frequency), 3)
            pitch_midi = int(round(float(librosa.hz_to_midi(raw_frequency))))

        voiced_prob_value = float(voiced_prob_array[index])
        rms_value = float(rms_array[index])

        frames.append(
            PitchFrame(
                start_ms=start_ms,
                end_ms=max(start_ms + 1, end_ms),
                frequency_hz=frequency_hz,
                pitch_midi=pitch_midi,
                voiced=bool(voiced_flag_array[index]),
                voiced_prob=(round(voiced_prob_value, 4) if not np.isnan(voiced_prob_value) else None),
                rms=round(rms_value, 6),
            )
        )

    return frames


def build_preview_contour(
    samples: np.ndarray,
    sample_rate: int,
    *,
    points: int = DEFAULT_CONTOUR_POINTS,
) -> list[float | None]:
    frames = extract_pitch_frames(samples, sample_rate)
    if points <= 0:
        return []
    if not frames:
        return [None] * points

    segment_size = max(1, ceil(len(frames) / points))
    contour: list[float | None] = []

    for index in range(points):
        start = index * segment_size
        end = min(len(frames), start + segment_size)
        if start >= len(frames):
            contour.append(None)
            continue

        segment = frames[start:end]
        voiced_frequencies = [frame.frequency_hz for frame in segment if frame.frequency_hz is not None]
        contour.append(round(float(np.median(voiced_frequencies)), 3) if voiced_frequencies else None)

    return contour


def build_onset_envelope(
    samples: np.ndarray,
    sample_rate: int,
    *,
    hop_length: int = ONSET_HOP_LENGTH,
) -> np.ndarray:
    normalized_samples = _normalize_samples(samples)
    if normalized_samples.size == 0 or sample_rate <= 0:
        return np.zeros(1, dtype=np.float32)

    onset_envelope = librosa.onset.onset_strength(
        y=normalized_samples,
        sr=sample_rate,
        hop_length=hop_length,
    ).astype(np.float32)

    if onset_envelope.size == 0 or float(np.max(onset_envelope)) <= 1e-6:
        onset_envelope = librosa.feature.rms(
            y=normalized_samples,
            frame_length=PYIN_FRAME_LENGTH,
            hop_length=hop_length,
        ).reshape(-1).astype(np.float32)

    peak = float(np.max(onset_envelope)) if onset_envelope.size else 0.0
    if peak > 0:
        onset_envelope /= peak

    return onset_envelope if onset_envelope.size else np.zeros(1, dtype=np.float32)
