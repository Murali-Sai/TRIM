"""Food logs with the time they were eaten (task 3.4, SPEC page 4 "Today screen design and
time-based logging").

POST takes `eaten_at` and a list of items; every item gets that time and one shared
log_group_id. Nutrients are computed here from the food (grams x per100 / 100) and stored as a
snapshot; the browser never sends nutrient numbers. `logged_on` is the user's local date for
eaten_at, fixed when logged, so changing timezone later never moves old entries.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import user_session
from app.deps import ServicesDep
from app.ids import uuid7
from app.models import FoodLog
from app.security.sessions import ActiveUserDep
from app.timeutil import local_date

router = APIRouter(prefix="/logs", tags=["logs"])

MAX_ITEMS = 50
MAX_GRAMS = 5000
MAX_QUANTITY = 1000
MAX_RANGE_DAYS = 62
EARLIEST = date(2000, 1, 1)
CENT = Decimal("0.01")
FOOD_NOT_FOUND = "Food not found"


class LogItemIn(BaseModel):
    """Either grams, or a quantity of one of the food's serving units ("2 x 1 jar")."""

    food_id: uuid.UUID
    grams: Annotated[float, Field(gt=0, le=MAX_GRAMS)] | None = None
    quantity: Annotated[float, Field(gt=0, le=MAX_QUANTITY)] | None = None
    unit_label: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    source: Literal["search", "recent"] = "search"

    @model_validator(mode="after")
    def _one_amount(self) -> "LogItemIn":
        by_unit = self.quantity is not None and self.unit_label is not None
        half_unit = (self.quantity is None) != (self.unit_label is None)
        if half_unit or (self.grams is not None) == by_unit:
            raise ValueError("Send grams, or quantity with unit_label")
        return self


class LogsIn(BaseModel):
    eaten_at: AwareDatetime
    items: Annotated[list[LogItemIn], Field(min_length=1, max_length=MAX_ITEMS)]


class LogOut(BaseModel):
    id: uuid.UUID
    log_group_id: uuid.UUID
    food_id: uuid.UUID | None
    eaten_at: datetime
    logged_on: date
    name: str
    brand: str | None
    grams: float | None
    quantity: float | None
    unit_label: str | None
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float | None
    sugar_g: float | None
    sodium_mg: float | None
    source: str


class LastTimeOut(BaseModel):
    """The eaten_at of the user's most recent add, for the "last used" time chip."""

    eaten_at: datetime | None


def _f(v: Decimal | None) -> float | None:
    return None if v is None else float(v)


def _out(row: Any) -> LogOut:
    return LogOut(
        id=row.id,
        log_group_id=row.log_group_id,
        food_id=row.food_id,
        eaten_at=row.eaten_at.astimezone(UTC),
        logged_on=row.logged_on,
        name=row.name,
        brand=row.brand,
        grams=_f(row.grams),
        quantity=_f(row.quantity),
        unit_label=row.unit_label,
        kcal=float(row.kcal),
        protein_g=float(row.protein_g),
        carbs_g=float(row.carbs_g),
        fat_g=float(row.fat_g),
        fiber_g=_f(row.fiber_g),
        sugar_g=_f(row.sugar_g),
        sodium_mg=_f(row.sodium_mg),
        source=row.source,
    )


def _timezone(s: Session, user_id: Any) -> str:
    tz: str = s.execute(
        text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user_id}
    ).scalar_one()
    return tz


def _nutrient(per_100: Decimal | None, grams: Decimal) -> Decimal | None:
    """Logged nutrients: grams x per100 / 100 (SPEC page 3). Unknown stays unknown."""
    if per_100 is None:
        return None
    return (per_100 * grams / 100).quantize(CENT, rounding=ROUND_HALF_UP)


def _food(s: Session, food_id: uuid.UUID) -> Any:
    """The food if this user may see it (shared cache or their own, by RLS); else 404."""
    food = s.execute(
        text(
            "SELECT id, name, brand, kcal_100, protein_100, carbs_100, fat_100, fiber_100, "
            "sugar_100, sodium_mg_100 FROM foods WHERE id = :f AND deleted_at IS NULL"
        ),
        {"f": food_id},
    ).one_or_none()
    if food is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, FOOD_NOT_FOUND)
    return food


def _grams(s: Session, item: LogItemIn) -> tuple[Decimal, Decimal | None, str | None]:
    if item.grams is not None:
        return Decimal(str(item.grams)).quantize(CENT, rounding=ROUND_HALF_UP), None, None
    if item.quantity is None or item.unit_label is None:  # ruled out by LogItemIn
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Send an amount")
    unit = s.execute(
        text(
            "SELECT grams FROM serving_units WHERE food_id = :f AND label = :l "
            "AND deleted_at IS NULL LIMIT 1"
        ),
        {"f": item.food_id, "l": item.unit_label},
    ).scalar_one_or_none()
    if unit is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown serving unit")
    quantity = Decimal(str(item.quantity)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    grams = (quantity * unit).quantize(CENT, rounding=ROUND_HALF_UP)
    if grams <= 0 or grams > MAX_GRAMS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Amount out of range")
    return grams, quantity, item.unit_label


def _check_time(eaten_at: datetime, now: datetime, tz: str) -> datetime:
    """Whole minutes (a time block is one minute). Past days are fine; later than today is not."""
    at = eaten_at.replace(second=0, microsecond=0).astimezone(UTC)
    zone = ZoneInfo(tz)
    local = at.astimezone(zone)
    today = local_date(now, tz)
    if local.date() > today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "You can log food for today or earlier."
        )
    if local.date() < EARLIEST:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That date is too far back.")
    return at


@router.post("", status_code=status.HTTP_201_CREATED)
def add_logs(body: LogsIn, user: ActiveUserDep, services: ServicesDep) -> list[LogOut]:
    now = services.clock()
    with user_session(user.user_id) as s:
        tz = _timezone(s, user.user_id)
        eaten_at = _check_time(body.eaten_at, now, tz)
        logged_on = local_date(eaten_at, tz)
        group = uuid7()
        rows: list[FoodLog] = []
        for item in body.items:
            food = _food(s, item.food_id)
            grams, quantity, unit_label = _grams(s, item)
            row = FoodLog(
                user_id=user.user_id,
                food_id=food.id,
                log_group_id=group,
                eaten_at=eaten_at,
                logged_on=logged_on,
                name=food.name,
                brand=food.brand,
                grams=grams,
                quantity=quantity,
                unit_label=unit_label,
                kcal=_nutrient(food.kcal_100, grams),
                protein_g=_nutrient(food.protein_100, grams),
                carbs_g=_nutrient(food.carbs_100, grams),
                fat_g=_nutrient(food.fat_100, grams),
                fiber_g=_nutrient(food.fiber_100, grams),
                sugar_g=_nutrient(food.sugar_100, grams),
                sodium_mg=_nutrient(food.sodium_mg_100, grams),
                source=item.source,
                created_at=now,
            )
            s.add(row)
            rows.append(row)
        s.flush()
        return [_out(r) for r in rows]


@router.get("")
def list_logs(
    user: ActiveUserDep,
    date_from: Annotated[date, Query()],
    date_to: Annotated[date | None, Query()] = None,
) -> list[LogOut]:
    """Entries whose local date is in [date_from, date_to], earliest eaten first."""
    end = date_to or date_from
    if end < date_from or (end - date_from) > timedelta(days=MAX_RANGE_DAYS - 1):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Choose a range of 1 to {MAX_RANGE_DAYS} days.",
        )
    with user_session(user.user_id) as s:
        rows = s.execute(
            text(
                "SELECT * FROM food_logs WHERE user_id = :u AND deleted_at IS NULL "
                "AND logged_on BETWEEN :a AND :b ORDER BY eaten_at, created_at, id"
            ),
            {"u": user.user_id, "a": date_from, "b": end},
        ).all()
        return [_out(r) for r in rows]


@router.get("/last-time")
def last_time(user: ActiveUserDep) -> LastTimeOut:
    with user_session(user.user_id) as s:
        at = s.execute(
            text(
                "SELECT eaten_at FROM food_logs WHERE user_id = :u AND deleted_at IS NULL "
                "ORDER BY created_at DESC, id DESC LIMIT 1"
            ),
            {"u": user.user_id},
        ).scalar_one_or_none()
    return LastTimeOut(eaten_at=at)


# --- edit, delete, move and copy (task 3.6) ------------------------------------------------


class LogPatchIn(BaseModel):
    """Any of: a new time, new grams, or a new quantity of the entry's own serving unit.

    A new amount scales the entry's nutrient snapshot, so later edits to the food never leak
    into history and an entry whose custom food was deleted can still be changed.
    """

    eaten_at: AwareDatetime | None = None
    grams: Annotated[float, Field(gt=0, le=MAX_GRAMS)] | None = None
    quantity: Annotated[float, Field(gt=0, le=MAX_QUANTITY)] | None = None

    @model_validator(mode="after")
    def _one_amount(self) -> "LogPatchIn":
        if self.grams is not None and self.quantity is not None:
            raise ValueError("Send grams or quantity, not both")
        return self


Ids = Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_ITEMS * 2)]


class LogsAtIn(BaseModel):
    """Entries (for example a whole time block) and the time to move or copy them to."""

    ids: Ids
    eaten_at: AwareDatetime


NUTRIENTS = ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg")
NOT_FOUND = "Not found"


def _rows(s: Session, user_id: Any, ids: list[uuid.UUID]) -> list[Any]:
    """The user's live entries with these ids, in the order given. Any other id is a 404, so
    nobody learns whether another user's entry exists."""
    wanted = list(dict.fromkeys(ids))
    rows = s.execute(
        text(
            "SELECT * FROM food_logs WHERE user_id = :u AND deleted_at IS NULL AND id = ANY(:ids)"
        ),
        {"u": user_id, "ids": wanted},
    ).all()
    if len(rows) != len(wanted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in wanted]


def _scaled(row: Any, grams: Decimal) -> dict[str, Decimal | None]:
    factor = grams / row.grams
    return {
        n: None
        if getattr(row, n) is None
        else (getattr(row, n) * factor).quantize(CENT, rounding=ROUND_HALF_UP)
        for n in NUTRIENTS
    }


@router.patch("/{log_id}")
def edit_log(
    log_id: uuid.UUID, body: LogPatchIn, user: ActiveUserDep, services: ServicesDep
) -> LogOut:
    now = services.clock()
    with user_session(user.user_id) as s:
        [row] = _rows(s, user.user_id, [log_id])
        changes: dict[str, Any] = {}
        if body.eaten_at is not None:
            tz = _timezone(s, user.user_id)
            at = _check_time(body.eaten_at, now, tz)
            changes |= {"eaten_at": at, "logged_on": local_date(at, tz)}
        if body.grams is not None or body.quantity is not None:
            if row.grams is None:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "A quick add has no amount to change"
                )
            if body.quantity is not None:
                if row.quantity is None:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_CONTENT, "This entry is logged in grams"
                    )
                quantity = Decimal(str(body.quantity)).quantize(
                    Decimal("0.001"), rounding=ROUND_HALF_UP
                )
                grams = (row.grams / row.quantity * quantity).quantize(CENT, rounding=ROUND_HALF_UP)
                changes |= {"quantity": quantity}
            else:
                grams = Decimal(str(body.grams)).quantize(CENT, rounding=ROUND_HALF_UP)
                # Switching to grams drops the serving unit.
                changes |= {"quantity": None, "unit_label": None}
            if grams <= 0 or grams > MAX_GRAMS:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Amount out of range")
            changes |= {"grams": grams, **_scaled(row, grams)}
        if changes:
            sets = ", ".join(f"{k} = :{k}" for k in changes)
            s.execute(
                # Column names come from the fixed keys above, never from input.
                text(
                    f"UPDATE food_logs SET {sets}, updated_at = :now "  # noqa: S608
                    "WHERE id = :id AND user_id = :u"
                ),
                {**changes, "now": now, "id": log_id, "u": user.user_id},
            )
        [updated] = _rows(s, user.user_id, [log_id])
        return _out(updated)


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(log_id: uuid.UUID, user: ActiveUserDep, services: ServicesDep) -> None:
    with user_session(user.user_id) as s:
        _rows(s, user.user_id, [log_id])
        s.execute(
            text("UPDATE food_logs SET deleted_at = :now WHERE id = :id AND user_id = :u"),
            {"now": services.clock(), "id": log_id, "u": user.user_id},
        )


@router.post("/{log_id}/restore")
def restore_log(log_id: uuid.UUID, user: ActiveUserDep) -> LogOut:
    """Undo a delete."""
    with user_session(user.user_id) as s:
        restored = s.execute(
            text(
                "UPDATE food_logs SET deleted_at = NULL "
                "WHERE id = :id AND user_id = :u AND deleted_at IS NOT NULL"
            ),
            {"id": log_id, "u": user.user_id},
        )
        if restored.rowcount != 1:  # type: ignore[attr-defined]
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        [row] = _rows(s, user.user_id, [log_id])
        return _out(row)


@router.post("/move")
def move_logs(body: LogsAtIn, user: ActiveUserDep, services: ServicesDep) -> list[LogOut]:
    """Moves entries, or a whole time block, to a new time or day. All or nothing."""
    now = services.clock()
    with user_session(user.user_id) as s:
        tz = _timezone(s, user.user_id)
        at = _check_time(body.eaten_at, now, tz)
        rows = _rows(s, user.user_id, body.ids)
        s.execute(
            text(
                "UPDATE food_logs SET eaten_at = :at, logged_on = :on, updated_at = :now "
                "WHERE user_id = :u AND id = ANY(:ids)"
            ),
            {
                "at": at,
                "on": local_date(at, tz),
                "now": now,
                "u": user.user_id,
                "ids": [r.id for r in rows],
            },
        )
        return [_out(r) for r in _rows(s, user.user_id, [r.id for r in rows])]


@router.post("/copy", status_code=status.HTTP_201_CREATED)
def copy_logs(body: LogsAtIn, user: ActiveUserDep, services: ServicesDep) -> list[LogOut]:
    """Copies entries, or a time block, to a time on any day up to today ("copy a time block
    to today" replaces "copy yesterday's meal"). The copies are one new add."""
    now = services.clock()
    with user_session(user.user_id) as s:
        tz = _timezone(s, user.user_id)
        at = _check_time(body.eaten_at, now, tz)
        group = uuid7()
        copies = [
            FoodLog(
                user_id=user.user_id,
                food_id=r.food_id,
                saved_meal_id=r.saved_meal_id,
                log_group_id=group,
                eaten_at=at,
                logged_on=local_date(at, tz),
                name=r.name,
                brand=r.brand,
                grams=r.grams,
                quantity=r.quantity,
                unit_label=r.unit_label,
                **{n: getattr(r, n) for n in NUTRIENTS},
                source=r.source,
                created_at=now,
            )
            for r in _rows(s, user.user_id, body.ids)
        ]
        s.add_all(copies)
        s.flush()
        return [_out(c) for c in copies]
