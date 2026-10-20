"""Streaks (task 3.15): lazy evaluation on request (SPEC page 3, Evaluation).

Each request walks the final days since last_counted_date (see app/streaks.py), writes their
streak_events and stores the new state, then applies yesterday and today provisionally for the
answer. The row is locked while walking, so two requests never write the same events twice.
"""

from datetime import date, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import streaks as engine
from app.db import user_session
from app.deps import ServicesDep
from app.security.sessions import ActiveUserDep
from app.timeutil import local_date

router = APIRouter(prefix="/streaks", tags=["streaks"])

DayState = Literal["logged", "freeze", "none", "future"]


class WeighInOut(BaseModel):
    current_weeks: int
    longest_weeks: int
    this_week: int


class CalendarDay(BaseModel):
    date: date
    state: DayState


class StreaksOut(BaseModel):
    today: date
    current_days: int
    longest_days: int
    freezes_held: int
    today_logged: bool
    # After a break: "New streak starts today. Longest: 14 days."
    message: str | None
    weigh_in: WeighInOut
    month: str
    calendar: list[CalendarDay]


def logged_days(s: Session, user_id: Any, tz: str, since: date | None) -> dict[date, bool]:
    """Days that count, from `since` on: True when saved only by a backfill made the next
    day. Entries added later than the end of the next day do not count (SPEC: Repair)."""
    rows = s.execute(
        text(
            "SELECT logged_on, "
            "bool_or((created_at AT TIME ZONE :tz)::date <= logged_on) AS on_time, "
            "bool_or((created_at AT TIME ZONE :tz)::date <= logged_on + 1) AS in_window "
            "FROM food_logs WHERE user_id = :u AND deleted_at IS NULL "
            "AND (CAST(:since AS date) IS NULL OR logged_on >= :since) GROUP BY logged_on"
        ),
        {"u": user_id, "tz": tz, "since": since},
    ).all()
    return {r.logged_on: not r.on_time for r in rows if r.in_window}


def weigh_in_counts(s: Session, user_id: Any, tz: str, since: date | None) -> dict[date, int]:
    rows = s.execute(
        text(
            "SELECT date_trunc('week', measured_at AT TIME ZONE :tz)::date AS monday, "
            "count(*) AS n FROM weight_entries WHERE user_id = :u AND deleted_at IS NULL "
            "AND (CAST(:since AS date) IS NULL OR (measured_at AT TIME ZONE :tz)::date >= :since) "
            "GROUP BY 1"
        ),
        {"u": user_id, "tz": tz, "since": since},
    ).all()
    return {r.monday: int(r.n) for r in rows}


def evaluate(
    s: Session, user_id: Any, tz: str, today: date
) -> tuple[engine.StreakView, engine.WeekView, dict[date, bool]]:
    s.execute(
        text("INSERT INTO user_streaks (user_id) VALUES (:u) ON CONFLICT (user_id) DO NOTHING"),
        {"u": user_id},
    )
    row = s.execute(
        text("SELECT * FROM user_streaks WHERE user_id = :u FOR UPDATE"), {"u": user_id}
    ).one()
    state = engine.StreakState(
        row.current_days, row.longest_days, row.freezes_held, row.last_counted_date
    )
    since = state.through + timedelta(days=1) if state.through else None
    logged = logged_days(s, user_id, tz, since)
    state, events = engine.advance(state, logged, engine.final_until(today))
    for e in events:
        s.execute(
            text(
                "INSERT INTO streak_events (id, user_id, on_date, kind) "
                "VALUES (gen_random_uuid(), :u, :d, :k)"
            ),
            {"u": user_id, "d": e.on, "k": e.kind},
        )

    weeks = engine.WeekState(
        row.weigh_in_current_weeks, row.weigh_in_longest_weeks, row.weigh_in_last_week
    )
    week_since = weeks.through + timedelta(weeks=1) if weeks.through else None
    counts = weigh_in_counts(s, user_id, tz, week_since)
    weeks = engine.advance_weeks(weeks, counts, engine.monday_of(today) - timedelta(weeks=1))
    s.execute(
        text(
            "UPDATE user_streaks SET current_days = :c, longest_days = :l, freezes_held = :f, "
            "last_counted_date = :t, weigh_in_current_weeks = :wc, weigh_in_longest_weeks = :wl, "
            "weigh_in_last_week = :wt, updated_at = now() WHERE user_id = :u"
        ),
        {
            "u": user_id,
            "c": state.current,
            "l": state.longest,
            "f": state.freezes,
            "t": state.through,
            "wc": weeks.current,
            "wl": weeks.longest,
            "wt": weeks.through,
        },
    )
    return (
        engine.view(state, logged, today),
        engine.week_view(weeks, counts, today),
        logged,
    )


def _month(month: str | None, today: date) -> date:
    if month is None:
        return today.replace(day=1)
    try:
        return date.fromisoformat(f"{month}-01")
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Use YYYY-MM") from None


@router.get("")
def get_streaks(
    user: ActiveUserDep,
    services: ServicesDep,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
) -> StreaksOut:
    """Current and longest streaks, freezes, the weigh-in streak and a month's calendar."""
    with user_session(user.user_id) as s:
        tz: str = s.execute(
            text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user.user_id}
        ).scalar_one()
        today = local_date(services.clock(), tz)
        v, w, _ = evaluate(s, user.user_id, tz, today)
        first = _month(month, today)
        nxt = (first + timedelta(days=32)).replace(day=1)
        counted = logged_days(s, user.user_id, tz, first)
        frozen = set(
            s.execute(
                text(
                    "SELECT on_date FROM streak_events WHERE user_id = :u AND kind = 'freeze_used' "
                    "AND on_date >= :a AND on_date < :b"
                ),
                {"u": user.user_id, "a": first, "b": nxt},
            ).scalars()
        ) | set(v.freeze_days)
    calendar: list[CalendarDay] = []
    day = first
    while day < nxt:
        state: DayState = (
            "future"
            if day > today
            else "logged"
            if day in counted
            else "freeze"
            if day in frozen
            else "none"
        )
        calendar.append(CalendarDay(date=day, state=state))
        day += timedelta(days=1)
    return StreaksOut(
        today=today,
        current_days=v.current,
        longest_days=v.longest,
        freezes_held=v.freezes,
        today_logged=v.today_logged,
        message=engine.broken_message(v),
        weigh_in=WeighInOut(
            current_weeks=w.current, longest_weeks=w.longest, this_week=w.this_week
        ),
        month=first.strftime("%Y-%m"),
        calendar=calendar,
    )
