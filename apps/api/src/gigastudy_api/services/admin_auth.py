from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import unicodedata
from datetime import datetime, timezone

from fastapi import Header, HTTPException, status

from gigastudy_api.config import get_settings

ADMIN_SESSION_TOKEN_PREFIX = "gst_admin_v1"


def admin_credentials_valid(
    *,
    authorization: str | None = None,
    admin_token: str | None = None,
    admin_user: str | None = None,
    admin_password: str | None = None,
    admin_password_b64: str | None = None,
) -> bool:
    settings = get_settings()
    if authorization and admin_session_token_valid(authorization, settings=settings):
        return True

    configured_token = settings.admin_token
    if configured_token and admin_token == configured_token:
        return True

    submitted_password = admin_password
    if admin_password_b64 is not None:
        submitted_password = _decode_admin_password(admin_password_b64)

    return (
        admin_user == settings.admin_username
        and _is_admin_password(
            submitted_password,
            settings.admin_password,
            settings.admin_password_aliases,
        )
    )


def require_admin_credentials(
    authorization: str | None = Header(default=None),
    x_gigastudy_admin_token: str | None = Header(default=None),
    x_gigastudy_admin_user: str | None = Header(default=None),
    x_gigastudy_admin_password: str | None = Header(default=None),
    x_gigastudy_admin_password_b64: str | None = Header(default=None),
) -> None:
    if admin_credentials_valid(
        authorization=authorization,
        admin_token=x_gigastudy_admin_token,
        admin_user=x_gigastudy_admin_user,
        admin_password=x_gigastudy_admin_password,
        admin_password_b64=x_gigastudy_admin_password_b64,
    ):
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid admin credentials.",
    )


def optional_admin_bypass(
    authorization: str | None = Header(default=None),
    x_gigastudy_admin_token: str | None = Header(default=None),
    x_gigastudy_admin_user: str | None = Header(default=None),
    x_gigastudy_admin_password: str | None = Header(default=None),
    x_gigastudy_admin_password_b64: str | None = Header(default=None),
) -> bool:
    return admin_credentials_valid(
        authorization=authorization,
        admin_token=x_gigastudy_admin_token,
        admin_user=x_gigastudy_admin_user,
        admin_password=x_gigastudy_admin_password,
        admin_password_b64=x_gigastudy_admin_password_b64,
    )


def create_admin_session_token(*, admin_user: str, admin_password: str) -> tuple[str, str, int]:
    settings = get_settings()
    if not _admin_password_credentials_valid(
        admin_user=admin_user,
        admin_password=admin_password,
        settings=settings,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials.",
        )

    ttl_seconds = max(60, int(settings.admin_session_ttl_seconds))
    issued_at = int(time.time())
    expires_at_epoch = issued_at + ttl_seconds
    payload = {
        "sub": settings.admin_username,
        "iat": issued_at,
        "exp": expires_at_epoch,
        "nonce": secrets.token_urlsafe(16),
    }
    encoded_payload = _b64url_encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    signature = _sign_session_payload(encoded_payload, settings=settings)
    token = f"{ADMIN_SESSION_TOKEN_PREFIX}.{encoded_payload}.{signature}"
    expires_at = datetime.fromtimestamp(expires_at_epoch, tz=timezone.utc).isoformat()
    return token, expires_at, ttl_seconds


def admin_session_token_valid(
    authorization: str,
    *,
    settings=None,
) -> bool:
    token = _extract_bearer_token(authorization)
    if not token:
        return False

    active_settings = settings or get_settings()
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != ADMIN_SESSION_TOKEN_PREFIX:
        return False

    encoded_payload = parts[1]
    submitted_signature = parts[2]
    expected_signature = _sign_session_payload(encoded_payload, settings=active_settings)
    if not hmac.compare_digest(submitted_signature, expected_signature):
        return False

    try:
        payload = json.loads(_b64url_decode(encoded_payload).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return False

    if payload.get("sub") != active_settings.admin_username:
        return False
    expires_at = payload.get("exp")
    if not isinstance(expires_at, int):
        return False
    return expires_at > int(time.time())


def _decode_admin_password(encoded_password: str) -> str | None:
    try:
        return base64.b64decode(encoded_password, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def _admin_password_credentials_valid(*, admin_user: str | None, admin_password: str | None, settings) -> bool:
    return (
        admin_user == settings.admin_username
        and _is_admin_password(
            admin_password,
            settings.admin_password,
            settings.admin_password_aliases,
        )
    )


def _is_admin_password(
    submitted_password: str | None,
    configured_password: str | None,
    configured_aliases: list[str],
) -> bool:
    if submitted_password is None or configured_password is None:
        return False
    normalized = unicodedata.normalize("NFC", submitted_password.strip())
    accepted_passwords = [configured_password, *configured_aliases]
    return any(
        normalized == unicodedata.normalize("NFC", accepted_password.strip())
        for accepted_password in accepted_passwords
    )


def _extract_bearer_token(authorization: str) -> str | None:
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _session_secret(settings) -> bytes:
    material = (
        settings.admin_session_secret
        or settings.admin_token
        or settings.admin_password
        or ""
    )
    return f"gigastudy-admin-session:{material}".encode("utf-8")


def _sign_session_payload(encoded_payload: str, *, settings) -> str:
    digest = hmac.new(_session_secret(settings), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return _b64url_encode(digest)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")
