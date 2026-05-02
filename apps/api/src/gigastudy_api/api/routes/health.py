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
    object_storage_configured = (
        settings.storage_backend == "s3"
        and bool(settings.s3_bucket)
        and bool(settings.s3_endpoint_url)
        and bool(settings.s3_access_key_id)
        and bool(settings.s3_secret_access_key)
    )
    deepseek_configured = bool(settings.deepseek_api_key)
    return {
        "status": "ready",
        "service": "gigastudy-six-track-api",
        "version": __version__,
        "environment": settings.app_env,
        "storage_backend": settings.storage_backend,
        "object_storage_configured": object_storage_configured,
        "database_configured": bool(settings.database_url),
        "studio_access_policy": settings.studio_access_policy,
        "max_upload_bytes": settings.max_upload_bytes,
        "max_active_engine_jobs": settings.max_active_engine_jobs,
        "engine_drain_max_jobs": settings.engine_drain_max_jobs,
        "omr_backend": settings.omr_backend,
        "voice_transcription_backend": settings.voice_transcription_backend,
        "deepseek_configured": deepseek_configured,
        "deepseek_harmony_enabled": deepseek_configured and settings.deepseek_harmony_enabled,
        "deepseek_registration_review_enabled": deepseek_configured and settings.deepseek_registration_review_enabled,
        "deepseek_ensemble_review_enabled": deepseek_configured and settings.deepseek_ensemble_review_enabled,
    }
