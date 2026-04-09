from __future__ import annotations

import csv
from io import StringIO
import json
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, Field, model_validator

from gigastudy_api.api.schemas.ops import EnvironmentValidationRunCreateRequest


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _parse_optional_bool(value: str | None) -> bool | None:
    normalized = (_normalize_optional_text(value) or "").lower()
    if not normalized:
        return None
    if normalized in {"true", "yes", "y", "1", "pass"}:
        return True
    if normalized in {"false", "no", "n", "0", "fail"}:
        return False
    raise ValueError(f"Unsupported boolean value: {value!r}")


def _parse_optional_int(value: str | None) -> int | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    return int(normalized)


def _parse_optional_latency_seconds(value: str | None) -> float | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    return float(normalized) / 1000


def _parse_warning_flags(value: str | None) -> list[str]:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return []
    return [item.strip() for item in normalized.split(",") if item.strip()]


class EnvironmentValidationSheetRow(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    tester: str | None = Field(default=None, max_length=120)
    device_name: str = Field(min_length=1, max_length=160)
    os: str = Field(min_length=1, max_length=80)
    browser: str = Field(min_length=1, max_length=80)
    input_device: str | None = Field(default=None, max_length=160)
    output_route: str | None = Field(default=None, max_length=160)
    outcome: str = Field(pattern="^(PASS|WARN|FAIL)$")
    secure_context: bool | None = None
    microphone_permission_before: str | None = Field(default=None, max_length=32)
    microphone_permission_after: str | None = Field(default=None, max_length=32)
    recording_mime_type: str | None = Field(default=None, max_length=64)
    audio_context_mode: str | None = Field(default=None, max_length=32)
    offline_audio_context_mode: str | None = Field(default=None, max_length=32)
    actual_sample_rate: int | None = Field(default=None, ge=1)
    base_latency: float | None = None
    output_latency: float | None = None
    warning_flags: list[str] = Field(default_factory=list)
    take_recording_succeeded: bool | None = None
    analysis_succeeded: bool | None = None
    playback_succeeded: bool | None = None
    audible_issues: str | None = Field(default=None, max_length=2000)
    permission_issues: str | None = Field(default=None, max_length=2000)
    unexpected_warnings: str | None = Field(default=None, max_length=2000)
    follow_up: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    validated_at: str | None = None

    @model_validator(mode="after")
    def normalize_strings(self) -> "EnvironmentValidationSheetRow":
        self.tester = _normalize_optional_text(self.tester)
        self.input_device = _normalize_optional_text(self.input_device)
        self.output_route = _normalize_optional_text(self.output_route)
        self.microphone_permission_before = _normalize_optional_text(self.microphone_permission_before)
        self.microphone_permission_after = _normalize_optional_text(self.microphone_permission_after)
        self.recording_mime_type = _normalize_optional_text(self.recording_mime_type)
        self.audio_context_mode = _normalize_optional_text(self.audio_context_mode)
        self.offline_audio_context_mode = _normalize_optional_text(self.offline_audio_context_mode)
        self.audible_issues = _normalize_optional_text(self.audible_issues)
        self.permission_issues = _normalize_optional_text(self.permission_issues)
        self.unexpected_warnings = _normalize_optional_text(self.unexpected_warnings)
        self.follow_up = _normalize_optional_text(self.follow_up)
        self.notes = _normalize_optional_text(self.notes)
        return self


def load_environment_validation_sheet(sheet_path: Path) -> list[EnvironmentValidationSheetRow]:
    with sheet_path.open("r", encoding="utf-8-sig", newline="") as handle:
        return _load_environment_validation_rows(csv.DictReader(handle))


def load_environment_validation_sheet_text(sheet_text: str) -> list[EnvironmentValidationSheetRow]:
    normalized_text = sheet_text.lstrip("\ufeff")
    handle = StringIO(normalized_text)
    return _load_environment_validation_rows(csv.DictReader(handle))


def build_environment_validation_requests(
    rows: list[EnvironmentValidationSheetRow],
) -> list[EnvironmentValidationRunCreateRequest]:
    return [
        EnvironmentValidationRunCreateRequest(
            label=row.label,
            tester=row.tester,
            device_name=row.device_name,
            os=row.os,
            browser=row.browser,
            input_device=row.input_device,
            output_route=row.output_route,
            outcome=row.outcome,
            secure_context=row.secure_context,
            microphone_permission_before=row.microphone_permission_before,
            microphone_permission_after=row.microphone_permission_after,
            recording_mime_type=row.recording_mime_type,
            audio_context_mode=row.audio_context_mode,
            offline_audio_context_mode=row.offline_audio_context_mode,
            actual_sample_rate=row.actual_sample_rate,
            base_latency=row.base_latency,
            output_latency=row.output_latency,
            warning_flags=row.warning_flags,
            take_recording_succeeded=row.take_recording_succeeded,
            analysis_succeeded=row.analysis_succeeded,
            playback_succeeded=row.playback_succeeded,
            audible_issues=row.audible_issues,
            permission_issues=row.permission_issues,
            unexpected_warnings=row.unexpected_warnings,
            follow_up=row.follow_up,
            notes=row.notes,
            validated_at=row.validated_at or datetime.now(UTC),
        )
        for row in rows
    ]


def render_environment_validation_requests_json(
    requests: list[EnvironmentValidationRunCreateRequest],
) -> str:
    return json.dumps([request.model_dump(mode="json") for request in requests], indent=2)


def _load_environment_validation_rows(
    reader: csv.DictReader,
) -> list[EnvironmentValidationSheetRow]:
    rows: list[EnvironmentValidationSheetRow] = []
    for raw_row in reader:
        if not any(str(value or "").strip() for value in raw_row.values()):
            continue
        rows.append(
            EnvironmentValidationSheetRow(
                label=str(raw_row.get("label") or "").strip(),
                tester=raw_row.get("tester"),
                device_name=str(raw_row.get("device_name") or "").strip(),
                os=str(raw_row.get("os") or "").strip(),
                browser=str(raw_row.get("browser") or "").strip(),
                input_device=raw_row.get("input_device"),
                output_route=raw_row.get("output_route"),
                outcome=str(raw_row.get("outcome") or "").strip().upper(),
                secure_context=_parse_optional_bool(raw_row.get("secure_context")),
                microphone_permission_before=raw_row.get("microphone_permission_before"),
                microphone_permission_after=raw_row.get("microphone_permission_after"),
                recording_mime_type=raw_row.get("recording_mime_type"),
                audio_context_mode=raw_row.get("audio_context_mode"),
                offline_audio_context_mode=raw_row.get("offline_audio_context_mode"),
                actual_sample_rate=_parse_optional_int(raw_row.get("actual_sample_rate")),
                base_latency=_parse_optional_latency_seconds(raw_row.get("base_latency_ms")),
                output_latency=_parse_optional_latency_seconds(raw_row.get("output_latency_ms")),
                warning_flags=_parse_warning_flags(raw_row.get("warning_flags")),
                take_recording_succeeded=_parse_optional_bool(raw_row.get("take_recording_succeeded")),
                analysis_succeeded=_parse_optional_bool(raw_row.get("analysis_succeeded")),
                playback_succeeded=_parse_optional_bool(raw_row.get("playback_succeeded")),
                audible_issues=raw_row.get("audible_issues"),
                permission_issues=raw_row.get("permission_issues"),
                unexpected_warnings=raw_row.get("unexpected_warnings"),
                follow_up=raw_row.get("follow_up"),
                notes=raw_row.get("notes"),
                validated_at=str(raw_row.get("validated_at") or "").strip(),
            )
        )
    return rows
