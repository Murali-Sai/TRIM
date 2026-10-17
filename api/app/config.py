from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime config, read from environment variables (prefix TRIM_) or api/.env."""

    model_config = SettingsConfigDict(env_prefix="TRIM_", env_file=".env", extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql+psycopg://trim:trim@127.0.0.1:5432/trim"


@lru_cache
def get_settings() -> Settings:
    return Settings()
