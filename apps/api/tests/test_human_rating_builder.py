from pathlib import Path

import pytest

from gigastudy_api.services.human_rating_builder import (
    HumanRatingMetadataCorpus,
    HumanRatingSheetRow,
    build_human_rating_corpus,
    load_human_rating_sheet,
    render_human_rating_corpus_json,
)


def test_build_human_rating_corpus_aggregates_consensus_labels() -> None:
    metadata = HumanRatingMetadataCorpus.model_validate(
        {
            "corpus_id": "human-rating-builder-test",
            "description": "Consensus aggregation coverage",
            "evidence_kind": "human_rating_corpus",
            "cases": [
                {
                    "case_id": "case-a",
                    "description": "Case A",
                    "project_title": "Case A",
                    "guide_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "guide_centered_vocalish",
                    },
                    "take_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "take_sharp_attack_vocalish",
                    },
                    "minimum_human_agreement_ratio": 0.67,
                }
            ],
        }
    )
    rows = [
        HumanRatingSheetRow(
            case_id="case-a",
            note_index=0,
            rater_id="r1",
            attack_direction="sharp",
            sustain_direction="centered",
            acceptability_label="review",
            notes="Attack is high.",
        ),
        HumanRatingSheetRow(
            case_id="case-a",
            note_index=0,
            rater_id="r2",
            attack_direction="sharp",
            sustain_direction="centered",
            acceptability_label="review",
            notes="Sustain lands.",
        ),
        HumanRatingSheetRow(
            case_id="case-a",
            note_index=0,
            rater_id="r3",
            attack_direction="flat",
            sustain_direction="centered",
            acceptability_label="review",
            notes="I hear the attack differently.",
        ),
    ]

    corpus = build_human_rating_corpus(metadata, rows, consensus_ratio=0.67)

    note = corpus.cases[0].human_ratings[0]
    assert note.attack_direction == "sharp"
    assert note.sustain_direction == "centered"
    assert note.acceptability_label == "review"
    assert note.rater_count == 3
    assert note.notes is not None
    assert "attack=0.6667" in note.notes

    rendered = render_human_rating_corpus_json(corpus)
    assert '"corpus_id": "human-rating-builder-test"' in rendered
    assert '"attack_direction": "sharp"' in rendered


def test_build_human_rating_corpus_marks_unclear_when_consensus_is_too_low() -> None:
    metadata = HumanRatingMetadataCorpus.model_validate(
        {
            "corpus_id": "human-rating-unclear-test",
            "description": "Low-consensus coverage",
            "cases": [
                {
                    "case_id": "case-a",
                    "description": "Case A",
                    "project_title": "Case A",
                    "guide_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "guide_centered_vocalish",
                    },
                    "take_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "take_sharp_attack_vocalish",
                    },
                }
            ],
        }
    )
    rows = [
        HumanRatingSheetRow(case_id="case-a", note_index=0, rater_id="r1", attack_direction="sharp"),
        HumanRatingSheetRow(case_id="case-a", note_index=0, rater_id="r2", attack_direction="flat"),
        HumanRatingSheetRow(case_id="case-a", note_index=0, rater_id="r3", attack_direction="centered"),
    ]

    corpus = build_human_rating_corpus(metadata, rows, consensus_ratio=0.67)

    assert corpus.cases[0].human_ratings[0].attack_direction == "unclear"


def test_load_human_rating_sheet_reads_template_csv(tmp_path: Path) -> None:
    csv_path = tmp_path / "ratings.csv"
    csv_path.write_text(
        "\n".join(
            [
                "case_id,note_index,rater_id,attack_direction,sustain_direction,acceptability_label,notes",
                "case-a,0,r1,sharp,centered,in_tune,hello",
                "case-a,1,r2,,flat,review,world",
            ]
        ),
        encoding="utf-8",
    )

    rows = load_human_rating_sheet(csv_path)

    assert len(rows) == 2
    assert rows[0].attack_direction == "sharp"
    assert rows[1].attack_direction is None
    assert rows[1].sustain_direction == "flat"


def test_build_human_rating_corpus_rejects_unknown_case_ids() -> None:
    metadata = HumanRatingMetadataCorpus.model_validate(
        {
            "corpus_id": "human-rating-invalid-test",
            "description": "Unknown case coverage",
            "cases": [
                {
                    "case_id": "case-a",
                    "description": "Case A",
                    "project_title": "Case A",
                    "guide_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "guide_centered_vocalish",
                    },
                    "take_source": {
                        "source_kind": "named_fixture",
                        "fixture_name": "take_sharp_attack_vocalish",
                    },
                }
            ],
        }
    )
    rows = [HumanRatingSheetRow(case_id="case-b", note_index=0, rater_id="r1", attack_direction="sharp")]

    with pytest.raises(ValueError, match="unknown case ids"):
        build_human_rating_corpus(metadata, rows)
