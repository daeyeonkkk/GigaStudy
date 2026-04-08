from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
import math
from random import Random
import wave


@dataclass(frozen=True)
class VocalSegment:
    duration_ms: int
    start_cents: float = 0.0
    end_cents: float = 0.0
    vibrato_cents: float = 0.0
    vibrato_hz: float = 5.5
    breath_noise: float = 0.0
    voiced_mix: float = 1.0


def build_test_wav_bytes(
    *,
    duration_ms: int = 1000,
    frequency_hz: float = 440.0,
    amplitude: float = 0.2,
    sample_rate: int = 16000,
) -> bytes:
    frame_count = max(1, round(sample_rate * (duration_ms / 1000)))
    output = BytesIO()

    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)

        frames = bytearray()
        for frame_index in range(frame_count):
            sample = math.sin((2 * math.pi * frequency_hz * frame_index) / sample_rate)
            pcm = int(max(-1.0, min(1.0, sample * amplitude)) * 32767)
            frames.extend(pcm.to_bytes(2, "little", signed=True))

        wav_file.writeframes(bytes(frames))

    return output.getvalue()


def build_vocalish_wav_bytes(
    *,
    duration_ms: int | None = None,
    base_frequency_hz: float = 440.0,
    amplitude: float = 0.22,
    sample_rate: int = 32000,
    segments: list[VocalSegment] | None = None,
    seed: int = 7,
) -> bytes:
    normalized_segments = segments or [VocalSegment(duration_ms=duration_ms or 1000)]
    total_duration_ms = duration_ms or sum(segment.duration_ms for segment in normalized_segments)
    frame_count = max(1, round(sample_rate * (total_duration_ms / 1000)))
    output = BytesIO()
    random = Random(seed)
    segment_boundaries: list[tuple[int, VocalSegment]] = []
    elapsed_ms = 0
    for segment in normalized_segments:
        elapsed_ms += max(1, segment.duration_ms)
        segment_boundaries.append((elapsed_ms, segment))

    harmonic_weights = (1.0, 0.52, 0.27, 0.16)
    harmonic_weight_sum = sum(harmonic_weights)
    phase = 0.0

    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)

        frames = bytearray()
        for frame_index in range(frame_count):
            current_ms = (frame_index * 1000) / sample_rate
            boundary_start_ms = 0
            active_segment = normalized_segments[-1]
            for boundary_end_ms, segment in segment_boundaries:
                if current_ms < boundary_end_ms:
                    active_segment = segment
                    break
                boundary_start_ms = boundary_end_ms

            local_duration_ms = max(1.0, float(active_segment.duration_ms))
            local_progress = min(
                1.0,
                max(0.0, (current_ms - boundary_start_ms) / local_duration_ms),
            )
            cents = active_segment.start_cents + (
                (active_segment.end_cents - active_segment.start_cents) * local_progress
            )
            if active_segment.vibrato_cents:
                local_time_seconds = (current_ms - boundary_start_ms) / 1000
                cents += active_segment.vibrato_cents * math.sin(
                    2 * math.pi * active_segment.vibrato_hz * local_time_seconds
                )

            frequency_hz = base_frequency_hz * (2 ** (cents / 1200))
            phase += (2 * math.pi * frequency_hz) / sample_rate

            voiced_sample = 0.0
            for harmonic_index, harmonic_weight in enumerate(harmonic_weights, start=1):
                voiced_sample += harmonic_weight * math.sin(phase * harmonic_index)
            voiced_sample /= harmonic_weight_sum

            noise_sample = ((random.random() * 2.0) - 1.0) * active_segment.breath_noise
            voiced_mix = max(0.0, min(1.0, active_segment.voiced_mix))
            blended_sample = (voiced_sample * voiced_mix) + noise_sample

            attack_envelope = min(1.0, frame_index / max(1, int(sample_rate * 0.015)))
            release_distance = frame_count - frame_index - 1
            release_envelope = min(1.0, release_distance / max(1, int(sample_rate * 0.02)))
            envelope = min(attack_envelope, release_envelope, 1.0)

            pcm = int(max(-1.0, min(1.0, blended_sample * amplitude * envelope)) * 32767)
            frames.extend(pcm.to_bytes(2, "little", signed=True))

        wav_file.writeframes(bytes(frames))

    return output.getvalue()


def _build_guide_centered_vocalish() -> bytes:
    return build_vocalish_wav_bytes(
        base_frequency_hz=440.0,
        segments=[VocalSegment(duration_ms=1500, vibrato_cents=2.5, vibrato_hz=5.1, breath_noise=0.01)],
    )


def _build_take_sharp_attack_vocalish() -> bytes:
    return build_vocalish_wav_bytes(
        base_frequency_hz=440.0,
        segments=[
            VocalSegment(
                duration_ms=260,
                start_cents=32.0,
                end_cents=12.0,
                breath_noise=0.12,
                voiced_mix=0.82,
            ),
            VocalSegment(
                duration_ms=1240,
                start_cents=10.0,
                end_cents=1.0,
                vibrato_cents=4.0,
                vibrato_hz=5.4,
                breath_noise=0.02,
            ),
        ],
    )


def _build_take_flat_sustain_vocalish() -> bytes:
    return build_vocalish_wav_bytes(
        base_frequency_hz=440.0,
        segments=[
            VocalSegment(duration_ms=220, start_cents=-4.0, end_cents=-8.0, breath_noise=0.08, voiced_mix=0.9),
            VocalSegment(
                duration_ms=1280,
                start_cents=-22.0,
                end_cents=-28.0,
                vibrato_cents=5.0,
                vibrato_hz=4.8,
                breath_noise=0.02,
            ),
        ],
    )


def _build_take_centered_vibrato_vocalish() -> bytes:
    return build_vocalish_wav_bytes(
        base_frequency_hz=440.0,
        segments=[
            VocalSegment(
                duration_ms=1500,
                start_cents=0.0,
                end_cents=0.0,
                vibrato_cents=16.0,
                vibrato_hz=5.7,
                breath_noise=0.025,
            )
        ],
    )


def _build_take_portamento_toward_center_vocalish() -> bytes:
    return build_vocalish_wav_bytes(
        base_frequency_hz=440.0,
        segments=[
            VocalSegment(duration_ms=360, start_cents=-42.0, end_cents=-5.0, breath_noise=0.05),
            VocalSegment(duration_ms=1140, start_cents=-4.0, end_cents=0.0, vibrato_cents=3.5, breath_noise=0.02),
        ],
    )


def _build_take_overshoot_then_settle_vocalish() -> bytes:
    return build_vocalish_wav_bytes(
        base_frequency_hz=440.0,
        segments=[
            VocalSegment(duration_ms=180, start_cents=38.0, end_cents=18.0, breath_noise=0.06),
            VocalSegment(duration_ms=240, start_cents=18.0, end_cents=2.0, breath_noise=0.03),
            VocalSegment(duration_ms=1080, start_cents=2.0, end_cents=0.0, vibrato_cents=3.0, breath_noise=0.015),
        ],
    )


def _build_take_breathy_onset_vocalish() -> bytes:
    return build_vocalish_wav_bytes(
        base_frequency_hz=440.0,
        segments=[
            VocalSegment(duration_ms=160, breath_noise=0.22, voiced_mix=0.42),
            VocalSegment(duration_ms=1340, breath_noise=0.03, voiced_mix=0.98, vibrato_cents=4.0),
        ],
    )


def _build_steady_sine_440() -> bytes:
    return build_test_wav_bytes(duration_ms=1500, frequency_hz=440.0, amplitude=0.2, sample_rate=32000)


NamedAudioFixtureBuilder = Callable[[], bytes]

NAMED_AUDIO_FIXTURES: dict[str, NamedAudioFixtureBuilder] = {
    "guide_centered_vocalish": _build_guide_centered_vocalish,
    "take_sharp_attack_vocalish": _build_take_sharp_attack_vocalish,
    "take_flat_sustain_vocalish": _build_take_flat_sustain_vocalish,
    "take_centered_vibrato_vocalish": _build_take_centered_vibrato_vocalish,
    "take_portamento_toward_center_vocalish": _build_take_portamento_toward_center_vocalish,
    "take_overshoot_then_settle_vocalish": _build_take_overshoot_then_settle_vocalish,
    "take_breathy_onset_vocalish": _build_take_breathy_onset_vocalish,
    "steady_sine_440": _build_steady_sine_440,
}


def list_named_audio_fixtures() -> list[str]:
    return sorted(NAMED_AUDIO_FIXTURES)


def build_named_audio_fixture(name: str) -> bytes:
    try:
        builder = NAMED_AUDIO_FIXTURES[name]
    except KeyError as error:
        raise KeyError(
            f"Unknown audio fixture '{name}'. Available fixtures: {', '.join(list_named_audio_fixtures())}"
        ) from error
    return builder()
