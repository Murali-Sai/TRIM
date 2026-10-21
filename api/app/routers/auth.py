"""Sign-up, email verification, login and logout (tasks 1.4 and 1.5)."""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db import anonymous_session, user_session
from app.deps import ClientIpDep, ServicesDep, SettingsDep
from app.email.messages import verify_email
from app.ids import uuid7
from app.measurements import seed_presets
from app.models import AuditLog, AuthToken, User, UserProfile
from app.security import ratelimit
from app.security.cookies import SESSION_COOKIE, clear_session_cookie, cookie_name, set_csrf_cookie
from app.security.csrf import new_csrf_token
from app.security.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    burn_time,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.security.sessions import CurrentUserDep, end_session, start_session
from app.security.tokens import hash_ip, hash_token, new_token
from app.services.email import EmailSendError
from app.services.registry import Services
from app.validators import valid_timezone

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

VERIFY_TOKEN_TTL = timedelta(hours=1)
RESEND_COOLDOWN = timedelta(minutes=1)

LOGIN_FAILED = "Email or password is incorrect."
LOGIN_LOCKED = "Too many attempts. Try again in 15 minutes."
TOO_MANY_SIGNUPS = "Too many sign-ups from this network. Try again later."


def _pepper(settings: Settings) -> str:
    return settings.ip_hash_pepper.get_secret_value()


def _send_verify_link(
    user_id: uuid.UUID, email: str, display_name: str, services: Services, settings: Settings
) -> None:
    """Stores a new 1-hour verify token and emails the link. Only the token's hash is stored."""
    now = services.clock()
    raw, token_hash = new_token()
    with user_session(user_id) as s:
        s.add(
            AuthToken(
                user_id=user_id,
                kind="verify",
                token_hash=token_hash,
                expires_at=now + VERIFY_TOKEN_TTL,
                created_at=now,
            )
        )
    link = f"{settings.app_base_url}/verify#token={raw}"
    try:
        services.email.send(email, verify_email(display_name, link))
    except EmailSendError:
        # The account exists; the user can ask for a new link after logging in.
        log.exception("Verification email failed for user %s", user_id)


# --- csrf ---------------------------------------------------------------------------------


@router.get("/csrf", status_code=status.HTTP_204_NO_CONTENT)
def csrf() -> None:
    """Lets the page obtain a CSRF cookie before its first write (the middleware sets it)."""


# --- sign-up ------------------------------------------------------------------------------


class SignupIn(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)]
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
    ]
    timezone: Annotated[str, AfterValidator(valid_timezone)]
    unit_system: Literal["metric", "imperial"]
    turnstile_token: Annotated[str, Field(max_length=2048)]


class CheckEmailOut(BaseModel):
    status: Literal["check_email"] = "check_email"


@router.post("/signup", status_code=status.HTTP_202_ACCEPTED)
def signup(
    body: SignupIn, services: ServicesDep, settings: SettingsDep, ip: ClientIpDep
) -> CheckEmailOut:
    now = services.clock()
    ip_key = ratelimit.rate_key("signup-ip", ip or "unknown", _pepper(settings))
    if ratelimit.count_recent(ip_key, now - ratelimit.SIGNUP_WINDOW) >= ratelimit.SIGNUP_MAX_PER_IP:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_SIGNUPS)
    if not services.human_check.verify(body.turnstile_token, ip):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please complete the check and try again.")
    if services.breach.is_breached(body.password):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "This password has appeared in a data breach. Choose a different one.",
        )
    ratelimit.hit(ip_key, now)

    email = body.email.strip().lower()
    # Hash before checking for an existing account so both paths take the same time.
    password_hash = hash_password(body.password)

    with anonymous_session() as s:
        exists = s.execute(text("SELECT 1 FROM auth_user_by_email(:e)"), {"e": email}).first()
    if exists:
        # Same answer as a new sign-up, so the form cannot be used to probe for accounts.
        return CheckEmailOut()

    user_id = uuid7()
    try:
        with user_session(user_id) as s:
            s.add(User(id=user_id, email=email, password_hash=password_hash, created_at=now))
            s.flush()
            s.add_all(
                [
                    UserProfile(
                        user_id=user_id,
                        display_name=body.display_name,
                        timezone=body.timezone,
                        unit_system=body.unit_system,
                    ),
                    AuditLog(
                        user_id=user_id,
                        event="signup",
                        at=now,
                        ip_hash=hash_ip(ip, _pepper(settings)),
                    ),
                ]
            )
            # Each account gets its own copy, so renaming one never touches another's.
            seed_presets(s, user_id, body.unit_system)
    except IntegrityError:
        # Lost a race with another sign-up for the same email.
        return CheckEmailOut()

    _send_verify_link(user_id, email, body.display_name, services, settings)
    return CheckEmailOut()


# --- verification -------------------------------------------------------------------------


class VerifyIn(BaseModel):
    token: Annotated[str, Field(min_length=1, max_length=128)]


class VerifiedOut(BaseModel):
    status: Literal["verified"] = "verified"


LINK_INVALID = "This link has expired or was already used."


@router.post("/verify")
def verify(body: VerifyIn, services: ServicesDep) -> VerifiedOut:
    now = services.clock()
    with anonymous_session() as s:
        row = s.execute(
            text("SELECT * FROM auth_token_by_hash(:h, 'verify')"), {"h": hash_token(body.token)}
        ).first()
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, LINK_INVALID)

    with user_session(row.user_id) as s:
        # Single use: only the first request can flip used_at.
        used = s.execute(
            text("UPDATE auth_tokens SET used_at = :now WHERE id = :id AND used_at IS NULL"),
            {"now": now, "id": row.token_id},
        )
        if used.rowcount != 1:  # type: ignore[attr-defined]
            raise HTTPException(status.HTTP_400_BAD_REQUEST, LINK_INVALID)
        s.execute(
            text(
                "UPDATE users SET email_verified_at = coalesce(email_verified_at, :now), "
                "updated_at = :now WHERE id = :id"
            ),
            {"now": now, "id": row.user_id},
        )
    return VerifiedOut()


class ResendOut(BaseModel):
    status: Literal["sent", "already_verified"]


@router.post("/resend-verify", status_code=status.HTTP_202_ACCEPTED)
def resend_verify(user: CurrentUserDep, services: ServicesDep, settings: SettingsDep) -> ResendOut:
    if user.email_verified:
        return ResendOut(status="already_verified")
    now = services.clock()
    with user_session(user.user_id) as s:
        recent = s.execute(
            text(
                "SELECT 1 FROM auth_tokens WHERE user_id = :u AND kind = 'verify' "
                "AND created_at > :since"
            ),
            {"u": user.user_id, "since": now - RESEND_COOLDOWN},
        ).first()
        account = s.execute(
            text(
                "SELECT u.email, p.display_name FROM users u "
                "JOIN user_profiles p ON p.user_id = u.id WHERE u.id = :u"
            ),
            {"u": user.user_id},
        ).one()
    if recent:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "A link was just sent. Wait a minute and try again."
        )
    _send_verify_link(user.user_id, account.email, account.display_name, services, settings)
    return ResendOut(status="sent")


# --- login and logout ---------------------------------------------------------------------


class LoginIn(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
    password: Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)]
    keep_signed_in: bool = False


class LoginOut(BaseModel):
    status: Literal["ok"] = "ok"


def _lock_keys(email: str, ip: str | None, settings: Settings) -> list[bytes]:
    # Counted separately per account and per IP: guessing one account from many IPs and
    # many accounts from one IP are both stopped.
    return [
        ratelimit.rate_key("login-acct", email, _pepper(settings)),
        ratelimit.rate_key("login-ip", ip or "unknown", _pepper(settings)),
    ]


def _locked_response(until: datetime, now: datetime) -> HTTPException:
    retry = max(1, int((until - now).total_seconds()))
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS, LOGIN_LOCKED, headers={"Retry-After": str(retry)}
    )


@router.post("/login")
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    services: ServicesDep,
    settings: SettingsDep,
    ip: ClientIpDep,
) -> LoginOut:
    now = services.clock()
    email = body.email.lower()
    keys = _lock_keys(email, ip, settings)
    until = ratelimit.locked_until(keys, now)
    if until is not None:
        raise _locked_response(until, now)

    with anonymous_session() as s:
        account = s.execute(text("SELECT * FROM auth_user_by_email(:e)"), {"e": email}).first()
    if account is None:
        burn_time(body.password)
        ok = False
    else:
        ok = verify_password(account.password_hash, body.password) and account.status == "active"

    if not ok or account is None:
        ratelimit.record_failure(
            keys,
            now,
            ratelimit.LOGIN_MAX_FAILURES,
            ratelimit.LOGIN_WINDOW,
            ratelimit.LOGIN_LOCK,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_FAILED)

    ratelimit.clear(keys[0])
    ip_hash = hash_ip(ip, _pepper(settings))
    with user_session(account.id) as s:
        new_hash = hash_password(body.password) if needs_rehash(account.password_hash) else None
        s.execute(
            text(
                "UPDATE users SET last_login_at = :now, updated_at = :now, "
                "password_hash = coalesce(:h, password_hash) WHERE id = :id"
            ),
            {"now": now, "h": new_hash, "id": account.id},
        )
        s.add(AuditLog(user_id=account.id, event="login", at=now, ip_hash=ip_hash))
    start_session(
        response,
        account.id,
        body.keep_signed_in,
        now,
        request.headers.get("user-agent"),
        ip_hash,
        settings,
    )
    # New CSRF token for the new session.
    set_csrf_cookie(response, new_csrf_token(), settings)
    return LoginOut()


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request, response: Response, services: ServicesDep, settings: SettingsDep
) -> None:
    raw = request.cookies.get(cookie_name(SESSION_COOKIE, settings))
    if raw:
        with anonymous_session() as s:
            row = s.execute(
                text("SELECT * FROM auth_session_by_token(:h)"), {"h": hash_token(raw)}
            ).first()
        if row is not None:
            with user_session(row.user_id) as s:
                s.add(AuditLog(user_id=row.user_id, event="logout", at=services.clock()))
            end_session(response, row.session_id, row.user_id, settings)
            return
    clear_session_cookie(response, settings)
