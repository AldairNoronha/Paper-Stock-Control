from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_name: str = "Paper Stock Control API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/postgres"
    )
    cors_origins: str = "http://localhost:5173"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_jwks_url: str = (
        "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json"
    )
    supabase_jwt_secret: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    supabase_storage_bucket: str = "label-images"
    label_ocr_enabled: bool = False
    google_vision_api_key: SecretStr = SecretStr("")
    label_ocr_timeout_seconds: int = Field(default=35, ge=5, le=90)
    label_ocr_daily_limit: int = Field(default=100, ge=1, le=10000)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
