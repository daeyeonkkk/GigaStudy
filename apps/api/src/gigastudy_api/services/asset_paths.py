from __future__ import annotations

import base64
from pathlib import Path, PurePosixPath


def clean_relative_path(relative_path: str) -> str:
    clean = PurePosixPath(str(relative_path).replace("\\", "/")).as_posix().lstrip("/")
    if clean in ("", ".") or clean.startswith("../"):
        raise ValueError("invalid asset path")
    return clean


def studio_id_from_asset_path(relative_path: str) -> str | None:
    parts = clean_relative_path(relative_path).split("/")
    if len(parts) >= 2 and parts[0] in {"uploads", "jobs"}:
        return parts[1]
    return None


def encode_asset_id(relative_path: str) -> str:
    clean = clean_relative_path(relative_path)
    return base64.urlsafe_b64encode(clean.encode("utf-8")).decode("ascii").rstrip("=")


def admin_asset_kind(kind: str) -> str:
    if kind in {"upload", "generated"}:
        return kind
    return "unknown"


def safe_filename_from_path(relative_path: str) -> str:
    return Path(clean_relative_path(relative_path)).name
