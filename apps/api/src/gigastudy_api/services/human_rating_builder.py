from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
import csv
import json
from pathlib import Path

from pydantic import BaseModel, model_validator

from gigastudy_api.services.calibration import (
    AudioSourceSpec,
    CalibrationCase,
    CalibrationCorpus,
    CalibrationExpectation,
    HumanRatingNote,
)


def _normalize_optional_label(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    return normalized


class HumanRatingCaseMetadata(BaseModel):
    case_id: str
    description: str
    project_title: str
    base_key: str = "C"
    bpm: int = 90
    chord_timeline_json: list[dict[str, object]] | None = None
    guide_source: AudioSourceSpec
    take_source: AudioSourceSpec
    expectation: CalibrationExpectation | None = None
    minimum_human_agreement_ratio: float | None = None


class HumanRatingMetadataCorpus(BaseModel):
    corpus_id: str
    description: str
    evidence_kind: str = "human_rating_corpus"
    cases: list[HumanRatingCaseMetadata]


class HumanRatingSheetRow(BaseModel):
    case_id: str
    note_index: int
    rater_id: str
    attack_direction: str | None = None
    sustain_direction: str | None = None
    acceptability_label: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def normalize_labels(self) -> "HumanRatingSheetRow":
        self.attack_direction = _normalize_optional_label(self.attack_direction)
        self.sustain_direction = _normalize_optional_label(self.sustain_direction)
        self.acceptability_label = _normalize_optional_label(self.acceptability_label)
        self.notes = self.notes.strip() if self.notes else None
        return self


def load_human_rating_metadata(metadata_path: Path) -> HumanRatingMetadataCorpus:
    return HumanRatingMetadataCorpus.model_validate_json(metadata_path.read_text(encoding="utf-8"))


def load_human_rating_sheet(sheet_path: Path) -> list[HumanRatingSheetRow]:
    with sheet_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for raw_row in reader:
            rows.append(
                HumanRatingSheetRow(
                    case_id=str(raw_row.get("case_id") or "").strip(),
                    note_index=int(str(raw_row.get("note_index") or "0").strip()),
                    rater_id=str(raw_row.get("rater_id") or "").strip(),
                    attack_direction=raw_row.get("attack_direction"),
                    sustain_direction=raw_row.get("sustain_direction"),
                    acceptability_label=raw_row.get("acceptability_label"),
                    notes=raw_row.get("notes"),
                )
            )
        return rows


def _resolve_consensus(values: list[str | None], threshold: float) -> tuple[str | None, float | None]:
    usable_values = [value for value in values if value]
    if not usable_values:
        return None, None

    counts = Counter(usable_values)
    winner, count = counts.most_common(1)[0]
    agreement_ratio = count / len(usable_values)
    rounded_ratio = round(agreement_ratio, 4)
    threshold_ratio = round(float(threshold), 2)
    if round(agreement_ratio, 2) >= threshold_ratio:
        return winner, rounded_ratio
    return "unclear", rounded_ratio


def _combine_notes(rows: Iterable[HumanRatingSheetRow]) -> str | None:
    normalized_notes: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if not row.notes:
            continue
        if row.notes in seen:
            continue
        seen.add(row.notes)
        normalized_notes.append(row.notes)
    if not normalized_notes:
        return None
    return " | ".join(normalized_notes)


def build_human_rating_corpus(
    metadata: HumanRatingMetadataCorpus,
    rows: list[HumanRatingSheetRow],
    *,
    consensus_ratio: float = 0.67,
) -> CalibrationCorpus:
    if not 0.0 < consensus_ratio <= 1.0:
        raise ValueError("consensus_ratio must be greater than 0.0 and at most 1.0.")

    metadata_case_ids = {case.case_id for case in metadata.cases}
    unknown_case_ids = sorted({row.case_id for row in rows if row.case_id not in metadata_case_ids})
    if unknown_case_ids:
        raise ValueError(f"Rating sheet contains unknown case ids: {', '.join(unknown_case_ids)}.")

    rows_by_case_note: dict[tuple[str, int], list[HumanRatingSheetRow]] = defaultdict(list)
    for row in rows:
        rows_by_case_note[(row.case_id, row.note_index)].append(row)

    calibration_cases: list[CalibrationCase] = []
    for metadata_case in metadata.cases:
        human_ratings: list[HumanRatingNote] = []
        note_indices = sorted(note_index for case_id, note_index in rows_by_case_note if case_id == metadata_case.case_id)
        for note_index in note_indices:
            note_rows = rows_by_case_note[(metadata_case.case_id, note_index)]
            attack_direction, attack_ratio = _resolve_consensus(
                [row.attack_direction for row in note_rows],
                consensus_ratio,
            )
            sustain_direction, sustain_ratio = _resolve_consensus(
                [row.sustain_direction for row in note_rows],
                consensus_ratio,
            )
            acceptability_label, acceptability_ratio = _resolve_consensus(
                [row.acceptability_label for row in note_rows],
                consensus_ratio,
            )
            combined_notes = _combine_notes(note_rows)
            ratio_bits = [
                f"attack={attack_ratio}" if attack_ratio is not None else None,
                f"sustain={sustain_ratio}" if sustain_ratio is not None else None,
                f"acceptability={acceptability_ratio}" if acceptability_ratio is not None else None,
            ]
            ratio_summary = ", ".join(bit for bit in ratio_bits if bit is not None)
            note_summary = combined_notes
            if ratio_summary:
                note_summary = f"{ratio_summary}. {combined_notes}" if combined_notes else ratio_summary

            human_ratings.append(
                HumanRatingNote(
                    note_index=note_index,
                    attack_direction=attack_direction,
                    sustain_direction=sustain_direction,
                    acceptability_label=acceptability_label,
                    rater_count=len({row.rater_id for row in note_rows}),
                    notes=note_summary,
                )
            )

        calibration_cases.append(
            CalibrationCase(
                case_id=metadata_case.case_id,
                description=metadata_case.description,
                project_title=metadata_case.project_title,
                base_key=metadata_case.base_key,
                bpm=metadata_case.bpm,
                chord_timeline_json=metadata_case.chord_timeline_json,
                guide_source=metadata_case.guide_source,
                take_source=metadata_case.take_source,
                expectation=metadata_case.expectation,
                human_ratings=human_ratings,
                minimum_human_agreement_ratio=metadata_case.minimum_human_agreement_ratio,
            )
        )

    return CalibrationCorpus(
        corpus_id=metadata.corpus_id,
        description=metadata.description,
        evidence_kind=metadata.evidence_kind,
        cases=calibration_cases,
    )


def render_human_rating_corpus_json(corpus: CalibrationCorpus) -> str:
    return json.dumps(corpus.model_dump(mode="json"), indent=2)
