import subprocess
from pathlib import Path

import pytest

from gigastudy_api.services.engine.omr import OmrUnavailableError, run_audiveris_omr


def test_run_audiveris_omr_converts_timeout_to_unavailable(tmp_path: Path, monkeypatch) -> None:
    def timeout_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=kwargs.get("timeout"))

    monkeypatch.setattr(subprocess, "run", timeout_run)

    with pytest.raises(OmrUnavailableError, match="Audiveris timed out after 7 seconds"):
        run_audiveris_omr(
            input_path=tmp_path / "score.pdf",
            output_dir=tmp_path / "out",
            audiveris_bin=str(tmp_path / "Audiveris"),
            timeout_seconds=7,
        )
