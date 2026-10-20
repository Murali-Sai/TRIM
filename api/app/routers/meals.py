"""Saved meals (task 3.7b, SPEC page 4 "Saved meals").

A meal is a named list of foods with amounts. Logging it adds one entry per item with a shared
log_group_id and saved_meal_id, using each food's current values; each entry then stands on its
own (own nutrient snapshot), so editing or deleting the meal never changes past logs.
"""

import uuid
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import user_session
from app.deps import ServicesDep
from app.ids import uuid7
from app.models import FoodLog, SavedMeal, SavedMealItem
from app.routers.logs import (
    MAX_GRAMS,
    MAX_QUANTITY,
    LogOut,
    _check_time,
    _nutrient,
    _out,
    _timezone,
)
from app.security.sessions import ActiveUserDep
from app.timeutil import local_date

router = APIRouter(prefix="/meals", tags=["meals"])

MAX_ITEMS = 30
MAX_MEALS = 200
CENT = Decimal("0.01")
NOT_FOUND = "Meal not found"
NUTRIENTS = ("kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg")
PER_100 = {
    "kcal": "kcal_100",
    "protein_g": "protein_100",
    "carbs_g": "carbs_100",
    "fat_g": "fat_100",
    "fiber_g": "fiber_100",
    "sugar_g": "sugar_100",
    "sodium_mg": "sodium_mg_100",
}


class MealItemIn(BaseModel):
    """A food with grams, or a quantity of one of its serving units."""

    food_id: uuid.UUID
    grams: Annotated[float, Field(gt=0, le=MAX_GRAMS)] | None = None
    quantity: Annotated[float, Field(gt=0, le=MAX_QUANTITY)] | None = None
    unit_label: Annotated[str, Field(min_length=1, max_length=60)] | None = None

    @model_validator(mode="after")
    def _one_amount(self) -> "MealItemIn":
        by_unit = self.quantity is not None and self.unit_label is not None
        half_unit = (self.quantity is None) != (self.unit_label is None)
        if half_unit or (self.grams is not None) == by_unit:
            raise ValueError("Send grams, or quantity with unit_label")
        return self


Name = Annotated[str, Field(min_length=1, max_length=80)]
Items = Annotated[list[MealItemIn], Field(min_length=1, max_length=MAX_ITEMS)]


class MealIn(BaseModel):
    name: Name
    note: Annotated[str, Field(max_length=500)] | None = None
    items: Items


class MealPatch(BaseModel):
    name: Name | None = None
    note: Annotated[str, Field(max_length=500)] | None = None
    is_favourite: bool | None = None
    archived: bool | None = None
    # Replaces the items, in this order.
    items: Items | None = None


class FromLogsIn(BaseModel):
    name: Name
    log_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_ITEMS)]


class ItemOverride(BaseModel):
    item_id: uuid.UUID
    grams: Annotated[float, Field(gt=0, le=MAX_GRAMS)] | None = None
    quantity: Annotated[float, Field(gt=0, le=MAX_QUANTITY)] | None = None

    @model_validator(mode="after")
    def _one(self) -> "ItemOverride":
        if (self.grams is None) == (self.quantity is None):
            raise ValueError("Send grams or quantity")
        return self


class MealLogIn(BaseModel):
    """Overrides are the item's final amount for this log; the multiplier scales the rest."""

    eaten_at: AwareDatetime
    multiplier: Annotated[float, Field(ge=0.1, le=10)] = 1
    skipped_item_ids: list[uuid.UUID] = []
    item_overrides: list[ItemOverride] = []


class Totals(BaseModel):
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class MealItemOut(BaseModel):
    id: uuid.UUID
    food_id: uuid.UUID | None
    name: str | None
    brand: str | None
    grams: float
    quantity: float | None
    unit_label: str | None
    sort_order: int
    # The food was deleted, so this item is skipped when the meal is logged.
    missing: bool
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class MealOut(BaseModel):
    id: uuid.UUID
    name: str
    note: str | None
    is_favourite: bool
    use_count: int
    last_used_at: datetime | None
    archived_at: datetime | None
    items: list[MealItemOut]
    totals: Totals
    missing: int


class MealLogOut(BaseModel):
    entries: list[LogOut]
    # Items whose food no longer exists, left out of this log.
    missing: int


def _q(v: Decimal | float) -> Decimal:
    return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)


def _meal(s: Session, user_id: Any, meal_id: uuid.UUID) -> Any:
    meal = s.execute(
        text("SELECT * FROM saved_meals WHERE id = :m AND user_id = :u AND deleted_at IS NULL"),
        {"m": meal_id, "u": user_id},
    ).one_or_none()
    if meal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return meal


def _items(s: Session, meal_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Any]]:
    """Each meal's items in order, with the food's current values (null when it is gone)."""
    out: dict[uuid.UUID, list[Any]] = {m: [] for m in meal_ids}
    if not meal_ids:
        return out
    rows = s.execute(
        text(
            "SELECT i.*, f.name AS food_name, f.brand AS food_brand, f.kcal_100, "
            "f.protein_100, f.carbs_100, f.fat_100, f.fiber_100, f.sugar_100, f.sodium_mg_100 "
            "FROM saved_meal_items i LEFT JOIN foods f ON f.id = i.food_id "
            "AND f.deleted_at IS NULL WHERE i.saved_meal_id = ANY(:ids) "
            "AND i.deleted_at IS NULL ORDER BY i.sort_order, i.created_at, i.id"
        ),
        {"ids": meal_ids},
    ).all()
    for r in rows:
        out[r.saved_meal_id].append(r)
    return out


def _item_nutrients(r: Any, grams: Decimal) -> dict[str, Decimal | None]:
    return {n: _nutrient(getattr(r, PER_100[n]), grams) for n in NUTRIENTS}


def _meal_out(meal: Any, items: list[Any]) -> MealOut:
    out_items = []
    totals: dict[str, Decimal] = {
        "kcal": Decimal(0),
        "protein_g": Decimal(0),
        "carbs_g": Decimal(0),
        "fat_g": Decimal(0),
    }
    missing = 0
    for r in items:
        gone = r.food_name is None
        missing += gone
        n = (
            {k: Decimal(0) for k in NUTRIENTS}
            if gone
            else {k: v or Decimal(0) for k, v in _item_nutrients(r, r.grams).items()}
        )
        for k in ("kcal", "protein_g", "carbs_g", "fat_g"):
            totals[k] += n[k]
        out_items.append(
            MealItemOut(
                id=r.id,
                food_id=r.food_id,
                name=r.food_name,
                brand=r.food_brand,
                grams=float(r.grams),
                quantity=None if r.quantity is None else float(r.quantity),
                unit_label=r.unit_label,
                sort_order=r.sort_order,
                missing=gone,
                kcal=float(n["kcal"] or 0),
                protein_g=float(n["protein_g"] or 0),
                carbs_g=float(n["carbs_g"] or 0),
                fat_g=float(n["fat_g"] or 0),
            )
        )
    return MealOut(
        id=meal.id,
        name=meal.name,
        note=meal.note,
        is_favourite=meal.is_favourite,
        use_count=meal.use_count,
        last_used_at=meal.last_used_at,
        archived_at=meal.archived_at,
        items=out_items,
        totals=Totals(**{k: float(v) for k, v in totals.items()}),
        missing=missing,
    )


def _one(s: Session, user_id: Any, meal_id: uuid.UUID) -> MealOut:
    meal = _meal(s, user_id, meal_id)
    return _meal_out(meal, _items(s, [meal_id])[meal_id])


def _resolve(s: Session, item: MealItemIn) -> tuple[Decimal, Decimal | None, str | None]:
    """Grams for an item; the food must be visible to this user and the unit its own."""
    food = s.execute(
        text("SELECT id FROM foods WHERE id = :f AND deleted_at IS NULL"), {"f": item.food_id}
    ).first()
    if food is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Food not found")
    if item.grams is not None:
        return _q(item.grams), None, None
    unit = s.execute(
        text(
            "SELECT grams FROM serving_units WHERE food_id = :f AND label = :l "
            "AND deleted_at IS NULL LIMIT 1"
        ),
        {"f": item.food_id, "l": item.unit_label},
    ).scalar_one_or_none()
    if unit is None or item.quantity is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown serving unit")
    quantity = Decimal(str(item.quantity)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    return _q(quantity * unit), quantity, item.unit_label


def _check_name(s: Session, user_id: Any, name: str, meal_id: uuid.UUID | None = None) -> str:
    clean = " ".join(name.split())
    if not clean:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter a name")
    taken = s.execute(
        text(
            "SELECT 1 FROM saved_meals WHERE user_id = :u AND lower(name) = lower(:n) "
            "AND deleted_at IS NULL AND (CAST(:m AS uuid) IS NULL OR id <> :m)"
        ),
        {"u": user_id, "n": clean, "m": meal_id},
    ).first()
    if taken:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f'You already have a meal called "{clean}".'
        )
    return clean


def _set_items(s: Session, user_id: Any, meal_id: uuid.UUID, items: list[MealItemIn]) -> None:
    s.execute(text("DELETE FROM saved_meal_items WHERE saved_meal_id = :m"), {"m": meal_id})
    for i, item in enumerate(items):
        grams, quantity, unit_label = _resolve(s, item)
        s.add(
            SavedMealItem(
                user_id=user_id,
                saved_meal_id=meal_id,
                food_id=item.food_id,
                grams=grams,
                quantity=quantity,
                unit_label=unit_label,
                sort_order=i,
            )
        )
    s.flush()


def _create(s: Session, user_id: Any, name: str, note: str | None) -> uuid.UUID:
    count = s.execute(
        text("SELECT count(*) FROM saved_meals WHERE user_id = :u AND deleted_at IS NULL"),
        {"u": user_id},
    ).scalar_one()
    if count >= MAX_MEALS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"You have {MAX_MEALS} saved meals. Delete an archived one to add another.",
        )
    meal = SavedMeal(user_id=user_id, name=_check_name(s, user_id, name), note=note)
    s.add(meal)
    s.flush()
    return meal.id


@router.get("")
def list_meals(user: ActiveUserDep, archived: Annotated[bool, Query()] = False) -> list[MealOut]:
    """Favourites first, then most recently used, then by name."""
    with user_session(user.user_id) as s:
        meals = s.execute(
            text(
                "SELECT * FROM saved_meals WHERE user_id = :u AND deleted_at IS NULL "
                "AND (archived_at IS NOT NULL) = :a "
                "ORDER BY is_favourite DESC, last_used_at DESC NULLS LAST, lower(name)"
            ),
            {"u": user.user_id, "a": archived},
        ).all()
        items = _items(s, [m.id for m in meals])
        return [_meal_out(m, items[m.id]) for m in meals]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_meal(body: MealIn, user: ActiveUserDep) -> MealOut:
    with user_session(user.user_id) as s:
        meal_id = _create(s, user.user_id, body.name, body.note)
        _set_items(s, user.user_id, meal_id, body.items)
        return _one(s, user.user_id, meal_id)


@router.post("/from-logs", status_code=status.HTTP_201_CREATED)
def meal_from_logs(body: FromLogsIn, user: ActiveUserDep) -> MealOut:
    """Save a time block or a selection as a meal, with the amounts as logged. Quick adds have
    no food, so they are left out; another user's entries are 404."""
    ids = list(dict.fromkeys(body.log_ids))
    with user_session(user.user_id) as s:
        rows = s.execute(
            text(
                "SELECT l.id, l.food_id, l.grams, l.quantity, l.unit_label FROM food_logs l "
                "WHERE l.user_id = :u AND l.deleted_at IS NULL AND l.id = ANY(:ids) "
                "ORDER BY l.eaten_at, l.created_at, l.id"
            ),
            {"u": user.user_id, "ids": ids},
        ).all()
        if len(rows) != len(ids):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        usable = [r for r in rows if r.food_id is not None and r.grams is not None]
        if not usable:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Quick adds have no food to save. Choose entries logged from a food.",
            )
        meal_id = _create(s, user.user_id, body.name, None)
        for i, r in enumerate(usable):
            s.add(
                SavedMealItem(
                    user_id=user.user_id,
                    saved_meal_id=meal_id,
                    food_id=r.food_id,
                    grams=r.grams,
                    quantity=r.quantity,
                    unit_label=r.unit_label,
                    sort_order=i,
                )
            )
        s.flush()
        return _one(s, user.user_id, meal_id)


@router.get("/{meal_id}")
def get_meal(meal_id: uuid.UUID, user: ActiveUserDep) -> MealOut:
    with user_session(user.user_id) as s:
        return _one(s, user.user_id, meal_id)


@router.patch("/{meal_id}")
def edit_meal(
    meal_id: uuid.UUID, body: MealPatch, user: ActiveUserDep, services: ServicesDep
) -> MealOut:
    """Rename, note, favourite, archive or replace the items. Past logs keep their own values."""
    with user_session(user.user_id) as s:
        _meal(s, user.user_id, meal_id)
        changes: dict[str, Any] = {}
        if body.name is not None:
            changes["name"] = _check_name(s, user.user_id, body.name, meal_id)
        if "note" in body.model_fields_set:
            changes["note"] = body.note
        if body.is_favourite is not None:
            changes["is_favourite"] = body.is_favourite
        if body.archived is not None:
            changes["archived_at"] = services.clock() if body.archived else None
        if changes:
            sets = ", ".join(f"{k} = :{k}" for k in changes)
            s.execute(
                # Column names come from the fixed keys above, never from input.
                text(f"UPDATE saved_meals SET {sets}, updated_at = now() WHERE id = :m"),  # noqa: S608
                {**changes, "m": meal_id},
            )
        if body.items is not None:
            _set_items(s, user.user_id, meal_id, body.items)
        return _one(s, user.user_id, meal_id)


@router.delete("/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(meal_id: uuid.UUID, user: ActiveUserDep) -> None:
    """Only archived meals can be deleted. Past logs stay; their saved_meal_id is cleared."""
    with user_session(user.user_id) as s:
        meal = _meal(s, user.user_id, meal_id)
        if meal.archived_at is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Archive the meal before deleting it."
            )
        s.execute(text("DELETE FROM saved_meals WHERE id = :m"), {"m": meal_id})


@router.post("/{meal_id}/log", status_code=status.HTTP_201_CREATED)
def log_meal(
    meal_id: uuid.UUID, body: MealLogIn, user: ActiveUserDep, services: ServicesDep
) -> MealLogOut:
    """One entry per item, sharing a log_group_id; scaled from unrounded per-100 g values."""
    now = services.clock()
    with user_session(user.user_id) as s:
        meal = _meal(s, user.user_id, meal_id)
        items = _items(s, [meal_id])[meal_id]
        known = {i.id for i in items}
        overrides = {o.item_id: o for o in body.item_overrides}
        if not set(body.skipped_item_ids) <= known or not set(overrides) <= known:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown item in this meal")
        tz = _timezone(s, user.user_id)
        at = _check_time(body.eaten_at, now, tz)
        group = uuid7()
        factor = Decimal(str(body.multiplier))
        rows: list[FoodLog] = []
        missing = 0
        for r in items:
            if r.id in body.skipped_item_ids:
                continue
            if r.food_name is None:
                missing += 1
                continue
            o = overrides.get(r.id)
            quantity = r.quantity
            if o is not None and o.grams is not None:
                grams, quantity, unit_label = _q(o.grams), None, None
            elif o is not None and o.quantity is not None:
                if r.quantity is None:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_CONTENT, "That item is saved in grams"
                    )
                quantity = Decimal(str(o.quantity))
                grams, unit_label = _q(r.grams / r.quantity * quantity), r.unit_label
            else:
                grams = _q(r.grams * factor)
                quantity = None if r.quantity is None else r.quantity * factor
                unit_label = r.unit_label
            if grams <= 0 or grams > MAX_GRAMS:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Amount out of range")
            row = FoodLog(
                user_id=user.user_id,
                food_id=r.food_id,
                saved_meal_id=meal.id,
                log_group_id=group,
                eaten_at=at,
                logged_on=local_date(at, tz),
                name=r.food_name,
                brand=r.food_brand,
                grams=grams,
                quantity=None
                if quantity is None
                else Decimal(quantity).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP),
                unit_label=unit_label,
                **_item_nutrients(r, grams),
                source="meal",
                created_at=now,
            )
            s.add(row)
            rows.append(row)
        if not rows:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing left to log")
        s.execute(
            text(
                "UPDATE saved_meals SET use_count = use_count + 1, last_used_at = :now "
                "WHERE id = :m"
            ),
            {"now": now, "m": meal.id},
        )
        s.flush()
        out = []
        for row in rows:
            entry = _out(row)
            entry.meal_name = meal.name
            out.append(entry)
        return MealLogOut(entries=out, missing=missing)
