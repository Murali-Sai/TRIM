from functools import lru_cache

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Cloudflare's published test secret: always passes, and only accepts the dummy token.
TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA"  # noqa: S105  secret-grep: allow
DEV_OFF_USER_AGENT = "TRIM/0.1 (development build)"


class Settings(BaseSettings):
    """Runtime config, read from environment variables (prefix TRIM_) or api/.env."""

    model_config = SettingsConfigDict(env_prefix="TRIM_", env_file=".env", extra="ignore")

    env: str = "dev"
    # The API connects as a login role that is a member of trim_app: not the table owner and
    # without BYPASSRLS, so row-level security always applies.
    database_url: str = "postgresql+psycopg://trim_api:trim_api@127.0.0.1:5433/trim"
    # Migrations run as the schema owner.
    migration_database_url: str = "postgresql+psycopg://trim:trim@127.0.0.1:5433/trim"

    # Origin of the web app, used to build links in emails.
    app_base_url: str = "http://localhost:5173"
    # Secure cookies with the __Host- prefix. Off only for local http development and tests.
    cookie_secure: bool = False
    # Shared with the Cloudflare Pages Function. When set, /api only answers the proxy.
    proxy_secret: SecretStr | None = None
    # Secret mixed into IP hashes so stored hashes cannot be reversed by brute force.
    ip_hash_pepper: SecretStr = SecretStr("dev-only-pepper")

    turnstile_secret: SecretStr = SecretStr(TURNSTILE_TEST_SECRET)
    breach_check_enabled: bool = True

    # No Resend key means emails are written to outbox_dir instead of being sent.
    resend_api_key: SecretStr | None = None
    email_from: str = "TRIM <no-reply@localhost>"
    outbox_dir: str = ".outbox"

    # Food search. No FDC key means search uses only personal foods, the cache and OFF.
    fdc_api_key: SecretStr | None = None
    # Open Food Facts asks every app to identify itself: "AppName/Version (contact)".
    off_user_agent: str = DEV_OFF_USER_AGENT

    # Web Push (streak reminders). Without keys, reminders are off and the app says so.
    vapid_public_key: str | None = None
    vapid_private_key: SecretStr | None = None
    vapid_subject: str = "mailto:admin@localhost"
    # The hourly job (Cloud Scheduler) sends this in X-Job-Token. Unset: the job is refused.
    job_token: SecretStr | None = None

    @model_validator(mode="after")
    def _no_dev_defaults_in_prod(self) -> "Settings":
        if self.env == "prod":
            if self.turnstile_secret.get_secret_value() == TURNSTILE_TEST_SECRET:
                raise ValueError("TRIM_TURNSTILE_SECRET must be a real secret in prod")
            if self.ip_hash_pepper.get_secret_value() == "dev-only-pepper":
                raise ValueError("TRIM_IP_HASH_PEPPER must be set in prod")
            if self.resend_api_key is None:
                raise ValueError("TRIM_RESEND_API_KEY must be set in prod")
            if not self.cookie_secure:
                raise ValueError("TRIM_COOKIE_SECURE must be true in prod")
            if self.proxy_secret is None or len(self.proxy_secret.get_secret_value()) < 32:
                raise ValueError("TRIM_PROXY_SECRET must be set (32+ characters) in prod")
            if self.fdc_api_key is None:
                raise ValueError("TRIM_FDC_API_KEY must be set in prod")
            if self.off_user_agent == DEV_OFF_USER_AGENT:
                raise ValueError("TRIM_OFF_USER_AGENT must name the app and a contact in prod")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
