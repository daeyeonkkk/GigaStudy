from __future__ import annotations

import base64
from pathlib import Path

from fastapi import HTTPException

from gigastudy_api.config import get_settings


DEFAULT_UPLOAD_BPM = 92
OMR_SOURCE_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
SYMBOLIC_SOURCE_SUFFIXES = {".musicxml", ".xml", ".mxl", ".mid", ".midi"}
AUDIO_SOURCE_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".flac"}
TRACK_UPLOAD_SUFFIXES = {
    "audio": tuple(AUDIO_SOURCE_SUFFIXES),
    "midi": (".mid", ".midi"),
    "document": tuple(SYMBOLIC_SOURCE_SUFFIXES | OMR_SOURCE_SUFFIXES),
}
STUDIO_SEED_UPLOAD_SUFFIXES = {
    "document": tuple(SYMBOLIC_SOURCE_SUFFIXES | OMR_SOURCE_SUFFIXES),
    "music": tuple(AUDIO_SOURCE_SUFFIXES),
}
AUDIO_MIME_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


def validate_track_upload_filename(source_kind: str, filename: str) -> tuple[str, str]:
    source_kind = normalize_upload_source_kind(source_kind)
    safe_filename = Path(filename.strip()).name
    suffix = Path(safe_filename).suffix.lower()
    allowed_suffixes = TRACK_UPLOAD_SUFFIXES.get(source_kind)
    if not safe_filename or allowed_suffixes is None or not safe_filename.lower().endswith(allowed_suffixes):
        raise HTTPException(status_code=422, detail="Unsupported file type for this upload.")
    return safe_filename, suffix


def validate_studio_seed_upload_filename(source_kind: str, filename: str) -> tuple[str, str]:
    source_kind = normalize_upload_source_kind(source_kind)
    safe_filename = Path(filename.strip()).name
    suffix = Path(safe_filename).suffix.lower()
    allowed_suffixes = STUDIO_SEED_UPLOAD_SUFFIXES.get(source_kind)
    if not safe_filename or allowed_suffixes is None or not safe_filename.lower().endswith(allowed_suffixes):
        raise HTTPException(status_code=422, detail="Unsupported file type for this upload.")
    return safe_filename, suffix


def decode_base64_upload(content_base64: str) -> bytes:
    payload = content_base64.split(",", 1)[1] if "," in content_base64 else content_base64
    try:
        content = base64.b64decode(payload, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid base64 upload content.") from error
    max_upload_bytes = get_settings().max_upload_bytes
    if len(content) > max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Upload exceeds the configured {max_upload_bytes} byte limit.",
        )
    return content


def guess_audio_mime_type(filename: str) -> str:
    return AUDIO_MIME_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")


def should_route_seed_upload_to_omr(source_kind: str, filename: str | None) -> bool:
    if normalize_upload_source_kind(source_kind) != "document" or filename is None:
        return False
    return Path(filename).suffix.lower() in OMR_SOURCE_SUFFIXES


def normalize_upload_source_kind(source_kind: str) -> str:
    return "document" if source_kind == "score" else source_kind


def guess_content_type(filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix in AUDIO_SOURCE_SUFFIXES:
        return guess_audio_mime_type(filename)
    if suffix in {".musicxml", ".xml"}:
        return "application/vnd.recordare.musicxml+xml"
    if suffix == ".mxl":
        return "application/vnd.recordare.musicxml"
    if suffix in {".mid", ".midi"}:
        return "audio/midi"
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}:
        if suffix in {".jpg", ".jpeg"}:
            return "image/jpeg"
        if suffix in {".tif", ".tiff"}:
            return "image/tiff"
        return f"image/{suffix.lstrip('.')}"
    return None


def track_upload_owner_from_path(relative_path: str) -> tuple[str, int] | None:
    parts = relative_path.split("/")
    if len(parts) < 4 or parts[0] != "uploads":
        return None
    try:
        slot_id = int(parts[2])
    except ValueError:
        return None
    if slot_id < 1 or slot_id > 6:
        return None
    return parts[1], slot_id


def is_staged_upload_path(relative_path: str) -> bool:
    parts = relative_path.split("/")
    return len(parts) >= 3 and parts[0] == "staged"
