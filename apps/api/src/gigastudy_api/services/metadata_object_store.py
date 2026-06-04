from __future__ import annotations

import json
from pathlib import PurePosixPath
from typing import Any

from botocore.exceptions import ClientError

from gigastudy_api.config import Settings


class MetadataObjectStoreError(Exception):
    pass


class S3JsonObjectStore:
    def __init__(self, *, settings: Settings, prefix: str) -> None:
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
            raise MetadataObjectStoreError(f"S3 metadata storage is missing required settings: {joined}.")
        self._bucket = settings.s3_bucket or ""
        self._prefix = _clean_prefix(prefix)
        self._client = _build_s3_client(
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
            access_key_id=settings.s3_access_key_id or "",
            secret_access_key=settings.s3_secret_access_key or "",
            addressing_style=settings.s3_addressing_style,
        )

    @property
    def label(self) -> str:
        return f"s3://{self._bucket}/{self._prefix}".rstrip("/")

    @property
    def bucket(self) -> str:
        return self._bucket

    def key(self, relative_path: str) -> str:
        clean_path = _clean_relative_path(relative_path)
        return f"{self._prefix}/{clean_path}" if self._prefix else clean_path

    def read_json(self, relative_path: str, default: Any) -> Any:
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=self.key(relative_path))
        except ClientError as error:
            if _is_missing_object(error):
                return default
            raise
        body = response.get("Body")
        if body is None:
            return default
        content = body.read()
        if not content:
            return default
        decoded = json.loads(content.decode("utf-8"))
        return decoded

    def write_json(self, relative_path: str, payload: Any) -> None:
        content = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self._client.put_object(
            Bucket=self._bucket,
            Key=self.key(relative_path),
            Body=content,
            ContentType="application/json; charset=utf-8",
        )

    def delete_object(self, relative_path: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=self.key(relative_path))

    def delete_prefix(self, relative_prefix: str) -> tuple[int, int]:
        prefix = self.key(_clean_relative_path(relative_prefix).rstrip("/") + "/")
        deleted_files = 0
        deleted_bytes = 0
        batch: list[dict[str, str]] = []
        for item in self.iter_objects(relative_prefix):
            key = str(item["Key"])
            deleted_files += 1
            deleted_bytes += int(item.get("Size", 0))
            batch.append({"Key": key})
            if len(batch) == 1000:
                self._client.delete_objects(Bucket=self._bucket, Delete={"Objects": batch})
                batch = []
        if batch:
            self._client.delete_objects(Bucket=self._bucket, Delete={"Objects": batch})
        return deleted_files, deleted_bytes

    def iter_objects(self, relative_prefix: str):
        clean_prefix = _clean_relative_path(relative_prefix).rstrip("/")
        prefix = self.key(f"{clean_prefix}/")
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                if item.get("Key"):
                    yield item

    def estimate_prefix_bytes(self, relative_prefix: str = "") -> int:
        clean_prefix = relative_prefix.strip().strip("/")
        total = 0
        paginator = self._client.get_paginator("list_objects_v2")
        prefix = self.key(clean_prefix) if clean_prefix else self._prefix
        if prefix and not prefix.endswith("/"):
            prefix = f"{prefix}/"
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            total += sum(int(item.get("Size", 0)) for item in page.get("Contents", []))
        return total


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


def _is_missing_object(error: ClientError) -> bool:
    status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    code = error.response.get("Error", {}).get("Code")
    return status == 404 or code in {"404", "NoSuchKey", "NotFound"}


def _clean_prefix(prefix: str) -> str:
    normalized = prefix.replace("\\", "/").strip().strip("/")
    if not normalized:
        return ""
    return _clean_relative_path(normalized)


def _clean_relative_path(relative_path: str) -> str:
    normalized = relative_path.replace("\\", "/").strip().strip("/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or not normalized:
        raise MetadataObjectStoreError("Metadata object path is not a relative storage path.")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise MetadataObjectStoreError("Metadata object path is not a relative storage path.")
    return path.as_posix()
