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
    true,
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
    # Energy differs from 4P + 4C + 9F by more than 15%: shown with a "check the label" note.
    kcal_mismatch: Mapped[bool] = mapped_column(Boolean, server_default=false())


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
    # The saved meal this entry was logged from; cleared if that meal is deleted.
    saved_meal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_meals.id", ondelete="SET NULL"), index=True
    )
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


class SavedMeal(Timestamps, Base):
    """A named list of foods with amounts, logged as one time block (SPEC page 4)."""

    __tablename__ = "saved_meals"
    __table_args__ = (
        Index(
            "uq_saved_meals_user_name",
            "user_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    name: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    is_favourite: Mapped[bool] = mapped_column(Boolean, server_default=false())
    use_count: Mapped[int] = mapped_column(Integer, server_default="0")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SavedMealItem(Timestamps, Base):
    """One food and amount in a saved meal. Nutrients come from the food when the meal is
    logged, so editing a food changes the meal's next log but never past entries."""

    __tablename__ = "saved_meal_items"
    __table_args__ = (
        CheckConstraint("grams > 0", name="grams_positive"),
        CheckConstraint("quantity IS NULL OR quantity > 0", name="quantity_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    saved_meal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_meals.id", ondelete="CASCADE"), index=True
    )
    # Null once the custom food it pointed at is deleted; the meal then flags it.
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="SET NULL"), index=True
    )
    grams: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))
    unit_label: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")


class FoodFavourite(Timestamps, Base):
    """A food the user starred; favourites appear first on Log food (SPEC page 1, UX)."""

    __tablename__ = "food_favourites"
    __table_args__ = (Index("uq_food_favourites_user_food", "user_id", "food_id", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    food_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="CASCADE"), index=True
    )


STREAK_EVENT_KINDS = ("counted", "freeze_earned", "freeze_used", "repaired", "broken")


class UserStreak(Timestamps, Base):
    """The walked (final) part of the streaks; see app/streaks.py. One row per user."""

    __tablename__ = "user_streaks"
    __table_args__ = (
        CheckConstraint("freezes_held BETWEEN 0 AND 2", name="freezes_held"),
        CheckConstraint("current_days >= 0 AND longest_days >= current_days", name="days"),
        CheckConstraint(
            "weigh_in_current_weeks >= 0 AND weigh_in_longest_weeks >= weigh_in_current_weeks",
            name="weeks",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    current_days: Mapped[int] = mapped_column(Integer, server_default="0")
    longest_days: Mapped[int] = mapped_column(Integer, server_default="0")
    last_counted_date: Mapped[date | None] = mapped_column(Date)
    freezes_held: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    weigh_in_current_weeks: Mapped[int] = mapped_column(Integer, server_default="0")
    weigh_in_longest_weeks: Mapped[int] = mapped_column(Integer, server_default="0")
    # Monday of the last week walked.
    weigh_in_last_week: Mapped[date | None] = mapped_column(Date)


class StreakEvent(Timestamps, Base):
    __tablename__ = "streak_events"
    __table_args__ = (
        CheckConstraint(_in("kind", STREAK_EVENT_KINDS), name="kind"),
        Index("ix_streak_events_user_date", "user_id", "on_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    on_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(Text)


GOAL_KINDS = ("log_food", "protein", "calories", "weigh_in", "water", "measurement")


class WeeklyGoal(Timestamps, Base):
    """One of the week's three goals (app/goals.py). completed_at is set the first time the
    goal is met; closed once the week has ended and was checked for the last time."""

    __tablename__ = "weekly_goals"
    __table_args__ = (
        CheckConstraint(_in("kind", GOAL_KINDS), name="kind"),
        CheckConstraint("needed > 0", name="needed_positive"),
        Index("uq_weekly_goals_user_week_kind", "user_id", "week_start", "kind", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    week_start: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(SmallInteger)
    needed: Mapped[int] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed: Mapped[bool] = mapped_column(Boolean, server_default=false())


class UserBadge(Timestamps, Base):
    """A badge earned, once (the unique index makes awarding idempotent)."""

    __tablename__ = "user_badges"
    __table_args__ = (Index("uq_user_badges_user_badge", "user_id", "badge", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    badge: Mapped[str] = mapped_column(Text)
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


WATER_UNITS = ("ml", "fl_oz")


class UserSettings(Timestamps, Base):
    """What the user tracks (SPEC page 2, user_settings). No row means the defaults."""

    __tablename__ = "user_settings"
    __table_args__ = (CheckConstraint(_in("water_unit", WATER_UNITS), name="water_unit"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Water is off until the user turns it on (SPEC page 3, Water).
    track_water: Mapped[bool] = mapped_column(Boolean, server_default=false())
    track_fiber: Mapped[bool] = mapped_column(Boolean, server_default=true())
    water_unit: Mapped[str] = mapped_column(Text, server_default="ml")
    # Streaks and badges (SPEC: off switch). Off hides them everywhere; data keeps being kept.
    gamification: Mapped[bool] = mapped_column(Boolean, server_default=true())
    # Streak reminder at this local time ("20:00"), or None for off (SPEC: opt-in).
    streak_reminder: Mapped[str | None] = mapped_column(Text)
    # The local day the last reminder went out: at most one a day.
    last_reminded_on: Mapped[date | None] = mapped_column(Date)
    # When "Add your 10 most-logged foods as staples?" was answered: it is offered once.
    staples_offered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PushSubscription(Timestamps, Base):
    """A browser's Web Push subscription. The keys are what the browser handed out for
    encrypting messages to it; they are needed as they are to send."""

    __tablename__ = "push_subscriptions"
    __table_args__ = (
        Index("uq_push_subscriptions_user_endpoint", "user_id", "endpoint", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    endpoint: Mapped[str] = mapped_column(Text)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)


FOOD_GROUPS = (
    "poultry",
    "red_meat",
    "fish_seafood",
    "eggs",
    "rice_grains",
    "bread_tortillas",
    "pasta",
    "cereal_oats",
    "vegetables",
    "fruit",
    "yogurt",
    "milk",
    "cheese",
    "nuts_butters",
    "beans_legumes",
    "tofu_plant_protein",
    "potatoes",
    "sweets_desserts",
    "savory_snacks",
    "shakes_bars",
    "sauces_condiments",
    "fats_oils",
    "mixed_dishes",
)


class Staple(Timestamps, Base):
    """A food or saved meal the user eats often, with the amounts a suggestion may use:
    min_units to max_units in steps of step_units of the unit (SPEC page 3, My staples).
    At most 20 per user, enforced by a trigger."""

    __tablename__ = "staples"
    __table_args__ = (
        CheckConstraint("(food_id IS NULL) <> (saved_meal_id IS NULL)", name="one_source"),
        CheckConstraint(
            f"food_group IS NULL OR {_in('food_group', FOOD_GROUPS)}", name="food_group"
        ),
        CheckConstraint(
            "step_units > 0 AND min_units > 0 AND max_units >= min_units", name="amounts"
        ),
        CheckConstraint("unit_grams IS NULL OR unit_grams > 0", name="unit_grams_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="CASCADE"), index=True
    )
    saved_meal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_meals.id", ondelete="CASCADE"), index=True
    )
    food_group: Mapped[str | None] = mapped_column(Text)
    unit_label: Mapped[str] = mapped_column(Text)
    # Grams in one unit; None for a saved meal, whose unit is the whole meal.
    unit_grams: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    step_units: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    min_units: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    max_units: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    is_available: Mapped[bool] = mapped_column(Boolean, server_default=true())
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")


class PairPreference(Timestamps, Base):
    """Two staples the user does not want together ("Don't suggest these together"); never on
    one suggestion (task 3.23). Stored with staple_a_id < staple_b_id, once per pair."""

    __tablename__ = "pair_preferences"
    __table_args__ = (
        CheckConstraint("kind = 'never'", name="kind"),
        CheckConstraint("staple_a_id < staple_b_id", name="ordered"),
        Index("uq_pair_preferences_pair", "user_id", "staple_a_id", "staple_b_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    staple_a_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("staples.id", ondelete="CASCADE")
    )
    staple_b_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("staples.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(Text, server_default="never")


PAIRING_CONTEXTS = ("breakfast", "lunch", "dinner", "snack")


class PairingScore(Timestamps, Base):
    """How often two food groups share a plate in What We Eat in America, per context: score =
    log2(lift) clipped to -2 to +2, 0 when seen on fewer than 30 plates (task 3.22). Shared
    reference data built by tools/build_pairing.py: no owner, read by everyone, written only
    by the owner role."""

    __tablename__ = "pairing_scores"
    __table_args__ = (
        CheckConstraint(_in("context", PAIRING_CONTEXTS), name="context"),
        CheckConstraint(
            f"{_in('group_a', FOOD_GROUPS)} AND {_in('group_b', FOOD_GROUPS)} "
            "AND group_a < group_b",
            name="groups",
        ),
        CheckConstraint("score BETWEEN -2 AND 2", name="score_range"),
    )

    context: Mapped[str] = mapped_column(Text, primary_key=True)
    group_a: Mapped[str] = mapped_column(Text, primary_key=True)
    group_b: Mapped[str] = mapped_column(Text, primary_key=True)
    plates: Mapped[int] = mapped_column(Integer)
    lift: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    score: Mapped[Decimal] = mapped_column(Numeric(6, 4))
    data_version: Mapped[str] = mapped_column(Text)


class WaterLog(Timestamps, Base):
    """One water add, stored in ml; fl oz is only for display."""

    __tablename__ = "water_logs"
    __table_args__ = (
        CheckConstraint("ml > 0 AND ml <= 5000", name="ml_range"),
        Index("ix_water_logs_user_day", "user_id", "logged_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = _user_fk()
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # The user's local date, fixed when logged.
    logged_on: Mapped[date] = mapped_column(Date)
    ml: Mapped[int] = mapped_column(Integer)


class FoodQuery(Base):
    """When FoodData Central or Open Food Facts last answered a search, so each source is asked
    at most once per query in 30 days. Holds a hash of the normalized query, never the text,
    and nothing about who searched. Read and written only through food_query_* functions."""

    __tablename__ = "food_queries"

    source: Mapped[str] = mapped_column(Text, primary_key=True)
    query_hash: Mapped[bytes] = mapped_column(LargeBinary, primary_key=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


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
    "food_favourites": "user_id",
    "saved_meals": "user_id",
    "saved_meal_items": "user_id",
    "user_settings": "user_id",
    "water_logs": "user_id",
    "user_streaks": "user_id",
    "streak_events": "user_id",
    "weekly_goals": "user_id",
    "user_badges": "user_id",
    "push_subscriptions": "user_id",
    "staples": "user_id",
    "pair_preferences": "user_id",
}

# Every table holding rows a user owns: the RLS tables plus custom foods, whose owner column
# is nullable because null marks the shared cache. Account deletion must leave none behind.
OWNED_ROWS: dict[str, str] = {**RLS_TABLES, "foods": "owner_id"}
