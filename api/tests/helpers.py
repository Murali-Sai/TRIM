import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.fakes import Fakes

PASSWORD = "correct horse battery"


def new_email() -> str:
    return f"person-{uuid.uuid4().hex[:12]}@example.com"


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


def sign_up(client: TestClient, **overrides: Any) -> str:
    body = signup_body(**overrides)
    assert client.post("/api/auth/signup", json=body).status_code == 202
    return str(body["email"])


def sign_up_and_get_token(client: TestClient, fakes: Fakes) -> tuple[str, str]:
    email = sign_up(client)
    return email, fakes.outbox.sent[-1].link_token()


def log_in(client: TestClient, email: str, password: str = PASSWORD, **extra: Any) -> Any:
    return client.post("/api/auth/login", json={"email": email, "password": password, **extra})
