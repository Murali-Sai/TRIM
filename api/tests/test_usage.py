"""Task 5.7: free-tier usage alerts. AC: a test alert fires (at 70%, once per period).

Counters are app-wide, so each test works in its own far-off hour, day or month, where other
tests have counted nothing."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, text

from app import usage
from app.config import get_settings
from tests.conftest import CsrfClient
from tests.fakes import FAKE_JOB_TOKEN, Fakes
from tests.helpers import sign_up

ALERTS_TO = "ops@example.com"


@pytest.fixture(autouse=True)
def alert_address(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "alert_email", ALERTS_TO)


def job(client: CsrfClient, fakes: Fakes, at: datetime) -> list[str]:
    fakes.clock.now = at
    res = client.post("/api/internal/jobs/hourly", headers={"X-Job-Token": FAKE_JOB_TOKEN})
    assert res.status_code == 200, res.text
    alerts: list[str] = res.json()["usage_alerts"]
    return alerts


def alerts_sent(fakes: Fakes) -> list[str]:
    return [m.email.subject for m in fakes.outbox.sent if m.to == ALERTS_TO]


def test_windows_and_periods() -> None:
    now = datetime(2031, 5, 17, 13, 42, tzinfo=UTC)
    assert usage.window_start("hour", now) == datetime(2031, 5, 17, 13, tzinfo=UTC)
    assert usage.window_start("day", now) == datetime(2031, 5, 17, tzinfo=UTC)
    assert usage.window_start("month", now) == datetime(2031, 5, 1, tzinfo=UTC)
    day = next(lim for lim in usage.LIMITS if lim.key == "resend_day")
    assert usage.period(day, now) == "2031-05-17T00:00:00+00:00"


def check(fakes: Fakes, at: datetime) -> list[str]:
    """The check on its own: the hourly job also sends other tests' check-in emails."""
    fakes.clock.now = at
    return usage.check(fakes.services())


def test_ac_an_alert_fires_at_70_percent_once(client: CsrfClient, fakes: Fakes) -> None:
    day = datetime(2031, 6, 3, 9, tzinfo=UTC)
    usage.record("email", day, n=69)
    assert "resend_day" not in check(fakes, day)
    usage.record("email", day + timedelta(hours=2))  # 70 of 100 today
    assert "resend_day" in check(fakes, day + timedelta(hours=3))
    subjects = alerts_sent(fakes)
    assert subjects.count("TRIM usage alert: Resend emails today at 70%") == 1
    # Once a day, however often it runs; the alert email itself is counted too (71 now).
    assert "resend_day" not in check(fakes, day + timedelta(hours=4))
    assert len(alerts_sent(fakes)) == 1
    # The next day starts again from zero.
    assert "resend_day" not in check(fakes, day + timedelta(days=1))


def test_the_hourly_job_runs_the_check(client: CsrfClient, fakes: Fakes) -> None:
    at = datetime(2031, 7, 9, 14, tzinfo=UTC)
    usage.record("fdc", at, n=950)
    assert "fdc_hour" in job(client, fakes, at)
    assert any("FoodData Central requests this hour at 95%" in s for s in alerts_sent(fakes))


def test_monthly_email_and_hourly_fdc_limits(client: CsrfClient, fakes: Fakes) -> None:
    month = datetime(2031, 8, 1, 0, tzinfo=UTC)
    # 2,100 of 3,000 this month, spread over days so no single day reaches 70.
    for d in range(30):
        usage.record("email", month + timedelta(days=d), n=70)
    at = month + timedelta(days=29, hours=23)
    usage.record("fdc", at, n=700)
    sent = check(fakes, at)
    assert "resend_month" in sent and "fdc_hour" in sent
    assert "FoodData Central requests this hour" in " ".join(alerts_sent(fakes))


def test_a_food_search_counts_against_fdc(
    client: CsrfClient, fakes: Fakes, owner_engine: Engine
) -> None:
    fakes.clock.now = datetime(2031, 9, 9, 10, 15, tzinfo=UTC)
    from tests.test_logs import signed_in

    signed_in(client)
    client.get("/api/foods/search", params={"q": "zucchini bread"})
    with owner_engine.connect() as conn:
        n = conn.execute(
            text("SELECT count FROM usage_counters WHERE metric = 'fdc' AND hour = :h"),
            {"h": datetime(2031, 9, 9, 10, tzinfo=UTC)},
        ).scalar()
    assert n == 1


def test_sign_up_emails_are_counted(client: CsrfClient, fakes: Fakes, owner_engine: Engine) -> None:
    fakes.clock.now = datetime(2031, 10, 2, 8, 30, tzinfo=UTC)
    sign_up(client)
    with owner_engine.connect() as conn:
        n = conn.execute(
            text("SELECT count FROM usage_counters WHERE metric = 'email' AND hour = :h"),
            {"h": datetime(2031, 10, 2, 8, tzinfo=UTC)},
        ).scalar()
    assert n == 1


def test_database_size_against_neon(client: CsrfClient, fakes: Fakes) -> None:
    tiny = usage.Limit("neon_storage", "Neon database size", 1, "MB", "now", None)
    fakes.clock.now = datetime(2031, 11, 5, tzinfo=UTC)
    assert usage.check(fakes.services(), (tiny,)) == ["neon_storage"]
    assert usage.check(fakes.services(), (tiny,)) == []  # once a month


def test_without_an_address_it_only_logs(
    client: CsrfClient,
    fakes: Fakes,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(get_settings(), "alert_email", None)
    at = datetime(2031, 12, 7, 5, tzinfo=UTC)
    usage.record("fdc", at, n=900)
    before = len(fakes.outbox.sent)
    with caplog.at_level("WARNING", logger="app.usage"):
        assert check(fakes, at) == ["fdc_hour"]
    assert len(fakes.outbox.sent) == before
    assert "free tier at 90%: FoodData Central requests this hour" in caplog.text
