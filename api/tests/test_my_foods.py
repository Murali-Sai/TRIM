"""Task 3.7: recents, frequents, favourites, quick add and custom foods.
AC: logging a recent food under 5 s (the web side times it; here the recent food comes back
with its last serving so it can be logged in one tap)."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import seed_food_rows, user_row
from tests.test_logs import day, log, shared_food, signed_in

NOON = "2026-10-17T12:00:00-04:00"


def quick(client: CsrfClient) -> dict[str, list[dict[str, Any]]]:
    res = client.get("/api/foods/quick")
    assert res.status_code == 200
    body: dict[str, list[dict[str, Any]]] = res.json()
    return body


def names(rows: list[dict[str, Any]]) -> list[str]:
    return [r["name"] for r in rows]


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


# --- recents and the last serving ------------------------------------------------------------


def test_recents_are_latest_first_with_the_last_serving(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    signed_in(client)
    oats = client.post(
        "/api/foods",
        json={
            "name": "Overnight oats",
            "per": "serving",
            "serving_label": "1 jar",
            "serving_grams": 250,
            "kcal": 375,
            "protein_g": 15,
            "carbs_g": 60,
            "fat_g": 10,
        },
    ).json()["id"]
    rice = shared_food(owner_engine)
    log(client, NOON, {"food_id": rice, "grams": 150})
    fakes.clock.now += timedelta(minutes=1)
    log(client, NOON, {"food_id": oats, "quantity": 2, "unit_label": "1 jar"})
    fakes.clock.now += timedelta(minutes=1)
    log(client, NOON, {"food_id": rice, "grams": 180})

    q = quick(client)
    assert names(q["recents"]) == ["White rice, cooked", "Overnight oats"]
    rice_row, oats_row = q["recents"]
    assert rice_row["last"] == {"grams": 180, "quantity": None, "unit_label": None}
    assert oats_row["last"] == {"grams": 500, "quantity": 2, "unit_label": "1 jar"}
    assert rice_row["times_logged"] == 2
    assert rice_row["tier"] == "personal"


def test_logging_a_recent_food_in_one_add(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    log(client, NOON, {"food_id": rice, "grams": 150})
    recent = quick(client)["recents"][0]
    last = recent["last"]
    [e] = log(
        client,
        "2026-10-17T18:00:00-04:00",
        {"food_id": recent["id"], "grams": last["grams"], "source": "recent"},
    ).json()
    assert (e["grams"], e["kcal"], e["source"]) == (150, 195, "recent")


def test_frequents_need_two_logs_in_90_days(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    beans = shared_food(owner_engine, kcal=127)
    for _ in range(3):
        log(client, NOON, {"food_id": rice, "grams": 100})
    log(client, NOON, {"food_id": beans, "grams": 100})
    assert [f["id"] for f in quick(client)["frequents"]] == [rice]
    # Logs older than 90 days no longer count.
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE food_logs SET created_at = created_at - interval '91 days' "
                "WHERE food_id = :f"
            ),
            {"f": rice},
        )
    assert quick(client)["frequents"] == []


def test_deleted_entries_and_quick_adds_do_not_count(
    client: CsrfClient, owner_engine: Engine
) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    [e] = log(client, NOON, {"food_id": rice, "grams": 100}).json()
    log(client, NOON, {"quick": {"kcal": 300}})
    client.delete(f"/api/logs/{e['id']}")
    assert quick(client)["recents"] == []


# --- favourites ------------------------------------------------------------------------------


def test_favourite_and_unfavourite(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    assert client.put(f"/api/foods/{rice}/favourite").status_code == 204
    assert client.put(f"/api/foods/{rice}/favourite").status_code == 204  # idempotent
    q = quick(client)
    assert [f["id"] for f in q["favourites"]] == [rice]
    assert q["favourites"][0]["is_favourite"] is True
    assert q["favourites"][0]["last"] is None  # never logged

    # Favourites come first in search too.
    found = client.get("/api/foods/search", params={"q": "rice"}).json()["results"]
    assert found[0]["id"] == rice and found[0]["tier"] == "personal"

    assert client.delete(f"/api/foods/{rice}/favourite").status_code == 204
    assert quick(client)["favourites"] == []


def test_another_users_custom_food_cannot_be_favourited(
    client: CsrfClient, owner_engine: Engine
) -> None:
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    other_email = signed_in(other)
    theirs = seed_food_rows(owner_engine, user_row(owner_engine, other_email).id)["food_id"]

    signed_in(client)
    assert client.put(f"/api/foods/{theirs}/favourite").status_code == 404
    assert client.delete(f"/api/foods/{theirs}/favourite").status_code == 404
    assert quick(client)["favourites"] == []
    # Their own favourite is untouched.
    assert len(quick(other)["favourites"]) == 1


# --- quick add -------------------------------------------------------------------------------


def test_quick_add(client: CsrfClient) -> None:
    signed_in(client)
    res = log(
        client,
        NOON,
        {"quick": {"name": "Office cake", "kcal": 320, "protein_g": 4, "fat_g": 15, "carbs_g": 41}},
        {"quick": {"kcal": 90}},
    )
    assert res.status_code == 201
    cake, plain = res.json()
    assert (cake["name"], cake["kcal"], cake["fat_g"], cake["source"]) == (
        "Office cake",
        320,
        15,
        "quick_add",
    )
    assert (cake["food_id"], cake["grams"], cake["quantity"]) == (None, None, None)
    assert (plain["name"], plain["protein_g"]) == ("Quick add", 0)
    # A quick add has no amount to change, but its time can move.
    assert client.patch(f"/api/logs/{cake['id']}", json={"grams": 10}).status_code == 422
    assert (
        client.patch(f"/api/logs/{cake['id']}", json={"eaten_at": "2026-10-17T13:00:00-04:00"})
    ).status_code == 200


@pytest.mark.parametrize(
    "item",
    [
        {"quick": {"kcal": -1}},
        {"quick": {"kcal": 100}, "grams": 50},
        {"quick": {"kcal": 100}, "food_id": "0190a000-0000-7000-8000-000000000000"},
        {},
    ],
)
def test_bad_quick_adds(client: CsrfClient, item: dict[str, Any]) -> None:
    signed_in(client)
    assert log(client, NOON, item).status_code == 422
    assert day(client, "2026-10-17") == []


# --- custom foods -----------------------------------------------------------------------------


def label(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Protein bar",
        "brand": "Corner Shop",
        "per": "serving",
        "serving_label": "1 bar",
        "serving_grams": 60,
        "kcal": 210,
        "protein_g": 20,
        "carbs_g": 22,
        "fat_g": 6,
        "fiber_g": 3,
    }
    body.update(overrides)
    return body


def test_custom_food_per_serving_is_stored_per_100_g(client: CsrfClient) -> None:
    signed_in(client)
    res = client.post("/api/foods", json=label())
    assert res.status_code == 201
    f = res.json()
    # per100 = per_serving / serving_g x 100
    assert (f["kcal_100"], f["protein_100"], f["carbs_100"], f["fat_100"], f["fiber_100"]) == (
        350,
        33.33,
        36.67,
        10,
        5,
    )
    assert f["sugar_100"] is None  # unknown, not zero
    assert f["servings"] == [{"label": "1 bar", "grams": 60, "is_default": True}]
    assert f["source"] == "custom" and f["tier"] == "personal"
    assert f["kcal_mismatch"] is False

    # It is found in search and can be logged by the bar.
    found = client.get("/api/foods/search", params={"q": "protein bar"}).json()["results"]
    assert found[0]["id"] == f["id"]
    [e] = log(client, NOON, {"food_id": f["id"], "quantity": 1, "unit_label": "1 bar"}).json()
    assert (e["grams"], e["kcal"], e["protein_g"]) == (60, 210, 20)


def test_custom_food_per_100_g_and_the_mismatch_flag(client: CsrfClient) -> None:
    signed_in(client)
    f = client.post(
        "/api/foods",
        json={
            "name": "Odd label",
            "per": "100g",
            "kcal": 500,
            "protein_g": 10,
            "carbs_g": 10,
            "fat_g": 1,
        },
    ).json()
    assert (f["kcal_100"], f["servings"]) == (500, [])
    assert f["kcal_mismatch"] is True  # 4P + 4C + 9F = 89, far from 500


@pytest.mark.parametrize(
    "body",
    [
        label(name=""),
        label(name="   "),
        label(per="serving", serving_label=None, serving_grams=None),
        label(serving_label="1 bar", serving_grams=None),
        label(kcal=-5),
        label(per="100g", protein_g=60, carbs_g=40, fat_g=10),
        label(per="100g", kcal=1200, protein_g=0, carbs_g=0, fat_g=0),
    ],
)
def test_bad_custom_foods_are_refused(client: CsrfClient, body: dict[str, Any]) -> None:
    signed_in(client)
    assert client.post("/api/foods", json=body).status_code == 422


def test_editing_a_custom_food_keeps_past_logs(client: CsrfClient) -> None:
    signed_in(client)
    f = client.post("/api/foods", json=label()).json()
    [e] = log(client, NOON, {"food_id": f["id"], "quantity": 1, "unit_label": "1 bar"}).json()
    res = client.patch(
        f"/api/foods/{f['id']}",
        json=label(
            name="Protein bar, new recipe", kcal=240, serving_label="1 big bar", serving_grams=70
        ),
    )
    assert res.status_code == 200
    g = res.json()
    assert g["name"] == "Protein bar, new recipe"
    assert g["servings"] == [{"label": "1 big bar", "grams": 70, "is_default": True}]
    [past] = day(client, "2026-10-17")
    assert (past["id"], past["name"], past["kcal"], past["unit_label"]) == (
        e["id"],
        "Protein bar",
        210,
        "1 bar",
    )


def test_shared_and_other_users_foods_cannot_be_edited(
    client: CsrfClient, owner_engine: Engine
) -> None:
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    other_email = signed_in(other)
    theirs = seed_food_rows(owner_engine, user_row(owner_engine, other_email).id)["food_id"]
    signed_in(client)
    rice = shared_food(owner_engine)
    assert client.patch(f"/api/foods/{rice}", json=label()).status_code == 404
    assert client.patch(f"/api/foods/{theirs}", json=label()).status_code == 404
    found = other.get("/api/foods/search", params={"q": "overnight"}).json()["results"]
    assert found[0]["name"] == "Overnight oats"


def test_custom_foods_need_a_session(client: CsrfClient) -> None:
    assert client.post("/api/foods", json=label()).status_code == 401
    assert client.get("/api/foods/quick").status_code == 401
