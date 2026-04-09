from __future__ import annotations

from pathlib import Path
import wave

from gigastudy_api.services.calibration import CalibrationCorpus
from gigastudy_api.services.human_rating_builder import HumanRatingMetadataCorpus
from gigastudy_api.services.real_vocal_corpus import (
    inspect_calibration_corpus,
    inspect_human_rating_metadata,
    render_corpus_inventory_markdown,
)


def _write_test_wav(path: Path, *, frame_count: int = 8000, sample_rate: int = 16000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frame_count)


def test_inspect_human_rating_metadata_reports_missing_and_fixture_sources(tmp_path: Path) -> None:
    metadata = HumanRatingMetadataCorpus.model_validate(
        {
            "corpus_id": "metadata-inventory-test",
            "description": "Metadata inventory coverage",
            "cases": [
                {
                    "case_id": "fixture-case",
                    "description": "Fixture-backed",
                    "project_title": "Fixture-backed",
                    "guide_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "guide_centered_vocalish",
                    },
                    "take_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "take_sharp_attack_vocalish",
                    },
                },
                {
                    "case_id": "missing-case",
                    "description": "Missing file",
                    "project_title": "Missing file",
                    "guide_source": {
                        "source_kind": "wav_path",
                        "wav_path": "missing-guide.wav",
                    },
                    "take_source": {
                        "source_kind": "wav_path",
                        "wav_path": "missing-take.wav",
                    },
                },
            ],
        }
    )

    report = inspect_human_rating_metadata(metadata, metadata_path=tmp_path / "metadata.json")

    assert report.summary.total_cases == 2
    assert report.summary.fixture_source_count == 2
    assert report.summary.missing_source_count == 2
    assert report.summary.all_sources_resolved is False
    assert report.cases[1].guide_source.error == "missing_audio_file"


def test_inspect_calibration_corpus_reports_real_audio_and_human_rating_coverage(tmp_path: Path) -> None:
    guide_path = tmp_path / "guide.wav"
    take_path = tmp_path / "take.wav"
    _write_test_wav(guide_path, frame_count=16000)
    _write_test_wav(take_path, frame_count=8000)

    corpus = CalibrationCorpus.model_validate(
        {
            "corpus_id": "real-vocal-inventory-test",
            "description": "Real vocal inventory coverage",
            "evidence_kind": "human_rating_corpus",
            "cases": [
                {
                    "case_id": "case-a",
                    "description": "Case A",
                    "project_title": "Case A",
                    "guide_source": {
                        "source_kind": "wav_path",
                        "wav_path": str(guide_path),
                    },
                    "take_source": {
                        "source_kind": "wav_path",
                        "wav_path": str(take_path),
                    },
                    "human_ratings": [
                        {
                            "note_index": 0,
                            "attack_direction": "sharp",
                            "sustain_direction": "centered",
                            "acceptability_label": "review",
                            "rater_count": 3,
                        },
                        {
                            "note_index": 1,
                            "attack_direction": "centered",
                            "sustain_direction": "centered",
                            "acceptability_label": "in_tune",
                            "rater_count": 2,
                        },
                    ],
                    "minimum_human_agreement_ratio": 0.75,
                }
            ],
        }
    )

    report = inspect_calibration_corpus(corpus, manifest_path=tmp_path / "corpus.json")

    assert report.summary.total_cases == 1
    assert report.summary.cases_using_real_audio == 1
    assert report.summary.missing_source_count == 0
    assert report.summary.total_rated_notes == 2
    assert report.cases[0].guide_source.duration_seconds == 1.0
    assert report.cases[0].take_source.duration_seconds == 0.5
    assert report.cases[0].human_rating_coverage.total_rater_count == 5
    assert report.cases[0].human_rating_coverage.max_raters_per_note == 3

    rendered = render_corpus_inventory_markdown(report)
    assert "Cases using real audio: 1" in rendered
    assert "rated_notes=2" in rendered
