"""Task 2.2: weight log CRUD. Isolation for these endpoints lives in test_isolation.py."""

from typing import Any

import pytest

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import log_in, sign_up


@pytest.fixture
def user(client: CsrfClient) -> CsrfClient:
    """Signed in, timezone America/New_York (UTC-4 in October)."""
    assert log_in(client, sign_up(client)).status_code == 200
    return client


def add(c: CsrfClient, **body: Any) -> Any:
    return c.post("/api/weights", json=body)


def test_add_defaults_to_now_and_local_day(user: CsrfClient, fakes: Fakes) -> None:
    res = add(user, kg=80.0)
    assert res.status_code == 201
    w = res.json()
    assert w["kg"] == 80.0
    assert w["measured_at"].startswith("2026-10-17T12:00:00")
    assert w["day"] == "2026-10-17"
    assert w["note"] is None


def test_day_is_the_users_local_date(user: CsrfClient) -> None:
    # 02:30 UTC on the 17th is 22:30 on the 16th in New York.
    w = add(user, kg=80.0, measured_at="2026-10-17T02:30:00Z").json()
    assert w["day"] == "2026-10-16"


def test_pounds_round_trip_at_gram_precision(user: CsrfClient) -> None:
    kg = 176.4 * 0.45359237
    w = add(user, kg=kg).json()
    assert w["kg"] == 80.014
    assert round(w["kg"] / 0.45359237, 1) == 176.4


@pytest.mark.parametrize("kg", [29.9, 300.1])
def test_weight_out_of_range_is_rejected(user: CsrfClient, kg: float) -> None:
    assert add(user, kg=kg).status_code == 422


def test_future_time_is_rejected_but_small_clock_skew_is_fine(user: CsrfClient) -> None:
    assert add(user, kg=80, measured_at="2026-10-17T12:04:00Z").status_code == 201
    res = add(user, kg=80, measured_at="2026-10-17T13:00:00Z")
    assert res.status_code == 422
    assert res.json()["detail"] == "That time is in the future."


def test_naive_times_are_rejected(user: CsrfClient) -> None:
    assert add(user, kg=80, measured_at="2026-10-17T07:00:00").status_code == 422


def test_list_is_oldest_first_and_filters_by_local_date(user: CsrfClient) -> None:
    add(user, kg=79.0, measured_at="2026-10-15T11:00:00Z")
    add(user, kg=81.0, measured_at="2026-10-01T11:00:00Z")
    add(user, kg=80.0, measured_at="2026-10-10T11:00:00Z")
    days = [w["day"] for w in user.get("/api/weights").json()]
    assert days == ["2026-10-01", "2026-10-10", "2026-10-15"]
    some = user.get("/api/weights", params={"from": "2026-10-05", "to": "2026-10-10"}).json()
    assert [w["kg"] for w in some] == [80.0]


def test_edit_changes_only_what_is_sent(user: CsrfClient) -> None:
    w = add(user, kg=80.0, note="after run").json()
    res = user.patch(f"/api/weights/{w['id']}", json={"kg": 79.6})
    assert res.status_code == 200
    assert (res.json()["kg"], res.json()["note"]) == (79.6, "after run")
    moved = user.patch(
        f"/api/weights/{w['id']}", json={"measured_at": "2026-10-16T11:00:00Z", "note": None}
    ).json()
    assert (moved["day"], moved["kg"], moved["note"]) == ("2026-10-16", 79.6, None)


def test_delete_hides_the_entry_and_restore_brings_it_back(user: CsrfClient) -> None:
    w = add(user, kg=80.0).json()
    assert user.delete(f"/api/weights/{w['id']}").status_code == 204
    assert user.get("/api/weights").json() == []
    assert user.patch(f"/api/weights/{w['id']}", json={"kg": 70}).status_code == 404
    assert user.delete(f"/api/weights/{w['id']}").status_code == 404

    res = user.post(f"/api/weights/{w['id']}/restore")
    assert res.status_code == 200
    assert [x["id"] for x in user.get("/api/weights").json()] == [w["id"]]
    assert user.post(f"/api/weights/{w['id']}/restore").status_code == 404


def test_unknown_ids_are_404(user: CsrfClient) -> None:
    missing = "0192f0c4-0000-7000-8000-000000000000"
    assert user.patch(f"/api/weights/{missing}", json={"kg": 70}).status_code == 404
    assert user.delete(f"/api/weights/{missing}").status_code == 404
    assert user.post(f"/api/weights/{missing}/restore").status_code == 404


def test_body_stats_latest_weight_follows_the_log(user: CsrfClient) -> None:
    add(user, kg=80.0, measured_at="2026-10-16T11:00:00Z")
    latest = add(user, kg=79.2).json()
    assert user.get("/api/me/body-stats").json()["latest_weight_kg"] == 79.2
    user.delete(f"/api/weights/{latest['id']}")
    assert user.get("/api/me/body-stats").json()["latest_weight_kg"] == 80.0
