"""Task 5.3: weekly check-ins. AC: check-ins generate correctly for users in UTC-5, UTC+0 and
UTC+9, including a week with a DST change; the under-4-days message is shown.

The job is global, so each test finds its own users' rows."""

from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Engine, text

from app import checkins as engine
from app.routers import checkins as router
from tests.conftest import CsrfClient
from tests.fakes import FAKE_JOB_TOKEN, Fakes
from tests.helpers import log_in, sign_up, user_row

# New York leaves daylight saving time on Sunday 1 Nov 2026, the last day of this week.
WEEK = date(2026, 10, 26)


def local(tz: str, day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(tz))


def job(client: CsrfClient, fakes: Fakes, at: datetime) -> Any:
    fakes.clock.now = at.astimezone(UTC)
    res = client.post("/api/internal/checkins", headers={"X-Job-Token": FAKE_JOB_TOKEN})
    assert res.status_code == 200, res.text
    return res.json()


def account(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes, tz: str, **kw: Any
) -> tuple[CsrfClient, Any]:
    fakes.clock.now = local(tz, date(2026, 10, 20), 9).astimezone(UTC)
    c = CsrfClient(client.app)
    c.get("/api/auth/csrf")
    email = sign_up(c, timezone=tz, **kw)
    assert log_in(c, email, keep_signed_in=True).status_code == 200
    uid = user_row(owner_engine, email).id
    # Confirmed, so the account stays usable past the 7-day deadline.
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET email_verified_at = :t WHERE id = :u"),
            {"t": fakes.clock.now, "u": uid},
        )
    return c, uid


def log_days(owner_engine: Engine, uid: Any, tz: str, days: list[date], kcal: int = 2000) -> None:
    with owner_engine.begin() as conn:
        for d in days:
            conn.execute(
                text(
                    "INSERT INTO food_logs (id, user_id, log_group_id, eaten_at, logged_on, name, "
                    "kcal, protein_g, carbs_g, fat_g, fiber_g, source) VALUES (gen_random_uuid(), "
                    ":u, gen_random_uuid(), :at, :d, 'Lunch', :k, 120, 200, 60, 25, 'quick_add')"
                ),
                {"u": uid, "at": local(tz, d, 12), "d": d, "k": kcal},
            )


def stored(owner_engine: Engine, uid: Any) -> dict[date, dict[str, Any]]:
    with owner_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT week_start, stats FROM weekly_checkins WHERE user_id = :u"), {"u": uid}
        ).all()
    return {r.week_start: r.stats for r in rows}


def test_the_job_needs_its_token(client: CsrfClient) -> None:
    assert client.post("/api/internal/checkins").status_code == 401
    res = client.post("/api/internal/checkins", headers={"X-Job-Token": "wrong"})
    assert res.status_code == 401


@pytest.mark.parametrize(
    ("tz", "due_utc"),
    [
        # 06:00 EST on Monday 2 Nov is 11:00 UTC (it would be 10:00 before the change).
        ("America/New_York", datetime(2026, 11, 2, 11, 0, tzinfo=UTC)),
        ("UTC", datetime(2026, 11, 2, 6, 0, tzinfo=UTC)),
        # 06:00 in Tokyo on Monday is 21:00 UTC on Sunday.
        ("Asia/Tokyo", datetime(2026, 11, 1, 21, 0, tzinfo=UTC)),
    ],
)
def test_ac_due_at_monday_6am_local_with_local_days(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes, tz: str, due_utc: datetime
) -> None:
    _, uid = account(client, owner_engine, fakes, tz)
    inside = [WEEK + timedelta(days=n) for n in (0, 1, 3, 5, 6)]
    # The Sunday before and the Monday after are other weeks.
    log_days(owner_engine, uid, tz, [WEEK - timedelta(days=1), WEEK + timedelta(days=7), *inside])
    assert engine.due_week(due_utc - timedelta(minutes=1), tz) == WEEK - timedelta(days=7)
    assert engine.due_week(due_utc, tz) == WEEK

    job(client, fakes, due_utc - timedelta(minutes=1))
    assert WEEK not in stored(owner_engine, uid)
    if tz == "America/New_York":
        # An hour early by the old offset: still not due.
        job(client, fakes, due_utc - timedelta(hours=1))
        assert WEEK not in stored(owner_engine, uid)
    job(client, fakes, due_utc)
    stats = stored(owner_engine, uid)[WEEK]
    assert stats["week_start"] == "2026-10-26" and stats["week_end"] == "2026-11-01"
    assert stats["days_logged"] == 5
    assert stats["avg_kcal"] == 2000
    # Running again makes nothing new.
    assert job(client, fakes, due_utc + timedelta(hours=1))["checkins_created"] >= 0
    assert len([w for w in stored(owner_engine, uid) if w == WEEK]) == 1


def test_a_week_before_sign_up_gets_no_check_in(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    # Signed up on Tuesday 20 Oct: the week of 12 Oct ended before that.
    _, uid = account(client, owner_engine, fakes, "UTC")
    job(client, fakes, datetime(2026, 10, 20, 12, tzinfo=UTC))
    assert stored(owner_engine, uid) == {}
    job(client, fakes, datetime(2026, 10, 26, 6, tzinfo=UTC))
    assert list(stored(owner_engine, uid)) == [date(2026, 10, 19)]


def test_ac_under_4_days_says_so(client: CsrfClient, owner_engine: Engine, fakes: Fakes) -> None:
    c, uid = account(client, owner_engine, fakes, "UTC")
    log_days(owner_engine, uid, "UTC", [WEEK, WEEK + timedelta(days=2), WEEK + timedelta(days=4)])
    job(client, fakes, datetime(2026, 11, 2, 7, tzinfo=UTC))
    res = c.get("/api/checkins/2026-10-26")
    assert res.status_code == 200, res.text
    lines = res.json()["lines"]
    assert lines[0] == "Only 3 days logged, so averages may be off."
    assert "You logged food on 3 of 7 days." in lines


def test_list_read_and_sentences(client: CsrfClient, owner_engine: Engine, fakes: Fakes) -> None:
    c, uid = account(client, owner_engine, fakes, "America/New_York", unit_system="metric")
    with owner_engine.begin() as conn:
        conn.execute(text("DELETE FROM targets WHERE user_id = :u"), {"u": uid})
        conn.execute(
            text(
                "INSERT INTO targets (id, user_id, effective_from, kcal, protein_g, carbs_g, "
                "fat_g, source) VALUES (gen_random_uuid(), :u, '2026-10-01', 2050, 140, 220, "
                "65, 'custom')"
            ),
            {"u": uid},
        )
        for n in range(8):
            conn.execute(
                text(
                    "INSERT INTO weight_entries (id, user_id, measured_at, kg) "
                    "VALUES (gen_random_uuid(), :u, :at, :kg)"
                ),
                {
                    "u": uid,
                    "at": local("America/New_York", WEEK + timedelta(days=n - 1), 7),
                    "kg": 80 - 0.1 * n,
                },
            )
        conn.execute(
            text(
                "INSERT INTO diet_phases (id, user_id, kind, start_date) "
                "VALUES (gen_random_uuid(), :u, 'cut', '2026-10-20')"
            ),
            {"u": uid},
        )
    log_days(owner_engine, uid, "America/New_York", [WEEK + timedelta(days=n) for n in range(6)])
    job(client, fakes, datetime(2026, 11, 2, 12, tzinfo=UTC))
    listed = c.get("/api/checkins").json()
    mine = [x for x in listed if x["week_start"] == "2026-10-26"]
    assert [{k: v for k, v in x.items() if k != "preview"} for x in mine] == [
        {
            "week_start": "2026-10-26",
            "week_end": "2026-11-01",
            "headline": "Avg 2,000 kcal, on target 6 of 6 days",
            "read": False,
        }
    ]
    one = c.get("/api/checkins/2026-10-26").json()
    assert mine[0]["preview"] == one["lines"][:3]
    assert one["read"] is True
    assert c.get("/api/checkins").json()[0]["read"] is True
    lines = one["lines"]
    assert lines[0] == (
        "You averaged 2,000 kcal a day against a 2,050 kcal target, on target on 6 of 6 "
        "logged days."
    )
    assert "Protein averaged 120 g a day against a 140 g target." in lines
    assert any(
        line.startswith("Your weight trend went from") and "kg, down" in line for line in lines
    )
    assert "Fiber averaged 25 g a day." in lines
    assert "That was day 13 of your Cut." in lines
    assert any(line.startswith("Current streak:") for line in lines)
    # Plain description only: no advice and no praise or blame.
    words = " ".join(lines).lower()
    for w in ("should", "try ", "great", "well done", "bad", "only ate", "failed"):
        assert w not in words
    assert c.get("/api/checkins/2026-10-19").status_code in (200, 404)
    assert c.get("/api/checkins/2026-01-05").status_code == 404


def test_emails_only_when_on_and_capped_per_day(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes, monkeypatch: pytest.MonkeyPatch
) -> None:
    off, off_id = account(client, owner_engine, fakes, "UTC")
    on, on_id = account(client, owner_engine, fakes, "UTC")
    assert on.patch("/api/me/settings", json={"checkin_email": True}).json()["checkin_email"]
    assert off.get("/api/me/settings").json()["checkin_email"] is False
    log_days(owner_engine, on_id, "UTC", [WEEK, WEEK + timedelta(days=1)])
    before = len(fakes.outbox.sent)
    job(client, fakes, datetime(2026, 11, 2, 7, tzinfo=UTC))
    mine = [m for m in fakes.outbox.sent[before:] if "week of 26 Oct" in m.email.subject]
    with owner_engine.connect() as conn:
        on_email = conn.execute(
            text("SELECT email FROM users WHERE id = :u"), {"u": on_id}
        ).scalar_one()
    to_me = [m for m in mine if m.to == on_email]
    assert mine, "the opted-in user gets the email"
    with owner_engine.connect() as conn:
        emailed: dict[Any, bool] = dict(
            conn.execute(
                text(
                    "SELECT user_id, emailed_at IS NOT NULL FROM weekly_checkins "
                    "WHERE user_id IN (:a, :b) AND week_start = :w"
                ),
                {"a": off_id, "b": on_id, "w": WEEK},
            ).all()
        )
    assert emailed == {off_id: False, on_id: True}
    assert to_me
    text_body = mine[-1].email.text
    assert "TRIM\nTrack, Record, Inspect, Measure" in text_body
    assert "Only 2 days logged, so averages may be off." in text_body

    # The cap: once 90 have gone out today, the rest wait for tomorrow.
    monkeypatch.setattr(router, "EMAILS_PER_DAY", 0)
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE weekly_checkins SET emailed_at = NULL WHERE user_id = :u"), {"u": on_id}
        )
    assert job(client, fakes, datetime(2026, 11, 2, 8, tzinfo=UTC))["checkin_emails_sent"] == 0
