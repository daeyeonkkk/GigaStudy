from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from gigastudy_api.api.schemas.admin import PlaybackInstrumentConfig
from gigastudy_api.config import get_settings
from gigastudy_api.services.upload_policy import (
    AUDIO_SOURCE_SUFFIXES,
    decode_base64_upload,
    guess_audio_mime_type,
)


CONFIG_FILENAME = "playback_instrument.json"
INSTRUMENT_DIRNAME = "playback_instrument"


class PlaybackInstrumentService:
    def __init__(self, storage_root: str) -> None:
        self._root = Path(storage_root)
        self._config_path = self._root / CONFIG_FILENAME
        self._audio_root = self._root / INSTRUMENT_DIRNAME

    def get_config(self, *, audio_url: str | None = None) -> PlaybackInstrumentConfig:
        config = self._read_config()
        filename = config.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            return PlaybackInstrumentConfig()

        path = self._audio_path(filename)
        if not path.exists() or not path.is_file():
            return PlaybackInstrumentConfig()

        return PlaybackInstrumentConfig(
            has_custom_file=True,
            filename=filename,
            root_midi=int(config.get("root_midi") or 69),
            audio_url=audio_url,
            updated_at=str(config.get("updated_at") or ""),
        )

    def get_audio_file(self) -> tuple[Path, str, str]:
        config = self.get_config()
        if not config.has_custom_file or not config.filename:
            raise HTTPException(status_code=404, detail="Playback instrument file not found.")
        path = self._audio_path(config.filename)
        return path, guess_audio_mime_type(config.filename), config.filename

    def update(self, *, filename: str, content_base64: str, root_midi: int) -> PlaybackInstrumentConfig:
        safe_filename = Path(filename.strip()).name
        suffix = Path(safe_filename).suffix.lower()
        if not safe_filename or suffix not in AUDIO_SOURCE_SUFFIXES:
            raise HTTPException(status_code=422, detail="Unsupported playback instrument file type.")

        content = decode_base64_upload(content_base64)
        self._audio_root.mkdir(parents=True, exist_ok=True)
        for existing in self._audio_root.iterdir():
            if existing.is_file():
                existing.unlink(missing_ok=True)

        path = self._audio_path(safe_filename)
        path.write_bytes(content)
        payload = {
            "filename": safe_filename,
            "root_midi": root_midi,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self._write_config(payload)
        return self.get_config()

    def reset(self) -> PlaybackInstrumentConfig:
        if self._audio_root.exists():
            for existing in self._audio_root.iterdir():
                if existing.is_file():
                    existing.unlink(missing_ok=True)
        self._config_path.unlink(missing_ok=True)
        return PlaybackInstrumentConfig()

    def _read_config(self) -> dict[str, Any]:
        if not self._config_path.exists():
            return {}
        try:
            payload = json.loads(self._config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _write_config(self, payload: dict[str, Any]) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _audio_path(self, filename: str) -> Path:
        safe_filename = Path(filename).name
        path = (self._audio_root / safe_filename).resolve()
        resolved_root = self._audio_root.resolve()
        if path != resolved_root and resolved_root not in path.parents:
            raise HTTPException(status_code=422, detail="Invalid playback instrument filename.")
        return path


def get_playback_instrument_service() -> PlaybackInstrumentService:
    return PlaybackInstrumentService(get_settings().storage_root)
