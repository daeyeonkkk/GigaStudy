import json
from functools import lru_cache
from typing import Annotated

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "GigaStudy Six-Track API"
    api_prefix: str = "/api"
    storage_root: str = "./storage"
    admin_token: str | None = None
    admin_username: str = "admin"
    admin_password: str | None = None
    admin_password_aliases: Annotated[list[str], NoDecode] = []
    studio_access_policy: str = "public"
    database_url: str | None = None
    storage_backend: str = "local"
    metadata_backend: str = "local"
    metadata_prefix: str = "metadata"
    s3_bucket: str | None = None
    s3_region: str = "auto"
    s3_endpoint_url: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_addressing_style: str = "path"
    max_upload_bytes: int = 15 * 1024 * 1024
    studio_soft_limit: int = 300
    studio_hard_limit: int = 500
    asset_warning_bytes: int = 7 * 1024 * 1024 * 1024
    asset_hard_bytes: int = int(8.5 * 1024 * 1024 * 1024)
    direct_upload_expiration_seconds: int = 15 * 60
    staged_upload_retention_seconds: int = 24 * 60 * 60
    pending_recording_retention_seconds: int = 30 * 60
    inactive_asset_retention_seconds: int = 7 * 24 * 60 * 60
    track_archive_non_pinned_limit: int = 3
    maintenance_cleanup_interval_seconds: int = 60 * 60
    maintenance_cleanup_batch_size: int = 5
    lifecycle_cleanup_interval_seconds: int = 15 * 60
    asset_cache_max_bytes: int = 256 * 1024 * 1024
    asset_cache_max_age_seconds: int = 6 * 60 * 60
    max_active_engine_jobs: int = 1
    engine_job_max_attempts: int = 3
    engine_job_lease_seconds: int = 10 * 60
    engine_drain_max_jobs: int = 3
    audiveris_bin: str | None = None
    document_extraction_backend: str = Field(
        default="auto",
        validation_alias=AliasChoices(
            "GIGASTUDY_API_DOCUMENT_EXTRACTION_BACKEND",
            "GIGASTUDY_API_OMR_BACKEND",
        ),
    )
    document_preprocess_mode: str = Field(
        default="retry",
        validation_alias=AliasChoices(
            "GIGASTUDY_API_DOCUMENT_PREPROCESS_MODE",
            "GIGASTUDY_API_OMR_PREPROCESS_MODE",
        ),
    )
    document_preprocess_dpi: int = Field(
        default=300,
        validation_alias=AliasChoices(
            "GIGASTUDY_API_DOCUMENT_PREPROCESS_DPI",
            "GIGASTUDY_API_OMR_PREPROCESS_DPI",
        ),
    )
    voice_transcription_backend: str = "auto"
    engine_processing_timeout_seconds: int = 120
    deepseek_harmony_enabled: bool = False
    deepseek_extraction_plan_enabled: bool = False
    deepseek_registration_review_enabled: bool = False
    deepseek_ensemble_review_enabled: bool = False
    deepseek_midi_role_review_enabled: bool = False
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_site_url: str | None = None
    deepseek_app_title: str = "GigaStudy"
    deepseek_timeout_seconds: float = 8.0
    deepseek_max_retries: int = 1
    deepseek_revision_cycles: int = 1
    deepseek_thinking_enabled: bool = False
    deepseek_temperature: float = 0.2
    deepseek_max_tokens: int = 1800
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    ]

    model_config = SettingsConfigDict(
        env_prefix="GIGASTUDY_API_",
        env_file=".env",
        env_file_encoding="utf-8",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            normalized = value.strip()
            if normalized.startswith("["):
                try:
                    decoded = json.loads(normalized)
                except json.JSONDecodeError:
                    decoded = None
                if isinstance(decoded, list):
                    return [str(item).strip() for item in decoded if str(item).strip()]
            return [item.strip() for item in value.split(",") if item.strip()]

        return value

    @field_validator("admin_password_aliases", mode="before")
    @classmethod
    def parse_admin_password_aliases(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            normalized = value.strip()
            if normalized.startswith("["):
                try:
                    decoded = json.loads(normalized)
                except json.JSONDecodeError:
                    decoded = None
                if isinstance(decoded, list):
                    return [str(item).strip() for item in decoded if str(item).strip()]
            return [item.strip() for item in value.split(",") if item.strip()]

        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
