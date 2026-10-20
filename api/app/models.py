"""Tables for accounts and auth (task 1.3). Every table here has row-level security; see the
migration for the policies and the auth_* lookup functions."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    Text,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.ids import uuid7

USER_STATUSES = ("active", "locked", "deleted")
UNIT_SYSTEMS = ("metric", "imperial")
SEXES = ("male", "female")
ACTIVITY_LEVELS = ("sedentary", "light", "moderate", "heavy", "athlete")
THEMES = ("system", "light", "dark")
TOKEN_KINDS = ("verify", "reset")
AUDIT_EVENTS = (
    "signup",
    "login",
    "logout",
    "password_change",
    "password_reset",
    "export",
    "delete",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def _user_fk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)


class User(Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint(_in("status", USER_STATUSES), name="status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    email: Mapped[str] = mapped_column(Text, unique=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_hash: Mapped[str] = mapped_column(Text)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text, server_default="active")


class UserProfile(Timestamps, Base):
    __tablename__ = "user_profiles"
    __table_args__ = (
        CheckConstraint(_in("unit_system", UNIT_SYSTEMS), name="unit_system"),
        CheckConstraint(_in("sex", SEXES), name="sex"),
        CheckConstraint(_in("activity_level", ACTIVITY_LEVELS), name="activity_level"),
        CheckConstraint(_in("theme", THEMES), name="theme"),
        CheckConstraint("age_years BETWEEN 18 AND 100", name="age_years"),
        CheckConstraint("height_cm BETWEEN 120 AND 230", name="height_cm"),
        CheckConstraint("goal_weight_kg BETWEEN 30 AND 300", name="goal_weight_kg"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    display_name: Mapped[str] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text)
    unit_system: Mapped[str] = mapped_column(Text)
    sex: Mapped[str | None] = mapped_column(Text)
    age_years: Mapped[int | None] = mapped_column(SmallInteger)
    age_recorded_on: Mapped[date | None] = mapped_column(Date)
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    activity_level: Mapped[str | None] = mapped_column(Text)
    goal_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    theme: Mapped[str] = mapped_column(Text, server_default="system")


class SessionRow(Timestamps, Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    # SHA-256 of the cookie token; the token itself is never stored.
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip_hash: Mapped[bytes | None] = mapped_column(LargeBinary)
    # "Keep me signed in": 30-day sliding cookie. Otherwise a browser-session cookie.
    persistent: Mapped[bool] = mapped_column(Boolean, server_default=false())


class RateEvent(Base):
    """One counted event (failed login, sign-up) under a hashed key such as an account or IP.
    Not user data: reachable only through the auth_rate_* functions, never by the app role."""

    __tablename__ = "rate_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    key_hash: Mapped[bytes] = mapped_column(LargeBinary, index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RateLock(Base):
    __tablename__ = "rate_locks"

    key_hash: Mapped[bytes] = mapped_column(LargeBinary, primary_key=True)
    locked_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AuthToken(Timestamps, Base):
    __tablename__ = "auth_tokens"
    __table_args__ = (CheckConstraint(_in("kind", TOKEN_KINDS), name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    kind: Mapped[str] = mapped_column(Text)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Timestamps, Base):
    __tablename__ = "audit_log"
    __table_args__ = (CheckConstraint(_in("event", AUDIT_EVENTS), name="event"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    event: Mapped[str] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ip_hash: Mapped[bytes | None] = mapped_column(LargeBinary)


TARGET_SOURCES = ("calculator", "custom")


class WeightEntry(Timestamps, Base):
    __tablename__ = "weight_entries"
    __table_args__ = (
        CheckConstraint("kg BETWEEN 30 AND 300", name="kg"),
        Index("ix_weight_entries_user_measured", "user_id", "measured_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Grams precision, so pounds round-trip: 176.4 lb is stored as 80.014 kg.
    kg: Mapped[Decimal] = mapped_column(Numeric(6, 3))
    note: Mapped[str | None] = mapped_column(Text)


class Target(Timestamps, Base):
    """One row per change; charts use the row in effect on each date."""

    __tablename__ = "targets"
    __table_args__ = (
        CheckConstraint(_in("source", TARGET_SOURCES), name="source"),
        CheckConstraint("kcal > 0", name="kcal_positive"),
        CheckConstraint(
            "protein_g >= 0 AND carbs_g >= 0 AND fat_g >= 0", name="macros_not_negative"
        ),
        Index("ix_targets_user_effective", "user_id", "effective_from"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    effective_from: Mapped[date] = mapped_column(Date)
    kcal: Mapped[int] = mapped_column(Integer)
    protein_g: Mapped[int] = mapped_column(Integer)
    carbs_g: Mapped[int] = mapped_column(Integer)
    fat_g: Mapped[int] = mapped_column(Integer)
    fiber_g: Mapped[int | None] = mapped_column(Integer)
    # Null means water is not tracked.
    water_ml: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(Text)
    calc_inputs: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    bmr: Mapped[int | None] = mapped_column(Integer)
    tdee: Mapped[int | None] = mapped_column(Integer)
    tolerance_pct: Mapped[int] = mapped_column(SmallInteger, server_default="5")


FOOD_SOURCES = ("custom", "fdc", "off")
LOG_SOURCES = ("search", "recent", "quick_add", "meal", "suggestion")


class Food(Timestamps, Base):
    """A food per 100 g. owner_id null is the shared cache of FoodData Central and Open Food
    Facts results; set, it is the user's custom food or private override. Users read shared
    rows and their own, and write only their own; the shared cache is written by the owner
    role (see the migration's policies)."""

    __tablename__ = "foods"
    __table_args__ = (
        CheckConstraint(_in("source", FOOD_SOURCES), name="source"),
        CheckConstraint("owner_id IS NOT NULL OR source <> 'custom'", name="custom_has_owner"),
        CheckConstraint(
            "kcal_100 >= 0 AND protein_100 >= 0 AND carbs_100 >= 0 AND fat_100 >= 0 "
            "AND coalesce(fiber_100, 0) >= 0 AND coalesce(sugar_100, 0) >= 0 "
            "AND coalesce(sodium_mg_100, 0) >= 0",
            name="nutrients_not_negative",
        ),
        CheckConstraint("density_g_ml IS NULL OR density_g_ml > 0", name="density_positive"),
        # One cached copy per source item; private overrides may repeat it.
        Index(
            "uq_foods_shared_source_ref",
            "source",
            "source_ref",
            unique=True,
            postgresql_where=text("owner_id IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(Text)
    source_ref: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(Text)
    kcal_100: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    protein_100: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    carbs_100: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    fat_100: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    # Null means the source has no value ("fiber unknown"), not zero.
    fiber_100: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    sugar_100: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    sodium_mg_100: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    density_g_ml: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))


class ServingUnit(Timestamps, Base):
    """A named portion of a food ("1 egg" = 50 g). Visible and writable exactly when its food is."""

    __tablename__ = "serving_units"
    __table_args__ = (
        CheckConstraint("grams > 0", name="grams_positive"),
        Index(
            "uq_serving_units_one_default",
            "food_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    food_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(Text)
    grams: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    is_default: Mapped[bool] = mapped_column(Boolean, server_default=false())


class FoodLog(Timestamps, Base):
    """One eaten item. Nutrients are a snapshot taken when logged, so later edits to the food
    (or deleting a custom food) never change history."""

    __tablename__ = "food_logs"
    __table_args__ = (
        CheckConstraint(_in("source", LOG_SOURCES), name="source"),
        CheckConstraint("grams IS NULL OR grams > 0", name="grams_positive"),
        CheckConstraint("quantity IS NULL OR quantity > 0", name="quantity_positive"),
        CheckConstraint(
            "kcal >= 0 AND protein_g >= 0 AND carbs_g >= 0 AND fat_g >= 0 "
            "AND coalesce(fiber_g, 0) >= 0 AND coalesce(sugar_g, 0) >= 0 "
            "AND coalesce(sodium_mg, 0) >= 0",
            name="nutrients_not_negative",
        ),
        Index("ix_food_logs_user_logged_on", "user_id", "logged_on"),
        Index("ix_food_logs_user_eaten_at", "user_id", "eaten_at"),
        Index("ix_food_logs_user_log_group", "user_id", "log_group_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    # Null for quick add, or after the custom food it came from was deleted.
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="SET NULL"), index=True
    )
    # Points at saved_meals once that table exists (task 3.7b).
    saved_meal_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # One id per add action, so a whole meal can be moved or undone together.
    log_group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    eaten_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # The user's local date for eaten_at, fixed when logged (SPEC page 3, Days).
    logged_on: Mapped[date] = mapped_column(Date)
    name: Mapped[str] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(Text)
    # Null for quick add, which has nutrients but no amount.
    grams: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))
    unit_label: Mapped[str | None] = mapped_column(Text)
    kcal: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    protein_g: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    carbs_g: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    fat_g: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    fiber_g: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    sugar_g: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    sodium_mg: Mapped[Decimal | None] = mapped_column(Numeric(9, 2))
    source: Mapped[str] = mapped_column(Text)


# Every table that row-level security protects, with the column that names the owner.
RLS_TABLES: dict[str, str] = {
    "users": "id",
    "user_profiles": "user_id",
    "sessions": "user_id",
    "auth_tokens": "user_id",
    "audit_log": "user_id",
    "weight_entries": "user_id",
    "targets": "user_id",
    "food_logs": "user_id",
}

# Every table holding rows a user owns: the RLS tables plus custom foods, whose owner column
# is nullable because null marks the shared cache. Account deletion must leave none behind.
OWNED_ROWS: dict[str, str] = {**RLS_TABLES, "foods": "owner_id"}
