"""Task 3.14: GET /api/foods/fits-my-macros. AC: the worked example ranks chicken 0.60,
yogurt 0.35, peanut butter 0.28, rice 0.27 (the scoring itself is in test_fit.py)."""

from datetime import UTC, datetime
from typing import Any

import pytest

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.test_logs import log, signed_in

NOON = "2026-10-17T12:00:00-04:00"


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def food(
    client: CsrfClient,
    name: str,
    per100: tuple[float, float, float, float],
    serving: tuple[str, float],
) -> str:
    kcal, p, c, f = per100
    res = client.post(
        "/api/foods",
        json={
            "name": name,
            "per": "100g",
            "kcal": kcal,
            "protein_g": p,
            "carbs_g": c,
            "fat_g": f,
            "serving_label": serving[0],
            "serving_grams": serving[1],
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def fits(client: CsrfClient, **params: str) -> dict[str, Any]:
    res = client.get("/api/foods/fits-my-macros", params=params)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def worked_example(client: CsrfClient) -> None:
    """2,300 / 150 / 250 / 70 targets with 2,000 / 110 / 225 / 62 eaten: 300 kcal, 40 P,
    25 C, 8 F left, as in SPEC page 3."""
    signed_in(client)
    res = client.post(
        "/api/targets", json={"kcal": 2300, "protein_g": 150, "fat_g": 70, "carbs_g": 250}
    )
    assert res.status_code == 201
    eaten = {"quick": {"kcal": 2000, "protein_g": 110, "carbs_g": 225, "fat_g": 62}}
    assert log(client, NOON, eaten).status_code == 201
    food(client, "Chicken breast", (165, 31, 0, 3.6), ("1 portion", 120))
    food(client, "Greek yogurt 0%", (59, 10.19, 3.6, 0.39), ("1 pot", 200))
    food(client, "Peanut butter", (588, 25, 20, 50), ("2 tbsp", 32))
    food(client, "Cooked rice", (130, 2.7, 28.2, 0.3), ("1 bowl", 150))
    food(client, "Olive oil", (884, 0, 0, 100), ("1 tbsp", 14))


def test_ac_the_worked_example_ranks_in_order(client: CsrfClient) -> None:
    worked_example(client)
    body = fits(client)
    assert body["has_target"] is True
    assert body["remaining"] == {"kcal": 300, "protein_g": 40, "carbs_g": 25, "fat_g": 8}
    got = [(r["food"]["name"], r["score"], r["label"]) for r in body["results"]]
    assert got == [
        ("Chicken breast", 0.60, "Great fit"),
        ("Greek yogurt 0%", 0.35, "Partial fit"),
        ("Peanut butter", 0.28, "Partial fit"),
        ("Cooked rice", 0.27, "Partial fit"),
    ]
    chicken = body["results"][0]
    assert chicken["serving"] == {"grams": 120, "quantity": 1, "unit_label": "1 portion"}
    assert chicken["fits_up_to_g"] == 180
    assert chicken["overflows"] == []
    assert body["results"][2]["overflows"] == ["fat_g"]
    # Olive oil (all fat, far past 8 g left) scores below 0.25 and is hidden.
    assert "Olive oil" not in {r["food"]["name"] for r in body["results"]}


def test_saved_meals_are_scored_on_their_totals(client: CsrfClient) -> None:
    worked_example(client)
    chicken = next(
        r["food"]["id"] for r in fits(client)["results"] if r["food"]["name"] == "Chicken breast"
    )
    meal = client.post(
        "/api/meals",
        json={"name": "Chicken snack", "items": [{"food_id": chicken, "grams": 120}]},
    ).json()
    meals = [r for r in fits(client)["results"] if r["kind"] == "meal"]
    assert [(m["meal_name"], m["score"], m["meal_items"]) for m in meals] == [
        ("Chicken snack", 0.60, 1)
    ]
    # Archived meals are left out.
    client.patch(f"/api/meals/{meal['id']}", json={"archived": True})
    assert [r for r in fits(client)["results"] if r["kind"] == "meal"] == []


def test_no_target_means_no_sort(client: CsrfClient) -> None:
    signed_in(client)
    assert fits(client) == {
        "date": "2026-10-17",
        "has_target": False,
        "remaining": None,
        "results": [],
    }


def test_another_day_uses_the_target_in_effect_then(client: CsrfClient) -> None:
    worked_example(client)
    # The targets start on the 17th, so the 16th has none and no sort.
    assert fits(client, on="2026-10-16")["has_target"] is False
    assert fits(client, on="2026-10-17")["remaining"]["kcal"] == 300


def test_only_your_own_foods(client: CsrfClient) -> None:
    worked_example(client)
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    signed_in(other)
    other.post("/api/targets", json={"kcal": 2300, "protein_g": 150, "fat_g": 70, "carbs_g": 250})
    assert fits(other)["results"] == []
