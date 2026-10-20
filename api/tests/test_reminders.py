"""Task 3.18: streak reminders. AC (server side): at most one a day, only if today is unlogged;
no reminder after the day is logged. (Delivery on desktop Chrome and an iPhone Home Screen
install is checked by hand.)

The job is global, so each test subscribes its own endpoint and counts only what reached it."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine

from tests.conftest import CsrfClient
from tests.fakes import FAKE_JOB_TOKEN, FAKE_VAPID_PUBLIC, Fakes
from tests.test_streaks import at, entry, signed_in

D = date(2026, 10, 14)


def run_job(client: CsrfClient, fakes: Fakes, now: datetime, token: str = FAKE_JOB_TOKEN) -> Any:
    fakes.clock.now = now.astimezone(UTC)
    return client.post("/api/internal/jobs/hourly", headers={"X-Job-Token": token})


def got(fakes: Fakes, endpoint: str) -> list[str]:
    return [body for e, body in fakes.push.sent if e == endpoint]


def subscribe(client: CsrfClient) -> str:
    endpoint = f"https://push.example.com/{uuid.uuid4().hex}"
    sub = {"endpoint": endpoint, "keys": {"p256dh": "key", "auth": "auth"}}
    assert client.post("/api/push/subscriptions", json=sub).status_code == 204
    return endpoint


def with_streak(client: CsrfClient, owner_engine: Engine, fakes: Fakes, days: int = 5) -> Any:
    fakes.clock.now = at(D - timedelta(days=days), 8).astimezone(UTC)
    uid = signed_in(client, owner_engine)
    for n in range(days):
        d = D - timedelta(days=days - n)
        entry(owner_engine, uid, d, at(d))
    endpoint = subscribe(client)
    res = client.patch("/api/me/settings", json={"streak_reminder": "20:00"})
    assert res.json()["streak_reminder"] == "20:00"
    return uid, endpoint


def test_the_job_needs_its_token(client: CsrfClient, fakes: Fakes) -> None:
    assert run_job(client, fakes, at(D), token="wrong").status_code == 401
    fakes.clock.now = at(D).astimezone(UTC)
    assert client.post("/api/internal/jobs/hourly").status_code == 401


def test_one_reminder_at_the_chosen_time_while_today_is_unlogged(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    _, endpoint = with_streak(client, owner_engine, fakes)
    run_job(client, fakes, at(D, 19))  # not yet
    assert got(fakes, endpoint) == []
    res = run_job(client, fakes, at(D, 20))
    assert res.status_code == 200
    assert res.json()["reminders_sent"] >= 1
    assert got(fakes, endpoint) == ["Log something today to keep your 5-day streak."]
    # 21:00 and 23:00: never twice in a day.
    run_job(client, fakes, at(D, 21))
    run_job(client, fakes, at(D, 23))
    assert len(got(fakes, endpoint)) == 1


def test_ac_no_reminder_after_the_day_is_logged(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    uid, endpoint = with_streak(client, owner_engine, fakes)
    entry(owner_engine, uid, D, at(D, 12))
    run_job(client, fakes, at(D, 20))
    run_job(client, fakes, at(D, 22))
    assert got(fakes, endpoint) == []


def test_no_reminder_without_a_streak(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    fakes.clock.now = at(D, 8).astimezone(UTC)
    signed_in(client, owner_engine)
    endpoint = subscribe(client)
    client.patch("/api/me/settings", json={"streak_reminder": "20:00"})
    run_job(client, fakes, at(D, 20))
    assert got(fakes, endpoint) == []


@pytest.mark.parametrize("change", [{"streak_reminder": None}, {"gamification": False}])
def test_turning_it_off_stops_reminders(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes, change: dict[str, Any]
) -> None:
    _, endpoint = with_streak(client, owner_engine, fakes)
    client.patch("/api/me/settings", json=change)
    run_job(client, fakes, at(D, 20))
    assert got(fakes, endpoint) == []


def test_a_dropped_subscription_is_forgotten(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    uid, endpoint = with_streak(client, owner_engine, fakes)
    fakes.push.gone.add(endpoint)
    run_job(client, fakes, at(D, 20))
    fakes.push.gone.clear()
    # Logged on the 14th so the streak is alive on the 15th; the browser is gone for good.
    entry(owner_engine, uid, D, at(D, 21))
    run_job(client, fakes, at(D + timedelta(days=1), 20))
    assert got(fakes, endpoint) == []


def test_reminder_time_is_the_users_local_time(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    _, endpoint = with_streak(client, owner_engine, fakes)
    client.patch("/api/me/settings", json={"streak_reminder": "07:30"})
    run_job(client, fakes, at(D, 7, 15))
    assert got(fakes, endpoint) == []
    run_job(client, fakes, at(D, 7, 45))
    assert len(got(fakes, endpoint)) == 1
    assert client.patch("/api/me/settings", json={"streak_reminder": "25:00"}).status_code == 422


def test_push_config_and_unsubscribe(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    _, endpoint = with_streak(client, owner_engine, fakes)
    assert client.get("/api/push/config").json() == {"public_key": FAKE_VAPID_PUBLIC}
    res = client.delete("/api/push/subscriptions", params={"endpoint": endpoint})
    assert res.status_code == 204
    run_job(client, fakes, at(D, 20))
    assert got(fakes, endpoint) == []
    bad = {"endpoint": "http://insecure.example.com/x", "keys": {"p256dh": "k", "auth": "a"}}
    assert client.post("/api/push/subscriptions", json=bad).status_code == 422
