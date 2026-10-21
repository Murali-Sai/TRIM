"""Forgot and reset password (task 1.6). A reset signs the user out everywhere."""

import logging
import uuid
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text

from app import usage
from app.config import Settings
from app.db import anonymous_session, user_session
from app.deps import ClientIpDep, ServicesDep, SettingsDep
from app.email.messages import reset_email
from app.models import AuditLog, AuthToken
from app.security import ratelimit
from app.security.passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hash_password
from app.security.tokens import hash_ip, hash_token, new_token
from app.services.email import EmailSendError
from app.services.registry import Services

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

RESET_TOKEN_TTL = timedelta(hours=1)
FORGOT_MAX_PER_ACCOUNT = 3
FORGOT_MAX_PER_IP = 10
FORGOT_WINDOW = timedelta(hours=1)

LINK_INVALID = "This link has expired or was already used."
BREACHED = "This password has appeared in a data breach. Choose a different one."


def _pepper(settings: Settings) -> str:
    return settings.ip_hash_pepper.get_secret_value()


class ForgotIn(BaseModel):
    email: EmailStr
    turnstile_token: Annotated[str, Field(max_length=2048)]


class CheckEmailOut(BaseModel):
    status: Literal["check_email"] = "check_email"


def _send_reset(user_id: uuid.UUID, email: str, services: Services, settings: Settings) -> None:
    """Runs after the response is sent, so the reply takes the same time whether or not the
    email belongs to an account."""
    now = services.clock()
    raw, token_hash = new_token()
    with user_session(user_id) as s:
        name = s.execute(
            text("SELECT display_name FROM user_profiles WHERE user_id = :u"), {"u": user_id}
        ).scalar_one()
        s.add(
            AuthToken(
                user_id=user_id,
                kind="reset",
                token_hash=token_hash,
                expires_at=now + RESET_TOKEN_TTL,
                created_at=now,
            )
        )
    link = f"{settings.app_base_url}/reset#token={raw}"
    try:
        usage.send_email(services, email, reset_email(name, link))
    except EmailSendError:
        log.exception("Reset email failed for user %s", user_id)


@router.post("/forgot", status_code=status.HTTP_202_ACCEPTED)
def forgot(
    body: ForgotIn,
    background: BackgroundTasks,
    services: ServicesDep,
    settings: SettingsDep,
    ip: ClientIpDep,
) -> CheckEmailOut:
    if not services.human_check.verify(body.turnstile_token, ip):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please complete the check and try again.")
    now = services.clock()
    since = now - FORGOT_WINDOW
    email = body.email.strip().lower()
    ip_key = ratelimit.rate_key("forgot-ip", ip or "unknown", _pepper(settings))
    acct_key = ratelimit.rate_key("forgot-acct", email, _pepper(settings))
    if ratelimit.count_recent(ip_key, since) >= FORGOT_MAX_PER_IP:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Try again later."
        )
    ratelimit.hit(ip_key, now)
    # Per account the limit is silent: same answer, no more emails. Saying "too many" here
    # would reveal that the address has an account.
    if ratelimit.count_recent(acct_key, since) >= FORGOT_MAX_PER_ACCOUNT:
        return CheckEmailOut()
    ratelimit.hit(acct_key, now)

    with anonymous_session() as s:
        account = s.execute(text("SELECT * FROM auth_user_by_email(:e)"), {"e": email}).first()
    if account is not None and account.status == "active":
        background.add_task(_send_reset, account.id, email, services, settings)
    return CheckEmailOut()


class ResetIn(BaseModel):
    token: Annotated[str, Field(min_length=1, max_length=128)]
    password: Annotated[str, Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)]


class ResetOut(BaseModel):
    status: Literal["password_reset"] = "password_reset"


@router.post("/reset")
def reset(body: ResetIn, services: ServicesDep, settings: SettingsDep, ip: ClientIpDep) -> ResetOut:
    now = services.clock()
    with anonymous_session() as s:
        row = s.execute(
            text("SELECT * FROM auth_token_by_hash(:h, 'reset')"), {"h": hash_token(body.token)}
        ).first()
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, LINK_INVALID)
    # Check the password before using up the link, so a rejected password can be retried.
    if services.breach.is_breached(body.password):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, BREACHED)
    new_hash = hash_password(body.password)

    with user_session(row.user_id) as s:
        used = s.execute(
            text("UPDATE auth_tokens SET used_at = :now WHERE id = :id AND used_at IS NULL"),
            {"now": now, "id": row.token_id},
        )
        if used.rowcount != 1:  # type: ignore[attr-defined]
            raise HTTPException(status.HTTP_400_BAD_REQUEST, LINK_INVALID)
        # Any other reset link still in an inbox stops working too.
        s.execute(
            text(
                "UPDATE auth_tokens SET used_at = :now "
                "WHERE user_id = :u AND kind = 'reset' AND used_at IS NULL"
            ),
            {"now": now, "u": row.user_id},
        )
        # The link proves the user reads this inbox, so it also confirms the email.
        email = s.execute(
            text(
                "UPDATE users SET password_hash = :h, updated_at = :now, "
                "email_verified_at = coalesce(email_verified_at, :now) "
                "WHERE id = :u RETURNING email"
            ),
            {"h": new_hash, "now": now, "u": row.user_id},
        ).scalar_one()
        # Sign out everywhere: whoever had the old password loses access.
        s.execute(text("DELETE FROM sessions WHERE user_id = :u"), {"u": row.user_id})
        s.add(
            AuditLog(
                user_id=row.user_id,
                event="password_reset",
                at=now,
                ip_hash=hash_ip(ip, _pepper(settings)),
            )
        )
    # A user locked out by failed logins can sign in with the new password straight away.
    ratelimit.clear(ratelimit.rate_key("login-acct", email, _pepper(settings)))
    return ResetOut()
