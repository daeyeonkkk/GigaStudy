from io import BytesIO
import math
from random import Random
import wave
from dataclasses import dataclass


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
