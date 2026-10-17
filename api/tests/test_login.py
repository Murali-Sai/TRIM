"""Task 1.5: login, logout, sessions, CSRF and lockout.
AC: the 6th failed attempt in 15 minutes is locked; a write without the CSRF header gets 403."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.main import create_app
from app.security.tokens import hash_token
from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import PASSWORD, log_in, sign_up, sign_up_and_get_token, signup_body


def ip(addr: str) -> dict[str, str]:
    return {"x-forwarded-for": addr}


# --- CSRF ---------------------------------------------------------------------------------


@pytest.fixture
def bare_client(owner_engine: Engine, fakes: Fakes) -> Any:
    with TestClient(create_app(fakes.services())) as c:
        yield c


def test_first_get_sets_a_readable_csrf_cookie(bare_client: TestClient) -> None:
    res = bare_client.get("/api/health")
    cookie = res.headers["set-cookie"]
    assert cookie.startswith("trim_csrf=")
    assert "HttpOnly" not in cookie
    assert "SameSite=lax" in cookie


@pytest.mark.parametrize(
    "path", ["/api/auth/signup", "/api/auth/login", "/api/auth/logout", "/api/auth/verify"]
)
def test_write_without_csrf_header_is_403(bare_client: TestClient, path: str) -> None:
    bare_client.get("/api/auth/csrf")
    res = bare_client.post(path, json={})
    assert res.status_code == 403
    assert res.json() == {"detail": "CSRF check failed"}


def test_write_with_wrong_csrf_header_is_403(bare_client: TestClient) -> None:
    bare_client.get("/api/auth/csrf")
    res = bare_client.post("/api/auth/login", json={}, headers={"x-csrf-token": "forged"})
    assert res.status_code == 403


def test_write_with_header_but_no_cookie_is_403(bare_client: TestClient) -> None:
    res = bare_client.post("/api/auth/login", json={}, headers={"x-csrf-token": "anything"})
    assert res.status_code == 403


def test_write_with_matching_header_passes_csrf(client: CsrfClient) -> None:
    res = client.post("/api/auth/login", json={"email": "x@example.com", "password": "nope"})
    assert res.status_code == 401


# --- login --------------------------------------------------------------------------------


def test_login_sets_session_cookie_and_me_works(client: CsrfClient, owner_engine: Engine) -> None:
    email = sign_up(client)
    res = log_in(client, email)
    assert res.status_code == 200
    cookies = res.headers.get_list("set-cookie")
    session = next(c for c in cookies if c.startswith("trim_session="))
    assert "HttpOnly" in session
    assert "SameSite=lax" in session
    assert "Max-Age" not in session  # browser-session cookie without "Keep me signed in"
    assert any(c.startswith("trim_csrf=") for c in cookies)  # rotated on login

    me = client.get("/api/me")
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == email
    assert body["email_verified"] is False
    assert body["verify_required"] is False

    raw = client.cookies.get("trim_session")
    assert raw
    with owner_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT token_hash FROM sessions WHERE token_hash = :h"), {"h": hash_token(raw)}
        ).all()
        stored_raw = conn.execute(
            text("SELECT count(*) FROM sessions WHERE token_hash = :r"), {"r": raw.encode()}
        ).scalar_one()
    assert len(rows) == 1
    assert stored_raw == 0


def test_keep_signed_in_sets_a_30_day_cookie(client: CsrfClient) -> None:
    email = sign_up(client)
    res = log_in(client, email, keep_signed_in=True)
    session = next(c for c in res.headers.get_list("set-cookie") if c.startswith("trim_session="))
    assert "Max-Age=2592000" in session


def test_email_is_case_insensitive(client: CsrfClient) -> None:
    email = sign_up(client)
    assert log_in(client, email.upper()).status_code == 200


def test_wrong_password_and_unknown_email_get_the_same_answer(client: CsrfClient) -> None:
    email = sign_up(client)
    wrong = log_in(client, email, "wrong password!")
    unknown = log_in(client, "nobody-here@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Email or password is incorrect."}


def test_me_without_session_is_401(client: CsrfClient) -> None:
    assert client.get("/api/me").status_code == 401


def test_forged_session_cookie_is_401(client: CsrfClient) -> None:
    client.cookies.set("trim_session", "made-up-token")
    assert client.get("/api/me").status_code == 401


# --- lockout ------------------------------------------------------------------------------


def test_sixth_failed_attempt_in_15_minutes_is_locked(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    for _ in range(5):
        fakes.clock.advance(minutes=2)
        assert log_in(client, email, "wrong password!").status_code == 401

    # Locked now, even with the right password.
    sixth = log_in(client, email)
    assert sixth.status_code == 429
    assert sixth.json()["detail"] == "Too many attempts. Try again in 15 minutes."
    assert int(sixth.headers["Retry-After"]) == 15 * 60

    fakes.clock.advance(minutes=14, seconds=59)
    assert log_in(client, email).status_code == 429
    fakes.clock.advance(seconds=1)
    assert log_in(client, email).status_code == 200


def test_failures_spread_over_more_than_15_minutes_do_not_lock(
    client: CsrfClient, fakes: Fakes
) -> None:
    email = sign_up(client)
    for _ in range(5):
        assert log_in(client, email, "wrong password!").status_code == 401
        fakes.clock.advance(minutes=4)
    # Failures at 0, 4, 8, 12 and 16 minutes: never 5 inside one 15-minute window.
    assert log_in(client, email).status_code == 200


def test_account_lock_applies_from_any_ip(client: CsrfClient) -> None:
    email = sign_up(client)
    for n in range(5):
        res = client.post(
            "/api/auth/login",
            json={"email": email, "password": "wrong password!"},
            headers=ip(f"198.51.100.{n}"),
        )
        assert res.status_code == 401
    res = client.post(
        "/api/auth/login", json={"email": email, "password": PASSWORD}, headers=ip("203.0.113.7")
    )
    assert res.status_code == 429


def test_ip_lock_applies_across_accounts(client: CsrfClient) -> None:
    for _ in range(5):
        res = client.post(
            "/api/auth/login",
            json={"email": sign_up(client), "password": "wrong password!"},
            headers=ip("192.0.2.50"),
        )
        assert res.status_code == 401
    victim = sign_up(client)
    res = client.post(
        "/api/auth/login", json={"email": victim, "password": PASSWORD}, headers=ip("192.0.2.50")
    )
    assert res.status_code == 429


def test_unknown_email_locks_the_same_way(client: CsrfClient) -> None:
    for _ in range(5):
        assert log_in(client, "ghost@example.com", "guess guess!").status_code == 401
    assert log_in(client, "ghost@example.com", "guess guess!").status_code == 429


def test_success_resets_the_account_counter(client: CsrfClient) -> None:
    email = sign_up(client)
    for n in range(4):
        r = client.post(
            "/api/auth/login",
            json={"email": email, "password": "wrong password!"},
            headers=ip(f"198.51.100.{n}"),
        )
        assert r.status_code == 401
    assert log_in(client, email).status_code == 200
    for n in range(4):
        r = client.post(
            "/api/auth/login",
            json={"email": email, "password": "wrong password!"},
            headers=ip(f"198.51.100.{10 + n}"),
        )
        assert r.status_code == 401


# --- sessions -----------------------------------------------------------------------------


def test_logout_ends_the_session(client: CsrfClient, owner_engine: Engine) -> None:
    email = sign_up(client)
    log_in(client, email)
    raw = client.cookies.get("trim_session")
    assert raw
    res = client.post("/api/auth/logout")
    assert res.status_code == 204
    assert any(
        c.startswith("trim_session=") and "Max-Age=0" in c
        for c in res.headers.get_list("set-cookie")
    )
    with owner_engine.connect() as conn:
        left = conn.execute(
            text("SELECT count(*) FROM sessions WHERE token_hash = :h"), {"h": hash_token(raw)}
        ).scalar_one()
    assert left == 0
    client.cookies.set("trim_session", raw)  # even if a copy of the cookie survives
    assert client.get("/api/me").status_code == 401


def test_logout_without_session_is_fine(client: CsrfClient) -> None:
    assert client.post("/api/auth/logout").status_code == 204


def test_browser_session_ends_after_24_idle_hours(client: CsrfClient, fakes: Fakes) -> None:
    log_in(client, sign_up(client))
    fakes.clock.advance(hours=23)
    assert client.get("/api/me").status_code == 200  # activity slides the expiry
    fakes.clock.advance(hours=23)
    assert client.get("/api/me").status_code == 200
    fakes.clock.advance(hours=24)
    assert client.get("/api/me").status_code == 401


def test_persistent_session_slides_for_30_days(client: CsrfClient, fakes: Fakes) -> None:
    log_in(client, sign_up(client), keep_signed_in=True)
    fakes.clock.advance(days=20)
    res = client.get("/api/me")
    assert res.status_code == 200
    assert any(c.startswith("trim_session=") for c in res.headers.get_list("set-cookie"))
    fakes.clock.advance(days=20)
    assert client.get("/api/me").status_code == 200
    fakes.clock.advance(days=30)
    assert client.get("/api/me").status_code == 401


def test_unverified_user_must_verify_after_7_days(client: CsrfClient, fakes: Fakes) -> None:
    log_in(client, sign_up(client), keep_signed_in=True)
    fakes.clock.advance(days=6, hours=23)
    assert client.get("/api/me").json()["verify_required"] is False
    fakes.clock.advance(hours=1)
    body = client.get("/api/me").json()
    assert body["verify_required"] is True
    assert body["verify_deadline"] is not None


def test_verified_user_has_no_deadline(client: CsrfClient, fakes: Fakes) -> None:
    email, token = sign_up_and_get_token(client, fakes)
    client.post("/api/auth/verify", json={"token": token})
    log_in(client, email, keep_signed_in=True)
    fakes.clock.advance(days=8)
    body = client.get("/api/me").json()
    assert body["email_verified"] is True
    assert body["verify_deadline"] is None
    assert body["verify_required"] is False


# --- resend verification ------------------------------------------------------------------


def test_resend_verify_needs_a_session(client: CsrfClient) -> None:
    assert client.post("/api/auth/resend-verify").status_code == 401


def test_resend_verify_sends_a_new_link_with_a_cooldown(client: CsrfClient, fakes: Fakes) -> None:
    email, first_token = sign_up_and_get_token(client, fakes)
    log_in(client, email)
    fakes.clock.advance(seconds=30)
    assert client.post("/api/auth/resend-verify").status_code == 429
    fakes.clock.advance(seconds=31)
    res = client.post("/api/auth/resend-verify")
    assert res.status_code == 202
    assert res.json() == {"status": "sent"}
    new_token = fakes.outbox.sent[-1].link_token()
    assert new_token != first_token
    assert fakes.outbox.sent[-1].to == email
    assert client.post("/api/auth/verify", json={"token": new_token}).status_code == 200
    assert client.post("/api/auth/resend-verify").json() == {"status": "already_verified"}


# --- sign-up limit and logging ------------------------------------------------------------


def test_signups_are_limited_per_ip(client: CsrfClient) -> None:
    for _ in range(10):
        assert client.post("/api/auth/signup", json=signup_body()).status_code == 202
    assert client.post("/api/auth/signup", json=signup_body()).status_code == 429


def test_login_never_logs_secrets(client: CsrfClient, caplog: Any) -> None:
    caplog.set_level("DEBUG")
    email = sign_up(client)
    log_in(client, email, "wrong password!")
    log_in(client, email)
    raw = client.cookies.get("trim_session") or "missing"
    for secret in (PASSWORD, "wrong password!", email, raw):
        assert secret not in caplog.text
