from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import wave

from pydantic import BaseModel, Field

from gigastudy_api.services.audio_fixture_library import build_named_audio_fixture
from gigastudy_api.services.calibration import AudioSourceSpec, CalibrationCorpus
from gigastudy_api.services.human_rating_builder import HumanRatingMetadataCorpus


class AudioSourceInventory(BaseModel):
    source_kind: str
    reference: str
    uses_real_audio: bool
    exists: bool
    duration_seconds: float | None = None
    sample_rate: int | None = None
    channel_count: int | None = None
    frame_count: int | None = None
    file_size_bytes: int | None = None
    error: str | None = None


class HumanRatingCoverage(BaseModel):
    rated_note_count: int = Field(ge=0)
    total_rater_count: int = Field(ge=0)
    max_raters_per_note: int = Field(ge=0)
    minimum_human_agreement_ratio: float | None = None


class CorpusCaseInventory(BaseModel):
    case_id: str
    description: str
    project_title: str
    guide_source: AudioSourceInventory
    take_source: AudioSourceInventory
    uses_real_audio: bool
    all_sources_resolved: bool
    human_rating_coverage: HumanRatingCoverage


class CorpusInventorySummary(BaseModel):
    total_cases: int = Field(ge=0)
    cases_using_real_audio: int = Field(ge=0)
    fixture_source_count: int = Field(ge=0)
    resolved_source_count: int = Field(ge=0)
    missing_source_count: int = Field(ge=0)
    invalid_source_count: int = Field(ge=0)
    cases_with_human_ratings: int = Field(ge=0)
    total_rated_notes: int = Field(ge=0)
    all_sources_resolved: bool


class CorpusInventoryReport(BaseModel):
    corpus_id: str
    description: str
    evidence_kind: str
    source_document: str | None = None
    summary: CorpusInventorySummary
    cases: list[CorpusCaseInventory]


@dataclass
class _CaseLike:
    case_id: str
    description: str
    project_title: str
    guide_source: AudioSourceSpec
    take_source: AudioSourceSpec
    human_ratings: list[object]
    minimum_human_agreement_ratio: float | None


def _inspect_wave_bytes(raw_bytes: bytes) -> tuple[float, int, int, int]:
    with wave.open(BytesIO(raw_bytes), "rb") as handle:
        frame_count = handle.getnframes()
        sample_rate = handle.getframerate()
        channel_count = handle.getnchannels()
        duration_seconds = frame_count / sample_rate if sample_rate else 0.0
    return duration_seconds, sample_rate, channel_count, frame_count


def _inspect_audio_source(source: AudioSourceSpec, base_dir: Path | None) -> AudioSourceInventory:
    if source.source_kind == "named_fixture":
        assert source.fixture_name is not None
        raw_bytes = build_named_audio_fixture(source.fixture_name)
        duration_seconds, sample_rate, channel_count, frame_count = _inspect_wave_bytes(raw_bytes)
        return AudioSourceInventory(
            source_kind=source.source_kind,
            reference=f"fixture:{source.fixture_name}",
            uses_real_audio=False,
            exists=True,
            duration_seconds=round(duration_seconds, 4),
            sample_rate=sample_rate,
            channel_count=channel_count,
            frame_count=frame_count,
            file_size_bytes=len(raw_bytes),
        )

    assert source.wav_path is not None
    wav_path = Path(source.wav_path)
    if not wav_path.is_absolute():
        wav_path = (base_dir or Path.cwd()) / wav_path
    resolved_path = wav_path.resolve()
    if not resolved_path.exists():
        return AudioSourceInventory(
            source_kind=source.source_kind,
            reference=str(resolved_path),
            uses_real_audio=True,
            exists=False,
            error="missing_audio_file",
        )

    raw_bytes = resolved_path.read_bytes()
    try:
        duration_seconds, sample_rate, channel_count, frame_count = _inspect_wave_bytes(raw_bytes)
        return AudioSourceInventory(
            source_kind=source.source_kind,
            reference=str(resolved_path),
            uses_real_audio=True,
            exists=True,
            duration_seconds=round(duration_seconds, 4),
            sample_rate=sample_rate,
            channel_count=channel_count,
            frame_count=frame_count,
            file_size_bytes=len(raw_bytes),
        )
    except wave.Error as exc:
        return AudioSourceInventory(
            source_kind=source.source_kind,
            reference=str(resolved_path),
            uses_real_audio=True,
            exists=True,
            file_size_bytes=len(raw_bytes),
            error=f"invalid_wav:{exc}",
        )


def _iter_case_like_from_corpus(corpus: CalibrationCorpus) -> list[_CaseLike]:
    return [
        _CaseLike(
            case_id=case.case_id,
            description=case.description,
            project_title=case.project_title,
            guide_source=case.guide_source,
            take_source=case.take_source,
            human_ratings=list(case.human_ratings),
            minimum_human_agreement_ratio=case.minimum_human_agreement_ratio,
        )
        for case in corpus.cases
    ]


def _iter_case_like_from_metadata(metadata: HumanRatingMetadataCorpus) -> list[_CaseLike]:
    return [
        _CaseLike(
            case_id=case.case_id,
            description=case.description,
            project_title=case.project_title,
            guide_source=case.guide_source,
            take_source=case.take_source,
            human_ratings=[],
            minimum_human_agreement_ratio=case.minimum_human_agreement_ratio,
        )
        for case in metadata.cases
    ]


def _build_inventory_report(
    *,
    corpus_id: str,
    description: str,
    evidence_kind: str,
    source_document: Path | None,
    cases: list[_CaseLike],
    base_dir: Path | None,
) -> CorpusInventoryReport:
    case_items: list[CorpusCaseInventory] = []

    for case in cases:
        guide_source = _inspect_audio_source(case.guide_source, base_dir)
        take_source = _inspect_audio_source(case.take_source, base_dir)
        human_rating_coverage = HumanRatingCoverage(
            rated_note_count=len(case.human_ratings),
            total_rater_count=sum(int(getattr(note, "rater_count", 0) or 0) for note in case.human_ratings),
            max_raters_per_note=max(
                (int(getattr(note, "rater_count", 0) or 0) for note in case.human_ratings),
                default=0,
            ),
            minimum_human_agreement_ratio=case.minimum_human_agreement_ratio,
        )
        case_items.append(
            CorpusCaseInventory(
                case_id=case.case_id,
                description=case.description,
                project_title=case.project_title,
                guide_source=guide_source,
                take_source=take_source,
                uses_real_audio=guide_source.uses_real_audio or take_source.uses_real_audio,
                all_sources_resolved=(
                    guide_source.exists
                    and take_source.exists
                    and guide_source.error is None
                    and take_source.error is None
                ),
                human_rating_coverage=human_rating_coverage,
            )
        )

    source_items = [case.guide_source for case in case_items] + [case.take_source for case in case_items]
    summary = CorpusInventorySummary(
        total_cases=len(case_items),
        cases_using_real_audio=sum(1 for case in case_items if case.uses_real_audio),
        fixture_source_count=sum(1 for source in source_items if not source.uses_real_audio),
        resolved_source_count=sum(
            1 for source in source_items if source.exists and source.error is None
        ),
        missing_source_count=sum(1 for source in source_items if not source.exists),
        invalid_source_count=sum(1 for source in source_items if source.error is not None),
        cases_with_human_ratings=sum(1 for case in case_items if case.human_rating_coverage.rated_note_count > 0),
        total_rated_notes=sum(case.human_rating_coverage.rated_note_count for case in case_items),
        all_sources_resolved=all(case.all_sources_resolved for case in case_items),
    )
    return CorpusInventoryReport(
        corpus_id=corpus_id,
        description=description,
        evidence_kind=evidence_kind,
        source_document=str(source_document.resolve()) if source_document is not None else None,
        summary=summary,
        cases=case_items,
    )


def inspect_calibration_corpus(
    corpus: CalibrationCorpus,
    *,
    manifest_path: Path | None = None,
) -> CorpusInventoryReport:
    return _build_inventory_report(
        corpus_id=corpus.corpus_id,
        description=corpus.description,
        evidence_kind=corpus.evidence_kind,
        source_document=manifest_path,
        cases=_iter_case_like_from_corpus(corpus),
        base_dir=manifest_path.parent if manifest_path is not None else None,
    )


def inspect_human_rating_metadata(
    metadata: HumanRatingMetadataCorpus,
    *,
    metadata_path: Path | None = None,
) -> CorpusInventoryReport:
    return _build_inventory_report(
        corpus_id=metadata.corpus_id,
        description=metadata.description,
        evidence_kind=metadata.evidence_kind,
        source_document=metadata_path,
        cases=_iter_case_like_from_metadata(metadata),
        base_dir=metadata_path.parent if metadata_path is not None else None,
    )


def render_corpus_inventory_markdown(report: CorpusInventoryReport) -> str:
    lines = [
        f"# Corpus Inventory: {report.corpus_id}",
        "",
        f"- Description: {report.description}",
        f"- Evidence kind: {report.evidence_kind}",
        f"- Source document: {report.source_document or 'inline'}",
        f"- Cases: {report.summary.total_cases}",
        f"- Cases using real audio: {report.summary.cases_using_real_audio}",
        f"- Fixture sources: {report.summary.fixture_source_count}",
        f"- Resolved sources: {report.summary.resolved_source_count}",
        f"- Missing sources: {report.summary.missing_source_count}",
        f"- Invalid sources: {report.summary.invalid_source_count}",
        f"- Cases with ratings: {report.summary.cases_with_human_ratings}",
        f"- Rated notes: {report.summary.total_rated_notes}",
        f"- All sources resolved: {'yes' if report.summary.all_sources_resolved else 'no'}",
        "",
        "## Cases",
        "",
    ]

    for case in report.cases:
        lines.append(f"### {case.case_id}")
        lines.append(f"- Description: {case.description}")
        lines.append(f"- Project title: {case.project_title}")
        lines.append(f"- Uses real audio: {'yes' if case.uses_real_audio else 'no'}")
        lines.append(f"- All sources resolved: {'yes' if case.all_sources_resolved else 'no'}")
        lines.append(
            "- Guide source: "
            f"{case.guide_source.reference} "
            f"(duration={case.guide_source.duration_seconds}, "
            f"sample_rate={case.guide_source.sample_rate}, "
            f"channels={case.guide_source.channel_count}, "
            f"error={case.guide_source.error})"
        )
        lines.append(
            "- Take source: "
            f"{case.take_source.reference} "
            f"(duration={case.take_source.duration_seconds}, "
            f"sample_rate={case.take_source.sample_rate}, "
            f"channels={case.take_source.channel_count}, "
            f"error={case.take_source.error})"
        )
        lines.append(
            "- Human-rating coverage: "
            f"rated_notes={case.human_rating_coverage.rated_note_count}, "
            f"total_raters={case.human_rating_coverage.total_rater_count}, "
            f"max_raters_per_note={case.human_rating_coverage.max_raters_per_note}, "
            f"minimum_agreement={case.human_rating_coverage.minimum_human_agreement_ratio}"
        )
        lines.append("")

    return "\n".join(lines).strip() + "\n"
