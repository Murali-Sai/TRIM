"""Task 3.15: streaks through the API. AC: the 13-day example plays out exactly; a day over
target still counts; timezone and DST tests pass. The pure rules are in test_streaks_engine.py.

Entries are written as the owner with an explicit logged_on and created_at, so each test can
say exactly when something was logged and for which day."""

from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import log_in, sign_up, user_row

NY = ZoneInfo("America/New_York")


def signed_in(client: CsrfClient, owner_engine: Engine, tz: str = "America/New_York") -> Any:
    email = sign_up(client, timezone=tz)
    assert log_in(client, email, keep_signed_in=True).status_code == 200
    uid = user_row(owner_engine, email).id
    with owner_engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified_at = now() WHERE id = :u"), {"u": uid})
    return uid


def entry(owner_engine: Engine, uid: Any, day: date, added: datetime, kcal: float = 500) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO food_logs (id, user_id, log_group_id, eaten_at, logged_on, name, "
                "kcal, protein_g, carbs_g, fat_g, source, created_at) VALUES (gen_random_uuid(), "
                ":u, gen_random_uuid(), :at, :d, 'Lunch', :k, 20, 50, 15, 'quick_add', :c)"
            ),
            {
                "u": uid,
                "at": datetime(day.year, day.month, day.day, 12, tzinfo=NY),
                "d": day,
                "k": kcal,
                "c": added,
            },
        )


def at(day: date, hour: int = 20, minute: int = 0, tz: ZoneInfo = NY) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)


def streaks(client: CsrfClient, fakes: Fakes, now: datetime, **params: str) -> dict[str, Any]:
    fakes.clock.now = now.astimezone(UTC)
    res = client.get("/api/streaks", params=params)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def events(owner_engine: Engine, uid: Any) -> list[tuple[int, str]]:
    with owner_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT on_date, kind FROM streak_events WHERE user_id = :u AND kind <> 'counted' "
                "ORDER BY on_date, kind"
            ),
            {"u": uid},
        ).all()
    return [(r.on_date.day, r.kind) for r in rows]


D1 = date(2026, 10, 1)


def day(n: int) -> date:
    return D1 + timedelta(days=n - 1)


@pytest.fixture(autouse=True)
def start(fakes: Fakes) -> None:
    fakes.clock.now = at(D1, 8).astimezone(UTC)


def test_ac_the_13_day_example(client: CsrfClient, owner_engine: Engine, fakes: Fakes) -> None:
    uid = signed_in(client, owner_engine)
    for n in range(1, 14):
        entry(owner_engine, uid, day(n), at(day(n)))
    s = streaks(client, fakes, at(day(14), 9))
    assert (s["current_days"], s["freezes_held"], s["today_logged"]) == (13, 1, False)

    # Logging today makes 14 and earns a second freeze.
    entry(owner_engine, uid, day(14), at(day(14), 9, 30))
    s = streaks(client, fakes, at(day(14), 10))
    assert (s["current_days"], s["freezes_held"], s["today_logged"]) == (14, 2, True)

    # Missing the 15th uses a freeze once it is past repair (on the 16th it still could be).
    s = streaks(client, fakes, at(day(16), 9))
    assert (s["current_days"], s["freezes_held"]) == (14, 1)
    s = streaks(client, fakes, at(day(17), 9))
    assert (s["current_days"], s["freezes_held"]) == (14, 0)
    s = streaks(client, fakes, at(day(18), 9))
    assert (s["current_days"], s["longest_days"], s["freezes_held"]) == (0, 14, 0)
    assert s["message"] == "New streak starts today. Longest: 14 days."

    # The final days wrote their events once each.
    s = streaks(client, fakes, at(day(19), 9))
    assert events(owner_engine, uid) == [
        (7, "freeze_earned"),
        (14, "freeze_earned"),
        (15, "freeze_used"),
        (16, "freeze_used"),
        (17, "broken"),
    ]
    by_day = {c["date"]: c["state"] for c in s["calendar"]}
    assert by_day["2026-10-14"] == "logged"
    assert by_day["2026-10-15"] == by_day["2026-10-16"] == "freeze"
    assert by_day["2026-10-17"] == "none"
    assert by_day["2026-10-20"] == "future"


def test_a_day_over_target_still_counts(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    uid = signed_in(client, owner_engine)
    for n in (1, 2, 3):
        entry(owner_engine, uid, day(n), at(day(n)), kcal=6000)
    assert streaks(client, fakes, at(day(3), 21))["current_days"] == 3


@pytest.mark.parametrize(
    ("added_hour", "added_minute", "added_day", "counts"),
    [(23, 59, 2, True), (0, 0, 3, False)],
    ids=["23:59 the next day counts", "00:00 two days later does not"],
)
def test_repair_window_edges(
    client: CsrfClient,
    owner_engine: Engine,
    fakes: Fakes,
    added_hour: int,
    added_minute: int,
    added_day: int,
    counts: bool,
) -> None:
    uid = signed_in(client, owner_engine)
    entry(owner_engine, uid, date(2026, 9, 30), at(date(2026, 9, 30)))
    # 1 Oct is backfilled late on 2 Oct, or just after midnight on 3 Oct.
    entry(owner_engine, uid, day(1), at(day(added_day), added_hour, added_minute))
    entry(owner_engine, uid, day(2), at(day(2)))
    entry(owner_engine, uid, day(3), at(day(3)))
    s = streaks(client, fakes, at(day(3), 21))
    assert s["current_days"] == (4 if counts else 2)
    if counts:
        s = streaks(client, fakes, at(day(5), 9))
        assert (1, "repaired") in events(owner_engine, uid)


def test_a_timezone_change_mid_streak_keeps_each_days_logged_on(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    uid = signed_in(client, owner_engine)
    for n in (1, 2, 3):
        entry(owner_engine, uid, day(n), at(day(n)))
    assert streaks(client, fakes, at(day(3), 21))["current_days"] == 3
    # The user flies to Tokyo and changes their timezone; old days keep their dates.
    tokyo = ZoneInfo("Asia/Tokyo")
    res = client.patch("/api/me/profile", json={"timezone": "Asia/Tokyo"})
    assert res.status_code == 200, res.text
    entry(owner_engine, uid, day(5), at(day(5), 12, tz=tokyo))
    entry(owner_engine, uid, day(4), at(day(4), 12, tz=tokyo))
    s = streaks(client, fakes, at(day(5), 13, tz=tokyo))
    assert (s["today"], s["current_days"]) == ("2026-10-05", 5)


def test_dst_weeks_still_count_their_days_and_weigh_ins(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    """New York leaves daylight time at 02:00 on Sun 1 Nov 2026: that week has a 25-hour day."""
    monday = date(2026, 10, 26)
    fakes.clock.now = at(monday, 8).astimezone(UTC)
    uid = signed_in(client, owner_engine)
    for n in range(7):
        d = monday + timedelta(days=n)
        entry(owner_engine, uid, d, at(d, 23, 30))
    # Weigh-ins: Monday, Saturday, and Sunday at 01:30 after the clocks went back.
    sunday_late = datetime(2026, 11, 1, 1, 30, tzinfo=NY, fold=1)
    with owner_engine.begin() as conn:
        for when in (at(monday, 7), at(date(2026, 10, 31), 7), sunday_late):
            conn.execute(
                text(
                    "INSERT INTO weight_entries (id, user_id, measured_at, kg) "
                    "VALUES (gen_random_uuid(), :u, :t, 80)"
                ),
                {"u": uid, "t": when},
            )
    s = streaks(client, fakes, at(date(2026, 11, 2), 9))
    assert s["current_days"] == 7
    assert s["weigh_in"] == {"current_weeks": 1, "longest_weeks": 1, "this_week": 0}


def test_weigh_in_streak_needs_three_a_week(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    uid = signed_in(client, owner_engine)
    monday = date(2026, 9, 28)
    with owner_engine.begin() as conn:
        for week, n in ((0, 3), (1, 3), (2, 2)):
            for i in range(n):
                conn.execute(
                    text(
                        "INSERT INTO weight_entries (id, user_id, measured_at, kg) "
                        "VALUES (gen_random_uuid(), :u, :t, 80)"
                    ),
                    {"u": uid, "t": at(monday + timedelta(weeks=week, days=i), 7)},
                )
    # During week 3 with 2 weigh-ins: 2 weeks, not broken yet.
    s = streaks(client, fakes, at(monday + timedelta(weeks=2, days=3), 9))
    assert s["weigh_in"] == {"current_weeks": 2, "longest_weeks": 2, "this_week": 2}
    # Week 3 ended with only 2: broken, longest kept.
    s = streaks(client, fakes, at(monday + timedelta(weeks=3), 9))
    assert s["weigh_in"] == {"current_weeks": 0, "longest_weeks": 2, "this_week": 0}


def test_a_new_user_has_no_streak(client: CsrfClient, owner_engine: Engine, fakes: Fakes) -> None:
    signed_in(client, owner_engine)
    s = streaks(client, fakes, at(day(1), 9), month="2026-10")
    assert (s["current_days"], s["longest_days"], s["message"]) == (0, 0, None)
    assert len(s["calendar"]) == 31
    assert client.get("/api/streaks", params={"month": "October"}).status_code == 422


def test_needs_a_session(client: CsrfClient) -> None:
    assert client.get("/api/streaks").status_code == 401
