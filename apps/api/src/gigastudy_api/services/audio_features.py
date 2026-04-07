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


def _normalize_samples(samples: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(samples, dtype=np.float32).reshape(-1))


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

    f0, _, _ = librosa.pyin(
        normalized_samples,
        sr=sample_rate,
        fmin=min_frequency_hz,
        fmax=max_frequency_hz,
        frame_length=frame_length,
        hop_length=hop_length,
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

        frames.append(
            PitchFrame(
                start_ms=start_ms,
                end_ms=max(start_ms + 1, end_ms),
                frequency_hz=frequency_hz,
                pitch_midi=pitch_midi,
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
