"""Task 3.6: edit, delete, move and copy.
AC: moving a card updates both blocks' subtotals."""

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import Engine

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import seed_food_rows, user_row
from tests.test_logs import day, log, shared_food, signed_in

FOUR_PM = "2026-10-17T16:00:00-04:00"
SEVEN_PM = "2026-10-17T19:00:00-04:00"


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    # 19:30 on 17 Oct in New York.
    fakes.clock.now = datetime(2026, 10, 17, 23, 30, tzinfo=UTC)


def blocks(client: CsrfClient, on: str = "2026-10-17") -> dict[str, float]:
    """kcal per eaten_at, the subtotals the Today blocks show."""
    out: dict[str, float] = {}
    for e in day(client, on):
        out[e["eaten_at"]] = round(out.get(e["eaten_at"], 0) + e["kcal"], 2)
    return out


def setup_day(client: CsrfClient, owner_engine: Engine) -> tuple[list[Any], list[Any]]:
    signed_in(client)
    rice = shared_food(owner_engine)  # 130 kcal / 100 g
    four = log(
        client, FOUR_PM, {"food_id": rice, "grams": 100}, {"food_id": rice, "grams": 200}
    ).json()
    seven = log(client, SEVEN_PM, {"food_id": rice, "grams": 50}).json()
    return four, seven


# --- acceptance ---------------------------------------------------------------------------


def test_moving_a_card_updates_both_blocks(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    assert blocks(client) == {"2026-10-17T20:00:00Z": 390.0, "2026-10-17T23:00:00Z": 65.0}

    res = client.post("/api/logs/move", json={"ids": [four[1]["id"]], "eaten_at": SEVEN_PM})
    assert res.status_code == 200
    assert blocks(client) == {"2026-10-17T20:00:00Z": 130.0, "2026-10-17T23:00:00Z": 325.0}


def test_editing_the_time_moves_the_card(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    res = client.patch(f"/api/logs/{four[0]['id']}", json={"eaten_at": SEVEN_PM})
    assert res.status_code == 200
    assert res.json()["eaten_at"] == "2026-10-17T23:00:00Z"
    assert blocks(client) == {"2026-10-17T20:00:00Z": 260.0, "2026-10-17T23:00:00Z": 195.0}


def test_moving_to_another_day_changes_logged_on(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    ids = [e["id"] for e in four]
    moved = client.post(
        "/api/logs/move", json={"ids": ids, "eaten_at": "2026-10-16T08:00:00-04:00"}
    ).json()
    assert {m["logged_on"] for m in moved} == {"2026-10-16"}
    assert len(day(client, "2026-10-16")) == 2
    assert len(day(client, "2026-10-17")) == 1


# --- amounts --------------------------------------------------------------------------------


def test_new_grams_scale_the_snapshot(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    e = client.patch(f"/api/logs/{four[0]['id']}", json={"grams": 150}).json()
    assert (e["grams"], e["kcal"], e["carbs_g"]) == (150, 195, 42.3)
    assert e["fiber_g"] is None  # unknown stays unknown


def test_new_quantity_keeps_the_serving_unit(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    own = seed_food_rows(owner_engine, user_row(owner_engine, email).id)  # 1 jar = 250 g
    [e] = log(
        client, FOUR_PM, {"food_id": str(own["food_id"]), "quantity": 1, "unit_label": "1 jar"}
    ).json()
    e = client.patch(f"/api/logs/{e['id']}", json={"quantity": 1.5}).json()
    assert (e["quantity"], e["unit_label"], e["grams"], e["kcal"]) == (1.5, "1 jar", 375, 562.5)
    # Switching to grams drops the unit.
    e = client.patch(f"/api/logs/{e['id']}", json={"grams": 100}).json()
    assert (e["quantity"], e["unit_label"], e["grams"], e["kcal"]) == (None, None, 100, 150)


def test_quantity_on_a_grams_entry_is_refused(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    assert client.patch(f"/api/logs/{four[0]['id']}", json={"quantity": 2}).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"grams": 0},
        {"grams": 5001},
        {"grams": 10, "quantity": 1},
        {"eaten_at": "2026-10-18T09:00:00-04:00"},
        {"eaten_at": "2026-10-17T16:00:00"},
    ],
)
def test_bad_edits_change_nothing(
    client: CsrfClient, owner_engine: Engine, body: dict[str, Any]
) -> None:
    four, _ = setup_day(client, owner_engine)
    before = day(client, "2026-10-17")
    assert client.patch(f"/api/logs/{four[0]['id']}", json=body).status_code == 422
    assert day(client, "2026-10-17") == before


# --- delete and undo --------------------------------------------------------------------------


def test_delete_and_restore(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    gone = four[0]["id"]
    assert client.delete(f"/api/logs/{gone}").status_code == 204
    assert gone not in [e["id"] for e in day(client, "2026-10-17")]
    assert client.patch(f"/api/logs/{gone}", json={"grams": 10}).status_code == 404
    assert client.delete(f"/api/logs/{gone}").status_code == 404

    res = client.post(f"/api/logs/{gone}/restore")
    assert res.status_code == 200
    assert gone in [e["id"] for e in day(client, "2026-10-17")]
    assert client.post(f"/api/logs/{gone}/restore").status_code == 404


# --- copy -----------------------------------------------------------------------------------


def test_copy_a_block_to_today_at_a_chosen_time(client: CsrfClient, owner_engine: Engine) -> None:
    signed_in(client)
    rice = shared_food(owner_engine)
    yesterday = log(
        client,
        "2026-10-16T12:30:00-04:00",
        {"food_id": rice, "grams": 100},
        {"food_id": rice, "grams": 40, "source": "recent"},
    ).json()

    res = client.post(
        "/api/logs/copy",
        json={"ids": [e["id"] for e in yesterday], "eaten_at": "2026-10-17T13:00:00-04:00"},
    )
    assert res.status_code == 201
    copies = res.json()
    assert len(copies) == 2
    assert {c["logged_on"] for c in copies} == {"2026-10-17"}
    assert len({c["log_group_id"] for c in copies}) == 1
    assert copies[0]["log_group_id"] != yesterday[0]["log_group_id"]
    assert [c["kcal"] for c in copies] == [e["kcal"] for e in yesterday]
    assert [c["source"] for c in copies] == ["search", "recent"]
    # The originals stay where they were.
    assert len(day(client, "2026-10-16")) == 2


def test_duplicate_is_a_copy_at_the_same_time(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    client.post("/api/logs/copy", json={"ids": [four[0]["id"]], "eaten_at": FOUR_PM})
    assert blocks(client)["2026-10-17T20:00:00Z"] == 520.0


# --- all or nothing, and other users -------------------------------------------------------


def test_an_unknown_id_moves_nothing(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    before = blocks(client)
    stranger = "0190a000-0000-7000-8000-000000000000"
    for path in ("/api/logs/move", "/api/logs/copy"):
        res = client.post(path, json={"ids": [four[0]["id"], stranger], "eaten_at": SEVEN_PM})
        assert res.status_code == 404
    assert blocks(client) == before


def test_another_users_entries_are_404(client: CsrfClient, owner_engine: Engine) -> None:
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    signed_in(other)
    rice = shared_food(owner_engine)
    [theirs] = log(other, FOUR_PM, {"food_id": rice, "grams": 100}).json()

    signed_in(client)
    tid = theirs["id"]
    assert client.patch(f"/api/logs/{tid}", json={"grams": 1}).status_code == 404
    assert client.delete(f"/api/logs/{tid}").status_code == 404
    assert client.post(f"/api/logs/{tid}/restore").status_code == 404
    assert (
        client.post("/api/logs/move", json={"ids": [tid], "eaten_at": SEVEN_PM}).status_code == 404
    )
    assert (
        client.post("/api/logs/copy", json={"ids": [tid], "eaten_at": SEVEN_PM}).status_code == 404
    )
    assert day(client, "2026-10-17") == []
    [still] = day(other, "2026-10-17")
    assert (still["grams"], still["eaten_at"]) == (100, "2026-10-17T20:00:00Z")


def test_move_and_copy_refuse_tomorrow(client: CsrfClient, owner_engine: Engine) -> None:
    four, _ = setup_day(client, owner_engine)
    for path in ("/api/logs/move", "/api/logs/copy"):
        res = client.post(
            path, json={"ids": [four[0]["id"]], "eaten_at": "2026-10-18T08:00:00-04:00"}
        )
        assert res.status_code == 422
