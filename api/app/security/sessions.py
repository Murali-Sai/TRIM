"""Session cookies: a random token in the browser, only its SHA-256 in the database."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import text

from app.config import Settings
from app.db import anonymous_session, user_session
from app.deps import ServicesDep, SettingsDep
from app.models import SessionRow
from app.security.cookies import (
    SESSION_COOKIE,
    clear_session_cookie,
    cookie_name,
    set_session_cookie,
)
from app.security.tokens import hash_token, new_token

PERSISTENT_TTL = timedelta(days=30)
# A browser-session cookie still needs a server-side end: 24 hours without activity.
BROWSER_SESSION_IDLE = timedelta(hours=24)
# Do not rewrite the session row on every request; extend at most once an hour.
REFRESH_EVERY = timedelta(hours=1)
UNVERIFIED_GRACE = timedelta(days=7)


def session_ttl(persistent: bool) -> timedelta:
    return PERSISTENT_TTL if persistent else BROWSER_SESSION_IDLE


def start_session(
    response: Response,
    user_id: uuid.UUID,
    persistent: bool,
    now: datetime,
    user_agent: str | None,
    ip_hash: bytes | None,
    settings: Settings,
) -> None:
    """Creates a session row and sets the cookie. A fresh token on every login, so a token
    planted before login is never promoted."""
    raw, token_hash = new_token()
    with user_session(user_id) as s:
        s.add(
            SessionRow(
                user_id=user_id,
                token_hash=token_hash,
                expires_at=now + session_ttl(persistent),
                last_seen_at=now,
                user_agent=(user_agent or "")[:300] or None,
                ip_hash=ip_hash,
                persistent=persistent,
            )
        )
    set_session_cookie(response, raw, PERSISTENT_TTL if persistent else None, settings)


@dataclass(frozen=True)
class CurrentUser:
    user_id: uuid.UUID
    session_id: uuid.UUID
    email_verified: bool
    created_at: datetime


NOT_SIGNED_IN = "Not signed in"


def current_user(
    request: Request, response: Response, services: ServicesDep, settings: SettingsDep
) -> CurrentUser:
    raw = request.cookies.get(cookie_name(SESSION_COOKIE, settings))
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_SIGNED_IN)
    now = services.clock()
    with anonymous_session() as s:
        row = s.execute(
            text("SELECT * FROM auth_session_by_token(:h)"), {"h": hash_token(raw)}
        ).first()
    if row is None or row.expires_at is None or row.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_SIGNED_IN)

    with user_session(row.user_id) as s:
        user = s.execute(
            text(
                "SELECT status, email_verified_at, created_at FROM users "
                "WHERE id = :id AND deleted_at IS NULL"
            ),
            {"id": row.user_id},
        ).first()
        if user is None or user.status != "active":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_SIGNED_IN)
        new_expiry = now + session_ttl(row.persistent)
        if new_expiry - row.expires_at >= REFRESH_EVERY:
            s.execute(
                text(
                    "UPDATE sessions SET expires_at = :exp, last_seen_at = :now, "
                    "updated_at = :now WHERE id = :id"
                ),
                {"exp": new_expiry, "now": now, "id": row.session_id},
            )
            if row.persistent:
                set_session_cookie(response, raw, PERSISTENT_TTL, settings)

    return CurrentUser(
        user_id=row.user_id,
        session_id=row.session_id,
        email_verified=user.email_verified_at is not None,
        created_at=user.created_at,
    )


CurrentUserDep = Annotated[CurrentUser, Depends(current_user)]


def verify_deadline(user: CurrentUser) -> datetime | None:
    return None if user.email_verified else user.created_at + UNVERIFIED_GRACE


def active_user(user: CurrentUserDep, services: ServicesDep) -> CurrentUser:
    """For data endpoints: unverified accounts can log for 7 days, then must verify."""
    deadline = verify_deadline(user)
    if deadline is not None and services.clock() >= deadline:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Confirm your email to keep using TRIM.")
    return user


ActiveUserDep = Annotated[CurrentUser, Depends(active_user)]


def end_session(
    response: Response, session_id: uuid.UUID, user_id: uuid.UUID, settings: Settings
) -> None:
    with user_session(user_id) as s:
        s.execute(text("DELETE FROM sessions WHERE id = :id"), {"id": session_id})
    clear_session_cookie(response, settings)
