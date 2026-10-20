"""Task 1.7: Account page. AC: a deleted user cannot log in and their rows are gone."""

import json
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, text

from app.models import OWNED_ROWS
from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import PASSWORD, log_in, seed_food_rows, sign_up, user_row

NEW_PASSWORD = "a brand new passphrase"
WORKED = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "tdee_vectors.json").read_text()
)["calculate"][0]["input"]


def second_device(client: CsrfClient) -> CsrfClient:
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    return other


def full_account(client: CsrfClient) -> str:
    """Signed in, with body stats, a weight entry, targets and an audit trail."""
    email = sign_up(client)
    assert log_in(client, email, keep_signed_in=True).status_code == 200
    client.patch(
        "/api/me/body-stats",
        json={
            "sex": "male",
            "age": 30,
            "height_cm": 180,
            "activity_level": "moderate",
            "unit_system": "metric",
            "weight_kg": 80,
        },
    )
    client.post("/api/targets/apply-calculation", json=WORKED)
    return email


def delete_account(client: CsrfClient, password: str = PASSWORD, confirm: str = "DELETE") -> Any:
    return client.request("DELETE", "/api/me", json={"password": password, "confirm": confirm})


def rows_owned(owner_engine: Engine, user_id: Any) -> dict[str, int]:
    with owner_engine.connect() as conn:
        return {
            table: int(
                conn.execute(
                    text(f"SELECT count(*) FROM {table} WHERE {col} = :u"), {"u": user_id}
                ).scalar_one()
            )
            for table, col in OWNED_ROWS.items()
        }


# --- delete account (acceptance) ----------------------------------------------------------


def test_deleted_user_cannot_log_in_and_rows_are_gone(
    client: CsrfClient, owner_engine: Engine
) -> None:
    email = full_account(client)
    user_id = user_row(owner_engine, email).id
    seed_food_rows(owner_engine, user_id)
    before = rows_owned(owner_engine, user_id)
    assert all(n >= 1 for n in before.values()), before  # every table had data

    res = delete_account(client)
    assert res.status_code == 204
    assert any(
        c.startswith("trim_session=") and "Max-Age=0" in c
        for c in res.headers.get_list("set-cookie")
    )

    assert rows_owned(owner_engine, user_id) == dict.fromkeys(OWNED_ROWS, 0)
    assert user_row(owner_engine, email) is None
    assert client.get("/api/me").status_code == 401
    assert log_in(client, email).status_code == 401


def test_delete_needs_the_password(client: CsrfClient, owner_engine: Engine) -> None:
    email = full_account(client)
    res = delete_account(client, password="wrong password!")
    assert res.status_code == 403
    assert user_row(owner_engine, email) is not None


@pytest.mark.parametrize("confirm", ["delete", "", "DELETE ", "yes"])
def test_delete_needs_the_word_delete(
    client: CsrfClient, owner_engine: Engine, confirm: str
) -> None:
    email = full_account(client)
    assert delete_account(client, confirm=confirm).status_code == 422
    assert user_row(owner_engine, email) is not None


def test_deleting_one_account_leaves_others(client: CsrfClient, owner_engine: Engine) -> None:
    other = second_device(client)
    keep = full_account(other)
    keep_id = user_row(owner_engine, keep).id
    seed_food_rows(owner_engine, keep_id)
    full_account(client)
    delete_account(client)
    assert all(n >= 1 for n in rows_owned(owner_engine, keep_id).values())
    assert other.get("/api/me").status_code == 200


def test_deleted_email_can_sign_up_again(client: CsrfClient, fakes: Fakes) -> None:
    email = full_account(client)
    delete_account(client)
    before = len(fakes.outbox.sent)
    client.post(
        "/api/auth/signup",
        json={
            "email": email,
            "password": PASSWORD,
            "display_name": "Again",
            "timezone": "UTC",
            "unit_system": "metric",
            "turnstile_token": "XXXX.DUMMY.TOKEN.XXXX",
        },
    )
    assert len(fakes.outbox.sent) == before + 1


# --- profile ------------------------------------------------------------------------------


def test_profile_update(client: CsrfClient) -> None:
    full_account(client)
    res = client.patch(
        "/api/me/profile",
        json={"display_name": "  Sam R  ", "timezone": "Asia/Tokyo", "theme": "dark"},
    )
    assert res.status_code == 200
    assert res.json() == {
        "display_name": "Sam R",
        "timezone": "Asia/Tokyo",
        "unit_system": "metric",
        "theme": "dark",
    }
    me = client.get("/api/me").json()
    assert (me["display_name"], me["timezone"], me["theme"]) == ("Sam R", "Asia/Tokyo", "dark")


@pytest.mark.parametrize(
    "body",
    [
        {"timezone": "Mars/Olympus"},
        {"display_name": ""},
        {"unit_system": "stone"},
        {"theme": "neon"},
    ],
)
def test_profile_rejects_bad_values(client: CsrfClient, body: dict[str, str]) -> None:
    full_account(client)
    assert client.patch("/api/me/profile", json=body).status_code == 422


def test_profile_ignores_fields_it_does_not_know(client: CsrfClient, owner_engine: Engine) -> None:
    email = full_account(client)
    client.patch("/api/me/profile", json={"user_id": "00000000-0000-0000-0000-000000000000"})
    assert user_row(owner_engine, email) is not None
    assert client.get("/api/me").status_code == 200


# --- password -----------------------------------------------------------------------------


def test_change_password_signs_out_other_devices_but_keeps_this_one(
    client: CsrfClient,
) -> None:
    email = full_account(client)
    phone = second_device(client)
    log_in(phone, email)
    res = client.post(
        "/api/me/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD, "keep_signed_in": True},
    )
    assert res.status_code == 200
    assert client.get("/api/me").status_code == 200  # this device got a new session
    assert phone.get("/api/me").status_code == 401
    assert log_in(phone, email, PASSWORD).status_code == 401
    assert log_in(phone, email, NEW_PASSWORD).status_code == 200


def test_change_password_needs_the_current_one(client: CsrfClient) -> None:
    email = full_account(client)
    res = client.post(
        "/api/me/password",
        json={"current_password": "wrong password!", "new_password": NEW_PASSWORD},
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "That password is not right."
    assert log_in(client, email, PASSWORD).status_code == 200


def test_wrong_current_passwords_count_toward_the_lock(client: CsrfClient) -> None:
    full_account(client)
    for _ in range(5):
        client.post(
            "/api/me/password",
            json={"current_password": "wrong password!", "new_password": NEW_PASSWORD},
        )
    res = client.post(
        "/api/me/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}
    )
    assert res.status_code == 429


def test_change_password_rejects_breached(client: CsrfClient, fakes: Fakes) -> None:
    full_account(client)
    fakes.breach.breached.add("password1234")
    res = client.post(
        "/api/me/password", json={"current_password": PASSWORD, "new_password": "password1234"}
    )
    assert res.status_code == 422


def test_change_password_writes_an_audit_row(client: CsrfClient, owner_engine: Engine) -> None:
    email = full_account(client)
    client.post(
        "/api/me/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}
    )
    user_id = user_row(owner_engine, email).id
    with owner_engine.connect() as conn:
        events = list(
            conn.execute(
                text("SELECT event FROM audit_log WHERE user_id = :u"), {"u": user_id}
            ).scalars()
        )
    assert "password_change" in events


# --- devices ------------------------------------------------------------------------------


def test_sessions_list_marks_this_device(client: CsrfClient) -> None:
    email = full_account(client)
    phone = second_device(client)
    phone.post(
        "/api/auth/login",
        json={"email": email, "password": PASSWORD},
        headers={"user-agent": "Phone Browser"},
    )
    sessions = client.get("/api/me/sessions").json()
    assert len(sessions) == 2
    assert [s["current"] for s in sessions].count(True) == 1
    assert any(s["user_agent"] == "Phone Browser" for s in sessions)


def test_revoke_one_session(client: CsrfClient) -> None:
    email = full_account(client)
    phone = second_device(client)
    log_in(phone, email)
    phone_id = next(s["id"] for s in client.get("/api/me/sessions").json() if not s["current"])
    assert client.delete(f"/api/me/sessions/{phone_id}").status_code == 204
    assert phone.get("/api/me").status_code == 401
    assert client.get("/api/me").status_code == 200


def test_sign_out_everywhere_else(client: CsrfClient) -> None:
    email = full_account(client)
    devices = [second_device(client) for _ in range(2)]
    for d in devices:
        log_in(d, email)
    assert client.delete("/api/me/sessions").status_code == 204
    assert all(d.get("/api/me").status_code == 401 for d in devices)
    assert client.get("/api/me").status_code == 200
    assert len(client.get("/api/me/sessions").json()) == 1


def test_another_users_session_id_is_404(client: CsrfClient) -> None:
    full_account(client)
    other = second_device(client)
    full_account(other)
    their_id = other.get("/api/me/sessions").json()[0]["id"]
    assert client.delete(f"/api/me/sessions/{their_id}").status_code == 404
    assert other.get("/api/me").status_code == 200


def test_account_endpoints_need_a_session(client: CsrfClient) -> None:
    assert client.patch("/api/me/profile", json={}).status_code == 401
    assert client.post("/api/me/password", json={}).status_code in (401, 422)
    assert client.get("/api/me/sessions").status_code == 401
    assert client.delete("/api/me/sessions").status_code == 401
    assert delete_account(client).status_code == 401


def test_unverified_after_grace_can_still_manage_the_account(
    client: CsrfClient, fakes: Fakes
) -> None:
    full_account(client)
    fakes.clock.advance(days=8)
    assert client.get("/api/me/sessions").status_code == 200
    assert delete_account(client).status_code == 204
