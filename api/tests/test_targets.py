"""Task 3.3: the Targets editor and the TDEE calculator page.
AC: editing calories recalculates carbs only; targets never change without the user tapping
"Use these targets" or saving an edit."""

from typing import Any

import pytest
from sqlalchemy import Engine

from tests.conftest import CsrfClient
from tests.helpers import user_row
from tests.test_setup import WORKED, body_stats, logged_in, targets

MAINTAIN = WORKED[0]["input"]  # 2,759 kcal: 141 P, 53 F, 430 C
LOSE = WORKED[1]["input"]  # 2,380 kcal: 168 P, 63 F, 286 C


def current(client: CsrfClient) -> dict[str, Any]:
    rows: list[dict[str, Any]] = client.get("/api/targets").json()
    return rows[0]


def test_editing_calories_recalculates_carbs_only(client: CsrfClient, owner_engine: Engine) -> None:
    email = logged_in(client)
    client.post("/api/targets/apply-calculation", json=MAINTAIN)

    res = client.post("/api/targets", json={"kcal": 2500, "protein_g": 141, "fat_g": 53})
    assert res.status_code == 201
    t = res.json()
    assert (t["kcal"], t["protein_g"], t["fat_g"], t["carbs_g"]) == (2500, 141, 53, 365)
    assert t["source"] == "custom"

    old, new = targets(owner_engine, email)
    assert (old.kcal, old.carbs_g, old.source) == (2759, 430, "calculator")
    assert (new.kcal, new.carbs_g, new.source) == (2500, 365, "custom")
    assert new.effective_from == old.effective_from


def test_carbs_the_user_typed_are_kept(client: CsrfClient) -> None:
    logged_in(client)
    client.post("/api/targets/apply-calculation", json=MAINTAIN)
    res = client.post(
        "/api/targets", json={"kcal": 2500, "protein_g": 150, "fat_g": 60, "carbs_g": 300}
    )
    t = res.json()
    assert (t["kcal"], t["protein_g"], t["fat_g"], t["carbs_g"]) == (2500, 150, 60, 300)


def test_carbs_clamp_at_zero_when_protein_and_fat_use_everything(client: CsrfClient) -> None:
    logged_in(client)
    client.post("/api/targets/apply-calculation", json=MAINTAIN)
    t = client.post("/api/targets", json={"kcal": 1000, "protein_g": 176, "fat_g": 66}).json()
    assert t["carbs_g"] == 0


def test_custom_row_keeps_the_formula_for_reset(client: CsrfClient) -> None:
    logged_in(client)
    client.post("/api/targets/apply-calculation", json={**LOSE, "deficit_kcal": 700})
    client.post("/api/targets", json={"kcal": 2200, "protein_g": 168, "fat_g": 63})
    t = current(client)
    assert t["source"] == "custom"
    assert t["carbs_g"] == 240
    assert t["formula"] == {
        "sex": "male",
        "age": 35,
        "weight_kg": 95,
        "height_cm": 188,
        "activity": "moderate",
        "plan": "lose",
        "deficit_kcal": 700,
    }
    assert (t["bmr"], t["tdee"]) == (1955, 3030)


def test_adjust_at_sign_up_saves_custom_targets_with_their_basis(client: CsrfClient) -> None:
    logged_in(client)
    client.patch("/api/me/body-stats", json=body_stats())
    assert client.get("/api/me").json()["setup"] == "targets"

    res = client.post(
        "/api/targets",
        json={"kcal": 2300, "protein_g": 170, "fat_g": 63, "basis": {**LOSE, "plan": "lose"}},
    )
    assert res.status_code == 201
    assert client.get("/api/me").json()["setup"] == "done"
    t = current(client)
    assert t["formula"]["plan"] == "lose"
    assert t["formula"]["weight_kg"] == 95
    assert t["tdee"] == 3030


def test_custom_targets_without_any_formula(client: CsrfClient) -> None:
    logged_in(client)
    t = client.post("/api/targets", json={"kcal": 2000, "protein_g": 120, "fat_g": 60}).json()
    assert t["formula"] is None
    assert t["carbs_g"] == (2000 - 480 - 540) / 4


def test_history_is_newest_first(client: CsrfClient) -> None:
    logged_in(client)
    client.post("/api/targets/apply-calculation", json=MAINTAIN)
    client.post("/api/targets", json={"kcal": 2500, "protein_g": 141, "fat_g": 53})
    client.post("/api/targets/apply-calculation", json=MAINTAIN)
    rows = client.get("/api/targets").json()
    assert [r["source"] for r in rows] == ["calculator", "custom", "calculator"]
    assert rows[0]["formula"]["plan"] == "maintain"
    # Maintain stores no deficit; reset offers the default chip if the user switches to Lose.
    assert rows[0]["formula"]["deficit_kcal"] == 650


@pytest.mark.parametrize(
    "body",
    [
        {"kcal": 499, "protein_g": 100, "fat_g": 50},
        {"kcal": 10001, "protein_g": 100, "fat_g": 50},
        {"kcal": 2000, "protein_g": -1, "fat_g": 50},
        {"kcal": 2000, "protein_g": 100, "fat_g": 1501},
        {"kcal": 2000, "protein_g": 100, "fat_g": 50, "carbs_g": -5},
        {"kcal": 2000, "protein_g": 100},
        {"kcal": 2000, "protein_g": 100, "fat_g": 50, "basis": {**MAINTAIN, "age": 12}},
    ],
)
def test_out_of_range_edits_are_refused(client: CsrfClient, body: dict[str, Any]) -> None:
    logged_in(client)
    client.post("/api/targets/apply-calculation", json=MAINTAIN)
    assert client.post("/api/targets", json=body).status_code == 422
    assert len(client.get("/api/targets").json()) == 1


def test_targets_never_change_on_their_own(client: CsrfClient, owner_engine: Engine) -> None:
    """Only "Use these targets" and saving an edit add rows. Weigh-ins, previews and body
    stats leave the targets alone (SPEC page 3, "Never automatic")."""
    email = logged_in(client)
    client.post("/api/targets/apply-calculation", json=MAINTAIN)
    before = [tuple(r) for r in targets(owner_engine, email)]

    client.post("/api/weights", json={"kg": 75.0})
    client.post("/api/weights", json={"kg": 74.0})
    client.post("/api/tdee/calculate", json={**MAINTAIN, "weight_kg": 74})
    client.patch("/api/me/body-stats", json=body_stats(activity_level="athlete"))
    client.get("/api/targets")

    assert [tuple(r) for r in targets(owner_engine, email)] == before


def test_custom_targets_need_a_session(client: CsrfClient) -> None:
    body = {"kcal": 2000, "protein_g": 100, "fat_g": 50}
    assert client.post("/api/targets", json=body).status_code == 401


def test_user_id_in_the_body_is_ignored(client: CsrfClient, owner_engine: Engine) -> None:
    email = logged_in(client)
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    other_email = logged_in(other)
    other_id = str(user_row(owner_engine, other_email).id)

    client.post(
        "/api/targets",
        json={"kcal": 2000, "protein_g": 100, "fat_g": 50, "user_id": other_id},
    )
    assert len(targets(owner_engine, email)) == 1
    assert targets(owner_engine, other_email) == []
