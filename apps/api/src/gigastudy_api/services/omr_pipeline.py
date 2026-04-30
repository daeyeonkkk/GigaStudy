from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.services.asset_storage import AssetStorageError
from gigastudy_api.services.engine.omr import OmrUnavailableError
from gigastudy_api.services.engine.omr_results import write_pdf_vector_omr_summary
from gigastudy_api.services.engine.pdf_vector_omr import PdfVectorOmrError
from gigastudy_api.services.engine.symbolic import (
    ParsedSymbolicFile,
    SymbolicParseError,
    parse_symbolic_file_with_metadata,
)
from gigastudy_api.services.engine_queue import EngineQueueJob


@dataclass(frozen=True)
class OmrPipelineResult:
    parsed_symbolic: ParsedSymbolicFile
    output_reference: str
    candidate_method: str
    extraction_method: str
    job_method: str
    confidence: float
    message: str


class OmrPipelineError(RuntimeError):
    """Expected OMR pipeline failure with a user-facing job message."""


def run_omr_pipeline(
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
) -> OmrPipelineResult:
    normalized_backend = backend.strip().lower()
    try:
        if normalized_backend in {"pdf_vector", "vector_pdf"}:
            parsed_symbolic, output_reference = _run_pdf_vector_fallback(
                input_path=input_path,
                job_output_dir=job_output_dir,
                persist_generated_asset=persist_generated_asset,
                primary_error="Audiveris skipped because GIGASTUDY_API_OMR_BACKEND=pdf_vector.",
                source_label=source_label,
                studio=studio,
                vector_parser=vector_parser,
            )
            return _pdf_vector_result(parsed_symbolic, output_reference)

        if normalized_backend == "vector_first" and input_path.suffix.lower() == ".pdf":
            try:
                parsed_symbolic, output_reference = _run_pdf_vector_fallback(
                    input_path=input_path,
                    job_output_dir=job_output_dir,
                    persist_generated_asset=persist_generated_asset,
                    primary_error="Vector-first OMR mode.",
                    source_label=source_label,
                    studio=studio,
                    vector_parser=vector_parser,
                )
                return _pdf_vector_result(parsed_symbolic, output_reference)
            except (PdfVectorOmrError, AssetStorageError):
                return _run_audiveris_pipeline(
                    audiveris_bin=audiveris_bin,
                    audiveris_runner=audiveris_runner,
                    input_path=input_path,
                    job_output_dir=job_output_dir,
                    job_slot_id=job_slot_id,
                    parse_all_parts=bool(record.payload.get("parse_all_parts")),
                    persist_generated_asset=persist_generated_asset,
                    studio=studio,
                    timeout_seconds=timeout_seconds,
                )

        return _run_audiveris_pipeline(
            audiveris_bin=audiveris_bin,
            audiveris_runner=audiveris_runner,
            input_path=input_path,
            job_output_dir=job_output_dir,
            job_slot_id=job_slot_id,
            parse_all_parts=bool(record.payload.get("parse_all_parts")),
            persist_generated_asset=persist_generated_asset,
            studio=studio,
            timeout_seconds=timeout_seconds,
        )
    except (OmrUnavailableError, SymbolicParseError) as primary_error:
        if normalized_backend == "audiveris" or input_path.suffix.lower() != ".pdf":
            raise OmrPipelineError(str(primary_error)) from primary_error
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
            return _pdf_vector_result(
                parsed_symbolic,
                output_reference,
                message=(
                    "Audiveris failed or was unavailable; vector PDF extraction produced "
                    "reviewable part candidates."
                ),
            )
        except (PdfVectorOmrError, AssetStorageError) as fallback_error:
            message = f"{primary_error}; PDF vector fallback failed: {fallback_error}"
            raise OmrPipelineError(message) from fallback_error
    except (PdfVectorOmrError, AssetStorageError) as error:
        raise OmrPipelineError(str(error)) from error


def _run_audiveris_pipeline(
    *,
    audiveris_bin: str | None,
    audiveris_runner: Callable[..., Path],
    input_path: Path,
    job_output_dir: Path,
    job_slot_id: int,
    parse_all_parts: bool,
    persist_generated_asset: Callable[[Path], str],
    studio: Studio,
    timeout_seconds: int,
) -> OmrPipelineResult:
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
    return OmrPipelineResult(
        parsed_symbolic=parsed_symbolic,
        output_reference=output_reference,
        candidate_method="audiveris_omr_review",
        extraction_method="audiveris_omr_v0",
        job_method="audiveris_cli",
        confidence=0.55,
        message="OMR result requires user approval before track registration.",
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
        raise PdfVectorOmrError("Vector PDF extraction only supports PDF input.")
    parsed_symbolic = vector_parser(
        input_path,
        bpm=studio.bpm,
        time_signature_numerator=studio.time_signature_numerator,
        time_signature_denominator=studio.time_signature_denominator,
    )
    output_path = write_pdf_vector_omr_summary(
        job_output_dir,
        parsed_symbolic,
        source_label=source_label,
        primary_error=primary_error,
    )
    return parsed_symbolic, persist_generated_asset(output_path)


def _pdf_vector_result(
    parsed_symbolic: ParsedSymbolicFile,
    output_reference: str,
    *,
    message: str = "Vector PDF extraction produced reviewable part candidates.",
) -> OmrPipelineResult:
    return OmrPipelineResult(
        parsed_symbolic=parsed_symbolic,
        output_reference=output_reference,
        candidate_method="pdf_vector_omr_review",
        extraction_method="pdf_vector_omr_v0",
        job_method="pdf_vector_omr",
        confidence=0.46,
        message=message,
    )
