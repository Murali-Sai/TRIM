"""Weekly check-ins (task 5.3, SPEC page 3): one plain recap of each local Monday to Sunday.

A check-in is due once the user's local Monday 06:00 after its week has passed; the hourly job
makes the latest due one for everyone who had signed up by the end of that week. The numbers
are stored; the sentences are written from them when read, in the user's units at that time.
They describe the week and never give advice or judge it.
"""

import uuid
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.tdee import LB_IN_KG
from app.trend import WEIGHT_ALPHA, Reading, compute_trend, project_goal, weekly_rate

DUE_AT = time(6, 0)
FEW_DAYS = 4
ML_PER_FL_OZ = 29.5735


def due_week(now: datetime, tz: str) -> date:
    """The Monday of the latest week whose check-in is due: last week from Monday 06:00 on,
    the week before that until then."""
    local = now.astimezone(ZoneInfo(tz))
    monday = local.date() - timedelta(days=local.weekday())
    if local.replace(tzinfo=None) < datetime.combine(monday, DUE_AT):
        monday -= timedelta(days=7)
    return monday - timedelta(days=7)


def _avg(values: list[float]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def compute(s: Session, user_id: uuid.UUID, tz: str, monday: date, now: datetime) -> dict[str, Any]:
    """The week's numbers, in stored units (kcal, g, kg, ml)."""
    from app.routers.goals import refresh as refresh_goals
    from app.routers.phases import summarize

    sunday = monday + timedelta(days=6)
    summary = summarize(s, user_id, tz, monday, sunday)
    days = s.execute(
        text(
            "SELECT logged_on, sum(protein_g) AS protein, sum(fiber_g) AS fiber FROM food_logs "
            "WHERE user_id = :u AND deleted_at IS NULL AND logged_on BETWEEN :a AND :b "
            "GROUP BY logged_on"
        ),
        {"u": user_id, "a": monday, "b": sunday},
    ).all()
    targets = s.execute(
        text(
            "SELECT effective_from, protein_g FROM targets WHERE user_id = :u "
            "AND deleted_at IS NULL AND effective_from <= :b "
            "ORDER BY effective_from DESC, created_at DESC, id DESC"
        ),
        {"u": user_id, "b": sunday},
    ).all()
    protein_targets = [
        t.protein_g
        for d in days
        if (t := next((t for t in targets if t.effective_from <= d.logged_on), None))
    ]
    settings = s.execute(
        text(
            "SELECT p.goal_weight_kg, coalesce(st.track_water, false) AS water, "
            "coalesce(st.track_fiber, true) AS fiber, coalesce(st.gamification, true) AS games "
            "FROM user_profiles p LEFT JOIN user_settings st ON st.user_id = p.user_id "
            "WHERE p.user_id = :u"
        ),
        {"u": user_id},
    ).one()
    water = None
    if settings.water:
        per_day = s.execute(
            text(
                "SELECT sum(ml) AS ml FROM water_logs WHERE user_id = :u AND deleted_at IS NULL "
                "AND logged_on BETWEEN :a AND :b GROUP BY logged_on"
            ),
            {"u": user_id, "a": monday, "b": sunday},
        ).scalars()
        water = _avg([float(x) for x in per_day])
    fiber = _avg([float(d.fiber) for d in days if d.fiber is not None]) if settings.fiber else None

    # The fastest-changing measurement: the biggest change as a share of where it started.
    fastest: dict[str, Any] | None = None
    best = -1.0
    for m in summary.measurements:
        pct = 100 * (m.end / m.start - 1) if m.start else 0.0
        if abs(pct) > best:
            best = abs(pct)
            fastest = {
                "name": m.name,
                "side": m.side,
                "unit": m.unit,
                "change": m.change,
                "pct": round(pct, 2),
            }

    phase_row = s.execute(
        text(
            "SELECT kind, label, start_date FROM diet_phases WHERE user_id = :u "
            "AND deleted_at IS NULL AND start_date <= :b AND (end_date IS NULL OR end_date >= :b) "
            "LIMIT 1"
        ),
        {"u": user_id, "b": sunday},
    ).first()
    phase = None
    if phase_row is not None:
        name = phase_row.label or phase_row.kind.capitalize()
        phase = {"name": name, "day": (sunday - phase_row.start_date).days + 1}

    projection = None
    if settings.goal_weight_kg is not None:
        weighs = s.execute(
            text(
                "SELECT measured_at, (measured_at AT TIME ZONE :tz)::date AS day, kg "
                "FROM weight_entries WHERE user_id = :u AND deleted_at IS NULL "
                "AND (measured_at AT TIME ZONE :tz)::date <= :b ORDER BY measured_at"
            ),
            {"u": user_id, "tz": tz, "b": sunday},
        ).all()
        trend = compute_trend(
            [Reading(str(w.day), w.measured_at.isoformat(), float(w.kg)) for w in weighs],
            alpha=WEIGHT_ALPHA,
        )
        counted = [p for p in trend.points if p.counted and p.trend is not None]
        if counted:
            last = counted[-1]
            p = project_goal(
                last.trend or last.value,
                float(settings.goal_weight_kg),
                weekly_rate([(x.day, x.trend) for x in counted]),
                trend.visible,
                sunday.isoformat(),
            )
            if p.kind == "projection":
                projection = {"goal_kg": float(settings.goal_weight_kg), "date": p.date}

    games = None
    if settings.games:
        refresh_goals(s, user_id, now)
        streak = s.execute(
            text("SELECT current_days FROM user_streaks WHERE user_id = :u"), {"u": user_id}
        ).scalar()
        goals = s.execute(
            text(
                "SELECT count(*) AS n, count(completed_at) AS done FROM weekly_goals "
                "WHERE user_id = :u AND week_start = :w"
            ),
            {"u": user_id, "w": monday},
        ).one()
        from app.goals import BADGES

        names = {b.key: b.name for b in BADGES}
        earned = s.execute(
            text(
                "SELECT badge FROM user_badges WHERE user_id = :u "
                "AND (earned_at AT TIME ZONE :tz)::date BETWEEN :a AND :b ORDER BY earned_at"
            ),
            {"u": user_id, "tz": tz, "a": monday, "b": sunday},
        ).scalars()
        games = {
            "streak_days": int(streak or 0),
            "goals_done": int(goals.done),
            "goals": int(goals.n),
            "badges": [names.get(b, b) for b in earned],
        }

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "days_logged": summary.logged_days,
        "avg_kcal": summary.avg_kcal,
        "avg_target_kcal": summary.avg_target_kcal,
        "days_on_target": summary.days_on_target,
        "avg_protein_g": _avg([float(d.protein) for d in days]),
        "avg_target_protein_g": _avg([float(t) for t in protein_targets]),
        "weight": summary.weight.model_dump() if summary.weight else None,
        "measurement": fastest,
        "water_ml": water,
        "fiber_g": fiber,
        "phase": phase,
        "projection": projection,
        "games": games,
    }


# --- sentences -------------------------------------------------------------------------------


def _n(v: float, digits: int = 0) -> str:
    return f"{v:,.{digits}f}"


def _day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d:%b %Y}"


def _shown(value: float, unit: str) -> float:
    if unit == "in":
        return value / 2.54
    if unit == "lb":
        return value / LB_IN_KG
    return value


def headline(stats: dict[str, Any]) -> str:
    """ "Avg 2,310 kcal, on target 5 of 7 days" (the Progress card's answer)."""
    if stats["avg_kcal"] is None:
        return "No food logged that week"
    days = stats["days_logged"]
    if stats["avg_target_kcal"] is None:
        return f"Avg {_n(stats['avg_kcal'])} kcal over {days} {'day' if days == 1 else 'days'}"
    return (
        f"Avg {_n(stats['avg_kcal'])} kcal, on target {stats['days_on_target']} of {days} "
        f"{'day' if days == 1 else 'days'}"
    )


def sentences(stats: dict[str, Any], imperial: bool, fl_oz: bool) -> list[str]:
    """The check-in as plain sentences, in the order of SPEC page 3. No advice."""
    out: list[str] = []
    days = stats["days_logged"]
    if days < FEW_DAYS:
        out.append(f"Only {days} {'day' if days == 1 else 'days'} logged, so averages may be off.")
    if stats["avg_kcal"] is not None:
        if stats["avg_target_kcal"] is not None:
            out.append(
                f"You averaged {_n(stats['avg_kcal'])} kcal a day against a "
                f"{_n(stats['avg_target_kcal'])} kcal target, on target on "
                f"{stats['days_on_target']} of {days} logged {'day' if days == 1 else 'days'}."
            )
        else:
            out.append(f"You averaged {_n(stats['avg_kcal'])} kcal a day.")
    if stats["avg_protein_g"] is not None:
        target = stats["avg_target_protein_g"]
        out.append(
            f"Protein averaged {_n(stats['avg_protein_g'])} g a day"
            + (f" against a {_n(target)} g target." if target is not None else ".")
        )
    wu = "lb" if imperial else "kg"

    def kg(v: float) -> float:
        return v / LB_IN_KG if imperial else v

    w = stats["weight"]
    if w is not None:
        change = kg(w["change_kg"])
        moved = (
            "no change"
            if abs(change) < 0.05
            else f"{'down' if change < 0 else 'up'} {_n(abs(change), 1)} {wu}"
        )
        out.append(
            f"Your weight trend went from {_n(kg(w['start_kg']), 1)} to "
            f"{_n(kg(w['end_kg']), 1)} {wu}, {moved}."
        )
    m = stats["measurement"]
    if m is not None:
        change = _shown(m["change"], m["unit"]) if m["unit"] in ("in", "lb") else m["change"]
        unit = "%" if m["unit"] == "%" else f" {m['unit']}"
        name = f"{m['name']}, {m['side']}" if m["side"] else m["name"]
        moved = (
            "no change"
            if abs(change) < 0.05
            else f"{'down' if change < 0 else 'up'} {_n(abs(change), 1)}{unit}"
        )
        out.append(f"{name} changed the most: {moved}.")
    if stats["water_ml"] is not None:
        water = stats["water_ml"]
        shown = f"{_n(water / ML_PER_FL_OZ, 1)} fl oz" if fl_oz else f"{_n(water)} ml"
        out.append(f"Water averaged {shown} on the days you logged it.")
    if stats["fiber_g"] is not None:
        out.append(f"Fiber averaged {_n(stats['fiber_g'])} g a day.")
    out.append(f"You logged food on {days} of 7 days.")
    if stats["phase"] is not None:
        out.append(f"That was day {stats['phase']['day']} of your {stats['phase']['name']}.")
    if stats["projection"] is not None:
        goal = kg(stats["projection"]["goal_kg"])
        out.append(
            f"On the current trend, your goal of {_n(goal, 1)} {wu} falls around "
            f"{_day(stats['projection']['date'])}."
        )
    g = stats["games"]
    if g is not None:
        bits = [f"Current streak: {g['streak_days']} {'day' if g['streak_days'] == 1 else 'days'}."]
        if g["goals"]:
            bits.append(f"{g['goals_done']} of {g['goals']} weekly goals done.")
        if g["badges"]:
            bits.append(f"Badges earned: {', '.join(g['badges'])}.")
        out.append(" ".join(bits))
    return out
