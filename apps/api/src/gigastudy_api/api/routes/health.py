from fastapi import APIRouter

from gigastudy_api import __version__
from gigastudy_api.config import get_settings

router = APIRouter()


@router.get("/health")
def read_health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "gigastudy-six-track-api",
    }


@router.get("/health/ready")
def read_readiness() -> dict[str, str | int | bool]:
    settings = get_settings()
    storage_backend = settings.storage_backend.strip().lower()
    configured_metadata_backend = settings.metadata_backend.strip().lower()
    object_storage_configured = (
        storage_backend in {"s3", "r2"}
        and bool(settings.s3_bucket)
        and bool(settings.s3_endpoint_url)
        and bool(settings.s3_access_key_id)
        and bool(settings.s3_secret_access_key)
    )
    metadata_backend = "postgres" if settings.database_url else configured_metadata_backend
    metadata_configured = bool(settings.database_url) or (
        configured_metadata_backend in {"s3", "r2"} and object_storage_configured
    ) or configured_metadata_backend == "local"
    deepseek_configured = bool(settings.deepseek_api_key)
    return {
        "status": "ready",
        "service": "gigastudy-six-track-api",
        "version": __version__,
        "environment": settings.app_env,
        "storage_backend": storage_backend,
        "metadata_backend": metadata_backend,
        "metadata_prefix": settings.metadata_prefix,
        "metadata_configured": metadata_configured,
        "object_storage_configured": object_storage_configured,
        "database_configured": bool(settings.database_url),
        "studio_access_policy": settings.studio_access_policy,
        "max_upload_bytes": settings.max_upload_bytes,
        "max_active_engine_jobs": settings.max_active_engine_jobs,
        "engine_drain_max_jobs": settings.engine_drain_max_jobs,
        "min_instance_policy": 0,
        "pending_recording_retention_seconds": settings.pending_recording_retention_seconds,
        "inactive_asset_retention_seconds": settings.inactive_asset_retention_seconds,
        "track_archive_non_pinned_limit": settings.track_archive_non_pinned_limit,
        "document_extraction_backend": settings.document_extraction_backend,
        "voice_transcription_backend": settings.voice_transcription_backend,
        "deepseek_configured": deepseek_configured,
        "deepseek_harmony_enabled": deepseek_configured and settings.deepseek_harmony_enabled,
        "deepseek_midi_role_review_enabled": deepseek_configured and settings.deepseek_midi_role_review_enabled,
        "deepseek_registration_review_enabled": deepseek_configured and settings.deepseek_registration_review_enabled,
        "deepseek_ensemble_review_enabled": deepseek_configured and settings.deepseek_ensemble_review_enabled,
    }
