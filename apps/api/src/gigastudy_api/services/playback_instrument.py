from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from botocore.exceptions import ClientError

from gigastudy_api.api.schemas.admin import PlaybackInstrumentConfig
from gigastudy_api.config import Settings, get_settings
from gigastudy_api.services.metadata_object_store import S3JsonObjectStore, _build_s3_client
from gigastudy_api.services.upload_policy import (
    AUDIO_SOURCE_SUFFIXES,
    decode_base64_upload,
    guess_audio_mime_type,
)


CONFIG_FILENAME = "playback_instrument.json"
INSTRUMENT_DIRNAME = "playback_instrument"


class PlaybackInstrumentService:
    def __init__(self, storage_root: str, *, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._root = Path(storage_root)
        self._config_path = self._root / CONFIG_FILENAME
        self._audio_root = self._root / INSTRUMENT_DIRNAME
        self._metadata_backend = self._settings.metadata_backend.strip().lower()
        self._object_store: S3JsonObjectStore | None = None
        self._s3_client = None
        self._bucket = self._settings.s3_bucket or ""
        if self._metadata_backend in {"s3", "r2"}:
            self._object_store = S3JsonObjectStore(settings=self._settings, prefix=self._settings.metadata_prefix)
            self._s3_client = _build_s3_client(
                region=self._settings.s3_region,
                endpoint_url=self._settings.s3_endpoint_url,
                access_key_id=self._settings.s3_access_key_id or "",
                secret_access_key=self._settings.s3_secret_access_key or "",
                addressing_style=self._settings.s3_addressing_style,
            )

    def get_config(self, *, audio_url: str | None = None) -> PlaybackInstrumentConfig:
        config = self._read_config()
        filename = config.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            return PlaybackInstrumentConfig()

        if not self._has_audio_file(filename):
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
        if self._object_store is not None:
            self._download_audio_file(config.filename, path)
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
        if self._object_store is not None:
            self._delete_s3_audio_prefix()
            self._s3_client.put_object(
                Bucket=self._bucket,
                Key=self._audio_key(safe_filename),
                Body=content,
                ContentType=guess_audio_mime_type(safe_filename),
            )
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
        if self._object_store is not None:
            self._delete_s3_audio_prefix()
            self._object_store.delete_object("playback_instrument/config.json")
        self._config_path.unlink(missing_ok=True)
        return PlaybackInstrumentConfig()

    def _read_config(self) -> dict[str, Any]:
        if self._object_store is not None:
            payload = self._object_store.read_json("playback_instrument/config.json", {})
            return payload if isinstance(payload, dict) else {}
        if not self._config_path.exists():
            return {}
        try:
            payload = json.loads(self._config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _write_config(self, payload: dict[str, Any]) -> None:
        if self._object_store is not None:
            self._object_store.write_json("playback_instrument/config.json", payload)
            return
        self._root.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _audio_path(self, filename: str) -> Path:
        safe_filename = Path(filename).name
        path = (self._audio_root / safe_filename).resolve()
        resolved_root = self._audio_root.resolve()
        if path != resolved_root and resolved_root not in path.parents:
            raise HTTPException(status_code=422, detail="Invalid playback instrument filename.")
        return path

    def _has_audio_file(self, filename: str) -> bool:
        if self._object_store is None:
            path = self._audio_path(filename)
            return path.exists() and path.is_file()
        try:
            self._s3_client.head_object(Bucket=self._bucket, Key=self._audio_key(filename))
        except ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            code = error.response.get("Error", {}).get("Code")
            if status == 404 or code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True

    def _download_audio_file(self, filename: str, path: Path) -> None:
        if path.exists() and path.is_file():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._s3_client.download_file(self._bucket, self._audio_key(filename), str(path))
        except ClientError as error:
            raise HTTPException(status_code=404, detail="Playback instrument file not found.") from error

    def _delete_s3_audio_prefix(self) -> None:
        if self._object_store is None:
            return
        paginator = self._s3_client.get_paginator("list_objects_v2")
        batch: list[dict[str, str]] = []
        for page in paginator.paginate(Bucket=self._bucket, Prefix=f"{INSTRUMENT_DIRNAME}/"):
            for item in page.get("Contents", []):
                key = item.get("Key")
                if not key:
                    continue
                batch.append({"Key": str(key)})
                if len(batch) == 1000:
                    self._s3_client.delete_objects(Bucket=self._bucket, Delete={"Objects": batch})
                    batch = []
        if batch:
            self._s3_client.delete_objects(Bucket=self._bucket, Delete={"Objects": batch})

    @staticmethod
    def _audio_key(filename: str) -> str:
        return f"{INSTRUMENT_DIRNAME}/{Path(filename).name}"


def get_playback_instrument_service() -> PlaybackInstrumentService:
    settings = get_settings()
    return PlaybackInstrumentService(settings.storage_root, settings=settings)
