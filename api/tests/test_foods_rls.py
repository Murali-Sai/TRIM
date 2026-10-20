"""Task 3.1: foods mixes the shared cache (owner_id null) with custom foods, and serving_units
follows its food. Checked directly in the database, like test_rls.py."""

import uuid
from typing import Any

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from app.db import anonymous_session, user_session
from app.ids import uuid7
from tests.test_rls import Seeded, seed_user

FOOD_COLS = "id, owner_id, source, source_ref, name, kcal_100, protein_100, carbs_100, fat_100"


def insert_food(conn: Any, owner: uuid.UUID | None, source: str, ref: str | None = None) -> Any:
    return conn.execute(
        text(
            f"INSERT INTO foods ({FOOD_COLS}) VALUES (:id, :o, :s, :r, 'Food', 100, 5, 10, 2) "
            "RETURNING id"
        ),
        {"id": uuid7(), "o": owner, "s": source, "r": ref},
    ).scalar_one()


def insert_unit(conn: Any, food_id: Any) -> Any:
    return conn.execute(
        text(
            "INSERT INTO serving_units (id, food_id, label, grams) "
            "VALUES (:id, :f, '1 cup', 240) RETURNING id"
        ),
        {"id": uuid7(), "f": food_id},
    ).scalar_one()


@pytest.fixture(scope="module")
def world(app_engine: Engine, owner_engine: Engine) -> dict[str, Any]:
    alice, bob = seed_user("alice-food"), seed_user("bob-food")
    with owner_engine.begin() as conn:
        shared = insert_food(conn, None, "fdc", f"fdc-{uuid7().hex}")
        shared_unit = insert_unit(conn, shared)
    with user_session(alice.user_id) as s:
        custom = insert_food(s, alice.user_id, "custom")
        custom_unit = insert_unit(s, custom)
    return {
        "alice": alice,
        "bob": bob,
        "shared": shared,
        "shared_unit": shared_unit,
        "custom": custom,
        "custom_unit": custom_unit,
    }


def visible(user: Seeded | None, table: str, row_id: Any) -> bool:
    session = user_session(user.user_id) if user else anonymous_session()
    with session as s:
        return bool(
            s.execute(
                text(f"SELECT EXISTS (SELECT 1 FROM {table} WHERE id = :id)"), {"id": row_id}
            ).scalar_one()
        )


def test_everyone_reads_the_shared_cache(world: dict[str, Any]) -> None:
    for user in (world["alice"], world["bob"], None):
        assert visible(user, "foods", world["shared"])
        assert visible(user, "serving_units", world["shared_unit"])


def test_custom_foods_and_their_units_are_private(world: dict[str, Any]) -> None:
    assert visible(world["alice"], "foods", world["custom"])
    assert visible(world["alice"], "serving_units", world["custom_unit"])
    for user in (world["bob"], None):
        assert not visible(user, "foods", world["custom"])
        assert not visible(user, "serving_units", world["custom_unit"])


@pytest.mark.parametrize("target", ["shared", "custom"])
def test_others_cannot_change_or_delete_foods(
    world: dict[str, Any], owner_engine: Engine, target: str
) -> None:
    bob = world["bob"]
    with user_session(bob.user_id) as s:
        updated = s.execute(
            text("UPDATE foods SET name = 'x' WHERE id = :id"), {"id": world[target]}
        )
        units = s.execute(
            text("UPDATE serving_units SET grams = 1 WHERE food_id = :id"), {"id": world[target]}
        )
        gone_units = s.execute(
            text("DELETE FROM serving_units WHERE food_id = :id"), {"id": world[target]}
        )
        gone = s.execute(text("DELETE FROM foods WHERE id = :id"), {"id": world[target]})
        assert updated.rowcount == units.rowcount == 0  # type: ignore[attr-defined]
        assert gone_units.rowcount == gone.rowcount == 0  # type: ignore[attr-defined]
    with owner_engine.connect() as conn:
        assert (
            conn.execute(
                text("SELECT name FROM foods WHERE id = :id"), {"id": world[target]}
            ).scalar_one()
            == "Food"
        )


def test_the_owner_cannot_edit_the_shared_cache_either(world: dict[str, Any]) -> None:
    with user_session(world["alice"].user_id) as s:
        updated = s.execute(
            text("UPDATE foods SET name = 'x' WHERE id = :id"), {"id": world["shared"]}
        )
        assert updated.rowcount == 0  # type: ignore[attr-defined]


@pytest.mark.parametrize("owner", ["alice", "shared"])
def test_cannot_insert_foods_for_someone_else_or_into_the_cache(
    world: dict[str, Any], owner: str
) -> None:
    owner_id = world["alice"].user_id if owner == "alice" else None
    with (
        pytest.raises(DBAPIError, match="row-level security"),
        user_session(world["bob"].user_id) as s,
    ):
        insert_food(s, owner_id, "fdc" if owner_id is None else "custom")


def test_cannot_publish_a_custom_food_to_the_cache(world: dict[str, Any]) -> None:
    with (
        pytest.raises(DBAPIError, match="row-level security"),
        user_session(world["alice"].user_id) as s,
    ):
        s.execute(
            text("UPDATE foods SET owner_id = NULL, source = 'fdc' WHERE id = :id"),
            {"id": world["custom"]},
        )


@pytest.mark.parametrize("target", ["shared", "custom"])
def test_cannot_add_units_to_foods_you_do_not_own(world: dict[str, Any], target: str) -> None:
    with (
        pytest.raises(DBAPIError, match="row-level security"),
        user_session(world["bob"].user_id) as s,
    ):
        insert_unit(s, world[target])


def test_owner_manages_own_custom_food_units(world: dict[str, Any]) -> None:
    alice = world["alice"]
    with user_session(alice.user_id) as s:
        unit = insert_unit(s, world["custom"])
        s.execute(text("UPDATE serving_units SET grams = 200 WHERE id = :id"), {"id": unit})
        deleted = s.execute(text("DELETE FROM serving_units WHERE id = :id"), {"id": unit})
        assert deleted.rowcount == 1  # type: ignore[attr-defined]


def test_custom_food_needs_an_owner(owner_engine: Engine) -> None:
    with pytest.raises(DBAPIError, match="ck_foods_custom_has_owner"), owner_engine.begin() as c:
        insert_food(c, None, "custom")


def test_one_cached_copy_per_source_item(owner_engine: Engine, world: dict[str, Any]) -> None:
    ref = f"off-{uuid7().hex}"
    with owner_engine.begin() as conn:
        insert_food(conn, None, "off", ref)
    with pytest.raises(DBAPIError, match="uq_foods_shared_source_ref"), owner_engine.begin() as c:
        insert_food(c, None, "off", ref)
    # A private override of the same item is fine.
    with user_session(world["alice"].user_id) as s:
        insert_food(s, world["alice"].user_id, "off", ref)


def test_deleting_a_custom_food_keeps_the_log_snapshot(
    world: dict[str, Any], owner_engine: Engine
) -> None:
    alice = world["alice"]
    with user_session(alice.user_id) as s:
        food = insert_food(s, alice.user_id, "custom")
        log = s.execute(
            text(
                "INSERT INTO food_logs (id, user_id, food_id, log_group_id, eaten_at, logged_on, "
                "name, grams, kcal, protein_g, carbs_g, fat_g, source) VALUES (:id, :u, :f, :g, "
                "now(), '2026-10-17', 'Food', 100, 100, 5, 10, 2, 'search') RETURNING id"
            ),
            {"id": uuid7(), "u": alice.user_id, "f": food, "g": uuid7()},
        ).scalar_one()
        s.execute(text("DELETE FROM foods WHERE id = :id"), {"id": food})
    with owner_engine.connect() as conn:
        row = conn.execute(
            text("SELECT food_id, name, kcal FROM food_logs WHERE id = :id"), {"id": log}
        ).one()
    assert row.food_id is None
    assert (row.name, float(row.kcal)) == ("Food", 100.0)


def test_one_default_unit_per_food(world: dict[str, Any]) -> None:
    alice = world["alice"]
    with (
        pytest.raises(DBAPIError, match="uq_serving_units_one_default"),
        user_session(alice.user_id) as s,
    ):
        for _ in range(2):
            s.execute(
                text(
                    "INSERT INTO serving_units (id, food_id, label, grams, is_default) "
                    "VALUES (:id, :f, 'x', 10, true)"
                ),
                {"id": uuid7(), "f": world["custom"]},
            )
