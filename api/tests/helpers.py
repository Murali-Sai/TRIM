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


def seed_food_rows(owner_engine: Engine, user_id: Any) -> dict[str, Any]:
    """A custom food with a serving unit and one food log for `user_id`, written as the owner.

    Stands in until the food logging API exists (tasks 3.2 to 3.5), so account deletion and
    the isolation harness already cover these tables.
    """
    with owner_engine.begin() as conn:
        food_id = conn.execute(
            text(
                "INSERT INTO foods (id, owner_id, source, name, kcal_100, protein_100, "
                "carbs_100, fat_100) VALUES (gen_random_uuid(), :u, 'custom', 'Overnight oats', "
                "150, 6, 24, 4) RETURNING id"
            ),
            {"u": user_id},
        ).scalar_one()
        unit_id = conn.execute(
            text(
                "INSERT INTO serving_units (id, food_id, label, grams, is_default) "
                "VALUES (gen_random_uuid(), :f, '1 jar', 250, true) RETURNING id"
            ),
            {"f": food_id},
        ).scalar_one()
        log_id = conn.execute(
            text(
                "INSERT INTO food_logs (id, user_id, food_id, log_group_id, eaten_at, logged_on, "
                "name, grams, quantity, unit_label, kcal, protein_g, carbs_g, fat_g, source) "
                "VALUES (gen_random_uuid(), :u, :f, gen_random_uuid(), "
                "'2026-10-17T12:00:00Z', '2026-10-17', 'Overnight oats', 250, 1, '1 jar', "
                "375, 15, 60, 10, 'search') RETURNING id"
            ),
            {"u": user_id, "f": food_id},
        ).scalar_one()
    return {"food_id": food_id, "unit_id": unit_id, "log_id": log_id}
