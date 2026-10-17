from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime config, read from environment variables (prefix TRIM_) or api/.env."""

    model_config = SettingsConfigDict(env_prefix="TRIM_", env_file=".env", extra="ignore")

    env: str = "dev"
    # The API connects as a login role that is a member of trim_app: not the table owner and
    # without BYPASSRLS, so row-level security always applies.
    database_url: str = "postgresql+psycopg://trim_api:trim_api@127.0.0.1:5433/trim"
    # Migrations run as the schema owner.
    migration_database_url: str = "postgresql+psycopg://trim:trim@127.0.0.1:5433/trim"


@lru_cache
def get_settings() -> Settings:
    return Settings()
