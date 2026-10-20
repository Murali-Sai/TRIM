"""Weight and measurement trend math, exactly as in SPEC page 3 (Algorithms). Display only.

Mirrors web/src/lib/trend.ts; both pass shared/trend_vectors.json.
"""

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from typing import Literal

WEIGHT_ALPHA = 0.1
MEASUREMENT_ALPHA = 0.25
MIN_READINGS = 5
MIN_SPAN_DAYS = 7
RATE_WINDOW_DAYS = 14
# Exactly 3% must stay in even when floating point lands a hair above it.
EPSILON = 1e-9


@dataclass(frozen=True)
class Reading:
    """One weigh-in or measurement. `day` is the user's local date (YYYY-MM-DD)."""

    day: str
    at: str
    value: float


@dataclass(frozen=True)
class TrendPoint(Reading):
    trend: float | None = None  # the trend after this reading; None when not counted
    outlier: bool = False  # too far from the trend: shown hollow and left out of it
    counted: bool = False  # first reading of its day and not an outlier


@dataclass(frozen=True)
class TrendResult:
    points: list[TrendPoint] = field(default_factory=list)
    visible: bool = False
    readings_needed: int = MIN_READINGS
    days_needed: int = MIN_SPAN_DAYS


def day_number(day: str) -> int:
    return date.fromisoformat(day).toordinal()


def _instant(at: str) -> datetime:
    return datetime.fromisoformat(at.replace("Z", "+00:00"))


def gap_alpha(alpha: float, days: int) -> float:
    """Smoothing for a gap of `days` days: 1 - (1 - a)^d."""
    return 1 - (1 - alpha) ** days


def compute_trend(
    readings: Iterable[Reading],
    alpha: float = WEIGHT_ALPHA,
    outlier_abs: float = 2.0,
    outlier_pct: float = 0.03,
) -> TrendResult:
    seen_days: set[str] = set()
    points: list[TrendPoint] = []
    trend: float | None = None
    first_day = last_day = 0
    counted = 0

    for r in sorted(readings, key=lambda r: _instant(r.at)):
        point = TrendPoint(r.day, r.at, r.value)
        if r.day in seen_days:  # only the earliest reading of the day counts
            points.append(point)
            continue
        seen_days.add(r.day)

        d = day_number(r.day)
        if trend is None:
            trend = r.value
            first_day = d
        else:
            limit = max(outlier_abs, outlier_pct * trend)
            if abs(r.value - trend) > limit + EPSILON:
                points.append(replace(point, outlier=True))
                continue
            trend += gap_alpha(alpha, d - last_day) * (r.value - trend)
        last_day = d
        counted += 1
        points.append(replace(point, trend=trend, counted=True))

    span = 0 if counted == 0 else last_day - first_day + 1
    readings_needed = max(0, MIN_READINGS - counted)
    days_needed = max(0, MIN_SPAN_DAYS - span)
    return TrendResult(
        points=points,
        visible=readings_needed == 0 and days_needed == 0,
        readings_needed=readings_needed,
        days_needed=days_needed,
    )


def weekly_rate(
    points: Sequence[tuple[str, float | None]], window_days: int = RATE_WINDOW_DAYS
) -> float | None:
    """Least-squares slope of the trend over the last 14 days (ending on the latest point),
    times 7. None with fewer than two days of trend."""
    with_trend = [(day_number(day), t) for day, t in points if t is not None]
    if not with_trend:
        return None
    end = max(x for x, _ in with_trend)
    recent = [(x, y) for x, y in with_trend if x > end - window_days]
    n = len(recent)
    mean_x = sum(x for x, _ in recent) / n
    mean_y = sum(y for _, y in recent) / n
    sxx = sum((x - mean_x) ** 2 for x, _ in recent)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in recent)
    return None if sxx == 0 else sxy / sxx * 7


MIN_RATE_KG_PER_WEEK = 0.1
MAX_WEEKS = 104


@dataclass(frozen=True)
class Projection:
    """kind: "none" (no goal, or trend not visible), "no_projection" (flat, moving away or too
    far), or "projection" with weeks and the local date (YYYY-MM-DD)."""

    kind: Literal["none", "no_projection", "projection"]
    weeks: float | None = None
    date: str | None = None


def project_goal(
    trend_kg: float,
    goal_kg: float | None,
    weekly_rate_kg: float | None,
    trend_visible: bool,
    today: str,
) -> Projection:
    """Goal-date projection, exactly as in SPEC page 3. Mirrors web/src/lib/projection.ts."""
    if goal_kg is None or not trend_visible:
        return Projection("none")
    if weekly_rate_kg is None or abs(weekly_rate_kg) < MIN_RATE_KG_PER_WEEK - EPSILON:
        return Projection("no_projection")
    weeks = (goal_kg - trend_kg) / weekly_rate_kg
    if not weeks > 0 or weeks > MAX_WEEKS + EPSILON:
        return Projection("no_projection")
    # Half a day rounds up, as Math.round does in the TypeScript version.
    on = date.fromordinal(day_number(today) + math.floor(weeks * 7 + 0.5))
    return Projection("projection", weeks, on.isoformat())
