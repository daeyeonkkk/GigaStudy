import subprocess
from pathlib import Path

import pytest

from gigastudy_api.services.engine.omr import OmrUnavailableError, run_audiveris_omr
from gigastudy_api.services.engine.pdf_vector_omr import (
    _RawNote,
    _finalize_track_notes,
    _measure_position_for_x,
)


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


def test_vector_omr_positions_stay_inside_measure_grid() -> None:
    _, beat_in_measure = _measure_position_for_x(120, [(0, 100)], 4)

    assert beat_in_measure == 4.75


def test_vector_omr_caps_duration_at_measure_boundary() -> None:
    notes = _finalize_track_notes(
        [
            _RawNote(
                slot_id=1,
                page_index=0,
                beat=4.75,
                measure_index=1,
                beat_in_measure=4.75,
                pitch_midi=72,
                confidence=0.62,
            ),
            _RawNote(
                slot_id=1,
                page_index=0,
                beat=9,
                measure_index=3,
                beat_in_measure=1,
                pitch_midi=74,
                confidence=0.62,
            ),
        ],
        bpm=120,
        time_signature_numerator=4,
        time_signature_denominator=4,
        beats_per_measure=4,
    )

    assert notes[0].duration_beats == 0.25
    assert notes[0].measure_index == 1
    assert notes[0].beat_in_measure == 4.75
