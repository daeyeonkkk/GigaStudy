from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "GigaStudy API"
    api_prefix: str = "/api"
    public_app_url: str | None = None
    database_url: str = "sqlite:///./gigastudy.db"
    database_echo: bool = False
    default_user_nickname: str = "local-dev"
    storage_backend: str = "local"
    storage_root: str = "./storage"
    s3_bucket: str | None = None
    s3_region: str | None = None
    s3_endpoint_url: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_session_token: str | None = None
    s3_addressing_style: str = "path"
    basic_pitch_node_binary: str = "node"
    basic_pitch_timeout_seconds: int = 90
    analysis_timeout_seconds: int = 15
    upload_session_expiry_minutes: int = 30
    ops_recent_limit: int = 8
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
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
            return [item.strip() for item in value.split(",") if item.strip()]

        return value

    @field_validator("public_app_url", mode="before")
    @classmethod
    def normalize_public_app_url(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized = value.strip()
        if not normalized:
            return None

        return normalized.rstrip("/")

    @field_validator("storage_backend", mode="before")
    @classmethod
    def normalize_storage_backend(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("s3_endpoint_url", mode="before")
    @classmethod
    def normalize_s3_endpoint_url(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized = value.strip()
        if not normalized:
            return None

        return normalized.rstrip("/")

    @field_validator("s3_addressing_style", mode="before")
    @classmethod
    def normalize_s3_addressing_style(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"auto", "path", "virtual"}:
            return "path"
        return normalized


@lru_cache
def get_settings() -> Settings:
    return Settings()
