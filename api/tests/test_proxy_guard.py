"""Task 1.8, API side: only the same-origin proxy may call /api in production, and
X-Forwarded-For is trusted only from it."""

import uuid
from collections.abc import Iterator

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings
from tests.conftest import CsrfClient

SECRET = "s" * 40
PROXY = {"x-trim-proxy-secret": SECRET}


@pytest.fixture
def settings_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """Lets a test change TRIM_* settings; the cached settings are rebuilt around it."""
    get_settings.cache_clear()
    yield monkeypatch
    monkeypatch.undo()
    get_settings.cache_clear()


def configure(mp: pytest.MonkeyPatch, **values: str) -> None:
    for key, value in values.items():
        mp.setenv(f"TRIM_{key.upper()}", value)
    get_settings.cache_clear()


def wrong_logins_from(
    client: CsrfClient, addresses: list[str], headers: dict[str, str]
) -> list[int]:
    codes = []
    for addr in addresses:
        res = client.post(
            "/api/auth/login",
            json={
                "email": f"nobody-{uuid.uuid4().hex[:8]}@example.com",
                "password": "wrong password!",
            },
            headers={**headers, "x-forwarded-for": addr},
        )
        codes.append(res.status_code)
    return codes


def test_without_a_secret_configured_requests_pass(client: CsrfClient) -> None:
    assert client.get("/api/health").status_code == 200


def test_requests_that_skip_the_proxy_are_refused(
    client: CsrfClient, settings_env: pytest.MonkeyPatch
) -> None:
    configure(settings_env, proxy_secret=SECRET)
    assert client.get("/api/health").status_code == 403
    assert client.get("/api/health", headers={"x-trim-proxy-secret": "guess"}).status_code == 403
    assert client.get("/api/health", headers=PROXY).status_code == 200


def test_forwarded_for_is_ignored_outside_dev_without_the_proxy(
    client: CsrfClient, settings_env: pytest.MonkeyPatch
) -> None:
    configure(settings_env, env="staging")
    # Five different "addresses" are really one client: the 6th attempt hits the IP lock.
    codes = wrong_logins_from(client, [f"198.51.100.{n}" for n in range(6)], {})
    assert codes == [401] * 5 + [429]


def test_forwarded_for_is_trusted_from_the_proxy(
    client: CsrfClient, settings_env: pytest.MonkeyPatch
) -> None:
    configure(settings_env, env="staging", proxy_secret=SECRET)
    # Through the proxy, each address is its own client: nobody is locked.
    codes = wrong_logins_from(client, [f"198.51.100.{n}" for n in range(6)], PROXY)
    assert codes == [401] * 6


def test_prod_requires_a_long_proxy_secret() -> None:
    base = {
        "env": "prod",
        "turnstile_secret": "real-turnstile-secret",
        "ip_hash_pepper": "real-pepper",
        "resend_api_key": "re_real",
        "cookie_secure": True,
    }
    with pytest.raises(ValidationError, match="TRIM_PROXY_SECRET"):
        Settings(**base)  # type: ignore[arg-type]
    with pytest.raises(ValidationError, match="TRIM_PROXY_SECRET"):
        Settings(**base, proxy_secret="short")  # type: ignore[arg-type]
    assert Settings(**base, proxy_secret=SECRET).proxy_secret is not None  # type: ignore[arg-type]
