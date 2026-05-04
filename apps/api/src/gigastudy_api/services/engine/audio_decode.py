from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from gigastudy_api.services.engine.voice import VoiceTranscriptionError


@dataclass(frozen=True)
class VoiceAnalysisAudio:
    path: Path
    converted: bool
    original_suffix: str


def prepare_voice_analysis_wav(source_path: Path, *, timeout_seconds: int = 120) -> VoiceAnalysisAudio:
    """Return a WAV file path that the voice extractor can read."""

    suffix = source_path.suffix.lower()
    if suffix == ".wav":
        return VoiceAnalysisAudio(path=source_path, converted=False, original_suffix=suffix)
    if not source_path.exists() or not source_path.is_file():
        raise VoiceTranscriptionError("Uploaded audio source was not found.")

    output_path = _temporary_wav_path(source_path)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-sample_fmt",
        "s16",
        str(output_path),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout_seconds,
        )
    except FileNotFoundError as error:
        _remove_temp_file(output_path)
        raise VoiceTranscriptionError(
            "Audio decoder is not available. Server runtime must include ffmpeg for MP3/M4A/OGG/FLAC analysis."
        ) from error
    except subprocess.TimeoutExpired as error:
        _remove_temp_file(output_path)
        raise VoiceTranscriptionError("Audio decoding timed out before voice analysis could start.") from error

    if completed.returncode != 0:
        _remove_temp_file(output_path)
        detail = (completed.stderr or completed.stdout or "").strip()
        if len(detail) > 240:
            detail = detail[:237].rstrip() + "..."
        raise VoiceTranscriptionError(f"Audio decoding failed: {detail or 'unsupported or damaged audio file.'}")

    if not output_path.exists() or output_path.stat().st_size <= 0:
        _remove_temp_file(output_path)
        raise VoiceTranscriptionError("Audio decoding did not produce a readable WAV file.")

    return VoiceAnalysisAudio(path=output_path, converted=True, original_suffix=suffix)


def cleanup_voice_analysis_audio(audio: VoiceAnalysisAudio) -> None:
    if audio.converted:
        _remove_temp_file(audio.path)


def _temporary_wav_path(source_path: Path) -> Path:
    safe_stem = "".join(character if character.isalnum() else "-" for character in source_path.stem).strip("-")
    safe_stem = safe_stem[:32] or "voice"
    with tempfile.NamedTemporaryFile(prefix=f"gigastudy-{safe_stem}-", suffix=".wav", delete=False) as handle:
        return Path(handle.name)


def _remove_temp_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        return
