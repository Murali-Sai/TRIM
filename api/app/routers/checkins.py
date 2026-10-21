"""Weekly check-ins (task 5.3): the user's list and each week, plus the hourly job's part.

The job (POST /api/internal/checkins, and the hourly job) makes the check-ins that are due and
sends the opted-in emails, at most 90 a day across everyone to stay under Resend's free 100.
"""

import hmac
import json
import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from app import checkins as engine
from app import usage
from app.config import get_settings
from app.db import anonymous_session, user_session
from app.deps import ServicesDep
from app.email.messages import checkin_email
from app.security.sessions import ActiveUserDep
from app.services.email import EmailSendError

log = logging.getLogger(__name__)

router = APIRouter(tags=["checkins"])

EMAILS_PER_DAY = 90
NOT_FOUND = "Check-in not found"


class CheckinSummary(BaseModel):
    week_start: date
    week_end: date
    headline: str
    read: bool
    # The first three sentences, for the Progress card (reading them there is not opening it).
    preview: list[str]


class CheckinOut(CheckinSummary):
    lines: list[str]
    stats: dict[str, Any]


def _prefs(s: Any, user_id: Any) -> Any:
    return s.execute(
        text(
            "SELECT p.unit_system, coalesce(st.water_unit, 'ml') AS water FROM user_profiles p "
            "LEFT JOIN user_settings st ON st.user_id = p.user_id WHERE p.user_id = :u"
        ),
        {"u": user_id},
    ).one()


def _out(row: Any, prefs: Any) -> CheckinOut:
    stats = row.stats
    lines = engine.sentences(stats, prefs.unit_system == "imperial", prefs.water == "fl_oz")
    return CheckinOut(
        week_start=row.week_start,
        week_end=row.week_start + timedelta(days=6),
        headline=engine.headline(stats),
        read=row.read_at is not None,
        preview=lines[:3],
        lines=lines,
        stats=stats,
    )


@router.get("/checkins")
def list_checkins(user: ActiveUserDep) -> list[CheckinSummary]:
    """Newest first, with an unread mark."""
    with user_session(user.user_id) as s:
        rows = s.execute(
            text(
                "SELECT week_start, stats, read_at FROM weekly_checkins WHERE user_id = :u "
                "AND deleted_at IS NULL ORDER BY week_start DESC"
            ),
            {"u": user.user_id},
        ).all()
        prefs = _prefs(s, user.user_id)
        return [
            CheckinSummary(**_out(r, prefs).model_dump(exclude={"lines", "stats"})) for r in rows
        ]


@router.get("/checkins/{week}")
def get_checkin(week: date, user: ActiveUserDep, services: ServicesDep) -> CheckinOut:
    """One week (its Monday), marked read."""
    with user_session(user.user_id) as s:
        row = s.execute(
            text(
                "UPDATE weekly_checkins SET read_at = coalesce(read_at, :now) "
                "WHERE user_id = :u AND week_start = :w AND deleted_at IS NULL "
                "RETURNING week_start, stats, NULL::timestamptz AS read_at"
            ),
            {"u": user.user_id, "w": week, "now": services.clock()},
        ).first()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        out = _out(row, _prefs(s, user.user_id))
        out.read = True
        return out


# --- the job ---------------------------------------------------------------------------------


def generate(services: Any) -> int:
    """Make each user's latest due check-in if it is missing. Returns how many were made."""
    now = services.clock()
    with anonymous_session() as s:
        due = s.execute(text("SELECT * FROM checkins_due(:at)"), {"at": now}).all()
    made = 0
    for d in due:
        try:
            with user_session(d.user_id) as s:
                stats = engine.compute(s, d.user_id, d.timezone, d.week_start, now)
                created = s.execute(
                    text(
                        "INSERT INTO weekly_checkins (id, user_id, week_start, stats) "
                        "VALUES (gen_random_uuid(), :u, :w, CAST(:st AS jsonb)) "
                        "ON CONFLICT (user_id, week_start) DO NOTHING RETURNING id"
                    ),
                    {"u": d.user_id, "w": d.week_start, "st": _json(stats)},
                ).first()
                made += created is not None
        except Exception:
            # One account's trouble must not hold up everyone else's; it is tried next hour.
            log.exception("check-in for user %s failed", d.user_id)
    return made


def _json(stats: dict[str, Any]) -> str:
    return json.dumps(stats)


def send_emails(services: Any) -> int:
    """Send queued check-in emails, at most EMAILS_PER_DAY per UTC day across everyone."""
    now = services.clock()
    since = datetime.combine(now.astimezone(UTC).date(), time(0), tzinfo=UTC)
    with anonymous_session() as s:
        sent_today = int(
            s.execute(text("SELECT checkin_emails_sent_since(:t)"), {"t": since}).scalar_one()
        )
        budget = EMAILS_PER_DAY - sent_today
        if budget <= 0:
            return 0
        queue = s.execute(text("SELECT * FROM checkin_email_queue(:n)"), {"n": budget}).all()
    sent = 0
    base = get_settings().app_base_url.rstrip("/")
    for q in queue:
        with user_session(q.user_id) as s:
            row = s.execute(
                text(
                    "SELECT c.week_start, c.stats, c.read_at, u.email, p.display_name "
                    "FROM weekly_checkins c JOIN users u ON u.id = c.user_id "
                    "JOIN user_profiles p ON p.user_id = c.user_id WHERE c.id = :id"
                ),
                {"id": q.checkin_id},
            ).one()
            out = _out(row, _prefs(s, q.user_id))
            week = f"{row.week_start.day} {row.week_start:%b}"
            message = checkin_email(
                row.display_name, week, out.lines, f"{base}/checkins/{row.week_start}"
            )
            try:
                usage.send_email(services, row.email, message)
            except EmailSendError:
                # Try again next hour; the rest wait too, so the cap is never overrun.
                break
            s.execute(
                text("UPDATE weekly_checkins SET emailed_at = :t WHERE id = :id"),
                {"t": now, "id": q.checkin_id},
            )
            sent += 1
    return sent


class CheckinJobOut(BaseModel):
    checkins_created: int
    checkin_emails_sent: int


def run_job(services: Any) -> CheckinJobOut:
    return CheckinJobOut(
        checkins_created=generate(services), checkin_emails_sent=send_emails(services)
    )


@router.post("/internal/checkins")
def checkins_job(
    services: ServicesDep, x_job_token: Annotated[str | None, Header()] = None
) -> CheckinJobOut:
    """For Cloud Scheduler, with X-Job-Token (the hourly job runs this too)."""
    expected = services.job_token
    if not expected or not x_job_token or not hmac.compare_digest(x_job_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not allowed")
    return run_job(services)
