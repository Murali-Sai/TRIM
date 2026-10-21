"""My staples (task 3.19, SPEC page 3 "My staples" and page 4 "My staples page").

Up to 20 foods or saved meals the user eats often, each with a unit, the amounts a suggestion
may use, and a food group guessed from the name (editable). The limit is enforced by a trigger
(migration 0013); the check here only gives a friendlier message first. After 14 days of
logging the app offers, once, to add the 10 most-logged foods.
"""

import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import staples as rules
from app.db import user_session
from app.deps import ServicesDep
from app.food_groups import guess_group
from app.models import FOOD_GROUPS, Staple
from app.routers.meals import _items, _meal_out
from app.security.sessions import ActiveUserDep

router = APIRouter(prefix="/staples", tags=["staples"])

NOT_FOUND = "Staple not found"
LIMIT = f"You can keep up to {rules.MAX_STAPLES} staples. Remove one to add another."
PROMPT_DAYS = 14
PROMPT_FOODS = 10
CENT = Decimal("0.01")

Units = Annotated[Decimal, Field(gt=0, le=rules.MAX_UNITS, decimal_places=2)]


class StapleIn(BaseModel):
    """A food (with one of its serving units, or 100 g by default) or a saved meal."""

    food_id: uuid.UUID | None = None
    saved_meal_id: uuid.UUID | None = None
    unit_label: Annotated[str, Field(min_length=1, max_length=60)] | None = None

    @model_validator(mode="after")
    def _one_source(self) -> "StapleIn":
        if (self.food_id is None) == (self.saved_meal_id is None):
            raise ValueError("Send food_id or saved_meal_id")
        if self.saved_meal_id is not None and self.unit_label is not None:
            raise ValueError("A meal's unit is the whole meal")
        return self


class StaplePatch(BaseModel):
    """Changing the unit resets the amounts to that unit's defaults unless they are sent too."""

    unit_label: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    step_units: Units | None = None
    min_units: Units | None = None
    max_units: Units | None = None
    is_available: bool | None = None
    food_group: Annotated[str, Field(max_length=40)] | None = None


class OrderIn(BaseModel):
    ids: Annotated[list[uuid.UUID], Field(max_length=rules.MAX_STAPLES)]


class PromptIn(BaseModel):
    accept: bool


class PerUnit(BaseModel):
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class UnitOut(BaseModel):
    label: str
    grams: float


class StapleOut(BaseModel):
    id: uuid.UUID
    food_id: uuid.UUID | None
    saved_meal_id: uuid.UUID | None
    name: str | None
    brand: str | None
    food_group: str | None
    unit_label: str
    unit_grams: float | None
    step_units: float
    min_units: float
    max_units: float
    amounts: list[float]
    is_available: bool
    sort_order: int
    per_unit: PerUnit
    # Units the staple could switch to (a food's serving units and 100 g); none for a meal.
    units: list[UnitOut]
    # The food or meal was deleted, so suggestions skip this staple.
    missing: bool


class StaplesOut(BaseModel):
    staples: list[StapleOut]
    count: int
    limit: int


class PromptFood(BaseModel):
    food_id: uuid.UUID
    name: str
    brand: str | None
    times_logged: int


class PromptOut(BaseModel):
    offer: bool
    foods: list[PromptFood]


def _d(v: float | Decimal) -> Decimal:
    return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)


def _food(s: Session, food_id: uuid.UUID) -> Any:
    food = s.execute(
        text("SELECT id, name FROM foods WHERE id = :f AND deleted_at IS NULL"), {"f": food_id}
    ).first()
    if food is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Food not found")
    return food


def _food_unit(s: Session, food_id: uuid.UUID, label: str | None) -> tuple[str, Decimal]:
    """The unit and its grams: the label asked for, else the default serving, else 100 g."""
    if label == "100 g":
        return "100 g", Decimal(100)
    row = s.execute(
        text(
            "SELECT label, grams FROM serving_units WHERE food_id = :f AND deleted_at IS NULL "
            "AND (CAST(:l AS text) IS NULL AND is_default OR label = :l) "
            "ORDER BY is_default DESC LIMIT 1"
        ),
        {"f": food_id, "l": label},
    ).first()
    if row is None:
        if label is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown serving unit")
        return "100 g", Decimal(100)
    return row.label, row.grams


def _staple(s: Session, user_id: Any, staple_id: uuid.UUID) -> Any:
    row = s.execute(
        text("SELECT * FROM staples WHERE id = :i AND user_id = :u AND deleted_at IS NULL"),
        {"i": staple_id, "u": user_id},
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return row


def _count(s: Session, user_id: Any) -> int:
    n: int = s.execute(
        text("SELECT count(*) FROM staples WHERE user_id = :u AND deleted_at IS NULL"),
        {"u": user_id},
    ).scalar_one()
    return n


def _taken(s: Session, user_id: Any, food_id: Any, meal_id: Any) -> bool:
    return (
        s.execute(
            text(
                "SELECT 1 FROM staples WHERE user_id = :u AND deleted_at IS NULL "
                "AND (food_id = :f OR saved_meal_id = :m)"
            ),
            {"u": user_id, "f": food_id, "m": meal_id},
        ).first()
        is not None
    )


def _add(
    s: Session,
    user_id: Any,
    *,
    food_id: uuid.UUID | None = None,
    meal_id: uuid.UUID | None = None,
    unit_label: str | None = None,
) -> uuid.UUID:
    if food_id is not None:
        food = _food(s, food_id)
        label, grams = _food_unit(s, food_id, unit_label)
        unit_grams: Decimal | None = grams
        group = guess_group(food.name)
    else:
        meal = s.execute(
            text(
                "SELECT id, name FROM saved_meals WHERE id = :m AND user_id = :u "
                "AND deleted_at IS NULL"
            ),
            {"m": meal_id, "u": user_id},
        ).first()
        if meal is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Meal not found")
        label, unit_grams = rules.MEAL_UNIT, None
        # A meal is a mixed dish unless its name says otherwise ("Overnight oats").
        group = guess_group(meal.name) or "mixed_dishes"
    if _taken(s, user_id, food_id, meal_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That is already a staple.")
    if _count(s, user_id) >= rules.MAX_STAPLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, LIMIT)
    a = rules.default_amounts(label)
    last = s.execute(
        text("SELECT max(sort_order) FROM staples WHERE user_id = :u AND deleted_at IS NULL"),
        {"u": user_id},
    ).scalar_one()
    row = Staple(
        user_id=user_id,
        food_id=food_id,
        saved_meal_id=meal_id,
        food_group=group,
        unit_label=label,
        unit_grams=unit_grams,
        step_units=a.step,
        min_units=a.min,
        max_units=a.max,
        sort_order=0 if last is None else last + 1,
    )
    s.add(row)
    try:
        s.flush()
    except IntegrityError as e:
        # Another request added the 20th first: the trigger has the last word.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, LIMIT) from e
    return row.id


def staple_rows(s: Session, user_id: Any) -> list[StapleOut]:
    rows = s.execute(
        text(
            "SELECT st.*, f.name AS food_name, f.brand AS food_brand, f.kcal_100, f.protein_100, "
            "f.carbs_100, f.fat_100, m.name AS meal_name FROM staples st "
            "LEFT JOIN foods f ON f.id = st.food_id AND f.deleted_at IS NULL "
            "LEFT JOIN saved_meals m ON m.id = st.saved_meal_id AND m.deleted_at IS NULL "
            "WHERE st.user_id = :u AND st.deleted_at IS NULL ORDER BY st.sort_order, st.id"
        ),
        {"u": user_id},
    ).all()
    food_ids = [r.food_id for r in rows if r.food_id is not None]
    units: dict[Any, list[UnitOut]] = {f: [] for f in food_ids}
    if food_ids:
        for u in s.execute(
            text(
                "SELECT food_id, label, grams FROM serving_units WHERE food_id = ANY(:ids) "
                "AND deleted_at IS NULL ORDER BY is_default DESC, grams"
            ),
            {"ids": food_ids},
        ).all():
            units[u.food_id].append(UnitOut(label=u.label, grams=float(u.grams)))
    meal_ids = [r.saved_meal_id for r in rows if r.meal_name is not None]
    meals = {}
    if meal_ids:
        meal_rows = s.execute(
            text("SELECT * FROM saved_meals WHERE id = ANY(:ids)"), {"ids": meal_ids}
        ).all()
        items = _items(s, meal_ids)
        meals = {m.id: _meal_out(m, items[m.id]).totals for m in meal_rows}
    out = []
    for r in rows:
        missing = r.food_name is None and r.meal_name is None
        if r.food_id is not None and not missing:
            k = r.unit_grams / 100
            per = PerUnit(
                kcal=float(r.kcal_100 * k),
                protein_g=float(r.protein_100 * k),
                carbs_g=float(r.carbs_100 * k),
                fat_g=float(r.fat_100 * k),
            )
        elif r.saved_meal_id in meals:
            per = PerUnit(**meals[r.saved_meal_id].model_dump())
        else:
            per = PerUnit(kcal=0, protein_g=0, carbs_g=0, fat_g=0)
        a = rules.Amounts(r.step_units, r.min_units, r.max_units)
        options = []
        if r.food_id is not None:
            options = [UnitOut(label="100 g", grams=100)] + [
                u for u in units.get(r.food_id, []) if u.label != "100 g"
            ]
        out.append(
            StapleOut(
                id=r.id,
                food_id=r.food_id,
                saved_meal_id=r.saved_meal_id,
                name=r.food_name or r.meal_name,
                brand=r.food_brand,
                food_group=r.food_group,
                unit_label=r.unit_label,
                unit_grams=None if r.unit_grams is None else float(r.unit_grams),
                step_units=float(r.step_units),
                min_units=float(r.min_units),
                max_units=float(r.max_units),
                amounts=[float(v) for v in rules.allowed(a)],
                is_available=r.is_available,
                sort_order=r.sort_order,
                per_unit=per,
                units=options,
                missing=missing,
            )
        )
    return out


def _all(s: Session, user_id: Any) -> StaplesOut:
    staples = staple_rows(s, user_id)
    return StaplesOut(staples=staples, count=len(staples), limit=rules.MAX_STAPLES)


def _top_foods(s: Session, user_id: Any) -> list[PromptFood]:
    """The most-logged foods that are not staples yet, most entries first."""
    rows = s.execute(
        text(
            "SELECT f.id, f.name, f.brand, count(*) AS n FROM food_logs l "
            "JOIN foods f ON f.id = l.food_id AND f.deleted_at IS NULL "
            "WHERE l.user_id = :u AND l.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM "
            "staples st WHERE st.user_id = :u AND st.food_id = f.id AND st.deleted_at IS NULL) "
            "GROUP BY f.id, f.name, f.brand ORDER BY n DESC, max(l.eaten_at) DESC, f.id "
            "LIMIT :k"
        ),
        {"u": user_id, "k": PROMPT_FOODS},
    ).all()
    return [PromptFood(food_id=r.id, name=r.name, brand=r.brand, times_logged=r.n) for r in rows]


@router.get("")
def list_staples(user: ActiveUserDep) -> StaplesOut:
    """In the user's order, with nutrients per unit and the amounts each one allows."""
    with user_session(user.user_id) as s:
        return _all(s, user.user_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def add_staple(body: StapleIn, user: ActiveUserDep) -> StaplesOut:
    with user_session(user.user_id) as s:
        _add(
            s,
            user.user_id,
            food_id=body.food_id,
            meal_id=body.saved_meal_id,
            unit_label=body.unit_label,
        )
        return _all(s, user.user_id)


@router.put("/order")
def reorder(body: OrderIn, user: ActiveUserDep) -> StaplesOut:
    """Every staple's id, in the new order."""
    with user_session(user.user_id) as s:
        mine = set(
            s.execute(
                text("SELECT id FROM staples WHERE user_id = :u AND deleted_at IS NULL"),
                {"u": user.user_id},
            ).scalars()
        )
        if not set(body.ids) <= mine:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        if len(body.ids) != len(mine) or len(set(body.ids)) != len(body.ids):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Send every staple once, in order"
            )
        for i, staple_id in enumerate(body.ids):
            s.execute(
                text("UPDATE staples SET sort_order = :o, updated_at = now() WHERE id = :i"),
                {"o": i, "i": staple_id},
            )
        return _all(s, user.user_id)


@router.get("/prompt")
def get_prompt(user: ActiveUserDep) -> PromptOut:
    """Offered once, after 14 days with something logged, when there is a food to add."""
    with user_session(user.user_id) as s:
        row = s.execute(
            text(
                "SELECT (SELECT staples_offered_at FROM user_settings WHERE user_id = :u) AS "
                "offered, (SELECT count(DISTINCT logged_on) FROM food_logs WHERE user_id = :u "
                "AND deleted_at IS NULL) AS days"
            ),
            {"u": user.user_id},
        ).one()
        if row.offered is not None or row.days < PROMPT_DAYS:
            return PromptOut(offer=False, foods=[])
        if _count(s, user.user_id) >= rules.MAX_STAPLES:
            return PromptOut(offer=False, foods=[])
        foods = _top_foods(s, user.user_id)
        return PromptOut(offer=bool(foods), foods=foods)


@router.post("/prompt")
def answer_prompt(body: PromptIn, user: ActiveUserDep, services: ServicesDep) -> StaplesOut:
    """Yes adds the most-logged foods while there is room; either answer stops the offer."""
    with user_session(user.user_id) as s:
        s.execute(
            text(
                "INSERT INTO user_settings (user_id, staples_offered_at) VALUES (:u, :t) "
                "ON CONFLICT (user_id) DO UPDATE SET staples_offered_at = :t, updated_at = now()"
            ),
            {"u": user.user_id, "t": services.clock()},
        )
        if body.accept:
            room = rules.MAX_STAPLES - _count(s, user.user_id)
            for food in _top_foods(s, user.user_id)[: max(room, 0)]:
                _add(s, user.user_id, food_id=food.food_id)
        return _all(s, user.user_id)


@router.patch("/{staple_id}")
def edit_staple(staple_id: uuid.UUID, body: StaplePatch, user: ActiveUserDep) -> StaplesOut:
    with user_session(user.user_id) as s:
        row = _staple(s, user.user_id, staple_id)
        changes: dict[str, Any] = {}
        a = rules.Amounts(row.step_units, row.min_units, row.max_units)
        if body.unit_label is not None and body.unit_label != row.unit_label:
            if row.food_id is None:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, "A meal's unit is the whole meal"
                )
            label, grams = _food_unit(s, row.food_id, body.unit_label)
            changes |= {"unit_label": label, "unit_grams": grams}
            a = rules.default_amounts(label)
        a = rules.Amounts(
            _d(body.step_units) if body.step_units is not None else a.step,
            _d(body.min_units) if body.min_units is not None else a.min,
            _d(body.max_units) if body.max_units is not None else a.max,
        )
        error = rules.amounts_error(a)
        if error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
        changes |= {"step_units": a.step, "min_units": a.min, "max_units": a.max}
        if body.is_available is not None:
            changes["is_available"] = body.is_available
        if "food_group" in body.model_fields_set:
            if body.food_group is not None and body.food_group not in FOOD_GROUPS:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown food group")
            changes["food_group"] = body.food_group
        sets = ", ".join(f"{k} = :{k}" for k in changes)
        s.execute(
            # Column names come from the fixed keys above, never from input.
            text(f"UPDATE staples SET {sets}, updated_at = now() WHERE id = :i"),  # noqa: S608
            {**changes, "i": staple_id},
        )
        return _all(s, user.user_id)


@router.delete("/{staple_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_staple(staple_id: uuid.UUID, user: ActiveUserDep) -> None:
    """Removes the staple only; the food or meal stays."""
    with user_session(user.user_id) as s:
        _staple(s, user.user_id, staple_id)
        s.execute(text("DELETE FROM staples WHERE id = :i"), {"i": staple_id})
