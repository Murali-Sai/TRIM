"""Task 3.19: staples. AC: the 21st staple is rejected; countable units default to 1 to 4 in
steps of 1. The unit rules on their own are tested at the bottom."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from app import staples as rules
from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import user_row
from tests.test_logs import signed_in


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def food(client: CsrfClient, name: str, serving: tuple[str, float] | None = None) -> str:
    body: dict[str, Any] = {
        "name": name,
        "per": "100g",
        "kcal": 200,
        "protein_g": 10,
        "carbs_g": 20,
        "fat_g": 8,
    }
    if serving:
        body |= {"serving_label": serving[0], "serving_grams": serving[1]}
    res = client.post("/api/foods", json=body)
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def add(client: CsrfClient, **body: Any) -> Any:
    return client.post("/api/staples", json=body)


def staples(client: CsrfClient) -> list[dict[str, Any]]:
    res = client.get("/api/staples")
    assert res.status_code == 200, res.text
    rows: list[dict[str, Any]] = res.json()["staples"]
    return rows


def by_name(client: CsrfClient, name: str) -> dict[str, Any]:
    return next(s for s in staples(client) if s["name"] == name)


# --- acceptance ---------------------------------------------------------------------------


def test_ac_the_21st_staple_is_rejected(client: CsrfClient) -> None:
    signed_in(client)
    for i in range(20):
        assert add(client, food_id=food(client, f"Food {i}")).status_code == 201
    res = add(client, food_id=food(client, "One too many"))
    assert res.status_code == 422
    assert res.json()["detail"] == ("You can keep up to 20 staples. Remove one to add another.")
    body = client.get("/api/staples").json()
    assert (body["count"], body["limit"]) == (20, 20)
    # Removing one makes room again.
    assert client.delete(f"/api/staples/{body['staples'][0]['id']}").status_code == 204
    assert add(client, food_id=food(client, "Now it fits")).status_code == 201


def test_ac_the_trigger_rejects_a_21st_row_written_directly(
    client: CsrfClient, owner_engine: Engine
) -> None:
    email = signed_in(client)
    for i in range(20):
        assert add(client, food_id=food(client, f"Food {i}")).status_code == 201
    extra = food(client, "Sneaked in")
    uid = user_row(owner_engine, email).id
    with pytest.raises(DBAPIError, match="staples_limit"), owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO staples (id, user_id, food_id, unit_label, unit_grams, step_units, "
                "min_units, max_units) VALUES (gen_random_uuid(), :u, :f, '100 g', 100, 1, 1, 2)"
            ),
            {"u": uid, "f": extra},
        )


def test_ac_countable_units_default_to_1_to_4_in_steps_of_1(client: CsrfClient) -> None:
    signed_in(client)
    eggs = food(client, "Large egg", ("1 egg", 50))
    s = add(client, food_id=eggs).json()["staples"][0]
    assert (s["unit_label"], s["unit_grams"]) == ("1 egg", 50)
    assert (s["min_units"], s["max_units"], s["step_units"]) == (1, 4, 1)
    assert s["amounts"] == [1, 2, 3, 4]
    # 200 kcal per 100 g, so one 50 g egg is 100 kcal.
    assert s["per_unit"] == {"kcal": 100, "protein_g": 5, "carbs_g": 10, "fat_g": 4}


def test_other_units_default_to_half_to_3_in_steps_of_half(client: CsrfClient) -> None:
    signed_in(client)
    add(client, food_id=food(client, "Rice"))
    add(client, food_id=food(client, "Greek yogurt", ("1 cup (170 g)", 170)))
    rice, yogurt = staples(client)
    assert (rice["unit_label"], rice["unit_grams"]) == ("100 g", 100)
    assert rice["amounts"] == [0.5, 1, 1.5, 2, 2.5, 3]
    assert yogurt["unit_label"] == "1 cup (170 g)"
    assert yogurt["amounts"] == [0.5, 1, 1.5, 2, 2.5, 3]


# --- adding --------------------------------------------------------------------------------


def test_a_saved_meal_is_a_staple_of_one_meal(client: CsrfClient) -> None:
    signed_in(client)
    oats = food(client, "Oats")
    meal = client.post(
        "/api/meals", json={"name": "Breakfast bowl", "items": [{"food_id": oats, "grams": 150}]}
    ).json()
    s = add(client, saved_meal_id=meal["id"]).json()["staples"][0]
    assert (s["name"], s["unit_label"], s["unit_grams"]) == ("Breakfast bowl", "1 meal", None)
    assert s["per_unit"]["kcal"] == 300
    assert s["units"] == []
    assert s["amounts"] == [0.5, 1, 1.5, 2, 2.5, 3]


def test_a_food_can_start_in_another_of_its_units(client: CsrfClient) -> None:
    signed_in(client)
    bread = food(client, "Bread", ("1 slice", 30))
    s = add(client, food_id=bread, unit_label="100 g").json()["staples"][0]
    assert (s["unit_label"], s["amounts"][0]) == ("100 g", 0.5)
    assert [u["label"] for u in s["units"]] == ["100 g", "1 slice"]
    assert add(client, food_id=food(client, "Jam"), unit_label="1 jar").status_code == 422


def test_the_same_food_cannot_be_a_staple_twice(client: CsrfClient) -> None:
    signed_in(client)
    rice = food(client, "Rice")
    assert add(client, food_id=rice).status_code == 201
    res = add(client, food_id=rice)
    assert (res.status_code, res.json()["detail"]) == (422, "That is already a staple.")


def test_one_source_exactly(client: CsrfClient) -> None:
    signed_in(client)
    assert add(client).status_code == 422
    rice = food(client, "Rice")
    meal = client.post(
        "/api/meals", json={"name": "Rice bowl", "items": [{"food_id": rice, "grams": 150}]}
    ).json()
    assert add(client, food_id=rice, saved_meal_id=meal["id"]).status_code == 422


def test_unknown_food_or_meal_is_404(client: CsrfClient) -> None:
    signed_in(client)
    nobody = "00000000-0000-4000-8000-000000000000"
    assert add(client, food_id=nobody).status_code == 404
    assert add(client, saved_meal_id=nobody).status_code == 404


# --- editing ------------------------------------------------------------------------------


def test_availability_and_amounts_are_editable(client: CsrfClient) -> None:
    signed_in(client)
    s = add(client, food_id=food(client, "Rice")).json()["staples"][0]
    res = client.patch(
        f"/api/staples/{s['id']}",
        json={"is_available": False, "min_units": 1, "max_units": 2, "step_units": 0.25},
    )
    assert res.status_code == 200, res.text
    s = res.json()["staples"][0]
    assert s["is_available"] is False
    assert s["amounts"] == [1, 1.25, 1.5, 1.75, 2]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"min_units": 3, "max_units": 2}, "The largest amount must be at least the smallest."),
        ({"step_units": 0.7}, "The step must fit evenly between the smallest and largest amounts."),
        (
            {"min_units": 0.5, "max_units": 4, "step_units": 0.5},
            "Allow at most 7 amounts. Use a bigger step or a narrower range.",
        ),
    ],
)
def test_amounts_that_do_not_work_are_refused(
    client: CsrfClient, change: dict[str, float], message: str
) -> None:
    signed_in(client)
    s = add(client, food_id=food(client, "Rice")).json()["staples"][0]
    res = client.patch(f"/api/staples/{s['id']}", json=change)
    assert (res.status_code, res.json()["detail"]) == (422, message)


def test_a_new_unit_resets_the_amounts_to_its_defaults(client: CsrfClient) -> None:
    signed_in(client)
    s = add(client, food_id=food(client, "Bread", ("1 slice", 30)), unit_label="100 g").json()
    sid = s["staples"][0]["id"]
    s = client.patch(f"/api/staples/{sid}", json={"unit_label": "1 slice"}).json()["staples"][0]
    assert (s["unit_label"], s["unit_grams"], s["amounts"]) == ("1 slice", 30, [1, 2, 3, 4])
    # A meal has only one unit.
    meal = client.post(
        "/api/meals",
        json={"name": "Toast", "items": [{"food_id": s["food_id"], "grams": 60}]},
    ).json()
    m = add(client, saved_meal_id=meal["id"]).json()["staples"][1]
    assert (
        client.patch(f"/api/staples/{m['id']}", json={"unit_label": "1 slice"}).status_code == 422
    )


def test_food_group_is_one_of_the_23(client: CsrfClient) -> None:
    signed_in(client)
    s = add(client, food_id=food(client, "Rice")).json()["staples"][0]
    assert s["food_group"] is None
    res = client.patch(f"/api/staples/{s['id']}", json={"food_group": "rice_grains"})
    assert res.json()["staples"][0]["food_group"] == "rice_grains"
    assert client.patch(f"/api/staples/{s['id']}", json={"food_group": "candy"}).status_code == 422


def test_reorder_needs_every_staple_once(client: CsrfClient) -> None:
    signed_in(client)
    for name in ("Rice", "Eggs", "Milk"):
        add(client, food_id=food(client, name))
    ids = [s["id"] for s in staples(client)]
    res = client.put("/api/staples/order", json={"ids": ids[::-1]})
    assert res.status_code == 200, res.text
    assert [s["name"] for s in res.json()["staples"]] == ["Milk", "Eggs", "Rice"]
    assert client.put("/api/staples/order", json={"ids": ids[:2]}).status_code == 422
    assert client.put("/api/staples/order", json={"ids": [*ids[:2], ids[0]]}).status_code == 422
    nobody = "00000000-0000-4000-8000-000000000000"
    assert client.put("/api/staples/order", json={"ids": [*ids[:2], nobody]}).status_code == 404


def test_new_staples_go_last(client: CsrfClient) -> None:
    signed_in(client)
    for name in ("Rice", "Eggs"):
        add(client, food_id=food(client, name))
    ids = [s["id"] for s in staples(client)]
    client.put("/api/staples/order", json={"ids": ids[::-1]})
    add(client, food_id=food(client, "Milk"))
    assert [s["name"] for s in staples(client)] == ["Eggs", "Rice", "Milk"]


def test_a_deleted_food_leaves_a_missing_staple(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = food(client, "Rice")
    add(client, food_id=rice)
    with owner_engine.begin() as conn:
        conn.execute(text("UPDATE foods SET deleted_at = now() WHERE id = :f"), {"f": rice})
    (s,) = staples(client)
    assert (s["missing"], s["name"], s["per_unit"]["kcal"]) == (True, None, 0)


def test_deleting_a_staple_keeps_the_food(client: CsrfClient) -> None:
    signed_in(client)
    rice = food(client, "Rice")
    sid = add(client, food_id=rice).json()["staples"][0]["id"]
    assert client.delete(f"/api/staples/{sid}").status_code == 204
    assert client.delete(f"/api/staples/{sid}").status_code == 404
    # The food is still there: it can become a staple again.
    assert add(client, food_id=rice).status_code == 201


# --- "Add your 10 most-logged foods as staples?" ------------------------------------------


def log_days(owner_engine: Engine, uid: Any, foods: list[str], days: int) -> None:
    """One entry a day for `days` days, cycling through `foods`; the first food is logged
    most, so it is first in the prompt."""
    with owner_engine.begin() as conn:
        for n in range(days):
            on = date(2026, 10, 17) - timedelta(days=n)
            for f in foods[: 1 + n % len(foods)]:
                conn.execute(
                    text(
                        "INSERT INTO food_logs (id, user_id, food_id, log_group_id, eaten_at, "
                        "logged_on, name, grams, kcal, protein_g, carbs_g, fat_g, source) "
                        "VALUES (gen_random_uuid(), :u, :f, gen_random_uuid(), :at, :d, 'x', "
                        "100, 200, 10, 20, 8, 'search')"
                    ),
                    {"u": uid, "f": f, "at": datetime(on.year, on.month, on.day, 12), "d": on},
                )


def test_the_prompt_waits_for_14_days_of_logging(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    uid = user_row(owner_engine, email).id
    foods = [food(client, f"Food {i}") for i in range(12)]
    log_days(owner_engine, uid, foods, 13)
    assert client.get("/api/staples/prompt").json() == {"offer": False, "foods": []}
    log_days(owner_engine, uid, foods[:1], 14)
    prompt = client.get("/api/staples/prompt").json()
    assert prompt["offer"] is True
    assert len(prompt["foods"]) == 10
    assert prompt["foods"][0]["food_id"] == foods[0]


def test_yes_adds_the_10_most_logged_and_is_asked_once(
    client: CsrfClient, owner_engine: Engine
) -> None:
    email = signed_in(client)
    uid = user_row(owner_engine, email).id
    foods = [food(client, f"Food {i}") for i in range(12)]
    log_days(owner_engine, uid, foods, 14)
    top = [f["food_id"] for f in client.get("/api/staples/prompt").json()["foods"]]
    res = client.post("/api/staples/prompt", json={"accept": True})
    assert res.status_code == 200, res.text
    assert [s["food_id"] for s in res.json()["staples"]] == top
    assert client.get("/api/staples/prompt").json()["offer"] is False


def test_yes_stops_at_the_limit(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    uid = user_row(owner_engine, email).id
    for i in range(15):
        add(client, food_id=food(client, f"Kept {i}"))
    foods = [food(client, f"Food {i}") for i in range(10)]
    log_days(owner_engine, uid, foods, 14)
    body = client.post("/api/staples/prompt", json={"accept": True}).json()
    assert body["count"] == 20


def test_no_thanks_is_not_asked_again(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    uid = user_row(owner_engine, email).id
    log_days(owner_engine, uid, [food(client, "Rice")], 14)
    assert client.get("/api/staples/prompt").json()["offer"] is True
    body = client.post("/api/staples/prompt", json={"accept": False}).json()
    assert body["count"] == 0
    assert client.get("/api/staples/prompt").json()["offer"] is False


def test_needs_a_session(client: CsrfClient) -> None:
    assert client.get("/api/staples").status_code == 401


# --- the unit rules -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "countable"),
    [
        ("1 egg", True),
        ("1 large egg", True),
        ("1 bottle (500 ml)", True),
        ("2 slices", True),
        ("1 bar", True),
        ("100 g", False),
        ("250g", False),
        ("1 cup (240 ml)", False),
        ("1 tbsp", False),
        ("2 fl oz", False),
        ("1 serving", False),
        ("1 meal", False),
        ("", False),
    ],
)
def test_countable_units(label: str, countable: bool) -> None:
    assert rules.is_countable(label) is countable


def test_allowed_amounts_never_exceed_7() -> None:
    assert rules.allowed(rules.COUNTABLE) == [Decimal(n) for n in (1, 2, 3, 4)]
    assert len(rules.allowed(rules.MEASURED)) == 6
    wide = rules.Amounts(Decimal(1), Decimal(1), Decimal(8))
    assert rules.amounts_error(wide) is not None
    seven = rules.Amounts(Decimal(1), Decimal(1), Decimal(7))
    assert rules.amounts_error(seven) is None
