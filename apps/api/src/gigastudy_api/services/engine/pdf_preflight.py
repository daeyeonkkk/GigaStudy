from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

try:
    import fitz
except ImportError:  # pragma: no cover - PyMuPDF is a declared API dependency.
    fitz = None


PdfPreflightKind = Literal["born_digital_score", "scanned_score_possible", "text_only", "unknown"]

PDF_NOT_SCORE_MESSAGE = (
    "악보로 읽을 수 있는 오선이나 음표를 찾지 못했습니다. "
    "가사/일반 문서 PDF 대신 악보 PDF, MIDI, MusicXML을 사용해 주세요."
)

SMUFL_NOTE_GLYPHS = {"\ue0a3", "\ue0a4", "\ue0a9", "\ue0db"}


@dataclass(frozen=True)
class PdfPreflightResult:
    kind: PdfPreflightKind
    reason: str
    page_count: int = 0
    inspected_page_count: int = 0
    staff_row_count: int = 0
    note_glyph_count: int = 0
    barline_count: int = 0
    image_like_page_count: int = 0
    image_coverage_ratio: float = 0
    text_character_count: int = 0
    text_density: float = 0

    def diagnostics(self) -> dict[str, Any]:
        return asdict(self)


def inspect_pdf_for_score_content(path: Path, *, max_pages: int = 3) -> PdfPreflightResult:
    """Lightweight PDF gate before expensive document extraction.

    The check is intentionally conservative. Born-digital score PDFs usually
    expose vector staff lines or SMuFL note glyphs. Image-heavy PDFs may be
    scanned scores, so they remain eligible for recognition. Text-only PDFs
    without score evidence are rejected early.
    """

    if fitz is None or path.suffix.lower() != ".pdf":
        return PdfPreflightResult(kind="unknown", reason="preflight_unavailable")

    try:
        document = fitz.open(path)
    except Exception:
        return PdfPreflightResult(kind="unknown", reason="pdf_open_failed")

    with document:
        page_count = int(document.page_count)
        if page_count <= 0:
            return PdfPreflightResult(kind="text_only", reason="empty_pdf")

        inspected_page_count = min(max(1, max_pages), page_count)
        staff_row_count = 0
        note_glyph_count = 0
        barline_count = 0
        image_like_page_count = 0
        image_coverage_ratios: list[float] = []
        text_character_count = 0
        inspected_area = 0.0

        for page_index in range(inspected_page_count):
            page = document[page_index]
            page_area = max(1.0, float(page.rect.width * page.rect.height))
            inspected_area += page_area
            staff_row_count += _count_staff_rows(page)
            note_glyph_count += _count_note_glyphs(page)
            barline_count += _count_barlines(page)
            text_character_count += len((page.get_text("text") or "").strip())
            image_coverage = _image_coverage_ratio(page)
            image_coverage_ratios.append(image_coverage)
            if image_coverage >= 0.35:
                image_like_page_count += 1

        image_coverage_ratio = max(image_coverage_ratios, default=0)
        text_density = text_character_count / max(1.0, inspected_area / 10000)
        diagnostics = {
            "page_count": page_count,
            "inspected_page_count": inspected_page_count,
            "staff_row_count": staff_row_count,
            "note_glyph_count": note_glyph_count,
            "barline_count": barline_count,
            "image_like_page_count": image_like_page_count,
            "image_coverage_ratio": round(image_coverage_ratio, 3),
            "text_character_count": text_character_count,
            "text_density": round(text_density, 3),
        }

        if staff_row_count > 0 or note_glyph_count > 0 or barline_count >= 4:
            return PdfPreflightResult(
                kind="born_digital_score",
                reason="staff_or_note_detected",
                **diagnostics,
            )

        if image_like_page_count > 0:
            return PdfPreflightResult(
                kind="scanned_score_possible",
                reason="large_image_detected",
                **diagnostics,
            )

        if text_character_count >= 20:
            return PdfPreflightResult(
                kind="text_only",
                reason="text_without_score_evidence",
                **diagnostics,
            )

        return PdfPreflightResult(
            kind="text_only",
            reason="no_score_evidence",
            **diagnostics,
        )


def _count_staff_rows(page: Any) -> int:
    horizontal_y_values: list[float] = []
    for drawing in page.get_drawings():
        for item in drawing.get("items", []):
            if item[0] != "l":
                continue
            point_a, point_b = item[1], item[2]
            x0, y0, x1, y1 = point_a.x, point_a.y, point_b.x, point_b.y
            if abs(y0 - y1) <= 0.35 and abs(x1 - x0) >= 70:
                horizontal_y_values.append(y0)

    y_values = sorted(horizontal_y_values)
    staff_rows = 0
    index = 0
    while index <= len(y_values) - 5:
        chunk = y_values[index : index + 5]
        diffs = [chunk[offset + 1] - chunk[offset] for offset in range(4)]
        average_spacing = sum(diffs) / len(diffs)
        if 2.0 <= average_spacing <= 10.0 and max(diffs) - min(diffs) <= 2.0:
            staff_rows += 1
            index += 5
        else:
            index += 1
    return staff_rows


def _count_note_glyphs(page: Any) -> int:
    count = 0
    raw = page.get_text("rawdict")
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                for char in span.get("chars", []):
                    if char.get("c") in SMUFL_NOTE_GLYPHS:
                        count += 1
    return count


def _count_barlines(page: Any) -> int:
    values: list[float] = []
    for drawing in page.get_drawings():
        for item in drawing.get("items", []):
            if item[0] != "l":
                continue
            point_a, point_b = item[1], item[2]
            x0, y0, x1, y1 = point_a.x, point_a.y, point_b.x, point_b.y
            if abs(x0 - x1) <= 0.45 and abs(y1 - y0) >= 12:
                values.append(x0)
    return len(_group_close_values(values, tolerance=2.0))


def _image_coverage_ratio(page: Any) -> float:
    page_area = max(1.0, float(page.rect.width * page.rect.height))
    max_ratio = 0.0
    text_dict = page.get_text("dict")
    for block in text_dict.get("blocks", []):
        if block.get("type") != 1:
            continue
        bbox = block.get("bbox")
        if not bbox or len(bbox) != 4:
            continue
        x0, y0, x1, y1 = (float(value) for value in bbox)
        image_area = max(0.0, x1 - x0) * max(0.0, y1 - y0)
        max_ratio = max(max_ratio, image_area / page_area)
    return max_ratio


def _group_close_values(values: list[float], *, tolerance: float) -> list[list[float]]:
    groups: list[list[float]] = []
    for value in sorted(values):
        if not groups or abs(value - groups[-1][-1]) > tolerance:
            groups.append([value])
        else:
            groups[-1].append(value)
    return groups
