from __future__ import annotations

import copy
import os
import shutil
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree

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
        raise AudiverisDocumentError("현재 PDF 악보 인식을 사용할 수 없습니다. MIDI/MusicXML 파일을 사용해 주세요.")

    output_dir.mkdir(parents=True, exist_ok=True)
    settings = get_settings()
    chunk_pages = max(1, int(settings.document_audiveris_chunk_pages or 1))
    if input_path.suffix.lower() == ".pdf" and _pdf_page_count(input_path) > chunk_pages:
        return _run_chunked_audiveris_extraction(
            binary=binary,
            chunk_pages=chunk_pages,
            input_path=input_path,
            output_dir=output_dir,
            timeout_seconds=timeout_seconds,
        )

    return _run_single_audiveris_with_retry(
        binary=binary,
        input_path=input_path,
        output_dir=output_dir,
        timeout_seconds=timeout_seconds,
    )


def _run_single_audiveris_with_retry(
    *,
    binary: str,
    input_path: Path,
    output_dir: Path,
    timeout_seconds: int,
) -> Path:
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
        if int(settings.document_max_extraction_attempts or 1) <= 1:
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


def _run_chunked_audiveris_extraction(
    *,
    binary: str,
    chunk_pages: int,
    input_path: Path,
    output_dir: Path,
    timeout_seconds: int,
) -> Path:
    if fitz is None:
        return _run_single_audiveris_with_retry(
            binary=binary,
            input_path=input_path,
            output_dir=output_dir,
            timeout_seconds=timeout_seconds,
        )
    chunks = _split_pdf_into_chunks(input_path, output_dir=output_dir / "chunks", chunk_pages=chunk_pages)
    outputs: list[Path] = []
    for chunk_index, chunk_path in enumerate(chunks, start=1):
        chunk_output_dir = output_dir / f"chunk-{chunk_index:03d}"
        try:
            outputs.append(
                _run_single_audiveris_with_retry(
                    binary=binary,
                    input_path=chunk_path,
                    output_dir=chunk_output_dir,
                    timeout_seconds=timeout_seconds,
                )
            )
        except AudiverisDocumentError as error:
            raise AudiverisDocumentError(
                f"{chunk_index}번째 PDF 구간을 읽지 못했습니다. 더 작은 PDF나 MIDI/MusicXML 파일을 사용해 주세요. {error}"
            ) from error

    if not outputs:
        raise AudiverisDocumentError("PDF 악보에서 등록 가능한 결과를 만들지 못했습니다.")
    if len(outputs) == 1:
        return outputs[0]
    return _merge_musicxml_outputs(outputs, output_dir / f"{input_path.stem}-merged.musicxml")


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
    settings = get_settings()
    env = os.environ.copy()
    if settings.audiveris_java_max_heap.strip():
        existing_java_options = env.get("JAVA_TOOL_OPTIONS", "").strip()
        heap_option = f"-Xmx{settings.audiveris_java_max_heap.strip()}"
        env["JAVA_TOOL_OPTIONS"] = f"{existing_java_options} {heap_option}".strip()
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            env=env,
        )
    except subprocess.TimeoutExpired as error:
        raise AudiverisDocumentError(
            "문서 분석 시간이 제한 시간을 넘었습니다. 다시 시도하거나 MIDI/MusicXML 파일을 사용해 주세요."
        ) from error
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "recognition failed."
        raise AudiverisDocumentError(_public_audiveris_error_message(message))

    mxl_files = sorted(output_dir.rglob("*.mxl"))
    musicxml_files = sorted(output_dir.rglob("*.musicxml"))
    xml_files = sorted(output_dir.rglob("*.xml"))
    outputs = mxl_files or musicxml_files or xml_files
    if not outputs:
        raise AudiverisDocumentError(
            "악보로 등록할 수 있는 음표 결과를 만들지 못했습니다. MIDI/MusicXML 파일을 사용해 주세요."
        )
    return outputs[0]


def _public_audiveris_error_message(message: str) -> str:
    normalized = message.lower()
    if any(term in normalized for term in ("outofmemory", "java heap", "memory", "killed", "137")):
        return "문서가 너무 크거나 복잡해서 처리하지 못했습니다. MIDI/MusicXML 파일을 사용해 주세요."
    if "timed out" in normalized or "timeout" in normalized:
        return "문서 분석 시간이 제한 시간을 넘었습니다. 다시 시도하거나 MIDI/MusicXML 파일을 사용해 주세요."
    if "not configured" in normalized or "not found" in normalized:
        return "현재 PDF 악보 인식을 사용할 수 없습니다. MIDI/MusicXML 파일을 사용해 주세요."
    return "PDF 악보를 인식하지 못했습니다. 더 선명한 악보 PDF, MIDI, MusicXML을 사용해 주세요."


def _pdf_page_count(input_path: Path) -> int:
    if fitz is None or input_path.suffix.lower() != ".pdf":
        return 0
    try:
        with fitz.open(input_path) as document:
            return int(document.page_count)
    except Exception:
        return 0


def _split_pdf_into_chunks(input_path: Path, *, output_dir: Path, chunk_pages: int) -> list[Path]:
    if fitz is None:
        return [input_path]
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        source = fitz.open(input_path)
    except Exception as error:  # pragma: no cover - PyMuPDF exception type varies.
        raise AudiverisDocumentError(f"PDF를 열지 못했습니다: {error}") from error

    chunks: list[Path] = []
    try:
        for start in range(0, source.page_count, chunk_pages):
            end = min(source.page_count, start + chunk_pages)
            chunk = fitz.open()
            try:
                chunk.insert_pdf(source, from_page=start, to_page=end - 1)
                chunk_path = output_dir / f"{input_path.stem}-pages-{start + 1}-{end}.pdf"
                chunk.save(chunk_path)
                chunks.append(chunk_path)
            finally:
                chunk.close()
    finally:
        source.close()
    return chunks


def _merge_musicxml_outputs(paths: list[Path], output_path: Path) -> Path:
    if not paths:
        raise AudiverisDocumentError("병합할 악보 결과가 없습니다.")
    base_tree = _read_musicxml_tree(paths[0])
    base_root = base_tree.getroot()
    base_parts = _parts_by_id(base_root)
    if not base_parts:
        raise AudiverisDocumentError("악보 결과에서 파트를 찾지 못했습니다.")

    next_measure_by_part = {
        part_id: _next_measure_number(part)
        for part_id, part in base_parts.items()
    }
    for path in paths[1:]:
        root = _read_musicxml_tree(path).getroot()
        for part_id, source_part in _parts_by_id(root).items():
            target_part = base_parts.get(part_id)
            if target_part is None:
                continue
            next_number = next_measure_by_part.get(part_id, 1)
            for measure in _children_named(source_part, "measure"):
                copied = copy.deepcopy(measure)
                copied.set("number", str(next_number))
                target_part.append(copied)
                next_number += 1
            next_measure_by_part[part_id] = next_number

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ElementTree.ElementTree(base_root).write(output_path, encoding="utf-8", xml_declaration=True)
    return output_path


def _read_musicxml_tree(path: Path) -> ElementTree.ElementTree:
    if path.suffix.lower() == ".mxl":
        try:
            with zipfile.ZipFile(path) as archive:
                names = [
                    name
                    for name in archive.namelist()
                    if name.lower().endswith((".xml", ".musicxml")) and not name.lower().endswith("container.xml")
                ]
                if not names:
                    raise AudiverisDocumentError("압축 악보 결과에서 MusicXML을 찾지 못했습니다.")
                with archive.open(names[0]) as handle:
                    return ElementTree.ElementTree(ElementTree.fromstring(handle.read()))
        except zipfile.BadZipFile as error:
            raise AudiverisDocumentError("압축 악보 결과를 열지 못했습니다.") from error
    return ElementTree.parse(path)


def _parts_by_id(root: ElementTree.Element) -> dict[str, ElementTree.Element]:
    parts: dict[str, ElementTree.Element] = {}
    for child in list(root):
        if _local_name(child.tag) != "part":
            continue
        part_id = child.attrib.get("id")
        if part_id:
            parts[part_id] = child
    return parts


def _children_named(element: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in list(element) if _local_name(child.tag) == name]


def _next_measure_number(part: ElementTree.Element) -> int:
    measures = _children_named(part, "measure")
    if not measures:
        return 1
    numbers: list[int] = []
    for measure in measures:
        try:
            numbers.append(int(float(measure.attrib.get("number", ""))))
        except ValueError:
            continue
    if numbers:
        return max(numbers) + 1
    return len(measures) + 1


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _prepare_preprocessed_pdf(input_path: Path, *, output_dir: Path, dpi: int) -> Path:
    if fitz is None:
        raise AudiverisDocumentError("문서 전처리를 사용할 수 없습니다.")
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_dpi = max(180, min(450, dpi))
    scale = safe_dpi / 72
    output_path = output_dir / f"{input_path.stem}-preprocessed.pdf"

    try:
        source = fitz.open(input_path)
    except Exception as error:  # pragma: no cover - PyMuPDF exception type varies.
        raise AudiverisDocumentError(f"문서 전처리 입력을 열지 못했습니다: {error}") from error

    if source.page_count <= 0:
        raise AudiverisDocumentError("문서 전처리 대상 페이지가 없습니다.")

    preprocessed = fitz.open()
    try:
        for page_index in range(source.page_count):
            page = source[page_index]
            clip = _content_clip_for_page(page, scale)
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(scale, scale),
                colorspace=fitz.csGRAY,
                alpha=False,
                clip=clip,
            )
            target_page = preprocessed.new_page(width=clip.width, height=clip.height)
            target_page.insert_image(target_page.rect, pixmap=pixmap)
        preprocessed.save(output_path)
    except Exception as error:  # pragma: no cover - PyMuPDF exception type varies.
        raise AudiverisDocumentError(f"문서 전처리에 실패했습니다: {error}") from error
    finally:
        preprocessed.close()
        source.close()

    return output_path


def _content_clip_for_page(page: object, scale: float) -> object:
    if fitz is None:
        return page.rect
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
    bbox = _non_white_bbox(pixmap)
    if bbox is None:
        return page.rect
    x0, y0, x1, y1 = bbox
    margin = max(8, int(min(pixmap.width, pixmap.height) * 0.02))
    x0 = max(0, x0 - margin)
    y0 = max(0, y0 - margin)
    x1 = min(pixmap.width, x1 + margin)
    y1 = min(pixmap.height, y1 + margin)
    return fitz.Rect(x0 / scale, y0 / scale, x1 / scale, y1 / scale)


def _non_white_bbox(pixmap: object) -> tuple[int, int, int, int] | None:
    width = int(pixmap.width)
    height = int(pixmap.height)
    row_stride = int(getattr(pixmap, "stride", width))
    samples = pixmap.samples
    stride = max(1, min(width, height) // 900)
    threshold = 245
    x_min, y_min = width, height
    x_max, y_max = -1, -1
    for y in range(0, height, stride):
        row_offset = y * row_stride
        for x in range(0, width, stride):
            if samples[row_offset + x] < threshold:
                x_min = min(x_min, x)
                y_min = min(y_min, y)
                x_max = max(x_max, x)
                y_max = max(y_max, y)
    if x_max < x_min or y_max < y_min:
        return None
    return x_min, y_min, x_max + 1, y_max + 1
