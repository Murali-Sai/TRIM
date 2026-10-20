"""Task 3.12: days are the user's own local days (SPEC page 3, "Days").
AC: users in UTC-5 and UTC+9 at 23:30 local. Logs, daily totals, weigh-ins and targets all
land on the local date, and "today" ends at local midnight, not UTC midnight."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.isolation.registry import BODY_STATS, WORKED
from tests.test_logs import log, shared_food, signed_in

# (timezone, 23:30 local as UTC, the local date, the UTC date at that moment)
CASES = [
    # New York in January is UTC-5: 23:30 on the 15th is 04:30 UTC on the 16th.
    ("America/New_York", datetime(2026, 1, 16, 4, 30, tzinfo=UTC), "2026-01-15", "2026-01-16"),
    # Tokyo is UTC+9: 23:30 on the 15th is 14:30 UTC on the 15th, and 00:30 on the 16th
    # is still the 15th in UTC.
    ("Asia/Tokyo", datetime(2026, 1, 15, 14, 30, tzinfo=UTC), "2026-01-15", "2026-01-15"),
]
IDS = ["UTC-5", "UTC+9"]


def iso(at: datetime) -> str:
    return at.isoformat().replace("+00:00", "Z")


@pytest.mark.parametrize(("tz", "now", "local_day", "utc_day"), CASES, ids=IDS)
def test_a_log_at_23_30_local_is_on_the_local_day(
    client: CsrfClient,
    owner_engine: Engine,
    fakes: Fakes,
    tz: str,
    now: datetime,
    local_day: str,
    utc_day: str,
) -> None:
    fakes.clock.now = now
    signed_in(client, timezone=tz)
    rice = shared_food(owner_engine)
    res = log(client, iso(now), {"food_id": rice, "grams": 100})
    assert res.status_code == 201, res.text
    assert res.json()[0]["logged_on"] == local_day

    on_day = client.get("/api/logs", params={"date_from": local_day}).json()
    assert [e["logged_on"] for e in on_day] == [local_day]
    days = client.get(
        "/api/logs/days", params={"date_from": local_day, "date_to": local_day}
    ).json()
    assert [(d["date"], d["kcal"]) for d in days] == [(local_day, 130)]
    if utc_day != local_day:
        # Nothing on the UTC date: the day boundary is the user's, not the server's.
        assert client.get("/api/logs", params={"date_from": utc_day}).json() == []


@pytest.mark.parametrize(("tz", "now", "local_day", "utc_day"), CASES, ids=IDS)
def test_tomorrow_starts_at_local_midnight(
    client: CsrfClient,
    owner_engine: Engine,
    fakes: Fakes,
    tz: str,
    now: datetime,
    local_day: str,
    utc_day: str,
) -> None:
    fakes.clock.now = now
    signed_in(client, timezone=tz)
    rice = shared_food(owner_engine)
    just_after_midnight = now + timedelta(minutes=31)  # 00:01 local, the next day
    # Later today is fine; tomorrow is not, even though the UTC date may be the same.
    assert (
        log(client, iso(now + timedelta(minutes=29)), {"food_id": rice, "grams": 50}).status_code
        == 201
    )
    assert log(client, iso(just_after_midnight), {"food_id": rice, "grams": 50}).status_code == 422

    # Once it is past local midnight, the new day is today.
    fakes.clock.now = just_after_midnight
    res = log(client, iso(just_after_midnight), {"food_id": rice, "grams": 50})
    assert res.status_code == 201, res.text
    next_day = (datetime.fromisoformat(local_day) + timedelta(days=1)).date().isoformat()
    assert res.json()[0]["logged_on"] == next_day


@pytest.mark.parametrize(("tz", "now", "local_day", "utc_day"), CASES, ids=IDS)
def test_weigh_ins_and_targets_use_the_local_day(
    client: CsrfClient,
    fakes: Fakes,
    tz: str,
    now: datetime,
    local_day: str,
    utc_day: str,
) -> None:
    fakes.clock.now = now
    signed_in(client, timezone=tz)
    assert client.patch("/api/me/body-stats", json=BODY_STATS).status_code == 200
    assert client.post("/api/targets/apply-calculation", json=WORKED).status_code == 201
    targets: list[dict[str, Any]] = client.get("/api/targets").json()
    assert targets[0]["effective_from"] == local_day

    weight = client.post("/api/weights", json={"kg": 70.2})
    assert weight.status_code == 201, weight.text
    assert weight.json()["day"] == local_day


@pytest.mark.parametrize(("tz", "now", "local_day", "utc_day"), CASES, ids=IDS)
def test_a_saved_meal_logged_at_23_30_is_on_the_local_day(
    client: CsrfClient,
    owner_engine: Engine,
    fakes: Fakes,
    tz: str,
    now: datetime,
    local_day: str,
    utc_day: str,
) -> None:
    fakes.clock.now = now
    signed_in(client, timezone=tz)
    rice = shared_food(owner_engine)
    meal = client.post(
        "/api/meals", json={"name": "Late rice", "items": [{"food_id": rice, "grams": 100}]}
    ).json()
    res = client.post(f"/api/meals/{meal['id']}/log", json={"eaten_at": iso(now)})
    assert res.status_code == 201, res.text
    assert res.json()["entries"][0]["logged_on"] == local_day
