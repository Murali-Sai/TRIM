"""Account page (task 1.7): profile, password, devices and account deletion.

These use CurrentUserDep, not ActiveUserDep: someone whose email is still unconfirmed after
7 days can always change their password, sign out devices or delete the account.
"""

import logging
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import AfterValidator, BaseModel, Field, StringConstraints
from sqlalchemy import text

from app.config import Settings
from app.db import user_session
from app.deps import ClientIpDep, ServicesDep, SettingsDep
from app.models import AuditLog
from app.security import ratelimit
from app.security.cookies import clear_session_cookie, set_csrf_cookie
from app.security.csrf import new_csrf_token
from app.security.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    hash_password,
    verify_password,
)
from app.security.sessions import CurrentUserDep, start_session
from app.security.tokens import hash_ip
from app.validators import valid_timezone

log = logging.getLogger(__name__)

router = APIRouter(prefix="/me", tags=["account"])

NOT_RIGHT = "That password is not right."
BREACHED = "This password has appeared in a data breach. Choose a different one."


def _pepper(settings: Settings) -> str:
    return settings.ip_hash_pepper.get_secret_value()


def _check_password(
    user_id: uuid.UUID, password: str, services: ServicesDep, settings: Settings, ip: str | None
) -> str:
    """Verifies the current password; wrong guesses count toward the login lock. Returns the
    account email."""
    now = services.clock()
    with user_session(user_id) as s:
        row = s.execute(
            text("SELECT email, password_hash FROM users WHERE id = :u"), {"u": user_id}
        ).one()
    keys = [
        ratelimit.rate_key("login-acct", row.email, _pepper(settings)),
        ratelimit.rate_key("login-ip", ip or "unknown", _pepper(settings)),
    ]
    if ratelimit.locked_until(keys, now) is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in 15 minutes."
        )
    if not verify_password(row.password_hash, password):
        ratelimit.record_failure(
            keys,
            now,
            ratelimit.LOGIN_MAX_FAILURES,
            ratelimit.LOGIN_WINDOW,
            ratelimit.LOGIN_LOCK,
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_RIGHT)
    return str(row.email)


# --- profile ------------------------------------------------------------------------------


class ProfileIn(BaseModel):
    display_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)] | None
    ) = None
    timezone: Annotated[str, AfterValidator(valid_timezone)] | None = None
    unit_system: Literal["metric", "imperial"] | None = None
    theme: Literal["system", "light", "dark"] | None = None


class ProfileOut(BaseModel):
    display_name: str
    timezone: str
    unit_system: Literal["metric", "imperial"]
    theme: Literal["system", "light", "dark"]


@router.patch("/profile")
def patch_profile(body: ProfileIn, user: CurrentUserDep) -> ProfileOut:
    changes = body.model_dump(exclude_none=True)
    with user_session(user.user_id) as s:
        if changes:
            assignments = ", ".join(f"{k} = :{k}" for k in changes)  # keys from ProfileIn only
            s.execute(
                text(
                    f"UPDATE user_profiles SET {assignments}, updated_at = now() "  # noqa: S608
                    "WHERE user_id = :u"
                ),
                {**changes, "u": user.user_id},
            )
        row = s.execute(
            text(
                "SELECT display_name, timezone, unit_system, theme FROM user_profiles "
                "WHERE user_id = :u"
            ),
            {"u": user.user_id},
        ).one()
    return ProfileOut(**row._asdict())


# --- password -----------------------------------------------------------------------------


class PasswordIn(BaseModel):
    current_password: Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)]
    new_password: Annotated[
        str, Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    ]
    # Keep this device signed in with a new session (others are always signed out).
    keep_signed_in: bool = False


@router.post("/password")
def change_password(
    body: PasswordIn,
    request: Request,
    response: Response,
    user: CurrentUserDep,
    services: ServicesDep,
    settings: SettingsDep,
    ip: ClientIpDep,
) -> dict[str, str]:
    _check_password(user.user_id, body.current_password, services, settings, ip)
    if services.breach.is_breached(body.new_password):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, BREACHED)
    now = services.clock()
    ip_hash = hash_ip(ip, _pepper(settings))
    with user_session(user.user_id) as s:
        s.execute(
            text("UPDATE users SET password_hash = :h, updated_at = :now WHERE id = :u"),
            {"h": hash_password(body.new_password), "now": now, "u": user.user_id},
        )
        # Every session ends, this one included; this device gets a fresh one below.
        s.execute(text("DELETE FROM sessions WHERE user_id = :u"), {"u": user.user_id})
        s.add(AuditLog(user_id=user.user_id, event="password_change", at=now, ip_hash=ip_hash))
    start_session(
        response,
        user.user_id,
        body.keep_signed_in,
        now,
        request.headers.get("user-agent"),
        ip_hash,
        settings,
    )
    set_csrf_cookie(response, new_csrf_token(), settings)
    return {"status": "password_changed"}


# --- devices ------------------------------------------------------------------------------


class SessionOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    user_agent: str | None
    persistent: bool
    current: bool


@router.get("/sessions")
def list_sessions(user: CurrentUserDep, services: ServicesDep) -> list[SessionOut]:
    with user_session(user.user_id) as s:
        rows = s.execute(
            text(
                "SELECT id, created_at, last_seen_at, user_agent, persistent FROM sessions "
                "WHERE user_id = :u AND deleted_at IS NULL AND expires_at > :now "
                "ORDER BY last_seen_at DESC"
            ),
            {"u": user.user_id, "now": services.clock()},
        ).all()
    return [SessionOut(**r._asdict(), current=r.id == user.session_id) for r in rows]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: uuid.UUID, response: Response, user: CurrentUserDep, settings: SettingsDep
) -> None:
    with user_session(user.user_id) as s:
        # RLS hides other users' sessions, so their ids are simply not found: 404.
        deleted = s.execute(
            text("DELETE FROM sessions WHERE id = :id AND user_id = :u"),
            {"id": session_id, "u": user.user_id},
        )
        if deleted.rowcount != 1:  # type: ignore[attr-defined]
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if session_id == user.session_id:
        clear_session_cookie(response, settings)


@router.delete("/sessions", status_code=status.HTTP_204_NO_CONTENT)
def revoke_other_sessions(user: CurrentUserDep) -> None:
    """Sign out everywhere else."""
    with user_session(user.user_id) as s:
        s.execute(
            text("DELETE FROM sessions WHERE user_id = :u AND id <> :current"),
            {"u": user.user_id, "current": user.session_id},
        )


# --- delete account -----------------------------------------------------------------------


class DeleteIn(BaseModel):
    password: Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)]
    confirm: Literal["DELETE"]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    body: DeleteIn,
    response: Response,
    user: CurrentUserDep,
    services: ServicesDep,
    settings: SettingsDep,
    ip: ClientIpDep,
) -> None:
    """Deletes the user and, through ON DELETE CASCADE, every row they own."""
    email = _check_password(user.user_id, body.password, services, settings, ip)
    with user_session(user.user_id) as s:
        s.execute(text("DELETE FROM users WHERE id = :u"), {"u": user.user_id})
    # Rate-limit counters are keyed hashes, but they still belong to this account.
    ratelimit.clear(ratelimit.rate_key("login-acct", email, _pepper(settings)))
    ratelimit.clear(ratelimit.rate_key("forgot-acct", email, _pepper(settings)))
    log.info("Account %s deleted", user.user_id)
    clear_session_cookie(response, settings)
