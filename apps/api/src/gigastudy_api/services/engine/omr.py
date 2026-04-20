from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class OmrUnavailableError(RuntimeError):
    pass


def run_audiveris_omr(
    *,
    input_path: Path,
    output_dir: Path,
    audiveris_bin: str | None,
    timeout_seconds: int,
) -> Path:
    binary = audiveris_bin or shutil.which("audiveris")
    if not binary:
        raise OmrUnavailableError("Audiveris CLI is not configured on this machine.")

    output_dir.mkdir(parents=True, exist_ok=True)
    command = [
        binary,
        "-batch",
        "-transcribe",
        "-export",
        "-output",
        str(output_dir),
        "--",
        str(input_path),
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Audiveris failed."
        raise OmrUnavailableError(message)

    mxl_files = sorted(output_dir.rglob("*.mxl"))
    xml_files = sorted(output_dir.rglob("*.xml"))
    outputs = mxl_files or xml_files
    if not outputs:
        raise OmrUnavailableError("Audiveris did not produce a MusicXML output.")
    return outputs[0]
