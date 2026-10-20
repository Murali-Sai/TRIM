"""Task 3.16 through the API. AC: a user not tracking water never gets the water goal; each
badge is awarded once."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.test_streaks import at, entry, signed_in

MON = date(2026, 10, 12)


def get(client: CsrfClient, fakes: Fakes, now: datetime, path: str) -> Any:
    fakes.clock.now = now.astimezone(UTC)
    res = client.get(path)
    assert res.status_code == 200, res.text
    return res.json()


def badges(owner_engine: Engine, uid: Any) -> list[str]:
    with owner_engine.connect() as conn:
        return list(
            conn.execute(
                text("SELECT badge FROM user_badges WHERE user_id = :u ORDER BY badge"), {"u": uid}
            ).scalars()
        )


def target(client: CsrfClient) -> None:
    res = client.post("/api/targets", json={"kcal": 2000, "protein_g": 150, "fat_g": 60})
    assert res.status_code == 201


def test_ac_no_water_goal_for_a_user_not_tracking_water(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    fakes.clock.now = at(MON, 8).astimezone(UTC)
    signed_in(client, owner_engine)
    target(client)
    client.post("/api/weights", json={"kg": 80})
    seen: set[str] = set()
    for week in range(20):
        g = get(client, fakes, at(MON + timedelta(weeks=week), 9), "/api/goals")
        kinds = [x["kind"] for x in g["goals"]]
        assert kinds[0] == "log_food"
        assert len(kinds) == 3
        seen |= set(kinds)
    assert "water" not in seen
    assert {"protein", "calories", "weigh_in"} <= seen


def test_water_joins_the_pool_once_tracked(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    fakes.clock.now = at(MON, 8).astimezone(UTC)
    signed_in(client, owner_engine)
    client.patch("/api/me/settings", json={"track_water": True})
    seen: set[str] = set()
    for week in range(20):
        g = get(client, fakes, at(MON + timedelta(weeks=week), 9), "/api/goals")
        seen |= {x["kind"] for x in g["goals"]}
    assert "water" in seen


def test_goals_are_set_once_a_week_and_show_progress(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    fakes.clock.now = at(MON, 8).astimezone(UTC)
    uid = signed_in(client, owner_engine)
    first = get(client, fakes, at(MON, 9), "/api/goals")
    for n in range(5):
        d = MON + timedelta(days=n)
        entry(owner_engine, uid, d, at(d))
    later = get(client, fakes, at(MON + timedelta(days=4), 21), "/api/goals")
    assert [x["kind"] for x in later["goals"]] == [x["kind"] for x in first["goals"]]
    log_food = later["goals"][0]
    assert (log_food["text"], log_food["done"], log_food["needed"], log_food["complete"]) == (
        "Log food on 5 of 7 days",
        5,
        5,
        True,
    )


def test_a_perfect_week_and_badges_are_awarded_once(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    fakes.clock.now = at(MON, 8).astimezone(UTC)
    uid = signed_in(client, owner_engine)
    # No targets and no water: the goals are log food and weigh in.
    g = get(client, fakes, at(MON, 9), "/api/goals")
    assert [x["kind"] for x in g["goals"]] == ["log_food", "weigh_in"]
    for n in range(7):
        d = MON + timedelta(days=n)
        entry(owner_engine, uid, d, at(d))
    for n in (0, 2, 4):
        fakes.clock.now = at(MON + timedelta(days=n), 7).astimezone(UTC)
        assert client.post("/api/weights", json={"kg": 80}).status_code == 201
    client.post(
        "/api/meals",
        json={"name": "Usual", "items": [{"food_id": _a_food(client), "grams": 100}]},
    )
    g = get(client, fakes, at(MON + timedelta(days=6), 21), "/api/goals")
    assert g["perfect"] is True
    assert g["perfect_weeks"] == 1
    assert badges(owner_engine, uid) == ["first_saved_meal", "streak_7"]

    listed = get(client, fakes, at(MON + timedelta(days=6), 22), "/api/badges")
    earned = {b["key"]: b["earned_at"] for b in listed if b["earned_at"]}
    assert set(earned) == {"first_saved_meal", "streak_7"}
    locked = next(b for b in listed if b["key"] == "streak_30")
    assert (locked["earned_at"], locked["how"]) == (None, "Log food 30 days in a row.")

    # Asking again, next week or after a broken streak, never awards a badge twice.
    get(client, fakes, at(MON + timedelta(days=8), 9), "/api/badges")
    get(client, fakes, at(MON + timedelta(days=12), 9), "/api/badges")
    assert badges(owner_engine, uid) == ["first_saved_meal", "streak_7"]
    assert (
        get(client, fakes, at(MON + timedelta(days=12), 10), "/api/badges")[0]["earned_at"]
        == (earned["streak_7"])
    )


def _a_food(client: CsrfClient) -> str:
    res = client.post(
        "/api/foods",
        json={
            "name": "Oats",
            "per": "100g",
            "kcal": 380,
            "protein_g": 13,
            "carbs_g": 60,
            "fat_g": 7,
        },
    )
    return str(res.json()["id"])


def test_another_users_goals_and_badges_stay_theirs(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    fakes.clock.now = at(MON, 8).astimezone(UTC)
    uid = signed_in(client, owner_engine)
    for n in range(7):
        d = MON + timedelta(days=n)
        entry(owner_engine, uid, d, at(d))
    get(client, fakes, at(MON + timedelta(days=6), 21), "/api/badges")
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    signed_in(other, owner_engine)
    mine = other.get("/api/badges").json()
    assert all(b["earned_at"] is None for b in mine)
