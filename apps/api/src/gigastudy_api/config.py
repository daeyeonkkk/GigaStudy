import json
from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "GigaStudy Six-Track API"
    api_prefix: str = "/api"
    storage_root: str = "./storage"
    admin_token: str | None = None
    admin_username: str = "admin"
    admin_password: str = "\ub300\uc5f0123"
    studio_access_policy: str = "public"
    database_url: str | None = None
    storage_backend: str = "local"
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
    lifecycle_cleanup_interval_seconds: int = 15 * 60
    max_active_engine_jobs: int = 1
    engine_job_max_attempts: int = 3
    engine_job_lease_seconds: int = 10 * 60
    engine_drain_max_jobs: int = 3
    audiveris_bin: str | None = None
    engine_processing_timeout_seconds: int = 120
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
