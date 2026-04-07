from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "GigaStudy API"
    api_prefix: str = "/api"
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
