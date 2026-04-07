from io import BytesIO
import math
import wave


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
