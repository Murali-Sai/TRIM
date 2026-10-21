"""Task 5.2: JSON import. AC: export, then import into an empty account, gives identical counts
and checksums."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, text

from app import importer
from app.routers import imports
from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import log_in, seed_food_rows, sign_up, user_row
from tests.test_export import seed
from tests.test_logs import shared_food

COMPARED = [
    "food_log",
    "daily_totals",
    "saved_meals",
    "staples",
    "weight",
    "measurements",
    "water",
    "targets",
    "phases",
    "custom_foods",
    "profile",
]


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def new_account(client: CsrfClient, **kw: Any) -> CsrfClient:
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    email = sign_up(other, **kw)
    assert log_in(other, email).status_code == 200
    return other


def export_json(c: CsrfClient, fakes: Fakes) -> dict[str, Any]:
    res = c.post("/api/export", json={"format": "json"})
    assert res.status_code == 200, res.text
    fakes.clock.now += timedelta(minutes=2)
    doc: dict[str, Any] = json.loads(res.content)
    return doc


def post(c: CsrfClient, doc: Any) -> Any:
    body = doc if isinstance(doc, bytes) else json.dumps(doc).encode()
    return c.post("/api/import", content=body, headers={"Content-Type": "application/json"})


@pytest.fixture
def full(client: CsrfClient, owner_engine: Engine) -> CsrfClient:
    """An account with something in every dataset, including a log of a shared food."""
    email = sign_up(client, timezone="America/New_York", unit_system="imperial")
    assert log_in(client, email).status_code == 200
    uid = user_row(owner_engine, email).id
    seed_food_rows(owner_engine, uid)
    seed(owner_engine, email)
    rice = shared_food(owner_engine)
    with owner_engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO food_logs (id, user_id, food_id, log_group_id, eaten_at, logged_on, "
                "name, grams, kcal, protein_g, carbs_g, fat_g, source) VALUES "
                "(gen_random_uuid(), :u, :f, gen_random_uuid(), '2026-10-15T17:00:00Z', "
                "'2026-10-15', 'White rice, cooked', 150, 195, 4, 42, 0.5, 'search')"
            ),
            {"u": uid, "f": rice},
        )
    return client


def test_ac_export_import_export_matches(full: CsrfClient, fakes: Fakes) -> None:
    before = export_json(full, fakes)
    fresh = new_account(full)
    res = post(fresh, before)
    assert res.status_code == 200, res.text
    counts = res.json()["imported"]
    assert counts["food_log"] == len(before["datasets"]["food_log"]) == 4
    assert counts["custom_foods"] == 2 and counts["saved_meals"] == 1 and counts["staples"] == 3
    after = export_json(fresh, fakes)
    a = importer.checksums(before["datasets"])
    b = importer.checksums(after["datasets"])
    for key in COMPARED:
        assert a[key] == b[key], key
    # Ids are new, so the file could be imported next to the account it came from.
    old = {r["id"] for r in before["datasets"]["food_log"]}
    assert not old & {r["id"] for r in after["datasets"]["food_log"]}
    # The badge keeps its date.
    assert after["datasets"]["streaks"]["badges"][0]["earned_at"].startswith("2026-10-10")


def test_only_into_an_empty_account(full: CsrfClient, fakes: Fakes) -> None:
    doc = export_json(full, fakes)
    res = post(full, doc)
    assert res.status_code == 409
    assert res.json()["detail"].startswith("Import works into an empty account")


def test_presets_and_setup_targets_give_way(
    full: CsrfClient, fakes: Fakes, owner_engine: Engine
) -> None:
    doc = export_json(full, fakes)
    fresh = new_account(full)
    fresh.post("/api/targets", json={"kcal": 2400, "protein_g": 150, "fat_g": 70})
    assert post(fresh, doc).status_code == 200
    targets = fresh.get("/api/targets").json()
    assert [t["kcal"] for t in targets] == [165]  # the file's, not the one set after sign-up
    names = [t["name"] for t in fresh.get("/api/measurement-types").json()]
    assert names.count("Waist") == 1


def test_a_missing_shared_food_keeps_the_log(client: CsrfClient, owner_engine: Engine) -> None:
    fresh = new_account(client)
    doc = {
        "format": "trim-export",
        "version": 1,
        "datasets": {
            "food_log": [
                {
                    "food_id": "00000000-0000-4000-8000-0000000000aa",
                    "log_group_id": "00000000-0000-4000-8000-0000000000bb",
                    "eaten_at": "2026-10-15T17:00:00Z",
                    "logged_on": "2026-10-15",
                    "name": "Something from another server",
                    "grams": 100,
                    "kcal": 120,
                    "protein_g": 1,
                    "carbs_g": 2,
                    "fat_g": 3,
                    "source": "search",
                }
            ]
        },
    }
    res = post(fresh, doc)
    assert res.status_code == 200, res.text
    logs = fresh.get("/api/logs", params={"date_from": "2026-10-15", "date_to": "2026-10-15"})
    assert logs.status_code == 200, logs.text
    body = logs.json()
    rows = body if isinstance(body, list) else body.get("entries", body)
    assert "Something from another server" in json.dumps(rows)


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (b"not json", "This is not a JSON file from TRIM."),
        (b'{"format": "other"}', "This is not a JSON file from TRIM."),
        (b'{"format": "trim-export", "version": 2}', "This file is from a newer version of TRIM."),
    ],
)
def test_files_that_are_not_ours(client: CsrfClient, raw: bytes, message: str) -> None:
    fresh = new_account(client)
    res = post(fresh, raw)
    assert res.status_code == 422
    assert res.json()["detail"] == message


def test_a_bad_row_says_where(client: CsrfClient) -> None:
    fresh = new_account(client)
    doc = {"format": "trim-export", "version": 1, "datasets": {"weight": [{"kg": "heavy"}]}}
    res = post(fresh, doc)
    assert res.status_code == 422
    assert res.json()["detail"] == "Part of this file is not in the expected shape (weight.0)."


def test_all_or_nothing(client: CsrfClient, owner_engine: Engine) -> None:
    fresh = new_account(client)
    doc = {
        "format": "trim-export",
        "version": 1,
        "datasets": {
            "weight": [{"measured_at": "2026-10-15T11:00:00Z", "kg": 80}],
            "phases": [
                {"kind": "cut", "start_date": "2026-09-01", "end_date": "2026-09-30"},
                {"kind": "bulk", "start_date": "2026-09-15", "end_date": None},
            ],
        },
    }
    res = post(fresh, doc)
    assert res.status_code == 422
    assert res.json()["detail"].startswith("Some rows in this file could not be imported")
    assert fresh.get("/api/weights").json() == []
    assert fresh.get("/api/phases").json() == []


def test_too_big(client: CsrfClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fresh = new_account(client)
    monkeypatch.setattr(imports, "MAX_BYTES", 50)
    res = post(fresh, {"format": "trim-export", "version": 1, "datasets": {}, "pad": "x" * 100})
    assert res.status_code == 413
    assert res.json()["detail"] == "This file is too big to import."
