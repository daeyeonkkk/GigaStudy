from __future__ import annotations

import hashlib

from fastapi import HTTPException

from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.config import get_settings


def owner_policy_enabled() -> bool:
    return get_settings().studio_access_policy.strip().lower() not in {"", "public", "off", "false"}


def hash_owner_token(owner_token: str) -> str:
    return hashlib.sha256(owner_token.strip().encode("utf-8")).hexdigest()


def owner_hash_for_request(
    owner_token: str | None,
    *,
    allow_missing: bool = False,
    honor_public_token: bool = False,
) -> str | None:
    if not owner_policy_enabled() and not honor_public_token:
        return None
    normalized = (owner_token or "").strip()
    if not normalized:
        if allow_missing:
            return None
        raise HTTPException(status_code=401, detail="Studio owner token is required.")
    if len(normalized) < 24 or len(normalized) > 256:
        raise HTTPException(status_code=401, detail="Studio owner token is invalid.")
    return hash_owner_token(normalized)


def require_studio_access(studio: Studio, owner_token: str | None) -> None:
    if studio.owner_token_hash is not None:
        if (
            owner_hash_for_request(
                owner_token,
                allow_missing=not owner_policy_enabled(),
                honor_public_token=True,
            )
            != studio.owner_token_hash
        ):
            raise HTTPException(status_code=404, detail="Studio not found.")
        return

    if not owner_policy_enabled():
        return

    if studio.owner_token_hash is None or owner_hash_for_request(owner_token) != studio.owner_token_hash:
        raise HTTPException(status_code=404, detail="Studio not found.")
