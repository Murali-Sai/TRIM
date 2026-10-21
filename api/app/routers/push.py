"""Streak reminders (task 3.18): browser subscriptions and the hourly job.

Opt-in: the user picks a local time (20:00 by default) and allows notifications. The hourly job
sends at most one reminder a day, only while the streak is alive and today has no entry:
"Log something today to keep your 23-day streak." Nothing is sent once today is logged.
"""

import hmac
from datetime import datetime, time
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.db import anonymous_session, user_session
from app.deps import ServicesDep
from app.routers.streaks import evaluate as evaluate_streaks
from app.security.sessions import ActiveUserDep
from app.services.push import PushMessage, Subscription

router = APIRouter(tags=["push"])

Key = Annotated[str, Field(min_length=1, max_length=200)]


class PushConfigOut(BaseModel):
    """None when the server has no VAPID keys, so reminders cannot be turned on."""

    public_key: str | None


class Keys(BaseModel):
    p256dh: Key
    auth: Key


class SubscriptionIn(BaseModel):
    endpoint: Annotated[str, Field(min_length=10, max_length=1000, pattern=r"^https://")]
    keys: Keys


@router.get("/push/config")
def push_config(user: ActiveUserDep, services: ServicesDep) -> PushConfigOut:
    return PushConfigOut(public_key=services.vapid_public_key)


@router.post("/push/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(body: SubscriptionIn, user: ActiveUserDep) -> None:
    """Saves this browser's subscription for the signed-in user (again is fine)."""
    with user_session(user.user_id) as s:
        s.execute(
            text(
                "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) "
                "VALUES (gen_random_uuid(), :u, :e, :p, :a) ON CONFLICT (user_id, endpoint) "
                "DO UPDATE SET p256dh = :p, auth = :a, deleted_at = NULL, updated_at = now()"
            ),
            {"u": user.user_id, "e": body.endpoint, "p": body.keys.p256dh, "a": body.keys.auth},
        )


@router.delete("/push/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(user: ActiveUserDep, endpoint: Annotated[str, Query(max_length=1000)]) -> None:
    with user_session(user.user_id) as s:
        s.execute(
            text("DELETE FROM push_subscriptions WHERE user_id = :u AND endpoint = :e"),
            {"u": user.user_id, "e": endpoint},
        )


# --- the hourly job --------------------------------------------------------------------------


class JobOut(BaseModel):
    reminders_sent: int


def _due(now: datetime, tz: str, reminder: str, last: Any) -> bool:
    local = now.astimezone(ZoneInfo(tz))
    hh, mm = (int(x) for x in reminder.split(":"))
    return local.time() >= time(hh, mm) and last != local.date()


def send_reminders(services: Any) -> int:
    now = services.clock()
    with anonymous_session() as s:
        candidates = s.execute(text("SELECT * FROM reminder_candidates()")).all()
    sent = 0
    for c in candidates:
        if not _due(now, c.timezone, c.reminder, c.last_reminded_on):
            continue
        today = now.astimezone(ZoneInfo(c.timezone)).date()
        with user_session(c.user_id) as s:
            view, _, _ = evaluate_streaks(s, c.user_id, c.timezone, today)
            if view.today_logged or view.current == 0:
                continue
            days = view.current
            message = PushMessage(
                title="TRIM",
                body=f"Log something today to keep your {days}-day streak.",
                url="/log",
            )
            subs = s.execute(
                text(
                    "SELECT endpoint, p256dh, auth FROM push_subscriptions "
                    "WHERE user_id = :u AND deleted_at IS NULL"
                ),
                {"u": c.user_id},
            ).all()
            delivered = False
            for sub in subs:
                outcome = services.push.send(
                    Subscription(sub.endpoint, sub.p256dh, sub.auth), message
                )
                if outcome == "gone":
                    s.execute(
                        text("DELETE FROM push_subscriptions WHERE user_id = :u AND endpoint = :e"),
                        {"u": c.user_id, "e": sub.endpoint},
                    )
                delivered = delivered or outcome == "sent"
            # Marked even when every browser failed: at most one try a day, never a burst.
            s.execute(
                text("UPDATE user_settings SET last_reminded_on = :d WHERE user_id = :u"),
                {"d": today, "u": c.user_id},
            )
            sent += delivered
    return sent


@router.post("/internal/jobs/hourly")
def hourly_job(
    services: ServicesDep, x_job_token: Annotated[str | None, Header()] = None
) -> JobOut:
    """Cloud Scheduler calls this every hour with X-Job-Token. Streaks themselves are
    evaluated lazily; this sends the due reminders."""
    expected = services.job_token
    if not expected or not x_job_token or not hmac.compare_digest(x_job_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not allowed")
    return JobOut(reminders_sent=send_reminders(services))
