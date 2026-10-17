"""Task 1.4: sign-up and email verification. AC: the verify link works once and expires
after 1 hour."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.main import create_app
from tests.fakes import Fakes

PASSWORD = "correct horse battery"


@pytest.fixture
def fakes() -> Fakes:
    return Fakes()


@pytest.fixture
def client(owner_engine: Engine, fakes: Fakes) -> Iterator[TestClient]:
    with TestClient(create_app(fakes.services())) as c:
        yield c


_counter = 0


def new_email() -> str:
    global _counter
    _counter += 1
    return f"person{_counter}@example.com"


def signup_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "email": new_email(),
        "password": PASSWORD,
        "display_name": "Sam",
        "timezone": "America/New_York",
        "unit_system": "imperial",
        "turnstile_token": "XXXX.DUMMY.TOKEN.XXXX",
    }
    body.update(overrides)
    return body


def user_row(owner_engine: Engine, email: str) -> Any:
    with owner_engine.connect() as conn:
        return conn.execute(
            text("SELECT * FROM users WHERE email = :e"), {"e": email.lower()}
        ).first()


# --- sign-up ------------------------------------------------------------------------------


def test_signup_creates_account_profile_token_and_sends_email(
    client: TestClient, fakes: Fakes, owner_engine: Engine
) -> None:
    body = signup_body(email="New.Person@Example.com")
    res = client.post("/api/auth/signup", json=body)
    assert res.status_code == 202
    assert res.json() == {"status": "check_email"}

    user = user_row(owner_engine, "new.person@example.com")
    assert user is not None
    assert user.email == "new.person@example.com"
    assert user.email_verified_at is None
    assert user.password_hash.startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert PASSWORD not in user.password_hash

    with owner_engine.connect() as conn:
        profile = conn.execute(
            text("SELECT * FROM user_profiles WHERE user_id = :u"), {"u": user.id}
        ).one()
        token = conn.execute(
            text("SELECT * FROM auth_tokens WHERE user_id = :u"), {"u": user.id}
        ).one()
        audit = conn.execute(
            text("SELECT event FROM audit_log WHERE user_id = :u"), {"u": user.id}
        ).scalars()
        assert list(audit) == ["signup"]
    assert profile.display_name == "Sam"
    assert profile.timezone == "America/New_York"
    assert profile.unit_system == "imperial"
    assert token.kind == "verify"
    assert token.expires_at == fakes.clock.now.replace(hour=13)

    [sent] = fakes.outbox.sent
    assert sent.to == "new.person@example.com"
    assert "TRIM" in sent.email.html
    raw = sent.link_token()
    # Only the hash is stored, never the token from the link.
    assert raw.encode() != token.token_hash
    assert "/verify#token=" in sent.email.text


def test_existing_email_gets_the_same_answer_and_no_email(client: TestClient, fakes: Fakes) -> None:
    body = signup_body()
    assert client.post("/api/auth/signup", json=body).status_code == 202
    again = client.post("/api/auth/signup", json={**body, "email": body["email"].upper()})
    assert again.status_code == 202
    assert again.json() == {"status": "check_email"}
    assert len(fakes.outbox.sent) == 1


def test_failed_human_check_is_rejected(
    client: TestClient, fakes: Fakes, owner_engine: Engine
) -> None:
    fakes.human.passes = False
    body = signup_body()
    res = client.post("/api/auth/signup", json=body)
    assert res.status_code == 400
    assert user_row(owner_engine, body["email"]) is None


def test_breached_password_is_rejected(
    client: TestClient, fakes: Fakes, owner_engine: Engine
) -> None:
    fakes.breach.breached.add("password1234")
    body = signup_body(password="password1234")
    res = client.post("/api/auth/signup", json=body)
    assert res.status_code == 422
    assert "data breach" in res.json()["detail"]
    assert user_row(owner_engine, body["email"]) is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("password", "short9char"[:9]),
        ("email", "not-an-email"),
        ("timezone", "Mars/Olympus"),
        ("unit_system", "furlongs"),
        ("display_name", "   "),
        ("display_name", "x" * 51),
    ],
)
def test_invalid_fields_are_rejected(client: TestClient, field: str, value: str) -> None:
    res = client.post("/api/auth/signup", json=signup_body(**{field: value}))
    assert res.status_code == 422


def test_ten_character_password_is_accepted(client: TestClient) -> None:
    res = client.post("/api/auth/signup", json=signup_body(password="tencharsok"))
    assert res.status_code == 202


def test_email_failure_still_creates_account(
    client: TestClient, fakes: Fakes, owner_engine: Engine
) -> None:
    fakes.outbox.fail = True
    body = signup_body()
    assert client.post("/api/auth/signup", json=body).status_code == 202
    assert user_row(owner_engine, body["email"]) is not None


def test_secrets_never_reach_logs(client: TestClient, fakes: Fakes, caplog: Any) -> None:
    caplog.set_level("DEBUG")
    fakes.outbox.fail = True
    body = signup_body()
    client.post("/api/auth/signup", json=body)
    logged = caplog.text
    assert PASSWORD not in logged
    assert body["email"] not in logged


# --- verification -------------------------------------------------------------------------


def sign_up_and_get_token(client: TestClient, fakes: Fakes) -> tuple[str, str]:
    body = signup_body()
    assert client.post("/api/auth/signup", json=body).status_code == 202
    return body["email"], fakes.outbox.sent[-1].link_token()


def test_verify_link_works_once(client: TestClient, fakes: Fakes, owner_engine: Engine) -> None:
    email, token = sign_up_and_get_token(client, fakes)

    first = client.post("/api/auth/verify", json={"token": token})
    assert first.status_code == 200
    assert first.json() == {"status": "verified"}
    assert user_row(owner_engine, email).email_verified_at == fakes.clock.now

    second = client.post("/api/auth/verify", json={"token": token})
    assert second.status_code == 400
    assert second.json()["detail"] == "This link has expired or was already used."


def test_verify_link_works_just_before_one_hour(
    client: TestClient, fakes: Fakes, owner_engine: Engine
) -> None:
    email, token = sign_up_and_get_token(client, fakes)
    fakes.clock.advance(minutes=59, seconds=59)
    assert client.post("/api/auth/verify", json={"token": token}).status_code == 200
    assert user_row(owner_engine, email).email_verified_at is not None


def test_verify_link_expires_after_one_hour(
    client: TestClient, fakes: Fakes, owner_engine: Engine
) -> None:
    email, token = sign_up_and_get_token(client, fakes)
    fakes.clock.advance(hours=1)
    res = client.post("/api/auth/verify", json={"token": token})
    assert res.status_code == 400
    assert user_row(owner_engine, email).email_verified_at is None


def test_unknown_token_is_rejected(client: TestClient) -> None:
    res = client.post("/api/auth/verify", json={"token": "not-a-real-token"})
    assert res.status_code == 400


def test_one_users_token_only_verifies_that_user(
    client: TestClient, fakes: Fakes, owner_engine: Engine
) -> None:
    email_a, token_a = sign_up_and_get_token(client, fakes)
    email_b, _ = sign_up_and_get_token(client, fakes)
    assert client.post("/api/auth/verify", json={"token": token_a}).status_code == 200
    assert user_row(owner_engine, email_a).email_verified_at is not None
    assert user_row(owner_engine, email_b).email_verified_at is None
