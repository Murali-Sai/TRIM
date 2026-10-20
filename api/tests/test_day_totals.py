"""Task 3.9: daily totals for the calorie and macro charts."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import seed_food_rows, user_row
from tests.test_logs import log, shared_food, signed_in


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def days(client: CsrfClient, a: str, b: str) -> list[dict[str, object]]:
    res = client.get("/api/logs/days", params={"date_from": a, "date_to": b})
    assert res.status_code == 200, res.text
    out: list[dict[str, object]] = res.json()
    return out


def test_totals_per_local_day_and_only_logged_days(
    client: CsrfClient, owner_engine: Engine
) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)  # 130 kcal, 2.7 P, 28.2 C, 0.3 F per 100 g; fiber unknown
    # 23:30 in New York on the 15th is the 16th in UTC, but the local day is the 15th.
    log(client, "2026-10-15T23:30:00-04:00", {"food_id": rice, "grams": 150})
    log(client, "2026-10-17T08:00:00-04:00", {"food_id": rice, "grams": 100})
    log(
        client,
        "2026-10-17T12:00:00-04:00",
        {"food_id": rice, "grams": 50},
        {"quick": {"kcal": 300, "protein_g": 10, "carbs_g": 40, "fat_g": 12}},
    )

    got = days(client, "2026-10-01", "2026-10-31")
    assert [d["date"] for d in got] == ["2026-10-15", "2026-10-17"]
    assert got[0] == {
        "date": "2026-10-15",
        "entries": 1,
        "kcal": 195,
        "protein_g": 4.05,
        "carbs_g": 42.3,
        "fat_g": 0.45,
        "fiber_g": 0,
        "fiber_unknown": 1,
    }
    assert got[1]["entries"] == 3
    assert got[1]["kcal"] == 130 + 65 + 300
    assert got[1]["fiber_unknown"] == 3  # rice twice, and a quick add has no fiber either


def test_deleted_entries_do_not_count(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    [e] = log(client, "2026-10-17T08:00:00-04:00", {"food_id": rice, "grams": 100}).json()
    assert client.delete(f"/api/logs/{e['id']}").status_code == 204
    assert days(client, "2026-10-17", "2026-10-17") == []


def test_range_is_checked(client: CsrfClient) -> None:
    signed_in(client)
    bad = [("2026-10-17", "2026-10-16"), ("2016-10-01", "2026-10-17")]
    for a, b in bad:
        res = client.get("/api/logs/days", params={"date_from": a, "date_to": b})
        assert res.status_code == 422
    assert days(client, "2016-10-23", "2026-10-17") == []


def test_only_your_own_days(client: CsrfClient, owner_engine: Engine) -> None:
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    seed_food_rows(owner_engine, user_row(owner_engine, signed_in(other)).id)
    signed_in(client)
    assert days(client, "2026-10-01", "2026-10-31") == []
    assert len(days(other, "2026-10-01", "2026-10-31")) == 1


def test_needs_a_session(client: CsrfClient) -> None:
    res = client.get("/api/logs/days", params={"date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert res.status_code == 401
