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


# Every table that row-level security protects, with the column that names the owner.
RLS_TABLES: dict[str, str] = {
    "users": "id",
    "user_profiles": "user_id",
    "sessions": "user_id",
    "auth_tokens": "user_id",
    "audit_log": "user_id",
    "weight_entries": "user_id",
    "targets": "user_id",
}
