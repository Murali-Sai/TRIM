"""Seeds a month of data into one glance-test account and prints the answer key (task 3.11).

The glance test (SPEC page 4) asks people who have never seen TRIM five questions about a
seeded month on a phone. Create the account first (sign up and verify), then run from api/:

    TRIM_OWNER_URL=postgresql+psycopg://... uv run python tools/seed_glance_month.py you@example.com

It refuses an account that already has food logs or weigh-ins, so it never mixes with real
data. Days are relative to the account's own "today", so the dashboard always shows a full
week and a full 30 days. The answer key is printed for the facilitator; see
docs/glance-test.md.
"""

import os
import sys
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Engine, create_engine, text

from app.trend import Reading, compute_trend, weekly_rate

# Daily calories for the 30 days before today, oldest first; None is a day with nothing logged.
# The same shape as shared/fixture_month.json: some days right on the 5% edges, a few misses.
PAST_KCAL: list[int | None] = [
    2300, 2415, 2416, 2185, 2184, None, 1800, 2250, 2600, None,
    2350, 2200, 2000, 2400, 2310, 2310, 2311, 2090, 2089, None,
    2150, 2500, 1500, 2200, 2250, None, 2100, 2320, 2205, 1950,
]  # fmt: skip
# Today so far: 526 kcal left of 2,200, the SPEC's headline example.
TODAY_KCAL = 1674
TARGET = {"kcal": 2200, "protein_g": 165, "carbs_g": 220, "fat_g": 73}
GOAL_KG = 78.0
SWING = [0.3, -0.2, 0.1, -0.3, 0.2, 0.0, -0.1, 0.25, -0.15, 0.05]


def macros(kcal: float) -> dict[str, float]:
    """About 30% protein, 30% fat and 40% carbs of the day's energy."""
    return {
        "protein_g": round(kcal * 0.30 / 4, 1),
        "fat_g": round(kcal * 0.30 / 9, 1),
        "carbs_g": round(kcal * 0.40 / 4, 1),
    }


def on_target(value: float, target: float) -> bool:
    return abs(value - target) * 20 <= target


@dataclass(frozen=True)
class AnswerKey:
    kcal_left_today: int
    protein_week_avg: int
    protein_on_track: bool
    weight_trend_kg: float
    weight_kg_per_week: float
    days_on_target_this_week: int
    logged_days_this_week: int

    def lines(self) -> list[str]:
        direction = "down" if self.weight_kg_per_week < 0 else "up"
        return [
            f"1. Calories left today: {self.kcal_left_today:,} kcal",
            f"2. Protein this week: {self.protein_week_avg} of {TARGET['protein_g']} g a day, "
            + ("on track (within 5%)" if self.protein_on_track else "not on track"),
            f"3. Weight: {direction}, about {abs(self.weight_kg_per_week):.1f} kg a week "
            f"(trend {self.weight_trend_kg:.1f} kg)",
            f"4. Days on target this week: {self.days_on_target_this_week} "
            f"of {self.logged_days_this_week} logged",
            "5. Waist change since start: not seeded until measurements exist (task 4.1)",
        ]


def seed(engine: Engine, email: str) -> AnswerKey:
    with engine.begin() as conn:
        user = conn.execute(
            text(
                "SELECT u.id, p.timezone FROM users u JOIN user_profiles p ON p.user_id = u.id "
                "WHERE u.email = :e"
            ),
            {"e": email.lower()},
        ).one_or_none()
        if user is None:
            raise SystemExit(f"No account for {email}. Sign up and verify first.")
        taken = conn.execute(
            text(
                "SELECT (SELECT count(*) FROM food_logs WHERE user_id = :u) + "
                "(SELECT count(*) FROM weight_entries WHERE user_id = :u)"
            ),
            {"u": user.id},
        ).scalar_one()
        if taken:
            raise SystemExit("That account already has data. Use a fresh glance-test account.")

        tz = ZoneInfo(user.timezone)
        today = datetime.now(tz).date()
        start = today - timedelta(days=len(PAST_KCAL))
        conn.execute(
            text(
                "INSERT INTO targets (id, user_id, effective_from, kcal, protein_g, carbs_g, "
                "fat_g, source) VALUES (:id, :u, :d, :kcal, :protein_g, :carbs_g, :fat_g, "
                "'custom')"
            ),
            {"id": uuid.uuid4(), "u": user.id, "d": start, **TARGET},
        )
        conn.execute(
            text("UPDATE user_profiles SET goal_weight_kg = :g WHERE user_id = :u"),
            {"g": GOAL_KG, "u": user.id},
        )
        days: list[tuple[date, float]] = [
            (start + timedelta(days=i), k) for i, k in enumerate(PAST_KCAL) if k is not None
        ]
        days.append((today, TODAY_KCAL))
        for day, kcal in days:
            # Lunch time, or earlier today so it is never in the future.
            at = datetime.combine(day, time(12, 30), tz)
            if day == today:
                midnight = datetime.combine(day, time(0, 0), tz)
                at = max(midnight, min(at, datetime.now(tz) - timedelta(minutes=5)))
            conn.execute(
                text(
                    "INSERT INTO food_logs (id, user_id, log_group_id, eaten_at, logged_on, "
                    "name, kcal, protein_g, carbs_g, fat_g, source) VALUES (:id, :u, :g, :at, "
                    ":day, 'Seeded meals', :kcal, :protein_g, :carbs_g, :fat_g, 'quick_add')"
                ),
                {
                    "id": uuid.uuid4(),
                    "g": uuid.uuid4(),
                    "u": user.id,
                    "at": at,
                    "day": day,
                    "kcal": kcal,
                    **macros(kcal),
                },
            )
        readings: list[Reading] = []
        for i in range(30):
            day = today - timedelta(days=29 - i)
            kg = round(80.6 - i * 0.035 + SWING[i % len(SWING)], 1)
            at = min(datetime.combine(day, time(7, 0), tz), datetime.now(tz))
            conn.execute(
                text(
                    "INSERT INTO weight_entries (id, user_id, measured_at, kg) "
                    "VALUES (:id, :u, :at, :kg)"
                ),
                {"id": uuid.uuid4(), "u": user.id, "at": at, "kg": kg},
            )
            readings.append(Reading(day=day.isoformat(), at=at.isoformat(), value=kg))

    week = [(d, k) for d, k in days if d > today - timedelta(days=7)]
    protein = sum(macros(k)["protein_g"] for _, k in week) / len(week)
    trend = compute_trend(readings)
    latest = next(p.trend for p in reversed(trend.points) if p.trend is not None)
    rate = weekly_rate([(p.day, p.trend) for p in trend.points]) or 0.0
    return AnswerKey(
        kcal_left_today=TARGET["kcal"] - TODAY_KCAL,
        protein_week_avg=round(protein),
        protein_on_track=on_target(protein, TARGET["protein_g"]),
        weight_trend_kg=latest,
        weight_kg_per_week=rate,
        days_on_target_this_week=sum(on_target(k, TARGET["kcal"]) for _, k in week),
        logged_days_this_week=len(week),
    )


def main() -> int:
    url = os.environ.get("TRIM_OWNER_URL")
    if not url or len(sys.argv) != 2:
        print("Usage: TRIM_OWNER_URL=... uv run python tools/seed_glance_month.py EMAIL")
        return 1
    key = seed(create_engine(url), sys.argv[1])
    print("Seeded. Answer key for the facilitator:")
    for line in key.lines():
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
