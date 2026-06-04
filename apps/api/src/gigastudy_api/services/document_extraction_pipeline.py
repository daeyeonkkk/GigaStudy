from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from gigastudy_api.config import get_settings
from gigastudy_api.api.schemas.studios import SourceKind, Studio
from gigastudy_api.services.asset_storage import AssetStorageError
from gigastudy_api.services.engine.audiveris_document import AudiverisDocumentError
from gigastudy_api.services.engine.document_quality import (
    assess_document_symbolic_quality,
    public_document_quality_message,
)
from gigastudy_api.services.engine.document_results import write_pdf_vector_document_summary
from gigastudy_api.services.engine.pdf_vector_document import PdfVectorDocumentError
from gigastudy_api.services.engine.pdf_preflight import (
    PDF_NOT_SCORE_MESSAGE,
    inspect_pdf_for_score_content,
)
from gigastudy_api.services.engine.symbolic import (
    ParsedSymbolicFile,
    SymbolicParseError,
    parse_symbolic_file_with_metadata,
)
from gigastudy_api.services.engine_queue import EngineQueueJob
from gigastudy_api.services.upload_policy import SYMBOLIC_SOURCE_SUFFIXES


@dataclass(frozen=True)
class DocumentExtractionPipelineResult:
    parsed_symbolic: ParsedSymbolicFile
    output_reference: str
    candidate_method: str
    extraction_method: str
    job_method: str
    confidence: float
    message: str
    registered_source_kind: SourceKind = "document"
    direct_register_when_clear: bool = False
    diagnostics: dict[str, object] = field(default_factory=dict)


class DocumentExtractionPipelineError(RuntimeError):
    """Expected document extraction failure with a user-facing job message."""

    def __init__(self, message: str, *, diagnostics: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics or {}


def run_document_extraction_pipeline(
    *,
    audiveris_bin: str | None,
    audiveris_runner: Callable[..., Path],
    backend: str,
    input_path: Path,
    job_output_dir: Path,
    job_slot_id: int,
    persist_generated_asset: Callable[[Path], str],
    record: EngineQueueJob,
    source_label: str,
    studio: Studio,
    timeout_seconds: int,
    vector_parser: Callable[..., ParsedSymbolicFile],
) -> DocumentExtractionPipelineResult:
    normalized_backend = backend.strip().lower()
    parse_all_parts = bool(record.payload.get("parse_all_parts"))
    preflight = None
    attempts: list[dict[str, object]] = []

    try:
        if input_path.suffix.lower() in SYMBOLIC_SOURCE_SUFFIXES:
            return _run_symbolic_seed_pipeline(
                input_path=input_path,
                record=record,
                studio=studio,
            )

        if input_path.suffix.lower() == ".pdf":
            preflight = inspect_pdf_for_score_content(input_path)
            if preflight.kind == "text_only":
                raise DocumentExtractionPipelineError(
                    PDF_NOT_SCORE_MESSAGE,
                    diagnostics={"pdf_preflight": preflight.diagnostics()},
                )

        if normalized_backend in {"pdf_vector", "vector_pdf"}:
            parsed_symbolic, output_reference = _run_pdf_vector_fallback(
                input_path=input_path,
                job_output_dir=job_output_dir,
                persist_generated_asset=persist_generated_asset,
                primary_error="Vector document extraction mode.",
                source_label=source_label,
                studio=studio,
                vector_parser=vector_parser,
            )
            return _quality_checked_pdf_result(
                parsed_symbolic,
                output_reference,
                attempts=attempts,
                candidate_method="pdf_vector_document_review",
                extraction_method="pdf_vector_document_v2",
                job_method="pdf_vector_document",
                message="악보 PDF에서 읽은 파트를 확인한 뒤 등록할 수 있습니다.",
                preflight=preflight,
            )

        if (
            input_path.suffix.lower() == ".pdf"
            and normalized_backend in {"auto", "vector_first"}
            and (normalized_backend == "vector_first" or preflight is None or preflight.kind == "born_digital_score")
        ):
            try:
                parsed_symbolic, output_reference = _run_pdf_vector_fallback(
                    input_path=input_path,
                    job_output_dir=job_output_dir,
                    persist_generated_asset=persist_generated_asset,
                    primary_error="Born-digital score PDF path.",
                    source_label=source_label,
                    studio=studio,
                    vector_parser=vector_parser,
                )
                return _quality_checked_pdf_result(
                    parsed_symbolic,
                    output_reference,
                    attempts=attempts,
                    candidate_method="pdf_vector_document_review",
                    extraction_method="pdf_vector_document_v2",
                    job_method="pdf_vector_document",
                    message="악보 PDF에서 읽은 파트를 확인한 뒤 등록할 수 있습니다.",
                    preflight=preflight,
                )
            except DocumentExtractionPipelineError:
                # The quality helper has already appended the failed vector attempt.
                pass
            except (PdfVectorDocumentError, AssetStorageError) as error:
                attempts.append({"method": "pdf_vector_document", "passed": False, "reason": str(error)[:160]})

        return _run_audiveris_pipeline(
            audiveris_bin=audiveris_bin,
            audiveris_runner=audiveris_runner,
            input_path=input_path,
            job_output_dir=job_output_dir,
            job_slot_id=job_slot_id,
            parse_all_parts=parse_all_parts,
            persist_generated_asset=persist_generated_asset,
            preflight=preflight,
            previous_attempts=attempts,
            studio=studio,
            timeout_seconds=timeout_seconds,
        )
    except (AudiverisDocumentError, SymbolicParseError) as primary_error:
        if normalized_backend == "audiveris" or input_path.suffix.lower() != ".pdf":
            raise DocumentExtractionPipelineError(
                _public_document_extraction_error(primary_error),
                diagnostics={
                    "pdf_preflight": preflight.diagnostics() if preflight else None,
                    "document_quality": {"attempts": attempts},
                },
            ) from primary_error
        try:
            parsed_symbolic, output_reference = _run_pdf_vector_fallback(
                input_path=input_path,
                job_output_dir=job_output_dir,
                persist_generated_asset=persist_generated_asset,
                primary_error=str(primary_error),
                source_label=source_label,
                studio=studio,
                vector_parser=vector_parser,
            )
            attempts.append({"method": "document_recognition", "passed": False, "reason": str(primary_error)[:160]})
            return _quality_checked_pdf_result(
                parsed_symbolic,
                output_reference,
                attempts=attempts,
                candidate_method="pdf_vector_document_review",
                extraction_method="pdf_vector_document_v2",
                job_method="pdf_vector_document",
                message="악보 PDF에서 읽은 파트를 확인한 뒤 등록할 수 있습니다.",
                preflight=preflight,
            )
        except (PdfVectorDocumentError, AssetStorageError) as fallback_error:
            raise DocumentExtractionPipelineError(
                _public_document_extraction_error(primary_error, fallback_error),
                diagnostics={
                    "pdf_preflight": preflight.diagnostics() if preflight else None,
                    "document_quality": {"attempts": attempts},
                },
            ) from fallback_error
    except (PdfVectorDocumentError, AssetStorageError) as error:
        raise DocumentExtractionPipelineError(
            _public_document_extraction_error(error),
            diagnostics={
                "pdf_preflight": preflight.diagnostics() if preflight else None,
                "document_quality": {"attempts": attempts},
            },
        ) from error


def _run_symbolic_seed_pipeline(
    *,
    input_path: Path,
    record: EngineQueueJob,
    studio: Studio,
) -> DocumentExtractionPipelineResult:
    suffix = input_path.suffix.lower()
    parsed_symbolic = parse_symbolic_file_with_metadata(input_path, bpm=studio.bpm)
    if suffix in {".mid", ".midi"} and bool(record.payload.get("use_source_tempo")):
        if parsed_symbolic.source_bpm is not None:
            parsed_symbolic = parse_symbolic_file_with_metadata(
                input_path,
                bpm=parsed_symbolic.source_bpm,
            )

    if suffix in {".mid", ".midi"}:
        return DocumentExtractionPipelineResult(
            parsed_symbolic=parsed_symbolic,
            output_reference=str(record.payload.get("input_path") or input_path.name),
            candidate_method="midi_seed_review",
            extraction_method="midi_seed_v1",
            job_method="midi_seed_import",
            confidence=0.78,
            message="MIDI parts need review before registration.",
            registered_source_kind="midi",
            direct_register_when_clear=True,
        )

    return DocumentExtractionPipelineResult(
        parsed_symbolic=parsed_symbolic,
        output_reference=str(record.payload.get("input_path") or input_path.name),
        candidate_method="musicxml_seed_review",
        extraction_method="musicxml_seed_v1",
        job_method="musicxml_seed_import",
        confidence=0.74,
        message="Score parts need review before registration.",
        registered_source_kind="document",
        direct_register_when_clear=True,
    )


def _quality_checked_pdf_result(
    parsed_symbolic: ParsedSymbolicFile,
    output_reference: str,
    *,
    attempts: list[dict[str, object]],
    candidate_method: str,
    extraction_method: str,
    job_method: str,
    message: str,
    preflight: object | None,
) -> DocumentExtractionPipelineResult:
    settings = get_settings()
    assessment = assess_document_symbolic_quality(
        parsed_symbolic,
        min_score=settings.document_quality_min_score,
        selected_method=extraction_method,
    )
    attempts.append(
        {
            "method": extraction_method,
            "passed": assessment.passed,
            "score": assessment.score,
            "reason": assessment.reason,
        }
    )
    diagnostics = {
        "document_quality": {
            **assessment.diagnostics(),
            "attempts": list(attempts),
        },
    }
    if preflight is not None and hasattr(preflight, "diagnostics"):
        diagnostics["pdf_preflight"] = preflight.diagnostics()
    if not assessment.passed:
        raise DocumentExtractionPipelineError(
            public_document_quality_message(assessment.reason),
            diagnostics=diagnostics,
        )
    return DocumentExtractionPipelineResult(
        parsed_symbolic=parsed_symbolic,
        output_reference=output_reference,
        candidate_method=candidate_method,
        extraction_method=extraction_method,
        job_method=job_method,
        confidence=max(0.44, min(0.72, assessment.score)),
        message=message,
        diagnostics=diagnostics,
    )


def _run_audiveris_pipeline(
    *,
    audiveris_bin: str | None,
    audiveris_runner: Callable[..., Path],
    input_path: Path,
    job_output_dir: Path,
    job_slot_id: int,
    parse_all_parts: bool,
    persist_generated_asset: Callable[[Path], str],
    preflight: object | None = None,
    previous_attempts: list[dict[str, object]] | None = None,
    studio: Studio,
    timeout_seconds: int,
) -> DocumentExtractionPipelineResult:
    output_path = audiveris_runner(
        input_path=input_path,
        output_dir=job_output_dir,
        audiveris_bin=audiveris_bin,
        timeout_seconds=timeout_seconds,
    )
    parsed_symbolic = parse_symbolic_file_with_metadata(
        output_path,
        bpm=studio.bpm,
        target_slot_id=None if parse_all_parts else job_slot_id,
    )
    output_reference = persist_generated_asset(output_path)
    return _quality_checked_pdf_result(
        parsed_symbolic=parsed_symbolic,
        output_reference=output_reference,
        attempts=list(previous_attempts or []),
        candidate_method="audiveris_document_review",
        extraction_method="document_recognition_v2",
        job_method="audiveris_cli",
        message="악보 PDF에서 읽은 파트를 확인한 뒤 등록할 수 있습니다.",
        preflight=preflight,
    )


def _run_pdf_vector_fallback(
    *,
    input_path: Path,
    job_output_dir: Path,
    persist_generated_asset: Callable[[Path], str],
    primary_error: str,
    source_label: str,
    studio: Studio,
    vector_parser: Callable[..., ParsedSymbolicFile],
) -> tuple[ParsedSymbolicFile, str]:
    if input_path.suffix.lower() != ".pdf":
        raise PdfVectorDocumentError("Vector PDF extraction only supports PDF input.")
    parsed_symbolic = vector_parser(
        input_path,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
    )
    output_path = write_pdf_vector_document_summary(
        job_output_dir,
        parsed_symbolic,
        source_label=source_label,
        primary_error=primary_error,
    )
    return parsed_symbolic, persist_generated_asset(output_path)


def _public_document_extraction_error(*errors: BaseException) -> str:
    combined = " ".join(str(error) for error in errors).lower()
    if any(str(error) == PDF_NOT_SCORE_MESSAGE for error in errors):
        return PDF_NOT_SCORE_MESSAGE
    if "제한 시간을 넘었습니다" in combined or "timed out" in combined or "timeout" in combined:
        return "문서 분석 시간이 제한을 넘었습니다. 다시 시도하거나 MIDI/MusicXML 파일을 사용해 주세요."
    if any(term in combined for term in ("memory", "outofmemory", "java heap", "killed", "137", "너무 크거나 복잡")):
        return "문서가 너무 크거나 복잡해서 처리하지 못했습니다. MIDI/MusicXML 파일을 사용해 주세요."
    if "오선이나 음표" in combined or "no labelled" in combined or "no pitch" in combined:
        return PDF_NOT_SCORE_MESSAGE
    return "PDF 악보를 안정적으로 읽지 못했습니다. 더 선명한 악보 PDF, MIDI, MusicXML을 사용해 주세요."
