from __future__ import annotations

STUDIO_TIME_PRECISION_SECONDS = 0.001
STUDIO_TIME_STORAGE_DIGITS = 4


def round_studio_seconds(value: float) -> float:
    return round(value, STUDIO_TIME_STORAGE_DIGITS)


def clamp_studio_duration_seconds(value: float) -> float:
    return round_studio_seconds(max(STUDIO_TIME_PRECISION_SECONDS, value))


def studio_time_precision_beats(beat_seconds: float) -> float:
    return STUDIO_TIME_PRECISION_SECONDS / max(STUDIO_TIME_PRECISION_SECONDS, beat_seconds)
