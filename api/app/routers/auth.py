"""Sign-up and email verification (task 1.4). Login and sessions arrive in task 1.5."""

import logging
from datetime import timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, status
from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import anonymous_session, user_session
from app.deps import ClientIpDep, ServicesDep, SettingsDep
from app.email.messages import verify_email
from app.ids import uuid7
from app.models import AuditLog, AuthToken, User, UserProfile
from app.security.passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hash_password
from app.security.tokens import hash_ip, hash_token, new_token
from app.services.email import EmailSendError

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

VERIFY_TOKEN_TTL = timedelta(hours=1)


def _valid_timezone(tz: str) -> str:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown timezone") from None
    return tz


class SignupIn(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)]
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
    ]
    timezone: Annotated[str, AfterValidator(_valid_timezone)]
    unit_system: Literal["metric", "imperial"]
    turnstile_token: Annotated[str, Field(max_length=2048)]


class CheckEmailOut(BaseModel):
    status: Literal["check_email"] = "check_email"


@router.post("/signup", status_code=status.HTTP_202_ACCEPTED)
def signup(
    body: SignupIn, services: ServicesDep, settings: SettingsDep, ip: ClientIpDep
) -> CheckEmailOut:
    if not services.human_check.verify(body.turnstile_token, ip):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please complete the check and try again.")
    if services.breach.is_breached(body.password):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "This password has appeared in a data breach. Choose a different one.",
        )

    email = body.email.strip().lower()
    # Hash before checking for an existing account so both paths take the same time.
    password_hash = hash_password(body.password)

    with anonymous_session() as s:
        exists = s.execute(text("SELECT 1 FROM auth_user_by_email(:e)"), {"e": email}).first()
    if exists:
        # Same answer as a new sign-up, so the form cannot be used to probe for accounts.
        return CheckEmailOut()

    now = services.clock()
    user_id = uuid7()
    raw_token, token_hash = new_token()
    try:
        with user_session(user_id) as s:
            s.add(User(id=user_id, email=email, password_hash=password_hash))
            s.flush()
            s.add_all(
                [
                    UserProfile(
                        user_id=user_id,
                        display_name=body.display_name,
                        timezone=body.timezone,
                        unit_system=body.unit_system,
                    ),
                    AuthToken(
                        user_id=user_id,
                        kind="verify",
                        token_hash=token_hash,
                        expires_at=now + VERIFY_TOKEN_TTL,
                    ),
                    AuditLog(
                        user_id=user_id,
                        event="signup",
                        at=now,
                        ip_hash=hash_ip(ip, settings.ip_hash_pepper.get_secret_value()),
                    ),
                ]
            )
    except IntegrityError:
        # Lost a race with another sign-up for the same email.
        return CheckEmailOut()

    link = f"{settings.app_base_url}/verify#token={raw_token}"
    try:
        services.email.send(email, verify_email(body.display_name, link))
    except EmailSendError:
        # The account exists; the user can ask for a new link after logging in.
        log.exception("Verification email failed for user %s", user_id)
    return CheckEmailOut()


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
