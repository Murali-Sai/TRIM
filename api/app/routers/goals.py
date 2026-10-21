"""Weekly goals and badges (task 3.16), evaluated lazily like streaks.

Each request: the week's goals are set if missing (Monday's choice, app/goals.py), open weeks
are checked and closed once they end, and badges are awarded from the numbers. Awarding is an
insert that ignores repeats, so each badge is earned once.
"""

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import goals as g
from app.db import user_session
from app.deps import ServicesDep
from app.routers.streaks import evaluate as evaluate_streaks
from app.security.sessions import ActiveUserDep
from app.streaks import monday_of
from app.timeutil import local_date

router = APIRouter(tags=["goals"])


class GoalOut(BaseModel):
    kind: str
    text: str
    done: int
    needed: int
    complete: bool


class GoalsOut(BaseModel):
    week_start: date
    goals: list[GoalOut]
    perfect: bool
    perfect_weeks: int


class BadgeOut(BaseModel):
    key: str
    name: str
    how: str
    earned_at: datetime | None


def _tz(s: Session, user_id: Any) -> str:
    tz: str = s.execute(
        text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user_id}
    ).scalar_one()
    return tz


def _tracks(s: Session, user_id: Any, week_end: date) -> g.Tracks:
    row = s.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM targets WHERE user_id = :u AND deleted_at IS NULL "
            "AND effective_from <= :e) AS has_target, "
            "coalesce((SELECT track_water FROM user_settings WHERE user_id = :u), false) AS water, "
            "EXISTS (SELECT 1 FROM weight_entries WHERE user_id = :u AND deleted_at IS NULL) "
            "AS weighed, EXISTS (SELECT 1 FROM measurement_types WHERE user_id = :u "
            "AND deleted_at IS NULL AND archived_at IS NULL AND is_active) AS measures"
        ),
        {"u": user_id, "e": week_end},
    ).one()
    return g.Tracks(row.has_target, row.water, row.weighed, has_measurements=row.measures)


def week_data(s: Session, user_id: Any, tz: str, monday: date) -> g.WeekData:
    sunday = monday + timedelta(days=6)
    days = s.execute(
        text(
            "SELECT logged_on, sum(kcal) AS kcal, sum(protein_g) AS protein FROM food_logs "
            "WHERE user_id = :u AND deleted_at IS NULL AND logged_on BETWEEN :a AND :b "
            "GROUP BY logged_on"
        ),
        {"u": user_id, "a": monday, "b": sunday},
    ).all()
    targets = s.execute(
        text(
            "SELECT effective_from, kcal, protein_g FROM targets WHERE user_id = :u "
            "AND deleted_at IS NULL AND effective_from <= :b "
            "ORDER BY effective_from DESC, created_at DESC, id DESC"
        ),
        {"u": user_id, "b": sunday},
    ).all()
    protein_days = calorie_days = 0
    for d in days:
        t = next((t for t in targets if t.effective_from <= d.logged_on), None)
        if t is None:
            continue
        if float(d.protein) >= g.PROTEIN_SHARE * t.protein_g:
            protein_days += 1
        if abs(float(d.kcal) - t.kcal) * 20 <= t.kcal:
            calorie_days += 1
    counts = s.execute(
        text(
            "SELECT (SELECT count(*) FROM weight_entries WHERE user_id = :u AND deleted_at IS NULL "
            "AND (measured_at AT TIME ZONE :tz)::date BETWEEN :a AND :b) AS weigh_ins, "
            "(SELECT count(DISTINCT logged_on) FROM water_logs WHERE user_id = :u "
            "AND deleted_at IS NULL AND logged_on BETWEEN :a AND :b) AS water_days, "
            "(SELECT count(*) FROM measurement_entries WHERE user_id = :u AND deleted_at IS NULL "
            "AND (measured_at AT TIME ZONE :tz)::date BETWEEN :a AND :b) AS measurements"
        ),
        {"u": user_id, "tz": tz, "a": monday, "b": sunday},
    ).one()
    return g.WeekData(
        logged_days=len(days),
        protein_days=protein_days,
        calorie_days=calorie_days,
        weigh_ins=int(counts.weigh_ins),
        water_days=int(counts.water_days),
        measurements=int(counts.measurements),
    )


def refresh_goals(s: Session, user_id: Any, tz: str, today: date, now: datetime) -> date:
    """Set this week's goals if missing, then check every open week. Returns this Monday."""
    this_monday = monday_of(today)
    has_goals = s.execute(
        text("SELECT 1 FROM weekly_goals WHERE user_id = :u AND week_start = :w LIMIT 1"),
        {"u": user_id, "w": this_monday},
    ).first()
    if has_goals is None:
        tracks = _tracks(s, user_id, this_monday + timedelta(days=6))
        for i, kind in enumerate(g.choose_goals(tracks, str(user_id), this_monday)):
            s.execute(
                text(
                    "INSERT INTO weekly_goals (id, user_id, week_start, kind, position, needed) "
                    "VALUES (gen_random_uuid(), :u, :w, :k, :p, :n) ON CONFLICT DO NOTHING"
                ),
                {"u": user_id, "w": this_monday, "k": kind, "p": i, "n": g.GOAL_TARGETS[kind]},
            )
    open_weeks = s.execute(
        text(
            "SELECT DISTINCT week_start FROM weekly_goals WHERE user_id = :u AND NOT closed "
            "ORDER BY week_start"
        ),
        {"u": user_id},
    ).scalars()
    for monday in list(open_weeks):
        data = week_data(s, user_id, tz, monday)
        rows = s.execute(
            text(
                "SELECT id, kind, completed_at FROM weekly_goals WHERE user_id = :u "
                "AND week_start = :w"
            ),
            {"u": user_id, "w": monday},
        ).all()
        for r in rows:
            done, need = g.goal_progress(r.kind, data)
            if done >= need and r.completed_at is None:
                s.execute(
                    text("UPDATE weekly_goals SET completed_at = :t WHERE id = :id"),
                    {"t": now, "id": r.id},
                )
        if monday < this_monday:
            s.execute(
                text(
                    "UPDATE weekly_goals SET closed = true WHERE user_id = :u AND week_start = :w"
                ),
                {"u": user_id, "w": monday},
            )
    return this_monday


def perfect_weeks(s: Session, user_id: Any) -> int:
    n: int = s.execute(
        text(
            "SELECT count(*) FROM (SELECT week_start FROM weekly_goals WHERE user_id = :u "
            "GROUP BY week_start HAVING count(*) = count(completed_at)) w"
        ),
        {"u": user_id},
    ).scalar_one()
    return n


def award_badges(
    s: Session, user_id: Any, tz: str, now: datetime, longest_days: int, longest_weeks: int
) -> None:
    counts = s.execute(
        text(
            "SELECT (SELECT count(*) FROM saved_meals WHERE user_id = :u) AS meals, "
            "(SELECT count(*) FROM food_logs WHERE user_id = :u AND deleted_at IS NULL) "
            "AS entries, "
            "(SELECT count(*) FROM diet_phases WHERE user_id = :u AND deleted_at IS NULL "
            "AND end_date < :today) AS phases_ended"
        ),
        {"u": user_id, "today": local_date(now, tz)},
    ).one()
    earned = g.earned_badges(
        longest_days=longest_days,
        longest_weeks=longest_weeks,
        saved_meals=int(counts.meals),
        entries=int(counts.entries),
        phases_ended=int(counts.phases_ended),
        perfect_weeks=perfect_weeks(s, user_id),
        measurement_weeks=g.longest_week_run(
            s.execute(
                text(
                    "SELECT DISTINCT date_trunc('week', measured_at AT TIME ZONE :tz)::date "
                    "FROM measurement_entries WHERE user_id = :u AND deleted_at IS NULL"
                ),
                {"u": user_id, "tz": tz},
            ).scalars()
        ),
    )
    for badge in sorted(earned):
        s.execute(
            text(
                "INSERT INTO user_badges (id, user_id, badge, earned_at) "
                "VALUES (gen_random_uuid(), :u, :b, :t) ON CONFLICT (user_id, badge) DO NOTHING"
            ),
            {"u": user_id, "b": badge, "t": now},
        )


def refresh(s: Session, user_id: Any, now: datetime) -> tuple[str, date]:
    tz = _tz(s, user_id)
    today = local_date(now, tz)
    streak, weeks, _ = evaluate_streaks(s, user_id, tz, today)
    monday = refresh_goals(s, user_id, tz, today, now)
    award_badges(s, user_id, tz, now, streak.longest, weeks.longest)
    return tz, monday


@router.get("/goals")
def get_goals(user: ActiveUserDep, services: ServicesDep) -> GoalsOut:
    """This week's three goals with progress (done is capped at what each goal asks)."""
    now = services.clock()
    with user_session(user.user_id) as s:
        tz, monday = refresh(s, user.user_id, now)
        data = week_data(s, user.user_id, tz, monday)
        rows = s.execute(
            text(
                "SELECT kind FROM weekly_goals WHERE user_id = :u AND week_start = :w "
                "ORDER BY position"
            ),
            {"u": user.user_id, "w": monday},
        ).scalars()
        goals = []
        for kind in rows:
            done, need = g.goal_progress(kind, data)
            goals.append(
                GoalOut(
                    kind=kind, text=g.GOAL_TEXT[kind], done=done, needed=need, complete=done >= need
                )
            )
        return GoalsOut(
            week_start=monday,
            goals=goals,
            perfect=bool(goals) and all(x.complete for x in goals),
            perfect_weeks=perfect_weeks(s, user.user_id),
        )


@router.get("/badges")
def get_badges(user: ActiveUserDep, services: ServicesDep) -> list[BadgeOut]:
    """Every badge, earned ones with their date, locked ones with how to earn them."""
    now = services.clock()
    with user_session(user.user_id) as s:
        refresh(s, user.user_id, now)
        earned: dict[str, datetime] = dict(
            s.execute(
                text("SELECT badge, earned_at FROM user_badges WHERE user_id = :u"),
                {"u": user.user_id},
            ).all()
        )
    return [
        BadgeOut(key=b.key, name=b.name, how=b.how, earned_at=earned.get(b.key)) for b in g.BADGES
    ]
