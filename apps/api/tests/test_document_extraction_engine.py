import subprocess
from pathlib import Path
from xml.etree import ElementTree

import pytest

from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.audiveris_document import AudiverisDocumentError, run_audiveris_document_extraction
from gigastudy_api.services.engine.document_quality import assess_document_symbolic_quality
from gigastudy_api.services.engine.pdf_preflight import inspect_pdf_for_score_content
from gigastudy_api.services.engine.pdf_vector_document import (
    _RawDocumentEvent,
    _finalize_track_events,
    _measure_position_for_x,
)
from gigastudy_api.services.engine.symbolic import ParsedSymbolicFile

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None


def test_run_audiveris_document_extraction_converts_timeout_to_unavailable(tmp_path: Path, monkeypatch) -> None:
    def timeout_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=kwargs.get("timeout"))

    monkeypatch.setattr(subprocess, "run", timeout_run)

    with pytest.raises(AudiverisDocumentError, match="문서 분석 시간이 제한 시간을 넘었습니다"):
        run_audiveris_document_extraction(
            input_path=tmp_path / "score.pdf",
            output_dir=tmp_path / "out",
            audiveris_bin=str(tmp_path / "Audiveris"),
            timeout_seconds=7,
        )


@pytest.mark.skipif(fitz is None, reason="PyMuPDF is required for document preprocessing")
def test_run_audiveris_document_extraction_retries_with_preprocessed_pdf(tmp_path: Path, monkeypatch) -> None:
    source_pdf = tmp_path / "scan.pdf"
    document = fitz.open()
    page = document.new_page(width=200, height=120)
    page.insert_text((20, 40), "Soprano")
    document.save(source_pdf)
    document.close()

    calls: list[Path] = []

    def fake_run(command, **kwargs):
        input_path = Path(command[-1])
        calls.append(input_path)
        if len(calls) == 1:
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="primary failed")
        output_dir = Path(command[command.index("-output") + 1])
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "retry.musicxml").write_text("<score-partwise/>", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    output = run_audiveris_document_extraction(
        input_path=source_pdf,
        output_dir=tmp_path / "out",
        audiveris_bin=str(tmp_path / "Audiveris"),
        timeout_seconds=7,
    )

    assert output.name == "retry.musicxml"
    assert calls[0] == source_pdf
    assert calls[1].name == "scan-preprocessed.pdf"
    assert calls[1].exists()


def test_run_audiveris_document_extraction_caps_java_heap(tmp_path: Path, monkeypatch) -> None:
    captured_env: dict[str, str] = {}

    def fake_run(command, **kwargs):
        captured_env.update(kwargs.get("env") or {})
        output_dir = Path(command[command.index("-output") + 1])
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "output.musicxml").write_text("<score-partwise/>", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    run_audiveris_document_extraction(
        input_path=tmp_path / "score.pdf",
        output_dir=tmp_path / "out",
        audiveris_bin=str(tmp_path / "Audiveris"),
        timeout_seconds=7,
    )

    assert "-Xmx640m" in captured_env["JAVA_TOOL_OPTIONS"]


@pytest.mark.skipif(fitz is None, reason="PyMuPDF is required for chunked PDF extraction")
def test_run_audiveris_document_extraction_chunks_long_pdf_and_merges_measures(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("GIGASTUDY_API_DOCUMENT_AUDIVERIS_CHUNK_PAGES", "2")
    get_settings.cache_clear()

    source_pdf = tmp_path / "long-score.pdf"
    document = fitz.open()
    for _ in range(5):
        page = document.new_page(width=200, height=120)
        for offset in range(5):
            y = 40 + offset * 4
            page.draw_line((20, y), (180, y))
    document.save(source_pdf)
    document.close()

    calls: list[Path] = []

    def fake_run(command, **kwargs):
        input_path = Path(command[-1])
        calls.append(input_path)
        output_dir = Path(command[command.index("-output") + 1])
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "chunk.musicxml").write_text(
            """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note></measure></part>
</score-partwise>
""",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    output = run_audiveris_document_extraction(
        input_path=source_pdf,
        output_dir=tmp_path / "out",
        audiveris_bin=str(tmp_path / "Audiveris"),
        timeout_seconds=7,
    )

    get_settings.cache_clear()
    assert output.name == "long-score-merged.musicxml"
    assert len(calls) == 3
    numbers = [
        measure.attrib["number"]
        for measure in ElementTree.parse(output).getroot().findall(".//part/measure")
    ]
    assert numbers == ["1", "2", "3"]


@pytest.mark.skipif(fitz is None, reason="PyMuPDF is required for PDF preflight")
def test_pdf_preflight_classifies_vector_score_pdf(tmp_path: Path) -> None:
    source_pdf = tmp_path / "score.pdf"
    document = fitz.open()
    page = document.new_page(width=240, height=160)
    for offset in range(5):
        y = 60 + offset * 4
        page.draw_line((30, y), (210, y))
    page.draw_line((60, 60), (60, 76))
    page.draw_line((140, 60), (140, 76))
    document.save(source_pdf)
    document.close()

    result = inspect_pdf_for_score_content(source_pdf)

    assert result.kind == "born_digital_score"
    assert result.staff_row_count == 1
    assert result.barline_count >= 2


@pytest.mark.skipif(fitz is None, reason="PyMuPDF is required for PDF preflight")
def test_pdf_preflight_rejects_text_only_pdf(tmp_path: Path) -> None:
    source_pdf = tmp_path / "lyrics.pdf"
    document = fitz.open()
    page = document.new_page(width=240, height=160)
    page.insert_text((20, 60), "Lyrics only document without score notation.", fontsize=12)
    document.save(source_pdf)
    document.close()

    result = inspect_pdf_for_score_content(source_pdf)

    assert result.kind == "text_only"
    assert result.reason == "text_without_score_evidence"


def test_document_quality_gate_rejects_heavy_overlap() -> None:
    events = [
        TrackPitchEvent(
            pitch_midi=72,
            label="C5",
            onset_seconds=0,
            duration_seconds=1,
            beat=1,
            duration_beats=1,
            measure_index=1,
            beat_in_measure=1,
            source="document",
        ),
        TrackPitchEvent(
            pitch_midi=74,
            label="D5",
            onset_seconds=0.2,
            duration_seconds=1,
            beat=1.25,
            duration_beats=1,
            measure_index=1,
            beat_in_measure=1.25,
            source="document",
        ),
    ]
    parsed = ParsedSymbolicFile(tracks=[], mapped_events={1: events})

    assessment = assess_document_symbolic_quality(
        parsed,
        min_score=0.55,
        selected_method="document_recognition_v2",
    )

    assert assessment.passed is False
    assert assessment.reason == "heavy_overlap"


def test_vector_document_positions_stay_inside_measure_grid() -> None:
    _, beat_in_measure = _measure_position_for_x(120, [(0, 100)], 4)

    assert beat_in_measure == 4.75


def test_vector_document_caps_duration_at_measure_boundary() -> None:
    events = _finalize_track_events(
        [
            _RawDocumentEvent(
                slot_id=1,
                page_index=0,
                beat=4.75,
                measure_index=1,
                beat_in_measure=4.75,
                pitch_midi=72,
                confidence=0.62,
            ),
            _RawDocumentEvent(
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

    assert events[0].duration_beats == 0.25
    assert events[0].measure_index == 1
    assert events[0].beat_in_measure == 4.75
