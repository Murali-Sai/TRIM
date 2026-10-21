"""Task 4.1: measurement types and entries; presets copied per user at sign-up.
AC: renaming one user's preset does not affect another."""

from datetime import UTC, datetime
from typing import Any

import pytest

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import log_in, sign_up
from tests.test_logs import signed_in

NOBODY = "00000000-0000-4000-8000-000000000000"


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def types(client: CsrfClient, **params: str) -> list[dict[str, Any]]:
    res = client.get("/api/measurement-types", params=params)
    assert res.status_code == 200, res.text
    rows: list[dict[str, Any]] = res.json()
    return rows


def by_name(client: CsrfClient, name: str, side: str | None = None) -> dict[str, Any]:
    return next(t for t in types(client) if t["name"] == name and t["side"] == side)


def log(client: CsrfClient, *items: dict[str, Any], at: str | None = None) -> Any:
    body: dict[str, Any] = {"items": list(items)}
    if at:
        body["measured_at"] = at
    return client.post("/api/measurements", json=body)


# --- presets ------------------------------------------------------------------------------


def test_sign_up_copies_the_presets_switched_off(client: CsrfClient) -> None:
    email = sign_up(client, unit_system="metric")
    assert log_in(client, email).status_code == 200
    rows = types(client)
    names = [(t["name"], t["side"]) for t in rows]
    assert names == [
        ("Waist", None),
        ("Hips", None),
        ("Chest", None),
        ("Neck", None),
        ("Upper arm", "left"),
        ("Upper arm", "right"),
        ("Thigh", "left"),
        ("Thigh", "right"),
        ("Body fat", None),
    ]
    assert all(t["is_preset"] and not t["is_active"] for t in rows)
    arm = [t for t in rows if t["name"] == "Upper arm"]
    assert arm[0]["pair_id"] == arm[1]["pair_id"] is not None
    assert by_name(client, "Waist")["unit"] == "cm"
    assert by_name(client, "Body fat")["unit"] == "%"


def test_an_imperial_account_gets_inches(client: CsrfClient) -> None:
    email = sign_up(client, unit_system="imperial")
    assert log_in(client, email).status_code == 200
    assert by_name(client, "Waist")["unit"] == "in"
    assert by_name(client, "Body fat")["unit"] == "%"


def test_ac_renaming_one_users_preset_does_not_affect_another(client: CsrfClient) -> None:
    signed_in(client)
    waist = by_name(client, "Waist")
    res = client.patch(f"/api/measurement-types/{waist['id']}", json={"name": "Belly"})
    assert res.status_code == 200, res.text
    assert types(client)[0]["name"] == "Belly"
    client.post("/api/auth/logout")
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    signed_in(other)
    assert types(other)[0]["name"] == "Waist"
    # And B cannot touch A's copy at all.
    assert (
        other.patch(f"/api/measurement-types/{waist['id']}", json={"name": "X"}).status_code == 404
    )


# --- managing metrics ---------------------------------------------------------------------


def test_create_a_metric_and_a_pair(client: CsrfClient) -> None:
    signed_in(client)
    res = client.post("/api/measurement-types", json={"name": "Calf", "unit": "cm", "paired": True})
    assert res.status_code == 201, res.text
    calf = [t for t in res.json() if t["name"] == "Calf"]
    assert [t["side"] for t in calf] == ["left", "right"]
    assert calf[0]["pair_id"] == calf[1]["pair_id"]
    assert all(t["is_active"] and not t["is_preset"] for t in calf)
    mood = client.post("/api/measurement-types", json={"name": "Energy", "unit": "text"})
    assert mood.status_code == 201
    dup = client.post("/api/measurement-types", json={"name": "  waist ", "unit": "cm"})
    assert (dup.status_code, dup.json()["detail"]) == (
        422,
        'You already have a metric called "waist".',
    )


def test_a_pair_is_renamed_and_archived_together(client: CsrfClient) -> None:
    signed_in(client)
    left = by_name(client, "Thigh", "left")
    client.patch(f"/api/measurement-types/{left['id']}", json={"name": "Quad", "is_active": True})
    quad = [t for t in types(client) if t["name"] == "Quad"]
    assert [t["side"] for t in quad] == ["left", "right"]
    assert all(t["is_active"] for t in quad)
    client.patch(f"/api/measurement-types/{quad[1]['id']}", json={"archived": True})
    assert [t["name"] for t in types(client, archived="true")] == ["Quad", "Quad"]
    assert "Quad" not in [t["name"] for t in types(client, archived="false")]


def test_archiving_keeps_history(client: CsrfClient) -> None:
    signed_in(client)
    waist = by_name(client, "Waist")
    assert log(client, {"type_id": waist["id"], "value": 90}).status_code == 201
    client.patch(f"/api/measurement-types/{waist['id']}", json={"archived": True})
    readings = client.get("/api/measurements", params={"type_id": waist["id"]}).json()
    assert [r["value"] for r in readings] == [90]
    res = log(client, {"type_id": waist["id"], "value": 89})
    assert (res.status_code, res.json()["detail"]) == (422, "Restore this metric to add readings.")
    # Restoring brings it back with its readings.
    client.patch(f"/api/measurement-types/{waist['id']}", json={"archived": False})
    back = by_name(client, "Waist")
    assert (back["archived_at"], back["entries"], back["latest"]["value"]) == (None, 1, 90)


def test_units_switch_only_within_a_kind_once_there_are_readings(client: CsrfClient) -> None:
    signed_in(client)
    waist = by_name(client, "Waist")
    assert (
        client.patch(f"/api/measurement-types/{waist['id']}", json={"unit": "%"}).status_code == 200
    )
    client.patch(f"/api/measurement-types/{waist['id']}", json={"unit": "cm"})
    log(client, {"type_id": waist["id"], "value": 90})
    assert (
        client.patch(f"/api/measurement-types/{waist['id']}", json={"unit": "in"}).status_code
        == 200
    )
    bad = client.patch(f"/api/measurement-types/{waist['id']}", json={"unit": "kg"})
    assert bad.status_code == 422


def test_reorder(client: CsrfClient) -> None:
    signed_in(client)
    ids = [t["id"] for t in types(client)]
    res = client.put("/api/measurement-types/order", json={"ids": ids[::-1]})
    assert res.status_code == 200
    assert res.json()[0]["name"] == "Body fat"
    assert client.put("/api/measurement-types/order", json={"ids": [NOBODY]}).status_code == 404


# --- readings -----------------------------------------------------------------------------


def test_quick_log_several_at_once(client: CsrfClient) -> None:
    signed_in(client)
    left, right = by_name(client, "Upper arm", "left"), by_name(client, "Upper arm", "right")
    fat = by_name(client, "Body fat")
    res = log(
        client,
        {"type_id": left["id"], "value": 33.25},
        {"type_id": right["id"], "value": 33.5},
        {"type_id": fat["id"], "value": 18.4, "note": "scale"},
        at="2026-10-17T08:00:00-04:00",
    )
    assert res.status_code == 201, res.text
    rows = res.json()
    assert [r["value"] for r in rows] == [33.25, 33.5, 18.4]
    assert {r["measured_at"] for r in rows} == {"2026-10-17T12:00:00Z"}
    assert by_name(client, "Body fat")["latest"]["value"] == 18.4


@pytest.mark.parametrize(
    ("name", "value", "ok"),
    [("Waist", 0.5, False), ("Waist", 401, False), ("Waist", 85.2, True), ("Body fat", 101, False)],
)
def test_ranges(client: CsrfClient, name: str, value: float, ok: bool) -> None:
    signed_in(client)
    res = log(client, {"type_id": by_name(client, name)["id"], "value": value})
    assert (res.status_code == 201) is ok


def test_text_metrics_take_text(client: CsrfClient) -> None:
    signed_in(client)
    t = client.post("/api/measurement-types", json={"name": "Energy", "unit": "text"}).json()
    energy = next(x for x in t if x["name"] == "Energy")
    assert log(client, {"type_id": energy["id"], "value": 3}).status_code == 422
    assert log(client, {"type_id": energy["id"], "value_text": "Good"}).status_code == 201
    waist = by_name(client, "Waist")
    assert log(client, {"type_id": waist["id"], "value_text": "Good"}).status_code == 422
    assert log(client, {"type_id": waist["id"]}).status_code == 422


def test_readings_by_day_in_the_users_timezone(client: CsrfClient) -> None:
    signed_in(client)
    waist = by_name(client, "Waist")["id"]
    # 23:30 in New York on 16 Oct is already 17 Oct in UTC.
    log(client, {"type_id": waist, "value": 91}, at="2026-10-16T23:30:00-04:00")
    log(client, {"type_id": waist, "value": 90}, at="2026-10-17T07:00:00-04:00")
    day16 = client.get(
        "/api/measurements", params={"date_from": "2026-10-16", "date_to": "2026-10-16"}
    ).json()
    assert [r["value"] for r in day16] == [91]


def test_a_reading_cannot_be_in_the_future(client: CsrfClient) -> None:
    signed_in(client)
    waist = by_name(client, "Waist")["id"]
    res = log(client, {"type_id": waist, "value": 90}, at="2026-10-18T12:00:00Z")
    assert res.status_code == 422


def test_edit_and_delete_a_reading(client: CsrfClient) -> None:
    signed_in(client)
    waist = by_name(client, "Waist")["id"]
    r = log(client, {"type_id": waist, "value": 90}).json()[0]
    res = client.patch(f"/api/measurements/{r['id']}", json={"value": 89.5, "note": "after run"})
    assert (res.json()["value"], res.json()["note"]) == (89.5, "after run")
    assert client.patch(f"/api/measurements/{r['id']}", json={"value": 0.2}).status_code == 422
    assert client.delete(f"/api/measurements/{r['id']}").status_code == 204
    assert client.delete(f"/api/measurements/{r['id']}").status_code == 404
    assert client.patch(f"/api/measurements/{NOBODY}", json={"value": 80}).status_code == 404


def test_another_users_metric_is_404(client: CsrfClient) -> None:
    signed_in(client)
    assert log(client, {"type_id": NOBODY, "value": 90}).status_code == 404
    assert client.get("/api/measurements", params={"type_id": NOBODY}).status_code == 404


def test_needs_a_session(client: CsrfClient) -> None:
    assert client.get("/api/measurement-types").status_code == 401


def test_four_weeks_in_a_row_earns_the_measurement_badge(client: CsrfClient) -> None:
    signed_in(client)
    waist = by_name(client, "Waist")["id"]
    for day in ("2026-09-22", "2026-09-29", "2026-10-06"):
        log(client, {"type_id": waist, "value": 90}, at=f"{day}T12:00:00Z")
    badges = {b["key"]: b for b in client.get("/api/badges").json()}
    assert badges["measurements_4"]["earned_at"] is None
    log(client, {"type_id": waist, "value": 89.5}, at="2026-10-13T12:00:00Z")
    badges = {b["key"]: b for b in client.get("/api/badges").json()}
    assert badges["measurements_4"]["earned_at"] is not None


def test_an_active_metric_makes_the_measurement_goal_possible(client: CsrfClient) -> None:
    signed_in(client)
    # Presets start switched off, so nothing is tracked yet.
    assert "measurement" not in [g["kind"] for g in client.get("/api/goals").json()["goals"]]
