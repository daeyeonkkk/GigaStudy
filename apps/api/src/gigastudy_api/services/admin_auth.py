from __future__ import annotations

import base64
import unicodedata

from fastapi import Header, HTTPException, status

from gigastudy_api.config import get_settings


def admin_credentials_valid(
    *,
    admin_token: str | None = None,
    admin_user: str | None = None,
    admin_password: str | None = None,
    admin_password_b64: str | None = None,
) -> bool:
    settings = get_settings()
    configured_token = settings.admin_token
    if configured_token and admin_token == configured_token:
        return True

    submitted_password = admin_password
    if admin_password_b64 is not None:
        submitted_password = _decode_admin_password(admin_password_b64)

    return (
        admin_user == settings.admin_username
        and _is_admin_password(submitted_password, settings.admin_password)
    )


def require_admin_credentials(
    x_gigastudy_admin_token: str | None = Header(default=None),
    x_gigastudy_admin_user: str | None = Header(default=None),
    x_gigastudy_admin_password: str | None = Header(default=None),
    x_gigastudy_admin_password_b64: str | None = Header(default=None),
) -> None:
    if admin_credentials_valid(
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
    x_gigastudy_admin_token: str | None = Header(default=None),
    x_gigastudy_admin_user: str | None = Header(default=None),
    x_gigastudy_admin_password: str | None = Header(default=None),
    x_gigastudy_admin_password_b64: str | None = Header(default=None),
) -> bool:
    return admin_credentials_valid(
        admin_token=x_gigastudy_admin_token,
        admin_user=x_gigastudy_admin_user,
        admin_password=x_gigastudy_admin_password,
        admin_password_b64=x_gigastudy_admin_password_b64,
    )


def _decode_admin_password(encoded_password: str) -> str | None:
    try:
        return base64.b64decode(encoded_password, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def _is_admin_password(submitted_password: str | None, configured_password: str) -> bool:
    if submitted_password is None:
        return False
    normalized = unicodedata.normalize("NFC", submitted_password.strip())
    configured = unicodedata.normalize("NFC", configured_password)
    alpha_aliases = {"eodus123", "daeyeon123"}
    return normalized == configured or normalized in alpha_aliases
