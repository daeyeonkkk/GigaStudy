from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from gigastudy_api.config import get_settings
from gigastudy_api.services.asset_storage import AssetStorageError


class DirectUploadTokenCodec:
    def __init__(
        self,
        *,
        storage_root: Path,
        normalize_reference: Callable[[str], str],
    ) -> None:
        self._storage_root = storage_root
        self._normalize_reference = normalize_reference

    def encode(
        self,
        *,
        relative_path: str,
        expires_at: str,
        owner_hash: str | None,
        max_bytes: int,
    ) -> str:
        payload = {
            "relative_path": relative_path,
            "expires_at": expires_at,
            "owner_hash": owner_hash,
            "max_bytes": max_bytes,
        }
        serialized_payload = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        signature = hmac.new(
            self._signing_secret(),
            serialized_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        token = json.dumps(
            {
                "payload": payload,
                "signature": signature,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        encoded = base64.urlsafe_b64encode(token.encode("utf-8")).decode("ascii")
        return encoded.rstrip("=")

    def decode(self, asset_id: str, *, owner_policy_enabled: bool) -> dict[str, Any]:
        padding = "=" * (-len(asset_id) % 4)
        try:
            decoded = base64.urlsafe_b64decode(f"{asset_id}{padding}").decode("utf-8")
        except (ValueError, UnicodeDecodeError) as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error

        try:
            envelope = json.loads(decoded)
        except json.JSONDecodeError:
            relative_path = self.decode_asset_id(asset_id, not_found_detail="Upload target not found.")
            if owner_policy_enabled:
                raise HTTPException(status_code=404, detail="Upload target not found.")
            return {
                "relative_path": relative_path,
                "owner_hash": None,
                "max_bytes": get_settings().max_upload_bytes,
            }

        if not isinstance(envelope, dict) or not isinstance(envelope.get("payload"), dict):
            raise HTTPException(status_code=404, detail="Upload target not found.")
        payload = envelope["payload"]
        signature = envelope.get("signature")
        if not isinstance(signature, str):
            raise HTTPException(status_code=404, detail="Upload target not found.")

        serialized_payload = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        expected_signature = hmac.new(
            self._signing_secret(),
            serialized_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            raise HTTPException(status_code=404, detail="Upload target not found.")

        relative_path = payload.get("relative_path")
        expires_at = payload.get("expires_at")
        owner_hash = payload.get("owner_hash")
        max_bytes = payload.get("max_bytes")
        if not isinstance(relative_path, str) or not isinstance(expires_at, str) or not isinstance(max_bytes, int):
            raise HTTPException(status_code=404, detail="Upload target not found.")
        if owner_hash is not None and not isinstance(owner_hash, str):
            raise HTTPException(status_code=404, detail="Upload target not found.")
        if _parse_utc_datetime(expires_at) < datetime.now(UTC):
            raise HTTPException(status_code=410, detail="Upload target expired.")
        if max_bytes <= 0:
            raise HTTPException(status_code=404, detail="Upload target not found.")
        try:
            normalized_path = self._normalize_reference(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error
        return {
            "relative_path": normalized_path,
            "owner_hash": owner_hash,
            "max_bytes": min(max_bytes, get_settings().max_upload_bytes),
        }

    def decode_asset_id(self, asset_id: str, *, not_found_detail: str = "Asset not found.") -> str:
        padding = "=" * (-len(asset_id) % 4)
        try:
            decoded = base64.urlsafe_b64decode(f"{asset_id}{padding}").decode("utf-8")
        except (ValueError, UnicodeDecodeError) as error:
            raise HTTPException(status_code=404, detail=not_found_detail) from error
        if decoded.startswith("/") or decoded.startswith("\\") or ".." in Path(decoded).parts:
            raise HTTPException(status_code=404, detail=not_found_detail)
        return decoded

    def _signing_secret(self) -> bytes:
        settings = get_settings()
        secret = (
            settings.admin_token
            or settings.s3_secret_access_key
            or settings.database_url
            or f"{settings.app_name}:{self._storage_root.resolve()}"
        )
        return str(secret).encode("utf-8")


def _parse_utc_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Upload target not found.") from error
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
