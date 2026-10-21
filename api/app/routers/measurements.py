"""Custom measurements (task 4.1): the user's own metrics and their readings.

Values come in and go out in the stored unit (cm, kg or %); the web app converts for display.
A left and right pair is created, renamed, switched on or off and archived together. Archiving
keeps every reading (they still chart and export); an archived metric takes no new readings.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import measurements as rules
from app.db import user_session
from app.deps import ServicesDep
from app.ids import uuid7
from app.models import MeasurementEntry, MeasurementType
from app.security.sessions import ActiveUserDep

router = APIRouter(tags=["measurements"])

Unit = Literal["cm", "in", "%", "kg", "lb", "text"]
Name = Annotated[str, Field(min_length=1, max_length=40)]
NOT_FOUND = "Metric not found"
ENTRY_NOT_FOUND = "Reading not found"


class Latest(BaseModel):
    value: float | None
    value_text: str | None
    measured_at: datetime


class TypeOut(BaseModel):
    id: uuid.UUID
    name: str
    unit: Unit
    precision: int
    side: Literal["left", "right"] | None
    pair_id: uuid.UUID | None
    is_preset: bool
    is_active: bool
    sort_order: int
    archived_at: datetime | None
    entries: int
    latest: Latest | None


class TypeIn(BaseModel):
    name: Name
    unit: Unit
    precision: Annotated[int, Field(ge=0, le=3)] = 1
    # A left and right pair ("Thigh, left" and "Thigh, right").
    paired: bool = False


class TypePatch(BaseModel):
    name: Name | None = None
    unit: Unit | None = None
    precision: Annotated[int, Field(ge=0, le=3)] | None = None
    is_active: bool | None = None
    archived: bool | None = None


class OrderIn(BaseModel):
    ids: Annotated[list[uuid.UUID], Field(max_length=rules.MAX_TYPES * 2)]


class ReadingIn(BaseModel):
    type_id: uuid.UUID
    # In the stored unit: cm for lengths, kg for masses, % for percentages.
    value: Annotated[float, Field(gt=0, le=1000)] | None = None
    value_text: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    note: Annotated[str, Field(max_length=500)] | None = None

    @model_validator(mode="after")
    def _one(self) -> "ReadingIn":
        if (self.value is None) == (self.value_text is None):
            raise ValueError("Send value or value_text")
        return self


class ReadingsIn(BaseModel):
    """Several metrics measured at one time (the quick-log)."""

    measured_at: AwareDatetime | None = None
    items: Annotated[list[ReadingIn], Field(min_length=1, max_length=rules.MAX_TYPES)]


class ReadingPatch(BaseModel):
    value: Annotated[float, Field(gt=0, le=1000)] | None = None
    value_text: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    measured_at: AwareDatetime | None = None
    note: Annotated[str, Field(max_length=500)] | None = None


class ReadingOut(BaseModel):
    id: uuid.UUID
    type_id: uuid.UUID
    value: float | None
    value_text: str | None
    measured_at: datetime
    note: str | None


def _types(s: Session, user_id: Any, archived: bool | None = None) -> list[TypeOut]:
    rows = s.execute(
        text(
            "SELECT t.*, (SELECT count(*) FROM measurement_entries e WHERE e.type_id = t.id "
            "AND e.deleted_at IS NULL) AS n, l.value AS l_value, l.value_text AS l_text, "
            "l.measured_at AS l_at FROM measurement_types t LEFT JOIN LATERAL ("
            "SELECT value, value_text, measured_at FROM measurement_entries e "
            "WHERE e.type_id = t.id AND e.deleted_at IS NULL "
            "ORDER BY measured_at DESC, id DESC LIMIT 1) l ON true "
            "WHERE t.user_id = :u AND t.deleted_at IS NULL "
            "AND (CAST(:a AS boolean) IS NULL OR (t.archived_at IS NOT NULL) = :a) "
            "ORDER BY t.sort_order, t.created_at, t.id"
        ),
        {"u": user_id, "a": archived},
    ).all()
    return [
        TypeOut(
            id=r.id,
            name=r.name,
            unit=r.unit,
            precision=r.precision,
            side=r.side,
            pair_id=r.pair_id,
            is_preset=r.is_preset,
            is_active=r.is_active,
            sort_order=r.sort_order,
            archived_at=r.archived_at,
            entries=r.n,
            latest=None
            if r.l_at is None
            else Latest(
                value=None if r.l_value is None else float(r.l_value),
                value_text=r.l_text,
                measured_at=r.l_at,
            ),
        )
        for r in rows
    ]


def _type(s: Session, user_id: Any, type_id: uuid.UUID) -> Any:
    row = s.execute(
        text(
            "SELECT * FROM measurement_types WHERE id = :t AND user_id = :u AND deleted_at IS NULL"
        ),
        {"t": type_id, "u": user_id},
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return row


def _clean_name(s: Session, user_id: Any, name: str, keep: list[uuid.UUID]) -> str:
    clean = " ".join(name.split())
    if not clean:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter a name")
    taken = s.execute(
        text(
            "SELECT 1 FROM measurement_types WHERE user_id = :u AND lower(name) = lower(:n) "
            "AND deleted_at IS NULL AND archived_at IS NULL AND NOT (id = ANY(:keep))"
        ),
        {"u": user_id, "n": clean, "keep": keep},
    ).first()
    if taken:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f'You already have a metric called "{clean}".'
        )
    return clean


def _group(s: Session, row: Any) -> list[uuid.UUID]:
    """The metric and its other side, if it has one."""
    if row.pair_id is None:
        return [row.id]
    return list(
        s.execute(
            text(
                "SELECT id FROM measurement_types WHERE pair_id = :p AND user_id = :u "
                "AND deleted_at IS NULL"
            ),
            {"p": row.pair_id, "u": row.user_id},
        ).scalars()
    )


# --- metrics ------------------------------------------------------------------------------


@router.get("/measurement-types")
def list_types(
    user: ActiveUserDep, archived: Annotated[bool | None, Query()] = None
) -> list[TypeOut]:
    """Every metric in the user's order, with how many readings it has and the latest."""
    with user_session(user.user_id) as s:
        return _types(s, user.user_id, archived)


@router.post("/measurement-types", status_code=status.HTTP_201_CREATED)
def create_type(body: TypeIn, user: ActiveUserDep) -> list[TypeOut]:
    with user_session(user.user_id) as s:
        n = s.execute(
            text(
                "SELECT count(*) FROM measurement_types WHERE user_id = :u "
                "AND deleted_at IS NULL AND archived_at IS NULL"
            ),
            {"u": user.user_id},
        ).scalar_one()
        if n + (2 if body.paired else 1) > rules.MAX_TYPES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"You can keep up to {rules.MAX_TYPES} metrics. Archive one to add another.",
            )
        name = _clean_name(s, user.user_id, body.name, [])
        last = s.execute(
            text("SELECT max(sort_order) FROM measurement_types WHERE user_id = :u"),
            {"u": user.user_id},
        ).scalar_one()
        order = 0 if last is None else last + 1
        pair = uuid7() if body.paired else None
        for side in ("left", "right") if body.paired else (None,):
            s.add(
                MeasurementType(
                    user_id=user.user_id,
                    name=name,
                    unit=body.unit,
                    precision=body.precision,
                    side=side,
                    pair_id=pair,
                    sort_order=order,
                )
            )
            order += 1
        s.flush()
        return _types(s, user.user_id)


@router.put("/measurement-types/order")
def reorder_types(body: OrderIn, user: ActiveUserDep) -> list[TypeOut]:
    """Every metric's id, in the new order (archived ones may be left out)."""
    with user_session(user.user_id) as s:
        mine = set(
            s.execute(
                text("SELECT id FROM measurement_types WHERE user_id = :u AND deleted_at IS NULL"),
                {"u": user.user_id},
            ).scalars()
        )
        if not set(body.ids) <= mine:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        if len(set(body.ids)) != len(body.ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each metric once")
        for i, type_id in enumerate(body.ids):
            s.execute(
                text(
                    "UPDATE measurement_types SET sort_order = :o, updated_at = now() WHERE id = :t"
                ),
                {"o": i, "t": type_id},
            )
        return _types(s, user.user_id)


@router.patch("/measurement-types/{type_id}")
def edit_type(
    type_id: uuid.UUID, body: TypePatch, user: ActiveUserDep, services: ServicesDep
) -> list[TypeOut]:
    """Rename, change the shown unit or precision, switch on or off, archive or restore. A
    pair changes together. History is kept: archiving hides a metric, it deletes nothing."""
    with user_session(user.user_id) as s:
        row = _type(s, user.user_id, type_id)
        ids = _group(s, row)
        changes: dict[str, Any] = {}
        if body.name is not None:
            changes["name"] = _clean_name(s, user.user_id, body.name, ids)
        if body.unit is not None and body.unit != row.unit:
            has = s.execute(
                text(
                    "SELECT 1 FROM measurement_entries WHERE type_id = ANY(:ids) "
                    "AND deleted_at IS NULL LIMIT 1"
                ),
                {"ids": ids},
            ).first()
            if has and not rules.same_kind(row.unit, body.unit):
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "This metric has readings, so it can only switch between cm and in, or kg "
                    "and lb.",
                )
            changes["unit"] = body.unit
        if body.precision is not None:
            changes["precision"] = body.precision
        if body.is_active is not None:
            changes["is_active"] = body.is_active
        if body.archived is not None:
            changes["archived_at"] = services.clock() if body.archived else None
            if not body.archived:
                # Restoring must not clash with a live metric of the same name.
                _clean_name(s, user.user_id, changes.get("name", row.name), ids)
        if changes:
            sets = ", ".join(f"{k} = :{k}" for k in changes)
            s.execute(
                # Column names come from the fixed keys above, never from input.
                text(
                    f"UPDATE measurement_types SET {sets}, updated_at = now() "  # noqa: S608
                    "WHERE id = ANY(:ids)"
                ),
                {**changes, "ids": ids},
            )
        return _types(s, user.user_id)


# --- readings -----------------------------------------------------------------------------


def _q(v: float) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _check(t: Any, value: float | None, value_text: str | None) -> None:
    if t.archived_at is not None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Restore this metric to add readings."
        )
    if t.unit == "text":
        if value_text is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This metric takes text")
        return
    if value is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This metric takes a number")
    if rules.out_of_range(t.unit, value):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That reading is outside the usual range."
        )


def _reading(r: Any) -> ReadingOut:
    return ReadingOut(
        id=r.id,
        type_id=r.type_id,
        value=None if r.value is None else float(r.value),
        value_text=r.value_text,
        measured_at=r.measured_at.astimezone(UTC),
        note=r.note,
    )


def _not_future(at: datetime, now: datetime) -> datetime:
    at = at.astimezone(UTC)
    if at > now + timedelta(minutes=5):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "A reading cannot be in the future."
        )
    return at


@router.get("/measurements")
def list_readings(
    user: ActiveUserDep,
    type_id: Annotated[uuid.UUID | None, Query()] = None,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
) -> list[ReadingOut]:
    """Readings, oldest first; one metric's, or every metric's. Dates are inclusive and in
    the user's timezone."""
    with user_session(user.user_id) as s:
        if type_id is not None:
            _type(s, user.user_id, type_id)
        tz: str = s.execute(
            text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user.user_id}
        ).scalar_one()
        rows = s.execute(
            text(
                "SELECT * FROM measurement_entries WHERE user_id = :u AND deleted_at IS NULL "
                "AND (CAST(:t AS uuid) IS NULL OR type_id = :t) "
                "AND (CAST(:a AS date) IS NULL OR (measured_at AT TIME ZONE :tz)::date >= :a) "
                "AND (CAST(:b AS date) IS NULL OR (measured_at AT TIME ZONE :tz)::date <= :b) "
                "ORDER BY measured_at, id"
            ),
            {"u": user.user_id, "t": type_id, "a": date_from, "b": date_to, "tz": tz},
        ).all()
        return [_reading(r) for r in rows]


@router.post("/measurements", status_code=status.HTTP_201_CREATED)
def add_readings(body: ReadingsIn, user: ActiveUserDep, services: ServicesDep) -> list[ReadingOut]:
    now = services.clock()
    at = _not_future(body.measured_at or now, now)
    with user_session(user.user_id) as s:
        rows = []
        for item in body.items:
            t = _type(s, user.user_id, item.type_id)
            _check(t, item.value, item.value_text)
            row = MeasurementEntry(
                user_id=user.user_id,
                type_id=t.id,
                value=None if item.value is None else _q(item.value),
                value_text=item.value_text,
                measured_at=at,
                note=item.note,
            )
            s.add(row)
            rows.append(row)
        s.flush()
        return [_reading(r) for r in rows]


def _entry(s: Session, user_id: Any, entry_id: uuid.UUID) -> Any:
    row = s.execute(
        text(
            "SELECT * FROM measurement_entries WHERE id = :e AND user_id = :u "
            "AND deleted_at IS NULL"
        ),
        {"e": entry_id, "u": user_id},
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, ENTRY_NOT_FOUND)
    return row


@router.patch("/measurements/{entry_id}")
def edit_reading(
    entry_id: uuid.UUID, body: ReadingPatch, user: ActiveUserDep, services: ServicesDep
) -> ReadingOut:
    with user_session(user.user_id) as s:
        row = _entry(s, user.user_id, entry_id)
        t = _type(s, user.user_id, row.type_id)
        value = body.value if body.value is not None else row.value
        value_text = body.value_text if body.value_text is not None else row.value_text
        if body.value is not None or body.value_text is not None:
            _check(t, None if value is None else float(value), value_text)
        changes: dict[str, Any] = {}
        if body.value is not None:
            changes["value"] = _q(body.value)
        if body.value_text is not None:
            changes["value_text"] = body.value_text
        if body.measured_at is not None:
            changes["measured_at"] = _not_future(body.measured_at, services.clock())
        if "note" in body.model_fields_set:
            changes["note"] = body.note
        if changes:
            sets = ", ".join(f"{k} = :{k}" for k in changes)
            s.execute(
                # Column names come from the fixed keys above, never from input.
                text(
                    f"UPDATE measurement_entries SET {sets}, updated_at = now() "  # noqa: S608
                    "WHERE id = :e"
                ),
                {**changes, "e": entry_id},
            )
        return _reading(_entry(s, user.user_id, entry_id))


@router.delete("/measurements/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reading(entry_id: uuid.UUID, user: ActiveUserDep) -> None:
    with user_session(user.user_id) as s:
        _entry(s, user.user_id, entry_id)
        s.execute(text("DELETE FROM measurement_entries WHERE id = :e"), {"e": entry_id})
