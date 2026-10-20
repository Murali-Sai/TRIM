"""Task 1.6b: body stats and targets at sign-up.
AC: the three SPEC worked examples store exactly those targets; the first weight entry is
created."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import log_in, sign_up

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "tdee_vectors.json").read_text()
)
WORKED = [c for c in VECTORS["calculate"] if c["name"].startswith("SPEC worked example")]


def logged_in(client: CsrfClient) -> str:
    email = sign_up(client)
    assert log_in(client, email, keep_signed_in=True).status_code == 200
    return email


def body_stats(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "sex": "male",
        "age": 35,
        "height_cm": 188,
        "activity_level": "moderate",
        "unit_system": "metric",
        "weight_kg": 95,
    }
    body.update(overrides)
    return body


def calc_body(case_input: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {**case_input, **extra}


def weights(owner_engine: Engine, email: str) -> list[Any]:
    with owner_engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    "SELECT w.kg, w.measured_at FROM weight_entries w "
                    "JOIN users u ON u.id = w.user_id WHERE u.email = :e"
                ),
                {"e": email},
            )
        )


def targets(owner_engine: Engine, email: str) -> list[Any]:
    with owner_engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    "SELECT t.* FROM targets t JOIN users u ON u.id = t.user_id "
                    "WHERE u.email = :e ORDER BY t.created_at"
                ),
                {"e": email},
            )
        )


# --- acceptance ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", WORKED, ids=[c["name"] for c in WORKED])
def test_worked_examples_store_exactly_those_targets(
    client: CsrfClient, owner_engine: Engine, case: dict[str, Any]
) -> None:
    email = logged_in(client)
    i = case["input"]
    stats = body_stats(
        sex=i["sex"],
        age=i["age"],
        height_cm=i["height_cm"],
        activity_level=i["activity"],
        weight_kg=i["weight_kg"],
    )
    assert client.patch("/api/me/body-stats", json=stats).status_code == 200

    preview = client.post("/api/tdee/calculate", json=i)
    assert preview.status_code == 200
    applied = client.post("/api/targets/apply-calculation", json=i)
    assert applied.status_code == 201

    e = case["expect"]
    for res in (preview.json(), applied.json()):
        assert res["kcal" if "kcal" in res else "target_kcal"] == e["target_kcal"]
        assert (res["protein_g"], res["fat_g"], res["carbs_g"]) == (
            e["protein_g"],
            e["fat_g"],
            e["carbs_g"],
        )
    [row] = targets(owner_engine, email)
    assert (row.kcal, row.protein_g, row.fat_g, row.carbs_g) == (
        e["target_kcal"],
        e["protein_g"],
        e["fat_g"],
        e["carbs_g"],
    )
    assert row.bmr == e["bmr"]
    assert row.tdee == e["tdee"]
    assert row.source == "calculator"
    assert row.calc_inputs["plan"] == e["plan"]
    assert row.calc_inputs["rule_set"] == e["rule_set"]
    assert row.calc_inputs["bmi"] == e["bmi"]
    assert row.calc_inputs["floor_applied"] is False

    [w] = weights(owner_engine, email)
    assert float(w.kg) == i["weight_kg"]


# --- body stats ---------------------------------------------------------------------------


def test_first_weight_entry_is_created_once(client: CsrfClient, owner_engine: Engine) -> None:
    email = logged_in(client)
    client.patch("/api/me/body-stats", json=body_stats(weight_kg=800 / 10))
    # Going back during sign-up to fix a typo corrects that entry rather than adding one.
    client.patch("/api/me/body-stats", json=body_stats(weight_kg=80.014))
    [w] = weights(owner_engine, email)
    assert float(w.kg) == 80.014  # 176.4 lb keeps its precision


def test_after_setup_body_stats_never_touch_weights(
    client: CsrfClient, owner_engine: Engine
) -> None:
    email = logged_in(client)
    client.patch("/api/me/body-stats", json=body_stats(weight_kg=95))
    client.post("/api/targets/apply-calculation", json=WORKED[1]["input"])
    client.patch("/api/me/body-stats", json=body_stats(weight_kg=90))
    [w] = weights(owner_engine, email)
    assert float(w.kg) == 95


def test_body_stats_round_trip(client: CsrfClient) -> None:
    logged_in(client)
    client.patch("/api/me/body-stats", json=body_stats(height_cm=180.34, unit_system="imperial"))
    assert client.get("/api/me/body-stats").json() == {
        "sex": "male",
        "age": 35,
        "height_cm": 180.3,
        "activity_level": "moderate",
        "unit_system": "imperial",
        "latest_weight_kg": 95.0,
        "goal_weight_kg": None,
    }
    assert client.get("/api/me").json()["unit_system"] == "imperial"


def test_age_is_current_a_year_later(client: CsrfClient, fakes: Fakes) -> None:
    email = sign_up(client)
    client.post("/api/auth/verify", json={"token": fakes.outbox.sent[-1].link_token()})
    log_in(client, email)
    client.patch("/api/me/body-stats", json=body_stats(age=35))
    fakes.clock.advance(days=366)
    log_in(client, email)
    assert client.get("/api/me/body-stats").json()["age"] == 36


def test_unverified_after_7_days_cannot_use_setup(client: CsrfClient, fakes: Fakes) -> None:
    logged_in(client)
    fakes.clock.advance(days=7)
    res = client.patch("/api/me/body-stats", json=body_stats())
    assert res.status_code == 403
    assert res.json()["detail"] == "Confirm your email to keep using TRIM."


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("age", 17),
        ("age", 101),
        ("height_cm", 119),
        ("height_cm", 231),
        ("weight_kg", 29.9),
        ("weight_kg", 300.1),
        ("sex", "other"),
        ("activity_level", "couch"),
    ],
)
def test_body_stats_out_of_range(client: CsrfClient, field: str, value: Any) -> None:
    logged_in(client)
    assert client.patch("/api/me/body-stats", json=body_stats(**{field: value})).status_code == 422


# --- calculator and targets ---------------------------------------------------------------


def test_calculate_has_no_side_effects(client: CsrfClient, owner_engine: Engine) -> None:
    email = logged_in(client)
    case = WORKED[1]["input"]
    assert client.post("/api/tdee/calculate", json=case).status_code == 200
    assert targets(owner_engine, email) == []
    assert weights(owner_engine, email) == []


def test_deficit_must_be_a_chip_value(client: CsrfClient) -> None:
    logged_in(client)
    res = client.post("/api/tdee/calculate", json={**WORKED[1]["input"], "deficit_kcal": 625})
    assert res.status_code == 422


def test_user_choice_of_maintain_and_deficit_is_respected(
    client: CsrfClient, owner_engine: Engine, fakes: Fakes
) -> None:
    email = logged_in(client)
    base = WORKED[1]["input"]
    client.post("/api/targets/apply-calculation", json={**base, "plan": "maintain"})
    fakes.clock.advance(minutes=5)
    client.post("/api/targets/apply-calculation", json={**base, "deficit_kcal": 700})
    kcal = [r.kcal for r in targets(owner_engine, email)]
    assert kcal == [3030, 2330]
    history = client.get("/api/targets").json()
    assert [t["kcal"] for t in history] == [2330, 3030]  # newest first


def test_effective_from_is_the_users_local_day(
    client: CsrfClient, fakes: Fakes, owner_engine: Engine
) -> None:
    # 03:00 UTC on 17 Oct is still 16 Oct in New York (the test user's timezone).
    fakes.clock.now = datetime(2026, 10, 17, 3, 0, tzinfo=UTC)
    email = logged_in(client)
    client.post("/api/targets/apply-calculation", json=WORKED[0]["input"])
    [row] = targets(owner_engine, email)
    assert row.effective_from.isoformat() == "2026-10-16"


def test_setup_step_moves_from_body_stats_to_targets_to_done(client: CsrfClient) -> None:
    logged_in(client)
    assert client.get("/api/me").json()["setup"] == "body_stats"
    client.patch("/api/me/body-stats", json=body_stats())
    assert client.get("/api/me").json()["setup"] == "targets"
    client.post("/api/targets/apply-calculation", json=WORKED[1]["input"])
    assert client.get("/api/me").json()["setup"] == "done"


def test_endpoints_need_a_session(client: CsrfClient) -> None:
    assert client.get("/api/me/body-stats").status_code == 401
    assert client.patch("/api/me/body-stats", json=body_stats()).status_code == 401
    assert client.post("/api/tdee/calculate", json=WORKED[0]["input"]).status_code == 401
    assert client.post("/api/targets/apply-calculation", json=WORKED[0]["input"]).status_code == 401
    assert client.get("/api/targets").status_code == 401


def test_users_see_only_their_own_targets(client: CsrfClient) -> None:
    logged_in(client)
    client.post("/api/targets/apply-calculation", json=WORKED[0]["input"])
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    logged_in(other)
    assert other.get("/api/targets").json() == []
    assert other.get("/api/me/body-stats").json()["latest_weight_kg"] is None
