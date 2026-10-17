"""Task 1.6: forgot and reset password. AC: a reset revokes all sessions."""

from typing import Any

from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import PASSWORD, log_in, sign_up, user_row

NEW_PASSWORD = "a brand new passphrase"
TOKEN = "XXXX.DUMMY.TOKEN.XXXX"


def forgot(client: CsrfClient, email: str, **headers: str) -> Any:
    return client.post(
        "/api/auth/forgot", json={"email": email, "turnstile_token": TOKEN}, headers=headers
    )


def reset(client: CsrfClient, token: str, password: str = NEW_PASSWORD) -> Any:
    return client.post("/api/auth/reset", json={"token": token, "password": password})


def request_reset_token(client: CsrfClient, fakes: Fakes, email: str) -> str:
    before = len(fakes.outbox.sent)
    assert forgot(client, email).status_code == 202
    assert len(fakes.outbox.sent) == before + 1
    sent = fakes.outbox.sent[-1]
    assert sent.to == email
    assert sent.email.subject == "Reset your TRIM password"
    return sent.link_token()


def session_count(owner_engine: Engine, email: str) -> int:
    with owner_engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id "
                    "WHERE u.email = :e"
                ),
                {"e": email},
            ).scalar_one()
        )


def test_reset_revokes_all_sessions(client: CsrfClient, fakes: Fakes, owner_engine: Engine) -> None:
    email = sign_up(client)
    phone = CsrfClient(client.app)
    phone.get("/api/auth/csrf")
    assert log_in(client, email).status_code == 200
    assert log_in(phone, email, keep_signed_in=True).status_code == 200
    assert client.get("/api/me").status_code == 200
    assert phone.get("/api/me").status_code == 200
    assert session_count(owner_engine, email) == 2

    token = request_reset_token(client, fakes, email)
    res = reset(client, token)
    assert res.status_code == 200
    assert res.json() == {"status": "password_reset"}

    assert session_count(owner_engine, email) == 0
    assert client.get("/api/me").status_code == 401
    assert phone.get("/api/me").status_code == 401


def test_new_password_works_and_old_one_does_not(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    reset(client, request_reset_token(client, fakes, email))
    assert log_in(client, email, PASSWORD).status_code == 401
    assert log_in(client, email, NEW_PASSWORD).status_code == 200


def test_reset_link_works_once(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    token = request_reset_token(client, fakes, email)
    assert reset(client, token).status_code == 200
    again = reset(client, token, "yet another passphrase")
    assert again.status_code == 400
    assert again.json()["detail"] == "This link has expired or was already used."


def test_reset_link_expires_after_one_hour(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    token = request_reset_token(client, fakes, email)
    fakes.clock.advance(minutes=59, seconds=59)
    early = request_reset_token(client, fakes, email)
    fakes.clock.advance(seconds=1)
    assert reset(client, token).status_code == 400  # exactly 1 hour old
    assert reset(client, early).status_code == 200  # the newer link still works


def test_a_reset_cancels_other_reset_links(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    first = request_reset_token(client, fakes, email)
    second = request_reset_token(client, fakes, email)
    assert reset(client, second).status_code == 200
    assert reset(client, first).status_code == 400


def test_verify_token_cannot_reset_a_password(client: CsrfClient, fakes: Fakes) -> None:
    sign_up(client)
    verify_token = fakes.outbox.sent[-1].link_token()
    assert reset(client, verify_token).status_code == 400


def test_unknown_email_gets_the_same_answer_and_no_email(client: CsrfClient, fakes: Fakes) -> None:
    res = forgot(client, "nobody-at-all@example.com")
    assert res.status_code == 202
    assert res.json() == {"status": "check_email"}
    assert fakes.outbox.sent == []


def test_breached_password_is_rejected_and_link_still_works(
    client: CsrfClient, fakes: Fakes
) -> None:
    email = sign_up(client)
    token = request_reset_token(client, fakes, email)
    fakes.breach.breached.add("password1234")
    bad = reset(client, token, "password1234")
    assert bad.status_code == 422
    assert "data breach" in bad.json()["detail"]
    assert reset(client, token).status_code == 200


def test_short_password_is_rejected(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    token = request_reset_token(client, fakes, email)
    assert reset(client, token, "short").status_code == 422


def test_failed_human_check_is_rejected(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    fakes.human.passes = False
    assert forgot(client, email).status_code == 400
    assert len(fakes.outbox.sent) == 1  # only the sign-up email


def test_reset_confirms_the_email(client: CsrfClient, fakes: Fakes, owner_engine: Engine) -> None:
    email = sign_up(client)
    assert user_row(owner_engine, email).email_verified_at is None
    reset(client, request_reset_token(client, fakes, email))
    assert user_row(owner_engine, email).email_verified_at is not None


def test_reset_unlocks_a_locked_account(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    for n in range(5):
        client.post(
            "/api/auth/login",
            json={"email": email, "password": "wrong password!"},
            headers={"x-forwarded-for": f"198.51.100.{n}"},
        )
    assert log_in(client, email).status_code == 429
    reset(client, request_reset_token(client, fakes, email))
    assert log_in(client, email, NEW_PASSWORD).status_code == 200


def test_forgot_is_quietly_limited_per_account(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    for _ in range(3):
        request_reset_token(client, fakes, email)
    before = len(fakes.outbox.sent)
    res = forgot(client, email)
    assert res.status_code == 202  # same answer, so the limit does not reveal the account
    assert len(fakes.outbox.sent) == before
    fakes.clock.advance(hours=1)
    request_reset_token(client, fakes, email)


def test_forgot_is_limited_per_ip(client: CsrfClient) -> None:
    for n in range(10):
        assert forgot(client, f"someone{n}@example.com").status_code == 202
    assert forgot(client, "one-more@example.com").status_code == 429


def test_reset_writes_an_audit_row(client: CsrfClient, fakes: Fakes, owner_engine: Engine) -> None:
    email = sign_up(client)
    reset(client, request_reset_token(client, fakes, email))
    with owner_engine.connect() as conn:
        events = conn.execute(
            text(
                "SELECT a.event FROM audit_log a JOIN users u ON u.id = a.user_id "
                "WHERE u.email = :e ORDER BY a.at, a.id"
            ),
            {"e": email},
        ).scalars()
        assert "password_reset" in list(events)


def test_reset_never_logs_secrets(client: CsrfClient, fakes: Fakes, caplog: Any) -> None:
    caplog.set_level("DEBUG")
    email = sign_up(client)
    token = request_reset_token(client, fakes, email)
    reset(client, token)
    for secret in (token, NEW_PASSWORD, email):
        assert secret not in caplog.text
