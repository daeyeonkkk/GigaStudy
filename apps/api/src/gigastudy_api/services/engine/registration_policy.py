from __future__ import annotations

from dataclasses import dataclass

from gigastudy_api.services.engine.event_normalization import measure_sixteenth_note_beats
from gigastudy_api.services.engine.music_theory import seconds_per_beat


@dataclass(frozen=True)
class RegistrationGridPolicy:
    bpm: int
    time_signature_numerator: int
    time_signature_denominator: int
    rhythm_grid_beats: float

    @property
    def beat_seconds(self) -> float:
        return seconds_per_beat(max(1, self.bpm))

    @property
    def rhythm_grid_seconds(self) -> float:
        return self.rhythm_grid_beats * self.beat_seconds

    @property
    def minimum_note_beats(self) -> float:
        return self.rhythm_grid_beats

    def diagnostics(self) -> dict[str, float | int | str]:
        return {
            "version": "registration_grid_v1",
            "bpm": self.bpm,
            "time_signature_numerator": self.time_signature_numerator,
            "time_signature_denominator": self.time_signature_denominator,
            "rhythm_grid_beats": self.rhythm_grid_beats,
            "rhythm_grid_seconds": round(self.rhythm_grid_seconds, 6),
            "minimum_note_beats": self.minimum_note_beats,
        }


def build_registration_grid_policy(
    *,
    bpm: int,
    time_signature_numerator: int,
    time_signature_denominator: int,
) -> RegistrationGridPolicy:
    rhythm_grid_beats = measure_sixteenth_note_beats(
        time_signature_numerator,
        time_signature_denominator,
    )
    return RegistrationGridPolicy(
        bpm=bpm,
        time_signature_numerator=time_signature_numerator,
        time_signature_denominator=time_signature_denominator,
        rhythm_grid_beats=rhythm_grid_beats,
    )
