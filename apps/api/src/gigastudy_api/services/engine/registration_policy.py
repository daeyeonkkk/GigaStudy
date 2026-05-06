from __future__ import annotations

from dataclasses import dataclass

from gigastudy_api.services.engine.event_normalization import measure_sixteenth_note_beats
from gigastudy_api.services.engine.music_theory import quantize, seconds_per_beat

REGISTRATION_POLICY_VERSION = "registration_policy_v1"
DEFAULT_STUDIO_PRECISION_SECONDS = 0.001
TECHNICAL_MIN_RHYTHM_GRID_BEATS = 0.0625


@dataclass(frozen=True)
class RegistrationPolicy:
    bpm: int
    time_signature_numerator: int
    time_signature_denominator: int
    rhythm_grid_beats: float
    studio_precision_seconds: float = DEFAULT_STUDIO_PRECISION_SECONDS

    @property
    def beat_seconds(self) -> float:
        return seconds_per_beat(max(1, self.bpm))

    @property
    def rhythm_grid_seconds(self) -> float:
        return self.rhythm_grid_beats * self.beat_seconds

    @property
    def minimum_note_beats(self) -> float:
        return self.rhythm_grid_beats

    @property
    def voice_quantization_grid_beats(self) -> float:
        return self.rhythm_grid_beats

    @property
    def dense_voice_grid_beats(self) -> float:
        return round(self.rhythm_grid_beats * 2, 6)

    @property
    def same_pitch_merge_gap_beats(self) -> float:
        return max(0.0, self.rhythm_grid_beats - 0.0001)

    def should_absorb_gap(self, gap_beats: float) -> bool:
        return 0 < gap_beats < self.rhythm_grid_beats - 0.0001

    def quantize_beat(self, beat: float) -> float:
        safe_grid = max(TECHNICAL_MIN_RHYTHM_GRID_BEATS, self.rhythm_grid_beats)
        return round(max(1.0, quantize(beat, safe_grid)), 4)

    def quantize_duration(self, duration_beats: float) -> float:
        safe_grid = max(TECHNICAL_MIN_RHYTHM_GRID_BEATS, self.rhythm_grid_beats)
        return round(max(safe_grid, quantize(duration_beats, safe_grid)), 4)

    def diagnostics(self) -> dict[str, float | int | str]:
        return {
            "version": REGISTRATION_POLICY_VERSION,
            "bpm": self.bpm,
            "time_signature_numerator": self.time_signature_numerator,
            "time_signature_denominator": self.time_signature_denominator,
            "rhythm_grid_beats": self.rhythm_grid_beats,
            "rhythm_grid_seconds": round(self.rhythm_grid_seconds, 6),
            "minimum_note_beats": self.minimum_note_beats,
            "voice_quantization_grid_beats": self.voice_quantization_grid_beats,
            "dense_voice_grid_beats": self.dense_voice_grid_beats,
            "studio_precision_seconds": self.studio_precision_seconds,
        }


RegistrationGridPolicy = RegistrationPolicy


def build_registration_grid_policy(
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> RegistrationPolicy:
    rhythm_grid_beats = measure_sixteenth_note_beats(
        time_signature_numerator,
        time_signature_denominator,
    )
    return RegistrationPolicy(
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        rhythm_grid_beats=rhythm_grid_beats,
    )
