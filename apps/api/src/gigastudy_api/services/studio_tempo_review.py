from __future__ import annotations

from pathlib import Path
from typing import Any

from gigastudy_api.services.engine.symbolic import (
    SymbolicParseError,
    parse_symbolic_file_with_metadata,
)
from gigastudy_api.services.upload_policy import SYMBOLIC_SOURCE_SUFFIXES


def build_seed_tempo_review(
    source_path: Path,
    *,
    fallback_bpm: int,
    fallback_time_signature_numerator: int,
    fallback_time_signature_denominator: int,
) -> dict[str, Any]:
    """Build user-facing tempo/meter review data without registering tracks."""

    suggested_bpm = fallback_bpm
    suggested_numerator = fallback_time_signature_numerator
    suggested_denominator = fallback_time_signature_denominator
    evidence: list[str] = []
    warnings: list[str] = []
    tempo_source = "default"
    meter_source = "default"

    if source_path.suffix.lower() in SYMBOLIC_SOURCE_SUFFIXES:
        try:
            parsed = parse_symbolic_file_with_metadata(source_path, bpm=fallback_bpm)
        except SymbolicParseError as error:
            warnings.append(f"악보 파일의 템포 정보를 읽지 못했습니다: {error}")
            tempo_source = "unreadable_source"
            meter_source = "unreadable_source"
        else:
            if parsed.source_bpm is not None:
                suggested_bpm = parsed.source_bpm
                tempo_source = "source_file"
                evidence.append(f"파일 안의 템포 표시: {parsed.source_bpm} BPM")
            else:
                warnings.append("파일 안에서 명확한 BPM 표시를 찾지 못했습니다.")

            if parsed.has_time_signature:
                suggested_numerator = parsed.time_signature_numerator
                suggested_denominator = parsed.time_signature_denominator
                meter_source = "source_file"
                evidence.append(
                    "파일 안의 박자표: "
                    f"{parsed.time_signature_numerator}/{parsed.time_signature_denominator}"
                )
            else:
                warnings.append("파일 안에서 명확한 박자표를 찾지 못했습니다.")
    else:
        warnings.append("PDF/이미지 악보는 등록 전에 BPM과 박자표를 직접 확인해야 합니다.")

    return {
        "tempo_review_required": True,
        "suggested_bpm": suggested_bpm,
        "suggested_time_signature_numerator": suggested_numerator,
        "suggested_time_signature_denominator": suggested_denominator,
        "tempo_source": tempo_source,
        "meter_source": meter_source,
        "tempo_evidence": evidence,
        "tempo_warnings": warnings,
    }
