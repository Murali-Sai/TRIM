"""Every user-owned table (RLS_TABLES) is isolated per user by Postgres row-level security,
checked directly in the database. Started in task 1.3; each new table adds a seeded row here."""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from app.db import anonymous_session, user_session
from app.ids import uuid7
from app.models import (
    RLS_TABLES,
    AuditLog,
    AuthToken,
    Food,
    FoodFavourite,
    FoodLog,
    MeasurementEntry,
    MeasurementType,
    PairPreference,
    PushSubscription,
    SavedMeal,
    SavedMealItem,
    SessionRow,
    Staple,
    StreakEvent,
    Target,
    User,
    UserBadge,
    UserProfile,
    UserSettings,
    UserStreak,
    WaterLog,
    WeeklyGoal,
    WeightEntry,
)


@dataclass(frozen=True)
class Seeded:
    user_id: uuid.UUID
    email: str
    session_token_hash: bytes
    verify_token_hash: bytes


def seed_user(label: str) -> Seeded:
    """Signs a user up the way the app will: the new id is set as app.user_id before insert."""
    user_id = uuid7()
    email = f"{label}-{user_id.hex[:8]}@example.test"
    session_hash = hashlib.sha256(f"session-{user_id}".encode()).digest()
    verify_hash = hashlib.sha256(f"verify-{user_id}".encode()).digest()
    with user_session(user_id) as s:
        s.add(User(id=user_id, email=email, password_hash="argon2id$placeholder"))
        s.flush()
        s.add_all(
            [
                UserProfile(
                    user_id=user_id,
                    display_name=label,
                    timezone="America/New_York",
                    unit_system="imperial",
                ),
                SessionRow(user_id=user_id, token_hash=session_hash),
                AuthToken(
                    user_id=user_id,
                    kind="verify",
                    token_hash=verify_hash,
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                ),
                AuditLog(user_id=user_id, event="signup"),
                WeightEntry(user_id=user_id, measured_at=datetime.now(UTC), kg=Decimal("80")),
                Target(
                    user_id=user_id,
                    effective_from=date(2026, 10, 17),
                    kcal=2300,
                    protein_g=150,
                    carbs_g=280,
                    fat_g=65,
                    source="custom",
                ),
                FoodLog(
                    user_id=user_id,
                    log_group_id=uuid7(),
                    eaten_at=datetime.now(UTC),
                    logged_on=date(2026, 10, 17),
                    name="Quick add",
                    kcal=Decimal("250"),
                    protein_g=Decimal("10"),
                    carbs_g=Decimal("30"),
                    fat_g=Decimal("8"),
                    source="quick_add",
                ),
            ]
        )
        food = Food(
            owner_id=user_id,
            source="custom",
            name="Overnight oats",
            kcal_100=Decimal("150"),
            protein_100=Decimal("6"),
            carbs_100=Decimal("24"),
            fat_100=Decimal("4"),
        )
        s.add(food)
        s.flush()
        s.add(FoodFavourite(user_id=user_id, food_id=food.id))
        meal = SavedMeal(user_id=user_id, name="Breakfast")
        s.add(meal)
        s.flush()
        s.add(
            SavedMealItem(
                user_id=user_id, saved_meal_id=meal.id, food_id=food.id, grams=Decimal("250")
            )
        )
        oats = Staple(
            user_id=user_id,
            food_id=food.id,
            unit_label="100 g",
            unit_grams=Decimal("100"),
            step_units=Decimal("0.5"),
            min_units=Decimal("0.5"),
            max_units=Decimal("3"),
        )
        bowl = Staple(
            user_id=user_id,
            saved_meal_id=meal.id,
            unit_label="1 meal",
            step_units=Decimal("0.5"),
            min_units=Decimal("0.5"),
            max_units=Decimal("3"),
        )
        s.add_all([oats, bowl])
        s.flush()
        a, b = sorted([oats.id, bowl.id])
        s.add(PairPreference(user_id=user_id, staple_a_id=a, staple_b_id=b))
        waist = MeasurementType(user_id=user_id, name="Waist", unit="cm")
        s.add(waist)
        s.flush()
        s.add(
            MeasurementEntry(
                user_id=user_id,
                type_id=waist.id,
                value=Decimal("90"),
                measured_at=datetime(2026, 10, 17, 12, 0, tzinfo=UTC),
            )
        )
        s.add(UserSettings(user_id=user_id, track_water=True))
        s.add(UserStreak(user_id=user_id, current_days=3, longest_days=3))
        s.add(StreakEvent(user_id=user_id, on_date=date(2026, 10, 17), kind="counted"))
        s.add(
            WeeklyGoal(
                user_id=user_id,
                week_start=date(2026, 10, 12),
                kind="log_food",
                position=0,
                needed=5,
            )
        )
        s.add(UserBadge(user_id=user_id, badge="streak_7", earned_at=datetime.now(UTC)))
        s.add(
            PushSubscription(
                user_id=user_id,
                endpoint=f"https://push.example.com/{user_id.hex}",
                p256dh="p256dh-key",
                auth="auth-key",
            )
        )
        s.add(
            WaterLog(
                user_id=user_id,
                logged_at=datetime(2026, 10, 17, 12, 0, tzinfo=UTC),
                logged_on=date(2026, 10, 17),
                ml=250,
            )
        )
    return Seeded(user_id, email, session_hash, verify_hash)


@pytest.fixture(scope="module")
def users(app_engine: Engine) -> tuple[Seeded, Seeded]:
    return seed_user("alice"), seed_user("bob")


TABLES = sorted(RLS_TABLES)


def count(table: str, where: str = "true", **params: object) -> int:
    with anonymous_session() as s:
        return int(
            s.execute(text(f"SELECT count(*) FROM {table} WHERE {where}"), params).scalar_one()
        )


def count_as(user_id: uuid.UUID, table: str, where: str = "true", **params: object) -> int:
    with user_session(user_id) as s:
        return int(
            s.execute(text(f"SELECT count(*) FROM {table} WHERE {where}"), params).scalar_one()
        )


# --- the role the app runs as -------------------------------------------------------------


def test_app_role_is_not_superuser_owner_or_bypassrls(app_engine: Engine) -> None:
    with app_engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT r.rolsuper, r.rolbypassrls, "
                "(SELECT tableowner FROM pg_tables WHERE tablename = 'users') "
                "FROM pg_roles r WHERE r.rolname = current_user"
            )
        ).one()
    is_super, bypass, users_owner = row
    assert is_super is False
    assert bypass is False
    with app_engine.connect() as conn:
        assert users_owner != conn.execute(text("SELECT current_user")).scalar_one()


def test_every_user_owned_table_has_rls_and_a_policy(owner_engine: Engine) -> None:
    """Guards the AGENTS.md rule for every future migration: a table with a user_id column
    must ship with RLS enabled and a policy."""
    with owner_engine.connect() as conn:
        user_tables = set(
            conn.execute(
                text(
                    "SELECT table_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND column_name = 'user_id'"
                )
            ).scalars()
        ) | {"users"}
        secured = set(
            conn.execute(
                text(
                    "SELECT c.relname FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND c.relrowsecurity "
                    "AND EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname)"
                )
            ).scalars()
        )
        nullable_user_ids = set(
            conn.execute(
                text(
                    "SELECT table_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND column_name = 'user_id' "
                    "AND is_nullable = 'YES'"
                )
            ).scalars()
        )
    assert user_tables <= secured
    assert set(RLS_TABLES) == user_tables
    assert nullable_user_ids == set()


# --- reads --------------------------------------------------------------------------------


@pytest.mark.parametrize("table", TABLES)
def test_wrong_user_id_returns_zero_rows(users: tuple[Seeded, Seeded], table: str) -> None:
    """The task 1.3 acceptance check: a random app.user_id sees nothing at all."""
    assert count_as(uuid7(), table) == 0


@pytest.mark.parametrize("table", TABLES)
def test_no_user_id_returns_zero_rows(users: tuple[Seeded, Seeded], table: str) -> None:
    assert count(table) == 0


@pytest.mark.parametrize("table", TABLES)
def test_user_sees_only_own_rows(users: tuple[Seeded, Seeded], table: str) -> None:
    alice, bob = users
    col = RLS_TABLES[table]
    assert count_as(bob.user_id, table, f"{col} = :a", a=alice.user_id) == 0
    assert count_as(bob.user_id, table, f"{col} <> :b", b=bob.user_id) == 0
    assert count_as(alice.user_id, table, f"{col} = :a", a=alice.user_id) >= 1


# --- writes -------------------------------------------------------------------------------


@pytest.mark.parametrize("table", TABLES)
def test_cannot_update_or_delete_another_users_rows(
    users: tuple[Seeded, Seeded], owner_engine: Engine, table: str
) -> None:
    alice, bob = users
    col = RLS_TABLES[table]
    with user_session(bob.user_id) as s:
        updated = s.execute(
            text(f"UPDATE {table} SET updated_at = now() WHERE {col} = :a"), {"a": alice.user_id}
        )
        deleted = s.execute(text(f"DELETE FROM {table} WHERE {col} = :a"), {"a": alice.user_id})
        assert updated.rowcount == 0  # type: ignore[attr-defined]
        assert deleted.rowcount == 0  # type: ignore[attr-defined]
    with owner_engine.connect() as conn:
        left = conn.execute(
            text(f"SELECT count(*) FROM {table} WHERE {col} = :a"), {"a": alice.user_id}
        ).scalar_one()
    assert left >= 1


def test_cannot_insert_rows_for_another_user(users: tuple[Seeded, Seeded]) -> None:
    alice, bob = users
    with pytest.raises(DBAPIError, match="row-level security"), user_session(bob.user_id) as s:
        s.add(AuditLog(user_id=alice.user_id, event="login"))
        s.flush()


def test_cannot_move_own_row_to_another_user(users: tuple[Seeded, Seeded]) -> None:
    alice, bob = users
    with pytest.raises(DBAPIError, match="row-level security"), user_session(bob.user_id) as s:
        s.execute(
            text("UPDATE audit_log SET user_id = :a WHERE user_id = :b"),
            {"a": alice.user_id, "b": bob.user_id},
        )


def test_setting_does_not_leak_to_the_next_transaction(users: tuple[Seeded, Seeded]) -> None:
    alice, _ = users
    assert count_as(alice.user_id, "users") == 1
    assert count("users") == 0


# --- the pre-login lookups ----------------------------------------------------------------


def test_lookup_by_email_works_before_login(users: tuple[Seeded, Seeded]) -> None:
    alice, _ = users
    with anonymous_session() as s:
        rows = s.execute(
            text("SELECT * FROM auth_user_by_email(:e)"), {"e": alice.email.upper()}
        ).all()
    assert len(rows) == 1
    assert rows[0].id == alice.user_id
    assert set(rows[0]._fields) == {"id", "password_hash", "status", "email_verified_at"}


def test_lookup_by_email_unknown_returns_nothing(users: tuple[Seeded, Seeded]) -> None:
    with anonymous_session() as s:
        rows = s.execute(text("SELECT * FROM auth_user_by_email('nobody@example.test')")).all()
    assert rows == []


def test_session_lookup_by_token_hash(users: tuple[Seeded, Seeded]) -> None:
    alice, _ = users
    with anonymous_session() as s:
        rows = s.execute(
            text("SELECT * FROM auth_session_by_token(:h)"), {"h": alice.session_token_hash}
        ).all()
        missing = s.execute(
            text("SELECT * FROM auth_session_by_token(:h)"), {"h": b"\x00" * 32}
        ).all()
    assert [r.user_id for r in rows] == [alice.user_id]
    assert missing == []


def test_token_lookup_checks_kind(users: tuple[Seeded, Seeded]) -> None:
    alice, _ = users
    with anonymous_session() as s:
        verify = s.execute(
            text("SELECT * FROM auth_token_by_hash(:h, 'verify')"), {"h": alice.verify_token_hash}
        ).all()
        reset = s.execute(
            text("SELECT * FROM auth_token_by_hash(:h, 'reset')"), {"h": alice.verify_token_hash}
        ).all()
    assert [r.user_id for r in verify] == [alice.user_id]
    assert reset == []
