from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from gigastudy_api.api.schemas.admin import AdminDeleteResult, AdminStorageSummary, AdminStudioSummary
from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.services.alpha_limits import build_admin_limit_summary
from gigastudy_api.services.asset_paths import studio_id_from_asset_path
from gigastudy_api.services.engine_queue import EngineQueueStore
from gigastudy_api.services.studio_admin import (
    build_admin_studio_summary,
    clear_asset_references,
    clear_studio_asset_references,
    referenced_asset_paths,
)
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_documents import encode_studio_payload
from gigastudy_api.services.studio_store import StudioStore


class StudioAdminCommands:
    def __init__(
        self,
        *,
        assets: StudioAssetService,
        engine_queue: EngineQueueStore,
        lock: Any,
        store: StudioStore,
        now: Any,
    ) -> None:
        self._assets = assets
        self._engine_queue = engine_queue
        self._lock = lock
        self._store = store
        self._now = now

    def storage_summary(
        self,
        *,
        studio_limit: int = 50,
        studio_offset: int = 0,
        asset_limit: int = 25,
        asset_offset: int = 0,
    ) -> AdminStorageSummary:
        with self._lock:
            studio_count = self._store.count()
            studios = self._list_studios(limit=studio_limit, offset=studio_offset)

        studio_summaries = [
            self._build_studio_summary(
                studio,
                asset_limit=asset_limit,
                asset_offset=asset_offset,
            )
            for studio in studios
        ]
        metadata_bytes = self._store.estimate_total_bytes()
        asset_count, asset_bytes = self._assets.summarize_all()
        listed_asset_count = sum(len(studio.assets) for studio in studio_summaries)
        return AdminStorageSummary(
            storage_root=self._assets.storage_label,
            studio_count=studio_count,
            listed_studio_count=len(studio_summaries),
            studio_limit=studio_limit,
            studio_offset=studio_offset,
            has_more_studios=studio_offset + len(studio_summaries) < studio_count,
            asset_limit=asset_limit,
            asset_offset=asset_offset,
            asset_count=asset_count,
            listed_asset_count=listed_asset_count,
            total_asset_bytes=asset_bytes,
            total_bytes=metadata_bytes + asset_bytes,
            metadata_bytes=metadata_bytes,
            limits=build_admin_limit_summary(
                studio_count=studio_count,
                asset_bytes=asset_bytes,
            ),
            studios=studio_summaries,
        )

    def delete_studio(self, studio_id: str) -> AdminDeleteResult:
        with self._lock:
            if not self._store.delete_one_raw(studio_id):
                raise HTTPException(status_code=404, detail="Studio not found.")

        self._engine_queue.delete_studio_jobs(studio_id)
        upload_files, upload_bytes = self._assets.delete_asset_prefix(f"uploads/{studio_id}/")
        job_files, job_bytes = self._assets.delete_asset_prefix(f"jobs/{studio_id}/")
        deleted_files = upload_files + job_files
        deleted_bytes = upload_bytes + job_bytes
        return AdminDeleteResult(
            deleted=True,
            message="Studio and stored assets deleted.",
            studio_id=studio_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_studio_assets(self, studio_id: str) -> AdminDeleteResult:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = self._now()
            clear_studio_asset_references(studio, timestamp=timestamp)
            studio.updated_at = timestamp
            self._save_studio(studio)

        upload_files, upload_bytes = self._assets.delete_asset_prefix(f"uploads/{studio_id}/")
        job_files, job_bytes = self._assets.delete_asset_prefix(f"jobs/{studio_id}/")
        deleted_files = upload_files + job_files
        deleted_bytes = upload_bytes + job_bytes
        return AdminDeleteResult(
            deleted=True,
            message="Studio assets deleted. Normalized track notes and reports were kept.",
            studio_id=studio_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_staged_assets(self) -> AdminDeleteResult:
        deleted_files, deleted_bytes = self._assets.delete_asset_prefix("staged/")
        return AdminDeleteResult(
            deleted=True,
            message="Abandoned staged upload assets deleted.",
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_expired_staged_assets(self) -> AdminDeleteResult:
        deleted_files, deleted_bytes = self._assets.delete_expired_staged_uploads()
        return AdminDeleteResult(
            deleted=True,
            message="Expired staged upload assets deleted.",
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_asset(self, asset_id: str) -> AdminDeleteResult:
        relative_path = self._assets.decode_asset_id(asset_id)
        deleted_files, deleted_bytes = self._assets.delete_asset_file(relative_path)
        if deleted_files == 0:
            raise HTTPException(status_code=404, detail="Asset not found.")

        with self._lock:
            studio_id = studio_id_from_asset_path(relative_path)
            timestamp = self._now()
            if studio_id is not None:
                studio = self._load_studio(studio_id)
                if studio is not None and clear_asset_references(
                    studio,
                    relative_path=relative_path,
                    timestamp=timestamp,
                    normalize_reference=self._assets.normalize_reference,
                ):
                    studio.updated_at = timestamp
                    self._save_studio(studio)

        return AdminDeleteResult(
            deleted=True,
            message="Asset deleted.",
            studio_id=studio_id,
            asset_id=asset_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def _build_studio_summary(
        self,
        studio: Studio,
        *,
        asset_limit: int,
        asset_offset: int,
    ) -> AdminStudioSummary:
        referenced_paths = referenced_asset_paths(
            studio,
            normalize_reference=self._assets.normalize_reference,
        )
        asset_count, asset_bytes, assets = self._assets.list_admin_asset_summaries(
            studio.studio_id,
            referenced_paths=referenced_paths,
            limit=asset_limit,
            offset=asset_offset,
        )
        return build_admin_studio_summary(
            studio,
            asset_count=asset_count,
            asset_bytes=asset_bytes,
            assets=assets,
        )

    def _list_studios(self, *, limit: int, offset: int) -> list[Studio]:
        raw_rows = self._store.list_raw(limit=limit, offset=offset)
        return [Studio.model_validate(studio_payload) for _studio_id, studio_payload in raw_rows]

    def _load_studio(self, studio_id: str) -> Studio | None:
        raw_payload = self._store.load_one_raw(studio_id)
        if raw_payload is None:
            return None
        return Studio.model_validate(raw_payload)

    def _save_studio(self, studio: Studio) -> None:
        self._store.save_one_raw(studio.studio_id, encode_studio_payload(studio))
