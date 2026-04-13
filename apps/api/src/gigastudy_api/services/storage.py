from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Iterator
from urllib.parse import quote
import mimetypes
import os

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError
from fastapi import Request
from fastapi.responses import Response

from gigastudy_api.config import Settings, get_settings


class StorageObjectNotFoundError(FileNotFoundError):
    pass


@dataclass(frozen=True)
class StoredObject:
    storage_key: str
    byte_size: int


@dataclass(frozen=True)
class StorageUploadTarget:
    upload_url: str
    method: str
    storage_key: str
    headers: dict[str, str] = field(default_factory=dict)


def build_project_storage_key(project_id: object, *segments: object) -> str:
    parts = ["projects", str(project_id)]
    for segment in segments:
        value = str(segment).replace("\\", "/").strip("/")
        if value:
            parts.append(value)
    return "/".join(parts)


class LocalStorageBackend:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path_for_key(self, storage_key: str) -> Path:
        path = Path(storage_key)
        if path.is_absolute():
            return path
        return (self.root / storage_key).resolve()

    def write_bytes(self, storage_key: str, payload: bytes, content_type: str | None = None) -> StoredObject:
        path = self._path_for_key(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return StoredObject(storage_key=storage_key, byte_size=len(payload))

    def write_text(self, storage_key: str, content: str, encoding: str = "utf-8") -> StoredObject:
        payload = content.encode(encoding)
        path = self._path_for_key(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return StoredObject(storage_key=storage_key, byte_size=len(payload))

    def read_bytes(self, storage_key: str) -> bytes:
        path = self._path_for_key(storage_key)
        if not path.exists():
            raise StorageObjectNotFoundError(storage_key)
        return path.read_bytes()

    def read_text(self, storage_key: str, encoding: str = "utf-8") -> str:
        return self.read_bytes(storage_key).decode(encoding)

    def exists(self, storage_key: str) -> bool:
        return self._path_for_key(storage_key).exists()

    def byte_size(self, storage_key: str) -> int | None:
        path = self._path_for_key(storage_key)
        if not path.exists():
            return None
        return path.stat().st_size

    @contextmanager
    def materialize_to_path(self, storage_key: str, suffix: str = "") -> Iterator[Path]:
        path = self._path_for_key(storage_key)
        if not path.exists():
            raise StorageObjectNotFoundError(storage_key)
        yield path


class S3StorageBackend:
    def __init__(self, settings: Settings) -> None:
        if not settings.s3_bucket:
            raise ValueError("S3 storage requires GIGASTUDY_API_S3_BUCKET.")

        self.bucket = settings.s3_bucket
        self.client = _create_s3_client(settings)

    def _normalize_key(self, storage_key: str) -> str:
        return storage_key.replace("\\", "/").lstrip("/")

    def write_bytes(self, storage_key: str, payload: bytes, content_type: str | None = None) -> StoredObject:
        normalized_key = self._normalize_key(storage_key)
        kwargs = {
            "Bucket": self.bucket,
            "Key": normalized_key,
            "Body": payload,
        }
        if content_type:
            kwargs["ContentType"] = content_type
        self.client.put_object(**kwargs)
        return StoredObject(storage_key=normalized_key, byte_size=len(payload))

    def write_text(self, storage_key: str, content: str, encoding: str = "utf-8") -> StoredObject:
        payload = content.encode(encoding)
        return self.write_bytes(storage_key, payload, content_type="application/json")

    def read_bytes(self, storage_key: str) -> bytes:
        normalized_key = self._normalize_key(storage_key)
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=normalized_key)
        except ClientError as error:
            error_code = str(error.response.get("Error", {}).get("Code", ""))
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                raise StorageObjectNotFoundError(normalized_key) from error
            raise

        return response["Body"].read()

    def read_text(self, storage_key: str, encoding: str = "utf-8") -> str:
        return self.read_bytes(storage_key).decode(encoding)

    def exists(self, storage_key: str) -> bool:
        normalized_key = self._normalize_key(storage_key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=normalized_key)
            return True
        except ClientError as error:
            error_code = str(error.response.get("Error", {}).get("Code", ""))
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise

    def byte_size(self, storage_key: str) -> int | None:
        normalized_key = self._normalize_key(storage_key)
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=normalized_key)
        except ClientError as error:
            error_code = str(error.response.get("Error", {}).get("Code", ""))
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise

        content_length = response.get("ContentLength")
        return int(content_length) if content_length is not None else None

    @contextmanager
    def materialize_to_path(self, storage_key: str, suffix: str = "") -> Iterator[Path]:
        payload = self.read_bytes(storage_key)
        temp_file = NamedTemporaryFile(delete=False, suffix=suffix)
        temp_path = Path(temp_file.name)
        try:
            temp_file.write(payload)
            temp_file.flush()
            temp_file.close()
            yield temp_path
        finally:
            temp_file.close()
            if temp_path.exists():
                temp_path.unlink()

    def create_direct_upload_target(
        self,
        storage_key: str,
        *,
        content_type: str | None = None,
        expires_in_seconds: int,
    ) -> StorageUploadTarget:
        normalized_key = self._normalize_key(storage_key)
        params: dict[str, object] = {
            "Bucket": self.bucket,
            "Key": normalized_key,
        }
        headers: dict[str, str] = {}
        if content_type:
            params["ContentType"] = content_type
            headers["Content-Type"] = content_type

        upload_url = self.client.generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=expires_in_seconds,
            HttpMethod="PUT",
        )
        return StorageUploadTarget(
            upload_url=upload_url,
            method="PUT",
            storage_key=normalized_key,
            headers=headers,
        )


def _create_s3_client(settings: Settings):
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        aws_session_token=settings.s3_session_token,
        config=BotoConfig(
            s3={"addressing_style": settings.s3_addressing_style},
        ),
    )


def get_storage_backend():
    settings = get_settings()
    if settings.storage_backend == "s3":
        return S3StorageBackend(settings)
    return LocalStorageBackend(Path(settings.storage_root).resolve())


def build_track_upload_target(
    request: Request,
    *,
    track_id: object,
    storage_key: str,
    content_type: str | None = None,
) -> StorageUploadTarget:
    backend = get_storage_backend()
    if isinstance(backend, S3StorageBackend):
        expires_in_seconds = max(get_settings().upload_session_expiry_minutes, 1) * 60
        return backend.create_direct_upload_target(
            storage_key,
            content_type=content_type,
            expires_in_seconds=expires_in_seconds,
        )

    return StorageUploadTarget(
        upload_url=str(request.url_for("upload_track_source_audio", track_id=str(track_id))),
        method="PUT",
        storage_key=storage_key,
    )


def build_storage_download_response(
    storage_key: str,
    media_type: str | None = None,
    filename: str | None = None,
) -> Response:
    payload = get_storage_backend().read_bytes(storage_key)
    guessed_media_type = media_type or mimetypes.guess_type(filename or storage_key)[0] or "application/octet-stream"
    headers: dict[str, str] = {}
    if filename:
        safe_filename = os.path.basename(filename)
        headers["Content-Disposition"] = f"inline; filename*=UTF-8''{quote(safe_filename)}"

    return Response(content=payload, media_type=guessed_media_type, headers=headers)
