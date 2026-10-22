"""Free-tier usage alerts (task 5.7): warn at 70% of each limit the app can measure itself.

Counted here, per UTC hour: emails sent (alerting against Resend's free 100 a day and 3,000 a
month, well inside Gmail's 500 a day) and FoodData Central requests (1,000 an hour per key).
Measured live: the database size against Neon's free 0.5 GB. The hourly job checks them and
emails TRIM_ALERT_EMAIL once per limit per period. Render and Cloudflare stop at their free
limits rather than charge, since no card is on file.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import text

from app.db import anonymous_session
from app.email.layout import RenderedEmail
from app.email.messages import usage_alert_email

log = logging.getLogger(__name__)

THRESHOLD = 0.7
KEEP = timedelta(days=40)
Window = Literal["hour", "day", "month", "now"]


@dataclass(frozen=True)
class Limit:
    key: str
    name: str
    limit: float
    unit: str
    window: Window
    # The counter it sums, or None for a value read live.
    metric: str | None


LIMITS: tuple[Limit, ...] = (
    Limit("resend_day", "Emails today", 100, "emails", "day", "email"),
    Limit("resend_month", "Emails this month", 3000, "emails", "month", "email"),
    Limit("fdc_hour", "FoodData Central requests this hour", 1000, "requests", "hour", "fdc"),
    Limit("neon_storage", "Neon database size", 512, "MB", "now", None),
)


def _hour(at: datetime) -> datetime:
    return at.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def window_start(window: Window, now: datetime) -> datetime:
    h = _hour(now)
    if window == "hour":
        return h
    if window == "day":
        return h.replace(hour=0)
    return h.replace(day=1, hour=0)


def period(limit: Limit, now: datetime) -> str:
    """Which alert this would be: one per hour, day or month (live values: once a month)."""
    start = window_start("month" if limit.window == "now" else limit.window, now)
    return start.isoformat()


def record(metric: str, at: datetime, n: int = 1) -> None:
    """Count n calls to a metered service. Never fails the caller."""
    try:
        with anonymous_session() as s:
            s.execute(
                text(
                    "INSERT INTO usage_counters (metric, hour, count) VALUES (:m, :h, :n) "
                    "ON CONFLICT (metric, hour) DO UPDATE SET count = usage_counters.count + :n"
                ),
                {"m": metric, "h": _hour(at), "n": n},
            )
    except Exception:
        log.exception("could not count usage of %s", metric)


def send_email(services: Any, to: str, email: RenderedEmail) -> None:
    """Send through the email service and count it against the email limits."""
    services.email.send(to, email)
    record("email", services.clock())


def measure(s: Any, limit: Limit, now: datetime) -> float:
    if limit.metric is None:
        size: float = s.execute(
            text("SELECT pg_database_size(current_database()) / 1048576.0")
        ).scalar_one()
        return float(size)
    if limit.window == "now":
        raise ValueError(limit.key)
    total = s.execute(
        text(
            "SELECT coalesce(sum(count), 0) FROM usage_counters "
            "WHERE metric = :m AND hour >= :a AND hour <= :b"
        ),
        {"m": limit.metric, "a": window_start(limit.window, now), "b": _hour(now)},
    ).scalar_one()
    return float(total)


def check(services: Any, limits: tuple[Limit, ...] = LIMITS) -> list[str]:
    """Alert on every limit at 70% or more that has not been alerted this period. Returns the
    keys alerted."""
    from app.config import get_settings

    now = services.clock()
    to = get_settings().alert_email
    sent: list[str] = []
    with anonymous_session() as s:
        s.execute(text("DELETE FROM usage_counters WHERE hour < :t"), {"t": now - KEEP})
        for limit in limits:
            value = measure(s, limit, now)
            share = value / limit.limit
            if share < THRESHOLD:
                continue
            key = period(limit, now)
            fresh = s.execute(
                text(
                    "INSERT INTO usage_alerts (limit_key, period, value, sent_at) "
                    "VALUES (:k, :p, :v, :t) ON CONFLICT DO NOTHING RETURNING limit_key"
                ),
                {"k": limit.key, "p": key, "v": value, "t": now},
            ).first()
            if fresh is None:
                continue
            log.warning(
                "free tier at %d%%: %s, %s of %s %s",
                round(share * 100),
                limit.name,
                round(value),
                round(limit.limit),
                limit.unit,
            )
            if to:
                try:
                    send_email(
                        services, to, usage_alert_email(limit.name, value, limit.limit, limit.unit)
                    )
                except Exception:
                    log.exception("could not email the usage alert for %s", limit.key)
            sent.append(limit.key)
    return sent
