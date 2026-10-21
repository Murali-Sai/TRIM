"""Task 3.20: POST /api/suggestions over the user's own staples. The optimizer itself is tested
in test_suggest_engine.py; here the worked example runs end to end, with the empty states and
the ownership rules."""

from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import user_row
from tests.test_logs import signed_in

DAY = date(2026, 10, 17)
NOBODY = "00000000-0000-4000-8000-000000000000"


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def target(owner_engine: Engine, uid: Any, kcal: int = 2300) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO targets (id, user_id, effective_from, kcal, protein_g, carbs_g, "
                "fat_g, source) VALUES (gen_random_uuid(), :u, '2026-10-01', :k, 150, 280, 65, "
                "'custom')"
            ),
            {"u": uid, "k": kcal},
        )


def eaten(owner_engine: Engine, uid: Any, kcal: float, p: float, c: float, f: float) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO food_logs (id, user_id, log_group_id, eaten_at, logged_on, name, "
                "kcal, protein_g, carbs_g, fat_g, source) VALUES (gen_random_uuid(), :u, "
                "gen_random_uuid(), '2026-10-17T16:00:00Z', :d, 'Earlier', :k, :p, :c, :f, "
                "'quick_add')"
            ),
            {"u": uid, "d": DAY, "k": kcal, "p": p, "c": c, "f": f},
        )


def food(
    client: CsrfClient, name: str, per: tuple[float, float, float, float], serving: tuple[str, int]
) -> str:
    """A custom food entered per serving, as on a label."""
    kcal, p, c, f = per
    res = client.post(
        "/api/foods",
        json={
            "name": name,
            "per": "serving",
            "serving_label": serving[0],
            "serving_grams": serving[1],
            "kcal": kcal,
            "protein_g": p,
            "carbs_g": c,
            "fat_g": f,
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def staple(client: CsrfClient, food_id: str, *, unit: str | None = None, **patch: Any) -> str:
    body: dict[str, Any] = {"food_id": food_id}
    if unit:
        body["unit_label"] = unit
    res = client.post("/api/staples", json=body)
    assert res.status_code == 201, res.text
    sid = next(s["id"] for s in res.json()["staples"] if s["food_id"] == food_id)
    if patch:
        assert client.patch(f"/api/staples/{sid}", json=patch).status_code == 200
    return str(sid)


def worked_example(client: CsrfClient, owner_engine: Engine) -> tuple[dict[str, str], Any]:
    """SPEC page 3: 900 kcal, 60 P, 100 C, 25 F left, six staples."""
    email = signed_in(client)
    uid = user_row(owner_engine, email).id
    target(owner_engine, uid)
    eaten(owner_engine, uid, 1400, 90, 180, 40)
    up_to_2: dict[str, Any] = {"min_units": 0.5, "max_units": 2, "step_units": 0.5}
    ids = {
        "chicken": staple(client, food(client, "Chicken", (165, 31, 0, 3.6), ("100 g", 100))),
        "rice": staple(client, food(client, "Rice", (130, 2.7, 28.2, 0.3), ("100 g", 100))),
        "egg": staple(client, food(client, "Egg", (72, 6.3, 0.4, 4.8), ("1 egg", 50))),
        "yogurt": staple(
            client, food(client, "Yogurt", (100, 17.3, 6.1, 0.7), ("1 cup", 100)), **up_to_2
        ),
        "banana": staple(
            client,
            food(client, "Banana", (105, 1.3, 27, 0.4), ("1 banana", 100)),
            min_units=1,
            max_units=2,
            step_units=1,
        ),
        "pb": staple(
            client, food(client, "Peanut butter", (94, 4, 3.1, 8.2), ("1 tbsp", 20)), **up_to_2
        ),
    }
    return ids, uid


def ask(client: CsrfClient, **body: Any) -> dict[str, Any]:
    res = client.post("/api/suggestions", json=body)
    assert res.status_code == 200, res.text
    out: dict[str, Any] = res.json()
    return out


def plates(out: dict[str, Any], ids: dict[str, str]) -> list[dict[str, float]]:
    name = {v: k for k, v in ids.items()}
    return [{name[i["staple_id"]]: i["units"] for i in x["items"]} for x in out["suggestions"]]


def test_ac_worked_example_end_to_end(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    out = ask(client)
    assert out["state"] == "ok"
    assert out["budget"] == {"kcal": 900, "protein_g": 60, "carbs_g": 100, "fat_g": 25}
    assert plates(out, ids) == [
        {"rice": 3, "egg": 4, "yogurt": 1.5},
        {"chicken": 1.5, "rice": 3, "pb": 2},
        {"chicken": 1, "rice": 3, "egg": 4},
    ]
    assert [x["match_pct"] for x in out["suggestions"]] == [97.5, 97.2, 97.0]
    first = out["suggestions"][0]
    assert first["totals"]["kcal"] == 828
    assert first["leaves"] == {"kcal": 72, "protein_g": 0.75, "carbs_g": 4.65, "fat_g": 3.85}
    rice = first["items"][0]
    assert (rice["name"], rice["unit_label"], rice["grams"], rice["kcal"]) == (
        "Rice",
        "100 g",
        300,
        390,
    )


def test_shuffle_returns_the_next_three(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    first = ask(client)
    shown = [[i["staple_id"] for i in x["items"]] for x in first["suggestions"]]
    nxt = ask(client, exclude_sets=shown)
    assert nxt["state"] == "ok"
    assert not {frozenset(p) for p in plates(nxt, ids)} & {frozenset(p) for p in plates(first, ids)}


def test_no_more_combinations(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    shown: list[list[str]] = []
    for _ in range(30):
        out = ask(client, exclude_sets=shown)
        if out["state"] != "ok":
            break
        shown += [[i["staple_id"] for i in x["items"]] for x in out["suggestions"]]
    assert out["state"] == "no_more"
    assert out["message"] == (
        "No more good combinations. Try allowing more items or turning a staple back on."
    )
    assert len({frozenset(s) for s in shown}) == len(shown)
    assert ids


def test_budget_modes(client: CsrfClient, owner_engine: Engine) -> None:
    worked_example(client, owner_engine)
    half = ask(client, budget={"mode": "fraction", "fraction": 0.5})
    assert half["budget"] == {"kcal": 450, "protein_g": 30, "carbs_g": 50, "fat_g": 12.5}
    typed = ask(client, budget={"mode": "kcal", "kcal": 300})
    assert typed["budget"]["kcal"] == 300
    assert typed["budget"]["protein_g"] == 20
    for x in typed["suggestions"]:
        assert x["totals"]["kcal"] <= 315
    bad = client.post("/api/suggestions", json={"budget": {"mode": "fraction"}})
    assert bad.status_code == 422


def test_excluded_off_and_locked_staples(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    out = ask(client, excluded_staple_ids=[ids["rice"]])
    assert all("rice" not in p for p in plates(out, ids))
    client.patch(f"/api/staples/{ids['egg']}", json={"is_available": False})
    out = ask(client)
    assert all("egg" not in p for p in plates(out, ids))
    out = ask(client, locked=[{"staple_id": ids["banana"], "units": 2}])
    assert out["suggestions"]
    assert all(p.get("banana") == 2 for p in plates(out, ids))
    off = client.post("/api/suggestions", json={"locked": [{"staple_id": ids["egg"]}]})
    assert off.status_code == 422
    odd = client.post("/api/suggestions", json={"locked": [{"staple_id": ids["egg"], "units": 7}]})
    assert odd.status_code == 422


def test_another_users_staple_is_404(client: CsrfClient, owner_engine: Engine) -> None:
    worked_example(client, owner_engine)
    res = client.post("/api/suggestions", json={"locked": [{"staple_id": NOBODY}]})
    assert res.status_code == 404


def test_max_items(client: CsrfClient, owner_engine: Engine) -> None:
    worked_example(client, owner_engine)
    one = ask(client, max_items=1)
    assert all(len(x["items"]) == 1 for x in one["suggestions"])
    assert client.post("/api/suggestions", json={"max_items": 6}).status_code == 422


# --- empty states -------------------------------------------------------------------------


def test_no_target(client: CsrfClient) -> None:
    signed_in(client)
    out = ask(client)
    assert (out["state"], out["message"]) == ("no_target", "Set your targets to get suggestions.")


def test_needs_two_staples(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    target(owner_engine, user_row(owner_engine, email).id)
    staple(client, food(client, "Rice", (130, 2.7, 28.2, 0.3), ("100 g", 100)))
    out = ask(client)
    assert (out["state"], out["message"]) == (
        "need_staples",
        "Add at least 2 staples to get suggestions.",
    )


@pytest.mark.parametrize(
    ("kcal", "state", "message"),
    [
        (2300, "target_reached", "You've reached today's calorie target."),
        (2500, "target_reached", "You've reached today's calorie target."),
        (2250, "within_100", "You're within 100 kcal of your target."),
    ],
)
def test_near_or_past_the_target(
    client: CsrfClient, owner_engine: Engine, kcal: float, state: str, message: str
) -> None:
    _, uid = worked_example(client, owner_engine)
    # 1,400 kcal is logged already; log the rest so `kcal` is eaten in all.
    eaten(owner_engine, uid, kcal - 1400, 0, 0, 0)
    out = ask(client)
    assert (out["state"], out["message"]) == (state, message)
    assert out["suggestions"] == []


def test_nothing_fits_within_5_percent(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    uid = user_row(owner_engine, email).id
    target(owner_engine, uid)
    eaten(owner_engine, uid, 2000, 140, 250, 55)
    staple(client, food(client, "Pizza", (800, 30, 90, 35), ("1 pizza", 400)))
    staple(client, food(client, "Burger", (700, 35, 50, 40), ("1 burger", 300)))
    out = ask(client)
    assert (out["state"], out["message"]) == (
        "no_fit",
        "No combination fits within 5% of your calories. "
        "Try allowing more items or smaller amounts.",
    )


def test_needs_a_session(client: CsrfClient) -> None:
    assert client.post("/api/suggestions", json={}).status_code == 401


# --- logging and saving a suggestion (task 3.21) ------------------------------------------

AT = "2026-10-17T19:30:00-04:00"


def first_plate(client: CsrfClient) -> list[dict[str, Any]]:
    out = ask(client)
    return [
        {"staple_id": i["staple_id"], "units": i["units"]} for i in out["suggestions"][0]["items"]
    ]


def test_ac_logging_a_suggestion_is_one_time_block(
    client: CsrfClient, owner_engine: Engine
) -> None:
    worked_example(client, owner_engine)
    res = client.post("/api/suggestions/log", json={"eaten_at": AT, "items": first_plate(client)})
    assert res.status_code == 201, res.text
    rows = res.json()
    assert len(rows) == 3
    assert {r["log_group_id"] for r in rows} == {rows[0]["log_group_id"]}
    assert {r["source"] for r in rows} == {"suggestion"}
    assert [r["name"] for r in rows] == ["Rice", "Egg", "Yogurt"]
    assert round(sum(r["kcal"] for r in rows)) == 828
    rice, egg, yogurt = rows
    assert (rice["grams"], rice["quantity"], rice["unit_label"]) == (300, None, None)
    assert (egg["grams"], egg["quantity"], egg["unit_label"]) == (200, 4, "1 egg")
    assert (yogurt["grams"], yogurt["quantity"]) == (150, 1.5)
    # It is on the day, at 7:30 PM, like any other block.
    day = client.get("/api/logs", params={"date_from": "2026-10-17"}).json()
    assert sum(1 for r in day if r["source"] == "suggestion") == 3


def test_a_meal_staple_logs_its_items(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    oats = food(client, "Oats", (150, 5, 27, 3), ("100 g", 100))
    meal = client.post(
        "/api/meals", json={"name": "Oat bowl", "items": [{"food_id": oats, "grams": 80}]}
    ).json()
    res = client.post("/api/staples", json={"saved_meal_id": meal["id"]})
    bowl = next(s["id"] for s in res.json()["staples"] if s["saved_meal_id"] == meal["id"])
    res = client.post(
        "/api/suggestions/log",
        json={
            "eaten_at": AT,
            "items": [{"staple_id": bowl, "units": 1.5}, {"staple_id": ids["egg"], "units": 2}],
        },
    )
    assert res.status_code == 201, res.text
    oat, egg = res.json()
    assert (oat["name"], oat["grams"], oat["saved_meal_id"]) == ("Oats", 120, meal["id"])
    assert oat["kcal"] == 180
    assert egg["saved_meal_id"] is None
    assert client.get(f"/api/meals/{meal['id']}").json()["use_count"] == 1


def test_save_a_suggestion_as_a_meal(client: CsrfClient, owner_engine: Engine) -> None:
    worked_example(client, owner_engine)
    res = client.post(
        "/api/suggestions/save-meal", json={"name": "Rice plate", "items": first_plate(client)}
    )
    assert res.status_code == 201, res.text
    meal = res.json()
    assert [(i["name"], i["grams"]) for i in meal["items"]] == [
        ("Rice", 300),
        ("Egg", 200),
        ("Yogurt", 150),
    ]
    assert round(meal["totals"]["kcal"]) == 828
    again = client.post(
        "/api/suggestions/save-meal", json={"name": "rice plate", "items": first_plate(client)}
    )
    assert again.status_code == 422


def test_logging_needs_your_own_staples_once(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    other = client.post(
        "/api/suggestions/log",
        json={"eaten_at": AT, "items": [{"staple_id": NOBODY, "units": 1}]},
    )
    assert other.status_code == 404
    twice = client.post(
        "/api/suggestions/log",
        json={
            "eaten_at": AT,
            "items": [{"staple_id": ids["egg"], "units": 1}, {"staple_id": ids["egg"], "units": 2}],
        },
    )
    assert twice.status_code == 422
    later = client.post(
        "/api/suggestions/log",
        json={"eaten_at": "2026-10-19T12:00:00Z", "items": [{"staple_id": ids["egg"], "units": 1}]},
    )
    assert later.status_code == 422
