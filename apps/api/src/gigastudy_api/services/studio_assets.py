from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from gigastudy_api.api.schemas.admin import AdminAssetSummary
from gigastudy_api.api.schemas.studios import (
    DirectUploadRequest,
    DirectUploadTarget,
    SeedSourceKind,
    StudioSeedUploadRequest,
)
from gigastudy_api.config import get_settings
from gigastudy_api.services.alpha_limits import ensure_asset_capacity
from gigastudy_api.services.asset_paths import (
    admin_asset_kind as _admin_asset_kind,
    studio_id_from_asset_path as _studio_id_from_asset_path,
)
from gigastudy_api.services.asset_registry import AssetRecord, AssetRegistry
from gigastudy_api.services.asset_storage import AssetStorage, AssetStorageError
from gigastudy_api.services.direct_upload_tokens import DirectUploadTokenCodec
from gigastudy_api.services.engine.voice import VoiceTranscriptionResult, build_metronome_aligned_wav_bytes
from gigastudy_api.services.studio_access import owner_hash_for_request, owner_policy_enabled
from gigastudy_api.services.upload_policy import (
    decode_base64_upload as _decode_base64,
    guess_content_type as _guess_content_type,
    is_staged_upload_path as _is_staged_upload_path,
    track_upload_owner_from_path as _track_upload_owner_from_path,
    validate_studio_seed_upload_filename as _validated_studio_seed_upload_filename,
    validate_track_upload_filename as _validated_track_upload_filename,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class StudioAssetService:
    """Owns upload tokens, durable asset writes, registry updates, and cleanup."""

    def __init__(
        self,
        *,
        root: Path,
        asset_storage: AssetStorage,
        asset_registry: AssetRegistry,
        direct_upload_tokens: DirectUploadTokenCodec,
    ) -> None:
        self._root = root
        self._asset_storage = asset_storage
        self._asset_registry = asset_registry
        self._direct_upload_tokens = direct_upload_tokens
        self._last_lifecycle_cleanup_at: datetime | None = None

    @property
    def storage_label(self) -> str:
        return self._asset_storage.label

    def decode_asset_id(self, asset_id: str) -> str:
        return self._direct_upload_tokens.decode_asset_id(asset_id)

    def normalize_reference(self, asset_path: str | None) -> str | None:
        if asset_path is None:
            return None
        try:
            return self._asset_storage.normalize_reference(asset_path)
        except AssetStorageError:
            return None

    def ensure_capacity(self, incoming_bytes: int) -> None:
        _asset_count, current_bytes = self._asset_registry.summarize_all()
        ensure_asset_capacity(current_bytes=current_bytes, incoming_bytes=incoming_bytes)

    def summarize_all(self) -> tuple[int, int]:
        return self._asset_registry.summarize_all()

    def list_admin_asset_summaries(
        self,
        studio_id: str,
        *,
        referenced_paths: set[str],
        limit: int,
        offset: int,
        sync_missing: bool = False,
    ) -> tuple[int, int, list[AdminAssetSummary]]:
        asset_count, asset_bytes = self._asset_registry.summarize_studio(studio_id)
        if sync_missing and asset_count == 0:
            self._sync_studio_asset_registry(studio_id)
            asset_count, asset_bytes = self._asset_registry.summarize_studio(studio_id)
        records = (
            self._asset_registry.list_studio_assets(
                studio_id,
                limit=limit,
                offset=offset,
            )
            if limit > 0
            else []
        )
        return (
            asset_count,
            asset_bytes,
            [self._admin_asset_summary_from_record(record, referenced_paths) for record in records],
        )

    def _sync_studio_asset_registry(self, studio_id: str) -> None:
        try:
            stored_assets = self._asset_storage.iter_studio_assets(studio_id)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        self._asset_registry.sync_studio_assets(studio_id, stored_assets)

    @staticmethod
    def _admin_asset_summary_from_record(
        record: AssetRecord,
        referenced_paths: set[str],
    ) -> AdminAssetSummary:
        return AdminAssetSummary(
            asset_id=record.asset_id,
            studio_id=record.studio_id or "",
            kind=_admin_asset_kind(record.kind),
            filename=record.filename,
            relative_path=record.relative_path,
            size_bytes=record.size_bytes,
            updated_at=record.updated_at,
            referenced=record.relative_path in referenced_paths,
        )

    def create_studio_upload_target(
        self,
        request: StudioSeedUploadRequest,
        *,
        owner_token: str | None = None,
    ) -> DirectUploadTarget:
        owner_hash = owner_hash_for_request(
            owner_token,
            allow_missing=not owner_policy_enabled(),
            honor_public_token=True,
        )
        self.cleanup_expired_staged_uploads_if_due()
        filename, _suffix = _validated_studio_seed_upload_filename(request.source_kind, request.filename)
        settings = get_settings()
        if request.size_bytes > settings.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {settings.max_upload_bytes} byte limit.",
            )
        self.ensure_capacity(request.size_bytes)
        try:
            upload_info = self._asset_storage.create_staged_upload(
                filename=filename,
                content_type=request.content_type,
                expires_in_seconds=settings.direct_upload_expiration_seconds,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

        headers = dict(upload_info.headers)
        if not upload_info.upload_url and owner_token:
            headers["X-GigaStudy-Owner-Token"] = owner_token

        return DirectUploadTarget(
            asset_id=self._direct_upload_tokens.encode(
                relative_path=upload_info.relative_path,
                expires_at=upload_info.expires_at,
                owner_hash=owner_hash,
                max_bytes=settings.max_upload_bytes,
            ),
            asset_path=upload_info.relative_path,
            upload_url=upload_info.upload_url or "",
            method="PUT",
            headers=headers,
            expires_at=upload_info.expires_at,
            max_bytes=settings.max_upload_bytes,
        )

    def create_track_upload_target(
        self,
        studio_id: str,
        slot_id: int,
        request: DirectUploadRequest,
        *,
        owner_token: str | None = None,
        owner_token_hash: str | None,
    ) -> DirectUploadTarget:
        self.cleanup_expired_staged_uploads_if_due()
        filename, _suffix = _validated_track_upload_filename(request.source_kind, request.filename)
        settings = get_settings()
        if request.size_bytes > settings.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {settings.max_upload_bytes} byte limit.",
            )
        self.ensure_capacity(request.size_bytes)
        try:
            upload_info = self._asset_storage.create_direct_upload(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                content_type=request.content_type,
                expires_in_seconds=settings.direct_upload_expiration_seconds,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

        headers = dict(upload_info.headers)
        if not upload_info.upload_url and owner_token:
            headers["X-GigaStudy-Owner-Token"] = owner_token

        return DirectUploadTarget(
            asset_id=self._direct_upload_tokens.encode(
                relative_path=upload_info.relative_path,
                expires_at=upload_info.expires_at,
                owner_hash=owner_token_hash,
                max_bytes=settings.max_upload_bytes,
            ),
            asset_path=upload_info.relative_path,
            upload_url=upload_info.upload_url or "",
            method="PUT",
            headers=headers,
            expires_at=upload_info.expires_at,
            max_bytes=settings.max_upload_bytes,
        )

    def write_direct_upload_content(
        self,
        asset_id: str,
        content: bytes,
        *,
        owner_token: str | None = None,
        validate_track_upload_owner: Callable[[str, int], None] | None = None,
    ) -> dict[str, int | str]:
        upload_target = self._direct_upload_tokens.decode(
            asset_id,
            owner_policy_enabled=owner_policy_enabled(),
        )
        relative_path = upload_target["relative_path"]
        owner_hash = upload_target["owner_hash"]
        max_bytes = upload_target["max_bytes"]

        if owner_hash is not None:
            if owner_hash_for_request(owner_token, honor_public_token=True) != owner_hash:
                raise HTTPException(status_code=404, detail="Upload target not found.")
        elif owner_policy_enabled():
            raise HTTPException(status_code=404, detail="Upload target not found.")

        upload_owner = _track_upload_owner_from_path(relative_path)
        is_staged_upload = _is_staged_upload_path(relative_path)
        if upload_owner is None and not is_staged_upload:
            raise HTTPException(status_code=404, detail="Upload target not found.")
        if upload_owner is not None and validate_track_upload_owner is not None:
            studio_id, slot_id = upload_owner
            validate_track_upload_owner(studio_id, slot_id)
        if len(content) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {max_bytes} byte limit.",
            )
        self.ensure_capacity(len(content))
        try:
            self._asset_storage.write_direct_upload(relative_path=relative_path, content=content)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error
        return {"asset_path": relative_path, "size_bytes": len(content)}

    def register_asset(
        self,
        *,
        relative_path: str,
        kind: str,
        filename: str,
        size_bytes: int,
        content_type: str | None = None,
    ) -> None:
        self._asset_registry.upsert(
            AssetRecord(
                relative_path=relative_path,
                studio_id=_studio_id_from_asset_path(relative_path),
                kind=kind,
                filename=Path(filename).name or Path(relative_path).name,
                size_bytes=size_bytes,
                updated_at=_now(),
                content_type=content_type,
            )
        )

    def replace_audio_asset_with_aligned_wav(
        self,
        *,
        relative_audio_path: str,
        source_path: Path,
        source_label: str,
        audio_mime_type: str,
        transcription: VoiceTranscriptionResult,
    ) -> Path:
        if not transcription.alignment.applied or not relative_audio_path:
            return source_path
        aligned_content = build_metronome_aligned_wav_bytes(
            source_path,
            transcription.alignment.offset_seconds,
        )
        if aligned_content is None:
            return source_path
        old_size = source_path.stat().st_size if source_path.exists() else 0
        self.ensure_capacity(max(0, len(aligned_content) - old_size))
        try:
            aligned_path = self._asset_storage.write_direct_upload(
                relative_path=relative_audio_path,
                content=aligned_content,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        self.register_asset(
            relative_path=relative_audio_path,
            kind="upload",
            filename=source_label,
            size_bytes=len(aligned_content),
            content_type=audio_mime_type,
        )
        return aligned_path

    def delete_asset_file(self, relative_path: str) -> tuple[int, int]:
        try:
            result = self._asset_storage.delete_file(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Asset not found.") from error
        if result[0] > 0:
            self._asset_registry.mark_deleted(relative_path)
        return result

    def delete_asset_prefix(self, relative_prefix: str) -> tuple[int, int]:
        try:
            result = self._asset_storage.delete_prefix(relative_prefix)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        self._asset_registry.mark_prefix_deleted(relative_prefix)
        return result

    def delete_expired_staged_uploads(self) -> tuple[int, int]:
        settings = get_settings()
        cutoff = datetime.now(UTC) - timedelta(seconds=settings.staged_upload_retention_seconds)
        try:
            return self._asset_storage.delete_prefix_older_than("staged/", cutoff)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    def cleanup_expired_staged_uploads_if_due(self) -> None:
        settings = get_settings()
        if settings.lifecycle_cleanup_interval_seconds <= 0:
            return
        now = datetime.now(UTC)
        if (
            self._last_lifecycle_cleanup_at is not None
            and now - self._last_lifecycle_cleanup_at
            < timedelta(seconds=settings.lifecycle_cleanup_interval_seconds)
        ):
            return
        self._last_lifecycle_cleanup_at = now
        self.delete_expired_staged_uploads()

    def save_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_base64: str,
    ) -> Path:
        content = _decode_base64(content_base64)
        self.ensure_capacity(len(content))
        try:
            path = self._asset_storage.write_upload(
                studio_id=studio_id,
                slot_id=slot_id,
                filename=filename,
                content=content,
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        relative_path = self.relative_data_asset_path(path)
        self.register_asset(
            relative_path=relative_path,
            kind="upload",
            filename=filename,
            size_bytes=len(content),
            content_type=_guess_content_type(filename),
        )
        return path

    def resolve_existing_upload_asset(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        asset_path: str,
    ) -> Path:
        try:
            relative_path = self._asset_storage.normalize_reference(asset_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error

        expected_prefix = f"uploads/{studio_id}/{slot_id}/"
        if not relative_path.startswith(expected_prefix):
            raise HTTPException(status_code=404, detail="Upload target not found.")

        try:
            source_path = self._asset_storage.resolve_path(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.") from error
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.")

        size_bytes = source_path.stat().st_size
        if size_bytes <= 0:
            raise HTTPException(status_code=422, detail="Uploaded asset is empty.")
        max_upload_bytes = get_settings().max_upload_bytes
        if size_bytes > max_upload_bytes:
            self.delete_asset_file(relative_path)
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {max_upload_bytes} byte limit.",
            )

        self.ensure_capacity(size_bytes)
        self.register_asset(
            relative_path=relative_path,
            kind="upload",
            filename=filename,
            size_bytes=size_bytes,
            content_type=_guess_content_type(filename),
        )
        return source_path

    def promote_staged_seed_asset(
        self,
        *,
        studio_id: str,
        filename: str,
        source_kind: SeedSourceKind,
        asset_path: str,
    ) -> Path:
        filename, _suffix = _validated_studio_seed_upload_filename(source_kind, filename)
        try:
            relative_path = self._asset_storage.normalize_reference(asset_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Upload target not found.") from error

        if not _is_staged_upload_path(relative_path):
            raise HTTPException(status_code=404, detail="Upload target not found.")

        try:
            staged_path = self._asset_storage.resolve_path(relative_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.") from error
        if not staged_path.exists() or not staged_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded asset was not found.")

        size_bytes = staged_path.stat().st_size
        if size_bytes <= 0:
            raise HTTPException(status_code=422, detail="Uploaded asset is empty.")
        max_upload_bytes = get_settings().max_upload_bytes
        if size_bytes > max_upload_bytes:
            self.delete_asset_file(relative_path)
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the configured {max_upload_bytes} byte limit.",
            )

        self.ensure_capacity(size_bytes)
        try:
            promoted_path = self._asset_storage.write_upload(
                studio_id=studio_id,
                slot_id=0,
                filename=filename,
                content=staged_path.read_bytes(),
            )
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

        promoted_relative_path = self.relative_data_asset_path(promoted_path)
        self.register_asset(
            relative_path=promoted_relative_path,
            kind="upload",
            filename=filename,
            size_bytes=size_bytes,
            content_type=_guess_content_type(filename),
        )
        self.delete_asset_file(relative_path)
        return promoted_path

    def save_temp_upload(
        self,
        *,
        studio_id: str,
        slot_id: int,
        filename: str,
        content_base64: str,
    ) -> Path:
        content = _decode_base64(content_base64)
        safe_filename = Path(filename).name.strip() or "take.wav"
        temp_dir = self._root / "tmp" / studio_id / str(slot_id)
        temp_dir.mkdir(parents=True, exist_ok=True)
        path = temp_dir / f"{uuid4().hex}-{safe_filename}"
        path.write_bytes(content)
        return path

    def delete_temp_file(self, path: Path) -> None:
        try:
            resolved = path.resolve()
            resolved_root = self._root.resolve()
            if resolved != resolved_root and resolved_root in resolved.parents and resolved.exists():
                resolved.unlink()
                current = resolved.parent
                while current != resolved_root and resolved_root in current.parents:
                    try:
                        current.rmdir()
                    except OSError:
                        break
                    current = current.parent
        except OSError:
            return

    def persist_generated_asset(self, path: Path) -> str:
        size_bytes = path.stat().st_size if path.exists() else 0
        self.ensure_capacity(size_bytes)
        relative_path = self._asset_storage.persist_file(path)
        self.register_asset(
            relative_path=relative_path,
            kind="generated",
            filename=path.name,
            size_bytes=size_bytes,
        )
        return relative_path

    def relative_data_asset_path(self, path: Path) -> str:
        try:
            return self._asset_storage.relative_path(path)
        except AssetStorageError as error:
            raise HTTPException(status_code=500, detail="Uploaded asset is outside storage root.") from error

    def resolve_data_asset_path(self, asset_path: str) -> Path:
        try:
            return self._asset_storage.resolve_path(asset_path)
        except AssetStorageError as error:
            raise HTTPException(status_code=404, detail="Track audio source not found.") from error
