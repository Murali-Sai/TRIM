"""Weekly goals and badges (SPEC page 3, Streaks and gamification). All reward logging:
nothing rewards eating less, a bigger deficit or faster weight loss.

Every Monday three goals are set: "Log food on 5 of 7 days" always, plus two from a pool
limited to what the user tracks. The choice is a stable hash of the user and the week, so it
never changes during a week. All three complete is a Perfect week.
"""

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

GoalKind = Literal["log_food", "protein", "calories", "weigh_in", "water", "measurement"]
ALWAYS: GoalKind = "log_food"

# The number each goal asks for in a week.
GOAL_TARGETS: dict[GoalKind, int] = {
    "log_food": 5,
    "protein": 4,
    "calories": 4,
    "weigh_in": 3,
    "water": 5,
    "measurement": 1,
}
GOAL_TEXT: dict[GoalKind, str] = {
    "log_food": "Log food on 5 of 7 days",
    "protein": "Protein at 95% of target or more on 4 days",
    "calories": "Calories within 5% of target on 4 days",
    "weigh_in": "Weigh in 3 times",
    "water": "Log water on 5 days",
    "measurement": "Log any body measurement once",
}
PROTEIN_SHARE = 0.95


@dataclass(frozen=True)
class Tracks:
    """What the user tracks, which limits the pool."""

    has_target: bool
    track_water: bool
    has_weighed: bool
    has_measurements: bool


def eligible(t: Tracks) -> list[GoalKind]:
    pool: list[GoalKind] = []
    if t.has_target:
        pool += ["protein", "calories"]
    # Anyone can weigh in; it needs nothing switched on.
    pool.append("weigh_in")
    if t.track_water:
        pool.append("water")
    if t.has_measurements:
        pool.append("measurement")
    return pool


def choose_goals(t: Tracks, user_key: str, monday: date) -> list[GoalKind]:
    pool = eligible(t)
    pool.sort(key=lambda k: hashlib.sha256(f"{user_key}:{monday}:{k}".encode()).hexdigest())
    return [ALWAYS, *pool[:2]]


@dataclass(frozen=True)
class WeekData:
    logged_days: int
    protein_days: int
    calorie_days: int
    weigh_ins: int
    water_days: int
    measurements: int


def goal_progress(kind: GoalKind, w: WeekData) -> tuple[int, int]:
    """(done, needed), with done capped at needed."""
    done = {
        "log_food": w.logged_days,
        "protein": w.protein_days,
        "calories": w.calorie_days,
        "weigh_in": w.weigh_ins,
        "water": w.water_days,
        "measurement": w.measurements,
    }[kind]
    need = GOAL_TARGETS[kind]
    return min(done, need), need


# --- badges ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Badge:
    key: str
    name: str
    how: str


BADGES: tuple[Badge, ...] = (
    Badge("streak_7", "7-day streak", "Log food 7 days in a row."),
    Badge("streak_30", "30-day streak", "Log food 30 days in a row."),
    Badge("streak_100", "100-day streak", "Log food 100 days in a row."),
    Badge("streak_365", "365-day streak", "Log food every day for a year."),
    Badge("weigh_in_4", "4-week weigh-ins", "Weigh in 3 times a week for 4 weeks in a row."),
    Badge("weigh_in_12", "12-week weigh-ins", "Weigh in 3 times a week for 12 weeks in a row."),
    Badge("weigh_in_52", "52-week weigh-ins", "Weigh in 3 times a week for a year."),
    Badge("first_saved_meal", "First saved meal", "Save a meal you eat often."),
    Badge("entries_100", "100 entries", "Log 100 foods."),
    Badge("entries_1000", "1,000 entries", "Log 1,000 foods."),
    Badge("perfect_weeks_10", "10 Perfect weeks", "Complete all three weekly goals 10 times."),
    Badge("first_phase", "First diet phase", "Complete a diet phase."),
    Badge("measurements_4", "4 weeks of measurements", "Log a body measurement 4 weeks in a row."),
)


def earned_badges(
    *,
    longest_days: int,
    longest_weeks: int,
    saved_meals: int,
    entries: int,
    perfect_weeks: int,
    measurement_weeks: int = 0,
    phases_ended: int = 0,
) -> set[str]:
    got: set[str] = set()
    for n in (7, 30, 100, 365):
        if longest_days >= n:
            got.add(f"streak_{n}")
    for n in (4, 12, 52):
        if longest_weeks >= n:
            got.add(f"weigh_in_{n}")
    if saved_meals >= 1:
        got.add("first_saved_meal")
    for n in (100, 1000):
        if entries >= n:
            got.add(f"entries_{n}")
    if perfect_weeks >= 10:
        got.add("perfect_weeks_10")
    if measurement_weeks >= 4:
        got.add("measurements_4")
    if phases_ended >= 1:
        got.add("first_phase")
    return got


def longest_week_run(mondays: Iterable[date]) -> int:
    """The most weeks in a row (by their Mondays) that each have something logged."""
    best = run = 0
    prev: date | None = None
    for monday in sorted(set(mondays)):
        run = run + 1 if prev is not None and monday - prev == timedelta(weeks=1) else 1
        best = max(best, run)
        prev = monday
    return best
