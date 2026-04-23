from __future__ import annotations

from pathlib import Path

try:
    import fitz
except ImportError:  # pragma: no cover - PyMuPDF is a runtime dependency.
    fitz = None


class ScorePreviewError(ValueError):
    pass


def render_score_source_preview(
    source_path: Path,
    *,
    page_index: int = 0,
    max_width_pixels: int = 1200,
) -> bytes:
    if fitz is None:
        raise ScorePreviewError("Score preview rendering is unavailable.")
    if not source_path.exists() or not source_path.is_file():
        raise ScorePreviewError("Score source file is missing.")
    if page_index < 0:
        raise ScorePreviewError("Score preview page index is invalid.")

    try:
        document = _open_preview_document(source_path)
    except Exception as error:  # noqa: BLE001 - PyMuPDF raises several concrete errors.
        raise ScorePreviewError("Score source file cannot be opened for preview.") from error

    with document:
        if document.page_count <= 0:
            raise ScorePreviewError("Score source file has no previewable pages.")
        if page_index >= document.page_count:
            raise ScorePreviewError("Score preview page is out of range.")
        page = document.load_page(page_index)
        zoom = max(1.0, min(3.0, max_width_pixels / max(1.0, page.rect.width)))
        pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pixmap.tobytes("png")


def _open_preview_document(source_path: Path):
    suffix = source_path.suffix.lower().lstrip(".")
    if suffix == "jpg":
        suffix = "jpeg"
    if suffix in {"jpeg", "png", "bmp", "gif", "tif", "tiff", "webp"}:
        return fitz.open(stream=source_path.read_bytes(), filetype=suffix)
    return fitz.open(source_path)
