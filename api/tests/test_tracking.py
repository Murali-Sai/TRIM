"""Task 3.13: water and fiber. AC: 2,759 kcal gives 39 g fiber (the fl oz conversion is in the
browser, which shows ml as fl oz; the API stores ml only)."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.tdee import fiber_default
from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.isolation.registry import BODY_STATS, WORKED
from tests.test_logs import signed_in

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "fiber_vectors.json").read_text()
)["cases"]


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)  # 7 PM in New York


# --- fiber -----------------------------------------------------------------------------------


def test_ac_2759_kcal_gives_39_g_fiber() -> None:
    assert fiber_default(2759) == 39


@pytest.mark.parametrize("case", VECTORS, ids=lambda c: str(c["kcal"]))
def test_fiber_default_vectors(case: dict[str, int]) -> None:
    assert fiber_default(case["kcal"]) == case["fiber_g"]


def latest_target(client: CsrfClient) -> dict[str, Any]:
    rows: list[dict[str, Any]] = client.get("/api/targets").json()
    return rows[0]


def test_calculator_targets_get_the_fiber_default(client: CsrfClient) -> None:
    signed_in(client)
    assert client.patch("/api/me/body-stats", json=BODY_STATS).status_code == 200
    res = client.post("/api/targets/apply-calculation", json=WORKED)
    assert res.status_code == 201
    body = res.json()
    assert body["fiber_g"] == fiber_default(body["kcal"])
    assert body["water_ml"] is None  # water has no default


def test_custom_targets_keep_fiber_and_water(client: CsrfClient) -> None:
    signed_in(client)
    edit = {"kcal": 2759, "protein_g": 150, "fat_g": 80}
    assert client.post("/api/targets", json=edit).json()["fiber_g"] == 39
    set_both = client.post("/api/targets", json={**edit, "fiber_g": 35, "water_ml": 2500})
    assert (set_both.json()["fiber_g"], set_both.json()["water_ml"]) == (35, 2500)
    # Water and a fiber target the user set carry over when not sent; null turns water off.
    again = client.post("/api/targets", json={**edit, "kcal": 2000}).json()
    assert (again["fiber_g"], again["water_ml"]) == (35, 2500)
    assert client.post("/api/targets", json={**edit, "water_ml": None}).json()["water_ml"] is None
    assert client.post("/api/targets", json={**edit, "water_ml": 100}).status_code == 422


def test_fiber_follows_calories_until_the_user_sets_it(client: CsrfClient) -> None:
    signed_in(client)
    edit = {"protein_g": 150, "fat_g": 80}
    assert client.post("/api/targets", json={**edit, "kcal": 2759}).json()["fiber_g"] == 39
    assert client.post("/api/targets", json={**edit, "kcal": 2000}).json()["fiber_g"] == 28


# --- settings --------------------------------------------------------------------------------


def test_settings_default_and_change(client: CsrfClient) -> None:
    signed_in(client)
    assert client.get("/api/me/settings").json() == {
        "track_water": False,
        "track_fiber": True,
        "water_unit": "ml",
        "gamification": True,
    }
    res = client.patch("/api/me/settings", json={"track_water": True, "water_unit": "fl_oz"})
    on = {"track_water": True, "track_fiber": True, "water_unit": "fl_oz", "gamification": True}
    assert res.json() == on
    res = client.patch("/api/me/settings", json={"track_fiber": False, "gamification": False})
    assert res.json() == {**on, "track_fiber": False, "gamification": False}
    assert client.get("/api/me/settings").json()["track_fiber"] is False
    assert client.patch("/api/me/settings", json={"water_unit": "cups"}).status_code == 422


# --- water -----------------------------------------------------------------------------------


def test_water_adds_sum_per_local_day_and_undo(client: CsrfClient, fakes: Fakes) -> None:
    signed_in(client)
    a = client.post("/api/water", json={"ml": 250})
    assert a.status_code == 201, a.text
    assert a.json()["logged_on"] == "2026-10-17"
    client.post("/api/water", json={"ml": 500})
    # 23:30 in New York on the 17th is the 18th in UTC; still the 17th for this user.
    late = client.post("/api/water", json={"ml": 237, "logged_at": "2026-10-18T03:30:00Z"})
    assert late.status_code == 422  # later than now
    fakes.clock.now = datetime(2026, 10, 18, 3, 40, tzinfo=UTC)
    late = client.post("/api/water", json={"ml": 237, "logged_at": "2026-10-18T03:30:00Z"})
    assert late.json()["logged_on"] == "2026-10-17"

    day = client.get("/api/water", params={"date_from": "2026-10-17"}).json()
    assert [w["ml"] for w in day] == [250, 500, 237]
    days = client.get(
        "/api/water/days", params={"date_from": "2026-10-01", "date_to": "2026-10-31"}
    ).json()
    assert days == [{"date": "2026-10-17", "ml": 987}]

    assert client.delete(f"/api/water/{a.json()['id']}").status_code == 204
    assert client.delete(f"/api/water/{a.json()['id']}").status_code == 404
    days = client.get(
        "/api/water/days", params={"date_from": "2026-10-17", "date_to": "2026-10-17"}
    ).json()
    assert days == [{"date": "2026-10-17", "ml": 737}]


def test_water_amounts_and_ranges_are_checked(client: CsrfClient) -> None:
    signed_in(client)
    for bad in (0, -5, 5001):
        assert client.post("/api/water", json={"ml": bad}).status_code == 422
    res = client.get("/api/water/days", params={"date_from": "2026-10-17", "date_to": "2026-10-01"})
    assert res.status_code == 422


def test_another_users_water_is_404(client: CsrfClient) -> None:
    signed_in(client)
    mine = client.post("/api/water", json={"ml": 250}).json()["id"]
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    signed_in(other)
    assert other.delete(f"/api/water/{mine}").status_code == 404
    assert other.get("/api/water", params={"date_from": "2026-10-17"}).json() == []
