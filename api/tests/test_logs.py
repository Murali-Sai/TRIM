"""Task 3.4: time-based logging.
AC: food logged at 19:00 for 16:00 lands in the 4 PM block and on the correct local date."""

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import log_in, seed_food_rows, sign_up, user_row


def signed_in(client: CsrfClient, timezone: str = "America/New_York") -> str:
    email = sign_up(client, timezone=timezone)
    assert log_in(client, email).status_code == 200
    return email


def shared_food(owner_engine: Engine, **per_100: Any) -> str:
    """A row in the shared cache (owner_id null), as FDC results are stored."""
    values = {
        "kcal": 130,
        "protein": 2.7,
        "carbs": 28.2,
        "fat": 0.3,
        "fiber": None,
        **per_100,
    }
    with owner_engine.begin() as conn:
        return str(
            conn.execute(
                text(
                    "INSERT INTO foods (id, owner_id, source, source_ref, name, brand, kcal_100, "
                    "protein_100, carbs_100, fat_100, fiber_100) VALUES (gen_random_uuid(), "
                    "NULL, 'fdc', gen_random_uuid()::text, 'White rice, cooked', NULL, :kcal, "
                    ":protein, :carbs, :fat, :fiber) RETURNING id"
                ),
                values,
            ).scalar_one()
        )


def log(client: CsrfClient, eaten_at: str, *items: dict[str, Any]) -> Any:
    return client.post("/api/logs", json={"eaten_at": eaten_at, "items": list(items)})


def day(client: CsrfClient, on: str) -> list[dict[str, Any]]:
    res = client.get("/api/logs", params={"date_from": on})
    assert res.status_code == 200
    rows: list[dict[str, Any]] = res.json()
    return rows


# --- acceptance ---------------------------------------------------------------------------


def test_logged_at_19_for_16_lands_at_4_pm_on_that_local_day(
    client: CsrfClient, fakes: Fakes, owner_engine: Engine
) -> None:
    # 19:00 in New York on 17 Oct is 23:00 UTC.
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)
    signed_in(client)
    rice = shared_food(owner_engine)

    res = log(client, "2026-10-17T16:00:00-04:00", {"food_id": rice, "grams": 150})
    assert res.status_code == 201
    [entry] = res.json()
    assert entry["eaten_at"] == "2026-10-17T20:00:00Z"
    assert entry["logged_on"] == "2026-10-17"
    assert [e["id"] for e in day(client, "2026-10-17")] == [entry["id"]]
    assert day(client, "2026-10-18") == []


@pytest.mark.parametrize(
    ("timezone", "now_utc", "local_day"),
    [
        # 23:30 on 17 Oct in UTC-5 is already 18 Oct in UTC.
        ("America/Bogota", datetime(2026, 10, 18, 4, 30, tzinfo=UTC), "2026-10-17"),
        # 23:30 on 17 Oct in UTC+9 is still 17 Oct in UTC (14:30).
        ("Asia/Tokyo", datetime(2026, 10, 17, 14, 30, tzinfo=UTC), "2026-10-17"),
        # 08:30 on 18 Oct in UTC+9 is still 17 Oct in UTC.
        ("Asia/Tokyo", datetime(2026, 10, 17, 23, 30, tzinfo=UTC), "2026-10-18"),
    ],
)
def test_logged_on_is_the_users_local_day(
    client: CsrfClient,
    fakes: Fakes,
    owner_engine: Engine,
    timezone: str,
    now_utc: datetime,
    local_day: str,
) -> None:
    fakes.clock.now = now_utc
    signed_in(client, timezone)
    rice = shared_food(owner_engine)
    [entry] = log(client, now_utc.isoformat(), {"food_id": rice, "grams": 100}).json()
    assert entry["logged_on"] == local_day
    assert len(day(client, local_day)) == 1


# --- amounts and nutrients ------------------------------------------------------------------


def test_nutrients_are_grams_times_per_100(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    # SPEC page 3: rice 150 g at 130 kcal/100 g gives 195 kcal. Nutrients sent are ignored.
    [e] = log(client, "2026-10-17T12:00:00Z", {"food_id": rice, "grams": 150, "kcal": 9999}).json()
    assert (e["kcal"], e["protein_g"], e["carbs_g"], e["fat_g"]) == (195, 4.05, 42.3, 0.45)
    assert e["grams"] == 150
    assert e["quantity"] is None and e["unit_label"] is None
    assert e["fiber_g"] is None  # unknown, not zero
    assert e["name"] == "White rice, cooked"
    assert e["source"] == "search"


def test_serving_units_set_grams(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    own = seed_food_rows(owner_engine, user_row(owner_engine, email).id)
    [e] = log(
        client,
        "2026-10-17T12:00:00Z",
        {"food_id": str(own["food_id"]), "quantity": 2, "unit_label": "1 jar"},
    ).json()
    assert (e["grams"], e["quantity"], e["unit_label"]) == (500, 2, "1 jar")
    assert e["kcal"] == 750


def test_several_items_share_one_time_and_group(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    beans = shared_food(owner_engine, kcal=127)
    rows = log(
        client,
        "2026-10-17T16:00:37.5-04:00",
        {"food_id": rice, "grams": 150},
        {"food_id": beans, "grams": 100, "source": "recent"},
    ).json()
    assert len(rows) == 2
    assert len({r["log_group_id"] for r in rows}) == 1
    # One block is one minute: seconds are dropped.
    assert {r["eaten_at"] for r in rows} == {"2026-10-17T20:00:00Z"}
    assert [r["source"] for r in rows] == ["search", "recent"]


def test_backdating_to_a_past_day(client: CsrfClient, fakes: Fakes, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    [e] = log(client, "2026-10-14T08:15:00-04:00", {"food_id": rice, "grams": 80}).json()
    assert e["logged_on"] == "2026-10-14"
    assert day(client, "2026-10-17") == []
    rows = client.get(
        "/api/logs", params={"date_from": "2026-10-11", "date_to": "2026-10-17"}
    ).json()
    assert [r["id"] for r in rows] == [e["id"]]


def test_later_today_is_fine_but_tomorrow_is_refused(
    client: CsrfClient, owner_engine: Engine
) -> None:
    # The fake clock is 08:00 on 17 Oct in New York.
    signed_in(client)
    rice = shared_food(owner_engine)
    assert (
        log(client, "2026-10-17T21:00:00-04:00", {"food_id": rice, "grams": 80}).status_code == 201
    )
    res = log(client, "2026-10-18T00:00:00-04:00", {"food_id": rice, "grams": 80})
    assert res.status_code == 422
    assert len(day(client, "2026-10-18")) == 0


def test_entries_are_ordered_by_time_eaten(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    log(client, "2026-10-17T18:30:00-04:00", {"food_id": rice, "grams": 80})
    log(client, "2026-10-17T07:00:00-04:00", {"food_id": rice, "grams": 60})
    assert [e["grams"] for e in day(client, "2026-10-17")] == [60, 80]


# --- last used time ---------------------------------------------------------------------------


def test_last_time_is_the_most_recent_add(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    assert client.get("/api/logs/last-time").json() == {"eaten_at": None}
    rice = shared_food(owner_engine)
    log(client, "2026-10-17T12:30:00-04:00", {"food_id": rice, "grams": 80})
    # Added later, but eaten earlier: it is still the last time used.
    log(client, "2026-10-16T19:45:00-04:00", {"food_id": rice, "grams": 80})
    assert client.get("/api/logs/last-time").json() == {"eaten_at": "2026-10-16T23:45:00Z"}


# --- refusals -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"eaten_at": "2026-10-17T12:00:00Z", "items": []},
        {"eaten_at": "2026-10-17T12:00:00", "items": [{"food_id": "FOOD", "grams": 10}]},
        {"eaten_at": "2026-10-17T12:00:00Z", "items": [{"food_id": "FOOD"}]},
        {"eaten_at": "2026-10-17T12:00:00Z", "items": [{"food_id": "FOOD", "grams": 0}]},
        {"eaten_at": "2026-10-17T12:00:00Z", "items": [{"food_id": "FOOD", "grams": 5001}]},
        {"eaten_at": "2026-10-17T12:00:00Z", "items": [{"food_id": "FOOD", "quantity": 1}]},
        {
            "eaten_at": "2026-10-17T12:00:00Z",
            "items": [{"food_id": "FOOD", "grams": 10, "quantity": 1, "unit_label": "1 cup"}],
        },
        {
            "eaten_at": "2026-10-17T12:00:00Z",
            "items": [{"food_id": "FOOD", "quantity": 1, "unit_label": "1 bucket"}],
        },
        {"eaten_at": "1999-12-31T12:00:00Z", "items": [{"food_id": "FOOD", "grams": 10}]},
    ],
)
def test_bad_bodies_are_refused_and_write_nothing(
    client: CsrfClient, owner_engine: Engine, body: dict[str, Any]
) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    for item in body["items"]:
        item["food_id"] = rice
    assert client.post("/api/logs", json=body).status_code == 422
    assert client.get("/api/logs/last-time").json() == {"eaten_at": None}


def test_unknown_food_is_404(client: CsrfClient) -> None:
    signed_in(client)
    res = log(
        client,
        "2026-10-17T12:00:00Z",
        {"food_id": "0190a000-0000-7000-8000-000000000000", "grams": 1},
    )
    assert res.status_code == 404


def test_another_users_custom_food_is_404_and_nothing_is_written(
    client: CsrfClient, owner_engine: Engine
) -> None:
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    other_email = signed_in(other)
    theirs = seed_food_rows(owner_engine, user_row(owner_engine, other_email).id)

    signed_in(client)
    rice = shared_food(owner_engine)
    res = log(
        client,
        "2026-10-17T12:00:00Z",
        {"food_id": rice, "grams": 100},
        {"food_id": str(theirs["food_id"]), "grams": 100},
    )
    assert res.status_code == 404
    # The whole add is refused, including the item that was fine.
    assert day(client, "2026-10-17") == []
    assert len(day(other, "2026-10-17")) == 1  # their seeded log, untouched


def test_range_is_limited(client: CsrfClient) -> None:
    signed_in(client)
    bad = [
        {"date_from": "2026-10-17", "date_to": "2026-10-16"},
        {"date_from": "2026-08-01", "date_to": "2026-10-17"},
        {"date_from": "not a date"},
        {},
    ]
    for params in bad:
        assert client.get("/api/logs", params=params).status_code == 422


def test_logs_need_a_session(client: CsrfClient) -> None:
    assert client.get("/api/logs", params={"date_from": "2026-10-17"}).status_code == 401
    assert client.get("/api/logs/last-time").status_code == 401
    assert log(client, "2026-10-17T12:00:00Z", {"food_id": "x", "grams": 1}).status_code == 401
