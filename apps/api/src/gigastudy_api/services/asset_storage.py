from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
import shutil
from typing import Protocol
from uuid import uuid4

from botocore.exceptions import ClientError

from gigastudy_api.config import Settings


@dataclass(frozen=True)
class StoredAssetInfo:
    relative_path: str
    filename: str
    kind: str
    size_bytes: int
    updated_at: str


@dataclass(frozen=True)
class DirectUploadInfo:
    relative_path: str
    upload_url: str | None
    headers: dict[str, str]
    expires_at: str


class AssetStorage(Protocol):
    @property
    def label(self) -> str:
        ...

    def write_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content: bytes,
    ) -> Path:
        ...

    def create_direct_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_type: str | None,
        expires_in_seconds: int,
    ) -> DirectUploadInfo:
        ...

    def create_staged_upload(
        self,
        *,
        filename: str,
        content_type: str | None,
        expires_in_seconds: int,
    ) -> DirectUploadInfo:
        ...

    def write_direct_upload(self, *, relative_path: str, content: bytes) -> Path:
        ...

    def write_direct_upload_file(self, *, relative_path: str, source_path: Path) -> Path:
        ...

    def persist_file(self, path: Path) -> str:
        ...

    def relative_path(self, path: Path) -> str:
        ...

    def normalize_reference(self, asset_path: str) -> str:
        ...

    def resolve_path(self, asset_path: str) -> Path:
        ...

    def iter_studio_assets(self, studio_id: str) -> list[StoredAssetInfo]:
        ...

    def delete_file(self, relative_path: str) -> tuple[int, int]:
        ...

    def delete_prefix(self, relative_prefix: str) -> tuple[int, int]:
        ...

    def delete_prefix_older_than(self, relative_prefix: str, cutoff: datetime) -> tuple[int, int]:
        ...


class LocalAssetStorage:
    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def label(self) -> str:
        return str(self._root.resolve())

    def write_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content: bytes,
    ) -> Path:
        relative_path = _upload_relative_path(studio_id, slot_id, filename)
        path = self._cache_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def create_direct_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_type: str | None,
        expires_in_seconds: int,
    ) -> DirectUploadInfo:
        del content_type
        relative_path = _upload_relative_path(studio_id, slot_id, filename)
        expires_at = _expires_at(expires_in_seconds)
        return DirectUploadInfo(
            relative_path=relative_path,
            upload_url=None,
            headers={},
            expires_at=expires_at,
        )

    def create_staged_upload(
        self,
        *,
        filename: str,
        content_type: str | None,
        expires_in_seconds: int,
    ) -> DirectUploadInfo:
        del content_type
        relative_path = _staged_upload_relative_path(filename)
        return DirectUploadInfo(
            relative_path=relative_path,
            upload_url=None,
            headers={},
            expires_at=_expires_at(expires_in_seconds),
        )

    def write_direct_upload(self, *, relative_path: str, content: bytes) -> Path:
        path = self._cache_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def write_direct_upload_file(self, *, relative_path: str, source_path: Path) -> Path:
        path = self._cache_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, path)
        return path

    def persist_file(self, path: Path) -> str:
        return self.relative_path(path)

    def relative_path(self, path: Path) -> str:
        resolved_path = path.resolve()
        try:
            return resolved_path.relative_to(self._root.resolve()).as_posix()
        except ValueError as error:
            raise AssetStorageError("Asset path is outside the storage root.") from error

    def normalize_reference(self, asset_path: str) -> str:
        return self._relative_path_from_reference(asset_path)

    def resolve_path(self, asset_path: str) -> Path:
        relative_path = self._relative_path_from_reference(asset_path)
        return self._cache_path(relative_path)

    def iter_studio_assets(self, studio_id: str) -> list[StoredAssetInfo]:
        assets: list[StoredAssetInfo] = []
        for kind, prefix in _studio_prefixes(studio_id):
            root = self._cache_path(prefix)
            if not root.exists():
                continue
            for path in sorted(root.rglob("*")):
                if not path.is_file():
                    continue
                relative_path = self.relative_path(path)
                stat = path.stat()
                assets.append(
                    StoredAssetInfo(
                        relative_path=relative_path,
                        filename=path.name,
                        kind=kind,
                        size_bytes=stat.st_size,
                        updated_at=datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
                    )
                )
        return assets

    def delete_file(self, relative_path: str) -> tuple[int, int]:
        path = self._cache_path(relative_path)
        if not path.exists() or not path.is_file():
            return 0, 0
        deleted_bytes = path.stat().st_size
        path.unlink()
        _prune_empty_dirs(self._root, path.parent)
        return 1, deleted_bytes

    def delete_prefix(self, relative_prefix: str) -> tuple[int, int]:
        root = self._cache_path(relative_prefix)
        return _delete_local_tree(self._root, root)

    def delete_prefix_older_than(self, relative_prefix: str, cutoff: datetime) -> tuple[int, int]:
        root = self._cache_path(relative_prefix)
        if not root.exists():
            return 0, 0
        cutoff_utc = cutoff.astimezone(UTC)
        deleted_files = 0
        deleted_bytes = 0
        for path in sorted(root.rglob("*"), key=lambda child: len(child.parts), reverse=True):
            if path.is_dir():
                try:
                    path.rmdir()
                except OSError:
                    pass
                continue
            if not path.is_file():
                continue
            modified_at = datetime.fromtimestamp(path.stat().st_mtime, UTC)
            if modified_at >= cutoff_utc:
                continue
            deleted_bytes += path.stat().st_size
            path.unlink()
            deleted_files += 1
        _prune_empty_dirs(self._root, root)
        return deleted_files, deleted_bytes

    def _relative_path_from_reference(self, asset_path: str) -> str:
        raw_path = Path(asset_path)
        if raw_path.is_absolute():
            return self.relative_path(raw_path)
        return _clean_relative_path(asset_path)

    def _cache_path(self, relative_path: str) -> Path:
        clean_path = _clean_relative_path(relative_path)
        candidate = (self._root / Path(*PurePosixPath(clean_path).parts)).resolve()
        resolved_root = self._root.resolve()
        if candidate != resolved_root and resolved_root not in candidate.parents:
            raise AssetStorageError("Asset path is outside the storage root.")
        return candidate


class S3AssetStorage(LocalAssetStorage):
    def __init__(
        self,
        *,
        root: Path,
        bucket: str,
        region: str,
        endpoint_url: str | None,
        access_key_id: str,
        secret_access_key: str,
        addressing_style: str,
        cache_max_bytes: int,
        cache_max_age_seconds: int,
    ) -> None:
        super().__init__(root)
        self._bucket = bucket
        self._cache_max_bytes = cache_max_bytes
        self._cache_max_age_seconds = cache_max_age_seconds
        self._client = _build_s3_client(
            region=region,
            endpoint_url=endpoint_url,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            addressing_style=addressing_style,
        )

    @property
    def label(self) -> str:
        return f"s3://{self._bucket}"

    def write_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content: bytes,
    ) -> Path:
        relative_path = _upload_relative_path(studio_id, slot_id, filename)
        local_path = self._cache_path(relative_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(content)
        self._client.put_object(Bucket=self._bucket, Key=relative_path, Body=content)
        return local_path

    def create_direct_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_type: str | None,
        expires_in_seconds: int,
    ) -> DirectUploadInfo:
        relative_path = _upload_relative_path(studio_id, slot_id, filename)
        params: dict[str, str] = {
            "Bucket": self._bucket,
            "Key": relative_path,
        }
        headers: dict[str, str] = {}
        if content_type:
            params["ContentType"] = content_type
            headers["Content-Type"] = content_type
        upload_url = self._client.generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=expires_in_seconds,
            HttpMethod="PUT",
        )
        return DirectUploadInfo(
            relative_path=relative_path,
            upload_url=upload_url,
            headers=headers,
            expires_at=_expires_at(expires_in_seconds),
        )

    def create_staged_upload(
        self,
        *,
        filename: str,
        content_type: str | None,
        expires_in_seconds: int,
    ) -> DirectUploadInfo:
        relative_path = _staged_upload_relative_path(filename)
        return self._create_s3_direct_upload(
            relative_path=relative_path,
            content_type=content_type,
            expires_in_seconds=expires_in_seconds,
        )

    def write_direct_upload(self, *, relative_path: str, content: bytes) -> Path:
        clean_path = _clean_relative_path(relative_path)
        local_path = self._cache_path(clean_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(content)
        self._client.put_object(Bucket=self._bucket, Key=clean_path, Body=content)
        return local_path

    def write_direct_upload_file(self, *, relative_path: str, source_path: Path) -> Path:
        clean_path = _clean_relative_path(relative_path)
        local_path = self._cache_path(clean_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, local_path)
        self._client.upload_file(str(source_path), self._bucket, clean_path)
        return local_path

    def persist_file(self, path: Path) -> str:
        relative_path = self.relative_path(path)
        self._client.upload_file(str(path), self._bucket, relative_path)
        return relative_path

    def resolve_path(self, asset_path: str) -> Path:
        relative_path = self._relative_path_from_reference(asset_path)
        local_path = self._cache_path(relative_path)
        if not local_path.exists():
            self._evict_stale_cache_files()
            local_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                self._client.download_file(self._bucket, relative_path, str(local_path))
            except ClientError as error:
                _remove_empty_file(local_path)
                raise AssetStorageError("Stored asset was not found.") from error
            self._enforce_cache_size_limit()
        return local_path

    def iter_studio_assets(self, studio_id: str) -> list[StoredAssetInfo]:
        assets: list[StoredAssetInfo] = []
        for kind, prefix in _studio_prefixes(studio_id):
            for item in self._list_objects(prefix):
                relative_path = str(item["Key"])
                filename = PurePosixPath(relative_path).name
                updated_at = item.get("LastModified")
                if isinstance(updated_at, datetime):
                    updated_at_value = updated_at.astimezone(UTC).isoformat()
                else:
                    updated_at_value = datetime.now(UTC).isoformat()
                assets.append(
                    StoredAssetInfo(
                        relative_path=relative_path,
                        filename=filename,
                        kind=kind,
                        size_bytes=int(item.get("Size", 0)),
                        updated_at=updated_at_value,
                    )
                )
        return assets

    def delete_file(self, relative_path: str) -> tuple[int, int]:
        clean_path = _clean_relative_path(relative_path)
        deleted_bytes = self._object_size(clean_path)
        if deleted_bytes is None:
            return 0, 0
        self._client.delete_object(Bucket=self._bucket, Key=clean_path)
        super().delete_file(clean_path)
        return 1, deleted_bytes

    def delete_prefix(self, relative_prefix: str) -> tuple[int, int]:
        clean_prefix = _clean_relative_path(relative_prefix)
        if clean_prefix and not clean_prefix.endswith("/"):
            clean_prefix = f"{clean_prefix}/"
        deleted_files = 0
        deleted_bytes = 0
        batch: list[dict[str, str]] = []

        for item in self._list_objects(clean_prefix):
            key = str(item["Key"])
            deleted_files += 1
            deleted_bytes += int(item.get("Size", 0))
            batch.append({"Key": key})
            if len(batch) == 1000:
                self._delete_objects(batch)
                batch = []

        if batch:
            self._delete_objects(batch)

        local_root = self._cache_path(clean_prefix) if clean_prefix else self._root
        _delete_local_tree(self._root, local_root)
        return deleted_files, deleted_bytes

    def delete_prefix_older_than(self, relative_prefix: str, cutoff: datetime) -> tuple[int, int]:
        clean_prefix = _clean_relative_path(relative_prefix)
        if clean_prefix and not clean_prefix.endswith("/"):
            clean_prefix = f"{clean_prefix}/"
        cutoff_utc = cutoff.astimezone(UTC)
        deleted_files = 0
        deleted_bytes = 0
        batch: list[dict[str, str]] = []

        for item in self._list_objects(clean_prefix):
            updated_at = item.get("LastModified")
            if not isinstance(updated_at, datetime) or updated_at.astimezone(UTC) >= cutoff_utc:
                continue
            key = str(item["Key"])
            deleted_files += 1
            deleted_bytes += int(item.get("Size", 0))
            batch.append({"Key": key})
            if len(batch) == 1000:
                self._delete_objects(batch)
                batch = []

        if batch:
            self._delete_objects(batch)

        local_deleted_files, local_deleted_bytes = super().delete_prefix_older_than(clean_prefix, cutoff_utc)
        if deleted_files == 0:
            return local_deleted_files, local_deleted_bytes
        return deleted_files, deleted_bytes

    def _list_objects(self, prefix: str):
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                if item.get("Key"):
                    yield item

    def _object_size(self, key: str) -> int | None:
        try:
            response = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return None
            if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
                return None
            raise
        return int(response.get("ContentLength", 0))

    def _delete_objects(self, objects: list[dict[str, str]]) -> None:
        self._client.delete_objects(Bucket=self._bucket, Delete={"Objects": objects})

    def _evict_stale_cache_files(self) -> None:
        if self._cache_max_age_seconds <= 0:
            return
        cutoff = datetime.now(UTC) - timedelta(seconds=self._cache_max_age_seconds)
        for path in self._iter_cache_files():
            try:
                if datetime.fromtimestamp(path.stat().st_mtime, UTC) < cutoff:
                    path.unlink()
                    _prune_empty_dirs(self._root, path.parent)
            except OSError:
                continue

    def _enforce_cache_size_limit(self) -> None:
        if self._cache_max_bytes <= 0:
            return
        files = []
        total_bytes = 0
        now = datetime.now(UTC)
        for path in self._iter_cache_files():
            try:
                stat = path.stat()
            except OSError:
                continue
            total_bytes += stat.st_size
            files.append((datetime.fromtimestamp(stat.st_mtime, UTC), stat.st_size, path))

        if total_bytes <= self._cache_max_bytes:
            return

        for modified_at, size_bytes, path in sorted(files, key=lambda item: item[0]):
            if total_bytes <= self._cache_max_bytes:
                break
            # Do not evict files that may still be part of an in-flight parser job.
            if now - modified_at < timedelta(minutes=5):
                continue
            try:
                path.unlink()
                _prune_empty_dirs(self._root, path.parent)
            except OSError:
                continue
            total_bytes -= size_bytes

    def _iter_cache_files(self):
        for relative_prefix in ("uploads", "jobs", "staged"):
            root = self._cache_path(relative_prefix)
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if path.is_file():
                    yield path

    def _create_s3_direct_upload(
        self,
        *,
        relative_path: str,
        content_type: str | None,
        expires_in_seconds: int,
    ) -> DirectUploadInfo:
        params: dict[str, str] = {
            "Bucket": self._bucket,
            "Key": relative_path,
        }
        headers: dict[str, str] = {}
        if content_type:
            params["ContentType"] = content_type
            headers["Content-Type"] = content_type
        upload_url = self._client.generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=expires_in_seconds,
            HttpMethod="PUT",
        )
        return DirectUploadInfo(
            relative_path=relative_path,
            upload_url=upload_url,
            headers=headers,
            expires_at=_expires_at(expires_in_seconds),
        )


class AssetStorageError(Exception):
    pass


def build_asset_storage(*, storage_root: Path, settings: Settings) -> AssetStorage:
    backend = settings.storage_backend.strip().lower()
    if backend in {"", "local"}:
        return LocalAssetStorage(storage_root)
    if backend in {"s3", "r2"}:
        missing = [
            name
            for name, value in {
                "s3_bucket": settings.s3_bucket,
                "s3_access_key_id": settings.s3_access_key_id,
                "s3_secret_access_key": settings.s3_secret_access_key,
            }.items()
            if not value
        ]
        if missing:
            joined = ", ".join(missing)
            raise AssetStorageError(f"S3 asset storage is missing required settings: {joined}.")
        return S3AssetStorage(
            root=storage_root,
            bucket=settings.s3_bucket or "",
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
            access_key_id=settings.s3_access_key_id or "",
            secret_access_key=settings.s3_secret_access_key or "",
            addressing_style=settings.s3_addressing_style,
            cache_max_bytes=settings.asset_cache_max_bytes,
            cache_max_age_seconds=settings.asset_cache_max_age_seconds,
        )
    raise AssetStorageError(f"Unsupported asset storage backend: {settings.storage_backend}.")


def _build_s3_client(
    *,
    region: str,
    endpoint_url: str | None,
    access_key_id: str,
    secret_access_key: str,
    addressing_style: str,
):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name=region,
        config=Config(s3={"addressing_style": addressing_style}),
    )


def _upload_relative_path(studio_id: str, slot_id: int, filename: str) -> str:
    safe_filename = Path(filename).name.strip() or "upload.bin"
    return _clean_relative_path(f"uploads/{studio_id}/{slot_id}/{uuid4().hex}-{safe_filename}")


def _staged_upload_relative_path(filename: str) -> str:
    safe_filename = Path(filename).name.strip() or "upload.bin"
    return _clean_relative_path(f"staged/{uuid4().hex}/{uuid4().hex}-{safe_filename}")


def _expires_at(expires_in_seconds: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=expires_in_seconds)).isoformat()


def _studio_prefixes(studio_id: str) -> list[tuple[str, str]]:
    return [
        ("upload", f"uploads/{studio_id}/"),
        ("generated", f"jobs/{studio_id}/"),
    ]


def _clean_relative_path(relative_path: str) -> str:
    normalized = relative_path.replace("\\", "/").strip()
    path = PurePosixPath(normalized)
    if path.is_absolute() or not normalized:
        raise AssetStorageError("Asset path is not a relative storage path.")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise AssetStorageError("Asset path is not a relative storage path.")
    return path.as_posix()


def _delete_local_tree(root: Path, path: Path) -> tuple[int, int]:
    resolved = path.resolve()
    resolved_root = root.resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise AssetStorageError("Asset path is outside the storage root.")
    if not resolved.exists():
        return 0, 0
    if resolved.is_file():
        size = resolved.stat().st_size
        resolved.unlink()
        _prune_empty_dirs(root, resolved.parent)
        return 1, size

    deleted_files = 0
    deleted_bytes = 0
    for child in sorted(resolved.rglob("*"), key=lambda child: len(child.parts), reverse=True):
        if child.is_file():
            deleted_bytes += child.stat().st_size
            child.unlink()
            deleted_files += 1
        elif child.is_dir():
            child.rmdir()
    resolved.rmdir()
    _prune_empty_dirs(root, resolved.parent)
    return deleted_files, deleted_bytes


def _prune_empty_dirs(root: Path, start: Path) -> None:
    resolved_root = root.resolve()
    current = start.resolve()
    while current != resolved_root and resolved_root in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def _remove_empty_file(path: Path) -> None:
    try:
        if path.exists() and path.stat().st_size == 0:
            path.unlink()
    except OSError:
        return
