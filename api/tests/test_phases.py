"""Task 4.5: diet phases. AC: an overlapping phase is rejected; creating, editing or deleting a
phase leaves targets unchanged."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.helpers import user_row
from tests.test_logs import signed_in

NOBODY = "00000000-0000-4000-8000-000000000000"


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


def add(client: CsrfClient, **body: Any) -> Any:
    return client.post("/api/phases", json={"kind": "cut", **body})


def phases(client: CsrfClient) -> list[dict[str, Any]]:
    res = client.get("/api/phases")
    assert res.status_code == 200, res.text
    rows: list[dict[str, Any]] = res.json()
    return rows


def targets(owner_engine: Engine, email: str) -> list[Any]:
    with owner_engine.connect() as conn:
        return list(
            conn.execute(
                text("SELECT * FROM targets WHERE user_id = :u ORDER BY id"),
                {"u": user_row(owner_engine, email).id},
            ).all()
        )


def test_create_list_edit_delete(client: CsrfClient) -> None:
    signed_in(client)
    res = add(client, start_date="2026-09-01", end_date="2026-09-28", note="Before the trip")
    assert res.status_code == 201, res.text
    cut = res.json()
    assert cut["name"] == "Cut"
    assert cut["status"] == "ended"
    res = client.post(
        "/api/phases", json={"kind": "custom", "label": " Holiday ", "start_date": "2026-10-01"}
    )
    assert res.status_code == 201, res.text
    holiday = res.json()
    assert (holiday["name"], holiday["status"], holiday["end_date"]) == ("Holiday", "ongoing", None)
    assert [p["name"] for p in phases(client)] == ["Holiday", "Cut"]

    res = client.patch(f"/api/phases/{cut['id']}", json={"kind": "maintain", "note": None})
    assert res.status_code == 200, res.text
    assert (res.json()["name"], res.json()["note"]) == ("Maintain", None)
    assert res.json()["end_date"] == "2026-09-28"
    res = client.patch(f"/api/phases/{holiday['id']}", json={"end_date": "2026-10-10"})
    assert res.json()["status"] == "ended"
    res = client.patch(f"/api/phases/{holiday['id']}", json={"end_date": None})
    assert res.json()["status"] == "ongoing"

    assert client.delete(f"/api/phases/{cut['id']}").status_code == 204
    assert [p["name"] for p in phases(client)] == ["Holiday"]
    assert client.delete(f"/api/phases/{cut['id']}").status_code == 404
    assert client.patch(f"/api/phases/{cut['id']}", json={"note": "x"}).status_code == 404
    assert client.patch(f"/api/phases/{NOBODY}", json={"note": "x"}).status_code == 404


def test_ac_an_overlapping_phase_is_rejected(client: CsrfClient) -> None:
    signed_in(client)
    assert add(client, start_date="2026-09-01", end_date="2026-09-28").status_code == 201
    for start, end in [
        ("2026-09-28", "2026-10-05"),  # shares the last day
        ("2026-08-20", "2026-09-01"),  # shares the first day
        ("2026-09-10", "2026-09-12"),  # inside
        ("2026-08-01", None),  # ongoing from before
    ]:
        res = add(client, kind="bulk", start_date=start, end_date=end)
        assert res.status_code == 422, (start, end)
        assert res.json()["detail"] == (
            "This overlaps your Cut from 1 Sep 2026 to 28 Sep 2026. Phases cannot overlap."
        )
    assert add(client, start_date="2026-09-29", end_date="2026-10-05").status_code == 201
    assert len(phases(client)) == 2


def test_an_edit_that_would_overlap_is_rejected(client: CsrfClient) -> None:
    signed_in(client)
    add(client, start_date="2026-09-01", end_date="2026-09-28")
    later = add(client, kind="bulk", start_date="2026-10-01", end_date="2026-10-10").json()
    res = client.patch(f"/api/phases/{later['id']}", json={"start_date": "2026-09-20"})
    assert res.status_code == 422
    assert "overlaps your Cut" in res.json()["detail"]
    # A phase never clashes with itself.
    res = client.patch(f"/api/phases/{later['id']}", json={"start_date": "2026-09-29"})
    assert res.status_code == 200, res.text


def test_an_ongoing_phase_must_end_first_or_be_ended_for_you(client: CsrfClient) -> None:
    signed_in(client)
    first = add(client, start_date="2026-09-01").json()
    res = add(client, kind="maintain", start_date="2026-10-05")
    assert res.status_code == 422
    assert res.json()["detail"] == (
        "Your Cut from 1 Sep 2026, still going. End it before starting a new phase."
    )
    res = add(client, kind="maintain", start_date="2026-10-05", end_current=True)
    assert res.status_code == 201, res.text
    rows = {p["id"]: p for p in phases(client)}
    assert rows[first["id"]]["end_date"] == "2026-10-04"
    # Ending the current phase cannot make room before it started.
    res = add(client, kind="bulk", start_date="2026-08-01", end_current=True)
    assert res.status_code == 422


def test_the_database_rejects_an_overlap_too(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    add(client, start_date="2026-09-01", end_date="2026-09-28")
    with pytest.raises(Exception, match="phase_overlap"), owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO diet_phases (id, user_id, kind, start_date) "
                "VALUES (gen_random_uuid(), :u, 'bulk', '2026-09-15')"
            ),
            {"u": user_row(owner_engine, email).id},
        )


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"kind": "custom", "start_date": "2026-09-01"}, "Give your phase a name."),
        (
            {"kind": "cut", "start_date": "2026-09-10", "end_date": "2026-09-01"},
            "The end date cannot be before the start date.",
        ),
        ({"kind": "cut", "start_date": "2027-12-01"}, "A phase can start up to a year ahead."),
    ],
)
def test_bad_phases_say_what_is_wrong(
    client: CsrfClient, body: dict[str, Any], message: str
) -> None:
    signed_in(client)
    res = client.post("/api/phases", json=body)
    assert res.status_code == 422
    assert res.json()["detail"] == message


def test_ac_phases_never_change_targets(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    client.post("/api/targets", json={"kcal": 2200, "protein_g": 150, "fat_g": 60})
    before = targets(owner_engine, email)
    assert before
    cut = add(client, start_date="2026-10-01").json()
    client.patch(f"/api/phases/{cut['id']}", json={"kind": "bulk", "end_date": "2026-10-10"})
    add(client, kind="maintain", start_date="2026-10-11", end_current=True)
    client.delete(f"/api/phases/{cut['id']}")
    assert targets(owner_engine, email) == before


def test_another_users_phases_do_not_clash(client: CsrfClient) -> None:
    signed_in(client)
    add(client, start_date="2026-09-01", end_date="2026-09-28")
    client.post("/api/auth/logout")
    other = CsrfClient(client.app)
    other.get("/api/auth/csrf")
    signed_in(other)
    assert add(other, start_date="2026-09-01", end_date="2026-09-28").status_code == 201
    assert len(phases(other)) == 1


def seed_phase_data(owner_engine: Engine, email: str) -> None:
    """Sep 2026 in New York: a 2,000 kcal target, 4 logged days, weigh-ins and a waist pair."""
    uid = user_row(owner_engine, email).id
    with owner_engine.begin() as conn:
        conn.execute(text("DELETE FROM targets WHERE user_id = :u"), {"u": uid})
        conn.execute(
            text(
                "INSERT INTO targets (id, user_id, effective_from, kcal, protein_g, carbs_g, "
                "fat_g, source) VALUES (gen_random_uuid(), :u, '2026-08-01', 2000, 150, 200, 60, "
                "'custom'), (gen_random_uuid(), :u, '2026-09-15', 1800, 150, 150, 60, 'custom')"
            ),
            {"u": uid},
        )
        # 1 Sep 2,050 (on target), 2 Sep 2,300 (off), 20 Sep 1,850 (on, at 1,800), 30 Sep 1,500
        # (off); 31 Aug is before the phase.
        for day, kcal in [
            ("2026-08-31", 3000),
            ("2026-09-01", 2050),
            ("2026-09-02", 2300),
            ("2026-09-20", 1850),
            ("2026-09-30", 1500),
        ]:
            conn.execute(
                text(
                    "INSERT INTO food_logs (id, user_id, log_group_id, eaten_at, logged_on, "
                    "name, grams, quantity, unit_label, kcal, protein_g, carbs_g, fat_g, "
                    "source) VALUES (gen_random_uuid(), :u, gen_random_uuid(), :at, :d, "
                    "'Lunch', 100, 1, 'g', :k, 10, 10, 10, 'quick_add')"
                ),
                {"u": uid, "at": f"{day}T16:00:00Z", "d": day, "k": kcal},
            )
        start = date(2026, 8, 25)
        for i in range(0, 40, 3):
            weighed = start + timedelta(days=i)
            conn.execute(
                text(
                    "INSERT INTO weight_entries (id, user_id, measured_at, kg) "
                    "VALUES (gen_random_uuid(), :u, :at, :kg)"
                ),
                {"u": uid, "at": f"{weighed}T12:00:00Z", "kg": 80 - 0.1 * i},
            )
        waist = conn.execute(
            text(
                "UPDATE measurement_types SET is_active = true WHERE user_id = :u "
                "AND name = 'Waist' RETURNING id"
            ),
            {"u": uid},
        ).scalar_one()
        hips = conn.execute(
            text(
                "UPDATE measurement_types SET is_active = true WHERE user_id = :u "
                "AND name = 'Hips' RETURNING id"
            ),
            {"u": uid},
        ).scalar_one()
        for t, at, v in [
            (waist, "2026-08-20", 95.0),
            (waist, "2026-09-02", 90.0),
            (waist, "2026-09-16", 88.6),
            (waist, "2026-09-29", 87.3),
            (hips, "2026-09-10", 100.0),  # one reading in the phase: no change shown
        ]:
            conn.execute(
                text(
                    "INSERT INTO measurement_entries (id, user_id, type_id, value, measured_at) "
                    "VALUES (gen_random_uuid(), :u, :t, :v, :at)"
                ),
                {"u": uid, "t": t, "v": v, "at": f"{at}T12:00:00Z"},
            )


def test_summary(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    seed_phase_data(owner_engine, email)
    res = add(client, start_date="2026-09-01", end_date="2026-09-30")
    assert res.status_code == 201, res.text
    s = res.json()["summary"]
    assert s["days"] == 30
    assert s["logged_days"] == 4
    assert s["avg_kcal"] == round((2050 + 2300 + 1850 + 1500) / 4)
    assert s["avg_target_kcal"] == (2000 + 2000 + 1800 + 1800) / 4
    assert s["days_on_target"] == 2
    w = s["weight"]
    # The trend runs through every weigh-in; the phase takes it on its first (3 Sep) and last
    # (30 Sep) weigh-ins, 27 days apart.
    assert w["start_kg"] > w["end_kg"]
    assert w["change_kg"] == pytest.approx(w["end_kg"] - w["start_kg"], abs=0.011)
    assert w["weekly_kg"] == pytest.approx(w["change_kg"] / 27 * 7, abs=0.011)
    [m] = s["measurements"]
    assert (m["name"], m["start"], m["end"], m["change"]) == ("Waist", 90.0, 87.3, -2.7)


def test_an_ongoing_phase_is_summed_up_to_today(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    seed_phase_data(owner_engine, email)
    s = add(client, start_date="2026-09-20").json()["summary"]
    assert s["days"] == 28  # 20 Sep to 17 Oct
    assert s["logged_days"] == 2


def test_a_short_weight_span_has_no_weekly_rate(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    seed_phase_data(owner_engine, email)
    s = add(client, start_date="2026-09-01", end_date="2026-09-08").json()["summary"]
    assert s["weight"]["weekly_kg"] is None  # 3 Sep to 6 Sep
    assert s["measurements"] == []


def test_an_upcoming_phase_has_no_summary_and_charts_skip_summaries(client: CsrfClient) -> None:
    signed_in(client)
    p = add(client, start_date="2026-11-02", end_date="2026-12-20").json()
    assert (p["status"], p["summary"]) == ("upcoming", None)
    add(client, kind="maintain", start_date="2026-10-01", end_date="2026-10-20")
    rows = client.get("/api/phases", params={"summaries": "false"}).json()
    assert [r["summary"] for r in rows] == [None, None]


def test_an_ended_phase_earns_the_first_phase_badge(client: CsrfClient, fakes: Fakes) -> None:
    signed_in(client)
    add(client, start_date="2026-10-01")

    def earned() -> bool:
        badges = client.get("/api/badges").json()
        return next(b for b in badges if b["key"] == "first_phase")["earned_at"] is not None

    assert not earned()  # ongoing
    p = phases(client)[0]
    client.patch(f"/api/phases/{p['id']}", json={"end_date": "2026-10-17"})
    assert not earned()  # ends today
    fakes.clock.now = datetime(2026, 10, 18, 5, 0, tzinfo=UTC)  # 1 am on 18 Oct in New York
    assert earned()
