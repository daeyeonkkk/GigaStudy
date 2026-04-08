from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import subprocess
from tempfile import NamedTemporaryFile

import librosa
import numpy as np

from gigastudy_api.config import get_settings


BASIC_PITCH_SAMPLE_RATE = 22050
BASIC_PITCH_MODEL_VERSION = "basic-pitch-ts-v1.0.1"


@dataclass(frozen=True)
class BasicPitchNote:
    pitch_midi: int
    start_ms: int
    end_ms: int
    amplitude: float


class BasicPitchRunnerError(RuntimeError):
    """Raised when the Basic Pitch helper is unavailable or fails."""


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _script_path() -> Path:
    return _repo_root() / "scripts" / "basic_pitch_transcribe.cjs"


def _prepare_samples(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    mono_samples = np.asarray(samples, dtype=np.float32)
    if sample_rate != BASIC_PITCH_SAMPLE_RATE:
        mono_samples = librosa.resample(
            mono_samples,
            orig_sr=sample_rate,
            target_sr=BASIC_PITCH_SAMPLE_RATE,
        )

    return np.ascontiguousarray(np.clip(mono_samples, -1.0, 1.0), dtype=np.float32)


def extract_basic_pitch_notes(samples: np.ndarray, sample_rate: int) -> tuple[str, list[BasicPitchNote]]:
    settings = get_settings()
    script_path = _script_path()
    if not script_path.exists():
        raise BasicPitchRunnerError(f"Basic Pitch helper script is missing: {script_path}")

    prepared_samples = _prepare_samples(samples, sample_rate)
    temp_path: Path | None = None

    try:
        with NamedTemporaryFile(delete=False, suffix=".f32") as temp_file:
            temp_path = Path(temp_file.name)
            temp_file.write(prepared_samples.tobytes())

        completed = subprocess.run(
            [settings.basic_pitch_node_binary, script_path.as_posix(), temp_path.as_posix()],
            cwd=_repo_root().as_posix(),
            capture_output=True,
            text=True,
            timeout=settings.basic_pitch_timeout_seconds,
            check=False,
        )
    except FileNotFoundError as error:
        raise BasicPitchRunnerError(
            f"Basic Pitch node runtime is unavailable: {settings.basic_pitch_node_binary}"
        ) from error
    except subprocess.TimeoutExpired as error:
        raise BasicPitchRunnerError(
            f"Basic Pitch helper timed out after {settings.basic_pitch_timeout_seconds} seconds."
        ) from error
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()

    if completed.returncode != 0:
        helper_message = (completed.stderr or completed.stdout).strip() or "Basic Pitch helper failed."
        raise BasicPitchRunnerError(helper_message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise BasicPitchRunnerError("Basic Pitch helper returned invalid JSON.") from error

    model_version = str(payload.get("modelVersion") or BASIC_PITCH_MODEL_VERSION)
    note_payloads = payload.get("notes")
    if not isinstance(note_payloads, list):
        raise BasicPitchRunnerError("Basic Pitch helper returned an unexpected notes payload.")

    notes: list[BasicPitchNote] = []
    for item in note_payloads:
        try:
            start_ms = int(round(float(item["startTimeSeconds"]) * 1000))
            end_ms = int(
                round((float(item["startTimeSeconds"]) + float(item["durationSeconds"])) * 1000)
            )
            pitch_midi = int(round(float(item["pitchMidi"])))
            amplitude = float(item.get("amplitude", 0.75))
        except (KeyError, TypeError, ValueError) as error:
            raise BasicPitchRunnerError("Basic Pitch helper returned a malformed note payload.") from error

        if end_ms <= start_ms:
            continue

        notes.append(
            BasicPitchNote(
                pitch_midi=pitch_midi,
                start_ms=start_ms,
                end_ms=end_ms,
                amplitude=amplitude,
            )
        )

    return model_version, notes
