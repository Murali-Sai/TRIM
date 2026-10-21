"""Task 5.4: security headers. AC: a securityheaders.com-style check passes. The site's own
headers (web/public/_headers) are graded in web/e2e/security-headers.spec.ts."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import CsrfClient

# What securityheaders.com grades, plus HSTS long enough to be preloaded.
REQUIRED = (
    "strict-transport-security",
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
)


def grade(headers: Any) -> list[str]:
    """Problems found; none is an A+."""
    problems = [f"missing {h}" for h in REQUIRED if h not in headers]
    hsts = headers.get("strict-transport-security", "")
    age = next((p.split("=")[1] for p in hsts.split(";") if p.strip().startswith("max-age")), "0")
    if int(age) < 31_536_000:
        problems.append("HSTS shorter than a year")
    csp = headers.get("content-security-policy", "")
    if "unsafe-inline" in csp or "unsafe-eval" in csp:
        problems.append("CSP allows inline or eval scripts")
    if "frame-ancestors 'none'" not in csp:
        problems.append("CSP lets other sites frame the API")
    if headers.get("x-content-type-options") != "nosniff":
        problems.append("nosniff missing")
    return problems


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/api/health"), ("GET", "/api/me"), ("POST", "/api/auth/login"), ("GET", "/api/nope")],
)
def test_ac_every_response_grades_a_plus(client: CsrfClient, method: str, path: str) -> None:
    res = client.request(method, path, json={} if method == "POST" else None)
    assert grade(res.headers) == [], (path, res.status_code)


def test_refusals_from_the_proxy_guard_carry_them_too(
    client: CsrfClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pydantic import SecretStr

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr("s3cret"))
    res = TestClient(client.app).get("/api/health")
    assert res.status_code == 403
    assert grade(res.headers) == []


def test_the_docs_page_may_load_swagger(client: CsrfClient) -> None:
    res = client.get("/api/docs")
    assert res.status_code == 200
    assert "https://cdn.jsdelivr.net" in res.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
