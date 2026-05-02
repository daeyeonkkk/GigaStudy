from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from gigastudy_api.config import get_settings

try:
    import fitz
except ImportError:  # pragma: no cover - PyMuPDF is a declared API dependency.
    fitz = None


class AudiverisDocumentError(RuntimeError):
    pass


def run_audiveris_document_extraction(
    *,
    input_path: Path,
    output_dir: Path,
    audiveris_bin: str | None,
    timeout_seconds: int,
) -> Path:
    binary = audiveris_bin or shutil.which("audiveris") or shutil.which("Audiveris")
    if not binary:
        raise AudiverisDocumentError("Audiveris CLI is not configured on this machine.")

    output_dir.mkdir(parents=True, exist_ok=True)
    settings = get_settings()
    try:
        return _run_audiveris_command(
            binary=binary,
            input_path=input_path,
            output_dir=output_dir,
            timeout_seconds=timeout_seconds,
        )
    except AudiverisDocumentError as primary_error:
        if settings.document_preprocess_mode.strip().lower() in {"off", "false", "0"}:
            raise
        if input_path.suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}:
            raise

        try:
            preprocessed_input = _prepare_preprocessed_pdf(
                input_path,
                output_dir=output_dir / "preprocessed",
                dpi=settings.document_preprocess_dpi,
            )
            return _run_audiveris_command(
                binary=binary,
                input_path=preprocessed_input,
                output_dir=output_dir,
                timeout_seconds=timeout_seconds,
            )
        except AudiverisDocumentError as retry_error:
            raise AudiverisDocumentError(
                f"{primary_error}; preprocessed document extraction retry failed: {retry_error}"
            ) from retry_error


def _run_audiveris_command(
    *,
    binary: str,
    input_path: Path,
    output_dir: Path,
    timeout_seconds: int,
) -> Path:
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
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise AudiverisDocumentError(f"Audiveris timed out after {timeout_seconds} seconds.") from error
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Audiveris failed."
        raise AudiverisDocumentError(message)

    mxl_files = sorted(output_dir.rglob("*.mxl"))
    musicxml_files = sorted(output_dir.rglob("*.musicxml"))
    xml_files = sorted(output_dir.rglob("*.xml"))
    outputs = mxl_files or musicxml_files or xml_files
    if not outputs:
        raise AudiverisDocumentError("Audiveris did not produce a MusicXML output.")
    return outputs[0]


def _prepare_preprocessed_pdf(input_path: Path, *, output_dir: Path, dpi: int) -> Path:
    if fitz is None:
        raise AudiverisDocumentError("PyMuPDF is not installed, so document preprocessing is unavailable.")
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_dpi = max(180, min(450, dpi))
    scale = safe_dpi / 72
    output_path = output_dir / f"{input_path.stem}-preprocessed.pdf"

    try:
        source = fitz.open(input_path)
    except Exception as error:  # pragma: no cover - PyMuPDF exception type varies.
        raise AudiverisDocumentError(f"Could not open input for document preprocessing: {error}") from error

    if source.page_count <= 0:
        raise AudiverisDocumentError("Input has no pages for document preprocessing.")

    preprocessed = fitz.open()
    try:
        for page_index in range(source.page_count):
            page = source[page_index]
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
            target_page = preprocessed.new_page(width=page.rect.width, height=page.rect.height)
            target_page.insert_image(target_page.rect, pixmap=pixmap)
        preprocessed.save(output_path)
    except Exception as error:  # pragma: no cover - PyMuPDF exception type varies.
        raise AudiverisDocumentError(f"Could not preprocess document input: {error}") from error
    finally:
        preprocessed.close()
        source.close()

    return output_path
