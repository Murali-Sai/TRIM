"""Task 3.7b: saved meals.
AC: the "Post-workout lunch" example logs 1,345 kcal at 1x and 2,018 kcal at 1.5x; editing the
meal leaves past logs unchanged."""

from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import pytest
from sqlalchemy import Engine, text

from app.routers.meals import MAX_ITEMS, MAX_MEALS
from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import user_row
from tests.test_logs import day, log, signed_in

LUNCH = "2026-10-17T13:00:00-04:00"

# Per 100 g: kcal, protein, fat, carbs.
LUNCH_FOODS = {
    "Butter": (720, 1, 80, 0, 20),
    "Chicken breast": (120, 25, 1, 0, 350),
    "Rice": (230, 2.5, 0.15, 50, 200),
    "Mixed veg": (128.4, 0.12, 0.08, 35.6, 250),
}


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def food(client: CsrfClient, name: str, kcal: float, p: float, f: float, c: float) -> str:
    res = client.post(
        "/api/foods",
        json={"name": name, "per": "100g", "kcal": kcal, "protein_g": p, "carbs_g": c, "fat_g": f},
    )
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def lunch(client: CsrfClient) -> tuple[dict[str, Any], dict[str, str]]:
    ids = {n: food(client, n, *v[:4]) for n, v in LUNCH_FOODS.items()}
    res = client.post(
        "/api/meals",
        json={
            "name": "Post-workout lunch",
            "items": [{"food_id": ids[n], "grams": v[4]} for n, v in LUNCH_FOODS.items()],
        },
    )
    assert res.status_code == 201, res.text
    return res.json(), ids


def log_meal(client: CsrfClient, meal_id: str, **body: Any) -> Any:
    return client.post(f"/api/meals/{meal_id}/log", json={"eaten_at": LUNCH, **body})


def total(entries: list[dict[str, Any]], key: str = "kcal") -> Decimal:
    return sum((Decimal(str(e[key])) for e in entries), Decimal(0))


def shown(v: Decimal) -> int:
    return int(v.quantize(Decimal(1), rounding=ROUND_HALF_UP))


# --- AC ----------------------------------------------------------------------------------------


def test_post_workout_lunch_logs_1345_at_1x_and_2018_at_1_5x(client: CsrfClient) -> None:
    signed_in(client)
    meal, _ = lunch(client)
    assert meal["totals"] == {"kcal": 1345, "protein_g": 93, "carbs_g": 189, "fat_g": 20}

    res = log_meal(client, meal["id"])
    assert res.status_code == 201, res.text
    one = res.json()
    assert one["missing"] == 0
    assert [e["name"] for e in one["entries"]] == list(LUNCH_FOODS)
    assert shown(total(one["entries"])) == 1345
    assert len({e["log_group_id"] for e in one["entries"]}) == 1
    assert {e["source"] for e in one["entries"]} == {"meal"}
    assert {e["meal_name"] for e in one["entries"]} == {"Post-workout lunch"}

    half = log_meal(client, meal["id"], multiplier=1.5).json()["entries"]
    assert total(half) == Decimal("2017.5")
    assert shown(total(half)) == 2018
    assert [shown(total(half, k)) for k in ("protein_g", "fat_g", "carbs_g")] == [140, 30, 284]
    assert [e["grams"] for e in half] == [30, 525, 300, 375]

    # Both logs land on the 17th as two separate groups.
    rows = day(client, "2026-10-17")
    assert len(rows) == 8
    assert len({r["log_group_id"] for r in rows}) == 2
    assert {r["meal_name"] for r in rows} == {"Post-workout lunch"}


def test_editing_the_meal_leaves_past_logs_unchanged(client: CsrfClient) -> None:
    signed_in(client)
    meal, ids = lunch(client)
    before = log_meal(client, meal["id"]).json()["entries"]

    res = client.patch(
        f"/api/meals/{meal['id']}",
        json={"name": "Lunch", "items": [{"food_id": ids["Rice"], "grams": 400}]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["totals"]["kcal"] == 920
    # Changing a food's values does not reach back either.
    edit = client.patch(
        f"/api/foods/{ids['Butter']}",
        json={"name": "Butter", "per": "100g", "kcal": 1, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
    )
    assert edit.status_code == 200, edit.text

    after = day(client, "2026-10-17")
    assert shown(total(after)) == 1345
    assert sorted(e["id"] for e in after) == sorted(e["id"] for e in before)
    assert {e["meal_name"] for e in after} == {"Lunch"}


# --- logging options ---------------------------------------------------------------------------


def test_skip_and_per_item_amounts(client: CsrfClient) -> None:
    signed_in(client)
    meal, _ = lunch(client)
    butter, chicken, rice, _veg = (i["id"] for i in meal["items"])
    res = log_meal(
        client,
        meal["id"],
        multiplier=2,
        skipped_item_ids=[butter],
        item_overrides=[{"item_id": rice, "grams": 100}],
    )
    assert res.status_code == 201, res.text
    entries = res.json()["entries"]
    assert [(e["name"], e["grams"]) for e in entries] == [
        ("Chicken breast", 700),
        ("Rice", 100),
        ("Mixed veg", 500),
    ]
    assert chicken in {i["id"] for i in meal["items"]}


def test_items_by_serving_unit_scale_their_quantity(client: CsrfClient) -> None:
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
    meal = client.post(
        "/api/meals",
        json={"name": "Jar", "items": [{"food_id": oats, "quantity": 1, "unit_label": "1 jar"}]},
    ).json()
    assert meal["items"][0]["grams"] == 250
    [e] = log_meal(client, meal["id"], multiplier=0.5).json()["entries"]
    assert (e["grams"], e["quantity"], e["unit_label"], e["kcal"]) == (125, 0.5, "1 jar", 187.5)
    item = meal["items"][0]["id"]
    [e] = log_meal(client, meal["id"], item_overrides=[{"item_id": item, "quantity": 3}]).json()[
        "entries"
    ]
    assert (e["grams"], e["quantity"]) == (750, 3)
    unknown = client.post(
        "/api/meals",
        json={"name": "Bad", "items": [{"food_id": oats, "quantity": 1, "unit_label": "1 tub"}]},
    )
    assert unknown.status_code == 422


def test_a_deleted_food_is_left_out_and_counted(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    meal, ids = lunch(client)
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE foods SET deleted_at = now() WHERE id = :f"), {"f": ids["Butter"]}
        )
    got = client.get(f"/api/meals/{meal['id']}").json()
    assert got["missing"] == 1
    assert got["items"][0]["missing"] is True
    assert got["totals"]["kcal"] == 1201
    res = log_meal(client, meal["id"]).json()
    assert res["missing"] == 1
    assert len(res["entries"]) == 3


def test_logging_counts_use_and_sorts_the_list(client: CsrfClient, fakes: Fakes) -> None:
    signed_in(client)
    meal, ids = lunch(client)
    other = client.post(
        "/api/meals", json={"name": "Abc snack", "items": [{"food_id": ids["Rice"], "grams": 50}]}
    ).json()
    starred = client.post(
        "/api/meals", json={"name": "Zed", "items": [{"food_id": ids["Rice"], "grams": 60}]}
    ).json()
    assert [m["name"] for m in client.get("/api/meals").json()] == [
        "Abc snack",
        "Post-workout lunch",
        "Zed",
    ]
    log_meal(client, meal["id"])
    client.patch(f"/api/meals/{starred['id']}", json={"is_favourite": True})
    listed = client.get("/api/meals").json()
    assert [m["name"] for m in listed] == ["Zed", "Post-workout lunch", "Abc snack"]
    assert listed[1]["use_count"] == 1
    assert listed[1]["last_used_at"] is not None
    assert other["use_count"] == 0


def test_tomorrow_and_unknown_items_are_refused(client: CsrfClient) -> None:
    signed_in(client)
    meal, _ = lunch(client)
    tomorrow = client.post(
        f"/api/meals/{meal['id']}/log", json={"eaten_at": "2026-10-18T12:00:00-04:00"}
    )
    assert tomorrow.status_code == 422
    stranger = "00000000-0000-7000-8000-000000000000"
    assert log_meal(client, meal["id"], skipped_item_ids=[stranger]).status_code == 422
    everything = [i["id"] for i in meal["items"]]
    assert log_meal(client, meal["id"], skipped_item_ids=everything).status_code == 422
    assert log_meal(client, meal["id"], multiplier=11).status_code == 422
    assert day(client, "2026-10-17") == []


# --- from the timeline -------------------------------------------------------------------------


def test_save_a_time_block_as_a_meal_skips_quick_adds(client: CsrfClient) -> None:
    signed_in(client)
    rice = food(client, "Rice", 130, 2.7, 0.3, 28.2)
    res = log(
        client,
        LUNCH,
        {"food_id": rice, "grams": 150},
        {"quick": {"name": "Cake", "kcal": 300}},
    )
    entries = res.json()
    saved = client.post(
        "/api/meals/from-logs",
        json={"name": "Rice bowl", "log_ids": [e["id"] for e in entries]},
    )
    assert saved.status_code == 201, saved.text
    meal = saved.json()
    assert [(i["name"], i["grams"]) for i in meal["items"]] == [("Rice", 150)]
    assert meal["totals"]["kcal"] == 195

    quick_only = [e["id"] for e in entries if e["food_id"] is None]
    res = client.post("/api/meals/from-logs", json={"name": "Cake", "log_ids": quick_only})
    assert res.status_code == 422


# --- names, archive, delete and limits ---------------------------------------------------------


def test_names_are_unique_ignoring_case_and_spaces(client: CsrfClient) -> None:
    signed_in(client)
    meal, ids = lunch(client)
    body = {"name": "  post-WORKOUT   lunch ", "items": [{"food_id": ids["Rice"], "grams": 10}]}
    res = client.post("/api/meals", json=body)
    assert res.status_code == 422
    assert "already have a meal" in res.json()["detail"]
    # Renaming to its own name is fine.
    same = client.patch(f"/api/meals/{meal['id']}", json={"name": "Post-workout lunch"})
    assert same.status_code == 200


def test_archive_then_delete_keeps_past_logs(client: CsrfClient) -> None:
    signed_in(client)
    meal, _ = lunch(client)
    log_meal(client, meal["id"])
    assert client.delete(f"/api/meals/{meal['id']}").status_code == 422

    archived = client.patch(f"/api/meals/{meal['id']}", json={"archived": True}).json()
    assert archived["archived_at"] is not None
    assert client.get("/api/meals").json() == []
    assert [m["id"] for m in client.get("/api/meals", params={"archived": True}).json()] == [
        meal["id"]
    ]
    assert client.delete(f"/api/meals/{meal['id']}").status_code == 204
    assert client.get(f"/api/meals/{meal['id']}").status_code == 404

    rows = day(client, "2026-10-17")
    assert shown(total(rows)) == 1345
    assert {(r["saved_meal_id"], r["meal_name"]) for r in rows} == {(None, None)}


def test_item_and_meal_limits(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    rice = food(client, "Rice", 130, 2.7, 0.3, 28.2)
    many = [{"food_id": rice, "grams": 10}] * (MAX_ITEMS + 1)
    assert client.post("/api/meals", json={"name": "Big", "items": many}).status_code == 422
    ok = client.post("/api/meals", json={"name": "Big", "items": many[:MAX_ITEMS]})
    assert ok.status_code == 201

    uid = user_row(owner_engine, email).id
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO saved_meals (id, user_id, name) "
                "SELECT gen_random_uuid(), :u, 'Meal ' || n FROM generate_series(2, :n) n"
            ),
            {"u": uid, "n": MAX_MEALS},
        )
    res = client.post("/api/meals", json={"name": "One more", "items": many[:1]})
    assert res.status_code == 422
    assert f"{MAX_MEALS} saved meals" in res.json()["detail"]


# --- undo a whole meal -------------------------------------------------------------------------


def test_undo_a_whole_meal_deletes_its_group(client: CsrfClient) -> None:
    signed_in(client)
    meal, _ = lunch(client)
    group = log_meal(client, meal["id"]).json()["entries"][0]["log_group_id"]
    assert client.delete(f"/api/logs/groups/{group}").status_code == 204
    assert day(client, "2026-10-17") == []
    assert client.delete(f"/api/logs/groups/{group}").status_code == 404


# --- other users -------------------------------------------------------------------------------


def test_another_users_meal_is_404(client: CsrfClient) -> None:
    signed_in(client)
    meal, ids = lunch(client)
    group = log_meal(client, meal["id"]).json()["entries"][0]["log_group_id"]

    b = CsrfClient(client.app)
    b.get("/api/auth/csrf")
    signed_in(b)
    m = meal["id"]
    assert b.get(f"/api/meals/{m}").status_code == 404
    assert b.patch(f"/api/meals/{m}", json={"name": "Mine"}).status_code == 404
    assert b.delete(f"/api/meals/{m}").status_code == 404
    assert b.post(f"/api/meals/{m}/log", json={"eaten_at": LUNCH}).status_code == 404
    assert b.delete(f"/api/logs/groups/{group}").status_code == 404
    rice = {"food_id": ids["Rice"], "grams": 10}
    assert b.post("/api/meals", json={"name": "X", "items": [rice]}).status_code == 404
    assert b.get("/api/meals").json() == []
    assert client.get(f"/api/meals/{m}").json()["name"] == "Post-workout lunch"
