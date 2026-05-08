from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException

from gigastudy_api.api.schemas.admin import AdminDeleteResult, AdminStorageSummary, AdminStudioSummary
from gigastudy_api.config import get_settings
from gigastudy_api.api.schemas.studios import Studio
from gigastudy_api.services.alpha_limits import build_admin_limit_summary
from gigastudy_api.services.asset_paths import studio_id_from_asset_path
from gigastudy_api.services.document_job_recovery import (
    recover_stale_running_document_jobs,
    sanitize_failed_document_job_messages,
)
from gigastudy_api.services.engine_queue import EngineQueueStore
from gigastudy_api.services.studio_admin import (
    build_admin_studio_summary,
    clear_asset_references,
    clear_studio_asset_references,
    referenced_asset_paths,
)
from gigastudy_api.services.studio_assets import StudioAssetService
from gigastudy_api.services.studio_documents import encode_studio_payload
from gigastudy_api.services.studio_store import ActiveStatus, StudioStore


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
        self._last_maintenance_cleanup_at: datetime | None = None

    def storage_summary(
        self,
        *,
        studio_limit: int = 50,
        studio_offset: int = 0,
        asset_limit: int = 25,
        asset_offset: int = 0,
        sync_missing_assets: bool = False,
        studio_status: str = "active",
    ) -> AdminStorageSummary:
        self.cleanup_if_due()
        active_status = _normalize_active_status(studio_status)
        with self._lock:
            studio_count = self._store.count(active_status=active_status)
            active_studio_count = self._store.count(active_status="active")
            inactive_studio_count = self._store.count(active_status="inactive")
            total_studio_count = self._store.count(active_status="all")
            studios = self._list_studios(
                limit=studio_limit,
                offset=studio_offset,
                active_status=active_status,
            )

        studio_summaries = [
            self._build_studio_summary(
                studio,
                asset_limit=asset_limit,
                asset_offset=asset_offset,
                sync_missing_assets=sync_missing_assets,
            )
            for studio in studios
        ]
        metadata_bytes = self._store.estimate_total_bytes()
        asset_count, asset_bytes = self._assets.summarize_all()
        listed_asset_count = sum(len(studio.assets) for studio in studio_summaries)
        return AdminStorageSummary(
            storage_root=self._assets.storage_label,
            studio_count=studio_count,
            active_studio_count=active_studio_count,
            inactive_studio_count=inactive_studio_count,
            studio_status=active_status,
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
                studio_count=total_studio_count,
                asset_bytes=asset_bytes,
            ),
            studios=studio_summaries,
        )

    def deactivate_studio(self, studio_id: str) -> AdminDeleteResult:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = self._now()
            studio.is_active = False
            studio.deactivated_at = timestamp
            studio.updated_at = timestamp
            self._save_studio(studio)
        return AdminDeleteResult(
            deleted=True,
            message="Studio deactivated and hidden from the public list.",
            studio_id=studio_id,
        )

    def delete_inactive_studios(
        self,
        *,
        background_tasks: Any | None = None,
    ) -> AdminDeleteResult:
        with self._lock:
            inactive_studios = self._list_studios(limit=10_000, offset=0, active_status="inactive")
            studio_ids = [studio.studio_id for studio in inactive_studios]
            for studio_id in studio_ids:
                self._store.delete_one_raw(studio_id)

        for studio_id in studio_ids:
            self._engine_queue.delete_studio_jobs(studio_id)

        if background_tasks is not None:
            for studio_id in studio_ids:
                background_tasks.add_task(self._delete_studio_asset_prefixes, studio_id)
            return AdminDeleteResult(
                deleted=True,
                message=f"{len(studio_ids)} inactive studios removed. Stored asset cleanup is running in the background.",
                deleted_files=0,
                deleted_bytes=0,
                cleanup_queued=bool(studio_ids),
            )

        deleted_files = 0
        deleted_bytes = 0
        for studio_id in studio_ids:
            files, bytes_deleted = self._delete_studio_asset_prefixes(studio_id)
            deleted_files += files
            deleted_bytes += bytes_deleted
        return AdminDeleteResult(
            deleted=True,
            message=f"{len(studio_ids)} inactive studios permanently deleted.",
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_studio(
        self,
        studio_id: str,
        *,
        background_tasks: Any | None = None,
    ) -> AdminDeleteResult:
        with self._lock:
            if not self._store.delete_one_raw(studio_id):
                raise HTTPException(status_code=404, detail="Studio not found.")

        self._engine_queue.delete_studio_jobs(studio_id)
        if background_tasks is not None:
            background_tasks.add_task(self._delete_studio_asset_prefixes, studio_id)
            return AdminDeleteResult(
                deleted=True,
                message="Studio metadata deleted. Stored asset cleanup is running in the background.",
                studio_id=studio_id,
                cleanup_queued=True,
            )

        deleted_files, deleted_bytes = self._delete_studio_asset_prefixes(studio_id)
        return AdminDeleteResult(
            deleted=True,
            message="Studio and stored assets deleted.",
            studio_id=studio_id,
            deleted_files=deleted_files,
            deleted_bytes=deleted_bytes,
        )

    def delete_studio_assets(
        self,
        studio_id: str,
        *,
        background_tasks: Any | None = None,
    ) -> AdminDeleteResult:
        with self._lock:
            studio = self._load_studio(studio_id)
            if studio is None:
                raise HTTPException(status_code=404, detail="Studio not found.")
            timestamp = self._now()
            clear_studio_asset_references(studio, timestamp=timestamp)
            studio.updated_at = timestamp
            self._save_studio(studio)

        if background_tasks is not None:
            background_tasks.add_task(self._delete_studio_asset_prefixes, studio_id)
            return AdminDeleteResult(
                deleted=True,
                message="Studio asset references cleared. Stored asset cleanup is running in the background.",
                studio_id=studio_id,
                cleanup_queued=True,
            )

        deleted_files, deleted_bytes = self._delete_studio_asset_prefixes(studio_id)
        return AdminDeleteResult(
            deleted=True,
            message="Studio assets deleted. Normalized track events and reports were kept.",
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

    def cleanup_if_due(self) -> None:
        settings = get_settings()
        if settings.maintenance_cleanup_interval_seconds <= 0:
            return
        now = datetime.now(UTC)
        if (
            self._last_maintenance_cleanup_at is not None
            and now - self._last_maintenance_cleanup_at
            < timedelta(seconds=settings.maintenance_cleanup_interval_seconds)
        ):
            return
        self._last_maintenance_cleanup_at = now
        self.run_maintenance_cleanup()

    def run_maintenance_cleanup(self) -> AdminDeleteResult:
        settings = get_settings()
        now = datetime.now(UTC)
        batch_size = max(1, settings.maintenance_cleanup_batch_size)
        pending_cutoff = now - timedelta(seconds=settings.pending_recording_retention_seconds)
        inactive_cutoff = now - timedelta(seconds=settings.inactive_asset_retention_seconds)
        deleted_files = 0
        deleted_bytes = 0
        recovered_jobs = 0
        sanitized_jobs = 0

        staged_files, staged_bytes = self._assets.delete_expired_staged_uploads()
        deleted_files += staged_files
        deleted_bytes += staged_bytes

        with self._lock:
            studios = self._list_studios(limit=10_000, offset=0, active_status="all")

        processed_studios = 0
        for studio in studios:
            if processed_studios >= batch_size:
                break
            with self._lock:
                current = self._load_studio(studio.studio_id)
                if current is None:
                    continue
                timestamp = self._now()
                recovered_job_ids = recover_stale_running_document_jobs(
                    current,
                    now=now,
                    stale_seconds=settings.document_job_stale_seconds,
                    timestamp=timestamp,
                )
                sanitized_job_ids = sanitize_failed_document_job_messages(
                    current,
                    timestamp=timestamp,
                )
                if not recovered_job_ids and not sanitized_job_ids:
                    continue
                self._save_studio(current)
            for job_id in recovered_job_ids:
                self._engine_queue.fail(job_id, message="Stale document job failed.")
            recovered_jobs += len(recovered_job_ids)
            sanitized_jobs += len(sanitized_job_ids)
            processed_studios += 1

        processed_studios = 0
        for studio in studios:
            if processed_studios >= batch_size:
                break
            if studio.is_active is not False:
                continue
            deactivated_at = _parse_iso(studio.deactivated_at)
            if deactivated_at is None or deactivated_at > inactive_cutoff:
                continue
            with self._lock:
                current = self._load_studio(studio.studio_id)
                if current is None:
                    continue
                timestamp = self._now()
                clear_studio_asset_references(current, timestamp=timestamp)
                current.updated_at = timestamp
                self._save_studio(current)
            files, bytes_deleted = self._delete_studio_asset_prefixes(studio.studio_id)
            deleted_files += files
            deleted_bytes += bytes_deleted
            processed_studios += 1

        for studio in studios:
            if processed_studios >= batch_size:
                break
            if studio.is_active is False:
                continue
            referenced_paths = referenced_asset_paths(
                studio,
                normalize_reference=self._assets.normalize_reference,
            )
            files, bytes_deleted = self._assets.delete_unreferenced_studio_assets(
                studio.studio_id,
                referenced_paths=referenced_paths,
                cutoff=pending_cutoff,
                limit=batch_size - processed_studios,
            )
            if files:
                deleted_files += files
                deleted_bytes += bytes_deleted
                processed_studios += 1

        return AdminDeleteResult(
            deleted=True,
            message=_maintenance_cleanup_message(
                recovered_jobs=recovered_jobs,
                sanitized_jobs=sanitized_jobs,
            ),
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
        sync_missing_assets: bool,
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
            sync_missing=sync_missing_assets,
        )
        return build_admin_studio_summary(
            studio,
            asset_count=asset_count,
            asset_bytes=asset_bytes,
            assets=assets,
        )

    def _list_studios(
        self,
        *,
        limit: int,
        offset: int,
        active_status: ActiveStatus = "all",
    ) -> list[Studio]:
        raw_rows = self._store.list_raw(limit=limit, offset=offset, active_status=active_status)
        return [Studio.model_validate(studio_payload) for _studio_id, studio_payload in raw_rows]

    def _load_studio(self, studio_id: str) -> Studio | None:
        raw_payload = self._store.load_one_raw(studio_id)
        if raw_payload is None:
            return None
        return Studio.model_validate(raw_payload)

    def _save_studio(self, studio: Studio) -> None:
        self._store.save_one_raw(studio.studio_id, encode_studio_payload(studio))

    def _delete_studio_asset_prefixes(self, studio_id: str) -> tuple[int, int]:
        upload_files, upload_bytes = self._assets.delete_asset_prefix(f"uploads/{studio_id}/")
        job_files, job_bytes = self._assets.delete_asset_prefix(f"jobs/{studio_id}/")
        return upload_files + job_files, upload_bytes + job_bytes


def _normalize_active_status(value: str) -> ActiveStatus:
    normalized = value.strip().lower()
    if normalized in {"active", "inactive", "all"}:
        return normalized  # type: ignore[return-value]
    raise HTTPException(status_code=422, detail="studio_status must be active, inactive, or all.")


def _maintenance_cleanup_message(*, recovered_jobs: int, sanitized_jobs: int) -> str:
    parts = ["Maintenance cleanup completed."]
    if recovered_jobs:
        parts.append(f"Recovered {recovered_jobs} stale document job(s).")
    if sanitized_jobs:
        parts.append(f"Sanitized {sanitized_jobs} document job message(s).")
    return " ".join(parts)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
