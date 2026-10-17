"""Counting and locking under hashed keys, via the auth_rate_* database functions."""

import hashlib
import hmac
from datetime import datetime, timedelta

from sqlalchemy import text

from app.db import anonymous_session

LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_LOCK = timedelta(minutes=15)

SIGNUP_MAX_PER_IP = 10
SIGNUP_WINDOW = timedelta(hours=1)


def rate_key(namespace: str, value: str, pepper: str) -> bytes:
    """Keys are keyed hashes, so the table never holds an email or IP in the clear."""
    return hmac.new(pepper.encode(), f"{namespace}:{value}".encode(), hashlib.sha256).digest()


def locked_until(keys: list[bytes], now: datetime) -> datetime | None:
    with anonymous_session() as s:
        times = [
            s.execute(
                text("SELECT auth_rate_locked_until(:k, :now)"), {"k": k, "now": now}
            ).scalar_one()
            for k in keys
        ]
    found = [t for t in times if t is not None]
    return max(found) if found else None


def record_failure(
    keys: list[bytes], now: datetime, max_failures: int, window: timedelta, lock: timedelta
) -> None:
    """Counts one failure per key and locks any key that reaches max_failures in the window."""
    with anonymous_session() as s:
        for k in keys:
            s.execute(text("SELECT auth_rate_hit(:k, :now)"), {"k": k, "now": now})
            count = s.execute(
                text("SELECT auth_rate_count(:k, :since)"), {"k": k, "since": now - window}
            ).scalar_one()
            if count >= max_failures:
                s.execute(text("SELECT auth_rate_lock(:k, :until)"), {"k": k, "until": now + lock})


def count_recent(key: bytes, since: datetime) -> int:
    with anonymous_session() as s:
        return int(
            s.execute(
                text("SELECT auth_rate_count(:k, :since)"), {"k": key, "since": since}
            ).scalar_one()
        )


def hit(key: bytes, now: datetime) -> None:
    with anonymous_session() as s:
        s.execute(text("SELECT auth_rate_hit(:k, :now)"), {"k": key, "now": now})


def clear(key: bytes) -> None:
    with anonymous_session() as s:
        s.execute(text("SELECT auth_rate_clear(:k)"), {"k": key})
