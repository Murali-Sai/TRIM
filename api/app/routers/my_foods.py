"""The user's own foods: favourites, recents, frequents and custom foods (task 3.7).

SPEC page 1, UX principle 1: recents and favourites appear before typing, and the last serving
is remembered per food. Recents and frequents come from the user's own log, so nothing extra
is stored for them; the last serving is the amount of the latest entry for that food.
"""

import uuid
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import user_session
from app.deps import ServicesDep
from app.ids import uuid7
from app.models import Food, ServingUnit
from app.routers.foods import FOOD_COLUMNS, FoodOut, _food_out, _servings
from app.security.sessions import ActiveUserDep

router = APIRouter(prefix="/foods", tags=["foods"])

LIST_SIZE = 20
FREQUENT_DAYS = 90
MIN_FREQUENT = 2
MISMATCH = Decimal("0.15")
NOT_FOUND = "Food not found"
CENT = Decimal("0.01")


class LastServing(BaseModel):
    """The amount of the user's latest entry for this food: grams, or a quantity of a unit."""

    grams: float
    quantity: float | None
    unit_label: str | None


class QuickFood(FoodOut):
    last: LastServing | None
    is_favourite: bool
    times_logged: int


class QuickOut(BaseModel):
    favourites: list[QuickFood]
    recents: list[QuickFood]
    frequents: list[QuickFood]


def _visible(s: Session, food_id: uuid.UUID) -> None:
    """404 unless the user may see the food (shared cache or their own, by RLS)."""
    found = s.execute(
        text("SELECT 1 FROM foods WHERE id = :f AND deleted_at IS NULL"), {"f": food_id}
    ).first()
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)


def _quick(s: Session, user_id: Any, ids: list[uuid.UUID]) -> list[QuickFood]:
    if not ids:
        return []
    rows = {
        r.id: r
        for r in s.execute(
            text(
                f"SELECT {FOOD_COLUMNS} FROM foods f "  # noqa: S608 (a fixed column list)
                "WHERE f.id = ANY(:ids) AND f.deleted_at IS NULL"
            ),
            {"ids": ids},
        )
    }
    ids = [i for i in ids if i in rows]
    servings = _servings(s, ids)
    last = {
        r.food_id: r
        for r in s.execute(
            text(
                "SELECT DISTINCT ON (food_id) food_id, grams, quantity, unit_label "
                "FROM food_logs WHERE user_id = :u AND deleted_at IS NULL "
                "AND food_id = ANY(:ids) AND grams IS NOT NULL "
                "ORDER BY food_id, created_at DESC, id DESC"
            ),
            {"u": user_id, "ids": ids},
        )
    }
    counts: dict[uuid.UUID, int] = dict(
        s.execute(
            text(
                "SELECT food_id, count(*) FROM food_logs WHERE user_id = :u "
                "AND deleted_at IS NULL AND food_id = ANY(:ids) GROUP BY food_id"
            ),
            {"u": user_id, "ids": ids},
        ).all()
    )
    favs = set(
        s.execute(
            text("SELECT food_id FROM food_favourites WHERE user_id = :u AND food_id = ANY(:ids)"),
            {"u": user_id, "ids": ids},
        ).scalars()
    )
    out = []
    for i in ids:
        base = _food_out(rows[i], "personal", servings[i])
        units = {sv.label for sv in servings[i]}
        lr = last.get(i)
        serving = None
        if lr is not None:
            # A unit that no longer exists falls back to the same amount in grams.
            keep_unit = lr.unit_label is not None and lr.unit_label in units
            serving = LastServing(
                grams=float(lr.grams),
                quantity=float(lr.quantity) if keep_unit and lr.quantity is not None else None,
                unit_label=lr.unit_label if keep_unit else None,
            )
        out.append(
            QuickFood(
                **base.model_dump(),
                last=serving,
                is_favourite=i in favs,
                times_logged=int(counts.get(i, 0)),
            )
        )
    return out


@router.get("/quick")
def quick_foods(user: ActiveUserDep, services: ServicesDep) -> QuickOut:
    """Favourites, then recents (latest first), then frequents (most logged in 90 days)."""
    since = services.clock() - timedelta(days=FREQUENT_DAYS)
    with user_session(user.user_id) as s:
        fav_ids = list(
            s.execute(
                text(
                    "SELECT food_id FROM food_favourites WHERE user_id = :u "
                    "ORDER BY created_at DESC, id DESC LIMIT :n"
                ),
                {"u": user.user_id, "n": LIST_SIZE},
            ).scalars()
        )
        recent_ids = list(
            s.execute(
                text(
                    "SELECT food_id FROM food_logs WHERE user_id = :u AND deleted_at IS NULL "
                    "AND food_id IS NOT NULL GROUP BY food_id "
                    "ORDER BY max(created_at) DESC LIMIT :n"
                ),
                {"u": user.user_id, "n": LIST_SIZE},
            ).scalars()
        )
        frequent_ids = list(
            s.execute(
                text(
                    "SELECT food_id FROM food_logs WHERE user_id = :u AND deleted_at IS NULL "
                    "AND food_id IS NOT NULL AND created_at >= :since GROUP BY food_id "
                    "HAVING count(*) >= :min ORDER BY count(*) DESC, max(created_at) DESC "
                    "LIMIT :n"
                ),
                {"u": user.user_id, "since": since, "min": MIN_FREQUENT, "n": LIST_SIZE},
            ).scalars()
        )
        return QuickOut(
            favourites=_quick(s, user.user_id, fav_ids),
            recents=_quick(s, user.user_id, recent_ids),
            frequents=_quick(s, user.user_id, frequent_ids),
        )


@router.put("/{food_id}/favourite", status_code=status.HTTP_204_NO_CONTENT)
def add_favourite(food_id: uuid.UUID, user: ActiveUserDep) -> None:
    with user_session(user.user_id) as s:
        _visible(s, food_id)
        s.execute(
            text(
                "INSERT INTO food_favourites (id, user_id, food_id) VALUES (:id, :u, :f) "
                "ON CONFLICT (user_id, food_id) DO NOTHING"
            ),
            {"id": uuid7(), "u": user.user_id, "f": food_id},
        )


@router.delete("/{food_id}/favourite", status_code=status.HTTP_204_NO_CONTENT)
def remove_favourite(food_id: uuid.UUID, user: ActiveUserDep) -> None:
    with user_session(user.user_id) as s:
        _visible(s, food_id)
        s.execute(
            text("DELETE FROM food_favourites WHERE user_id = :u AND food_id = :f"),
            {"u": user.user_id, "f": food_id},
        )


# --- custom foods ---------------------------------------------------------------------------

Grams = Annotated[float, Field(ge=0, le=1000)]


class CustomFoodIn(BaseModel):
    """Nutrients as on a label: per 100 g, or per serving with the serving's weight. Stored
    per 100 g (SPEC page 3: per100 = per_serving / serving_g x 100)."""

    name: Annotated[str, Field(min_length=1, max_length=120)]
    brand: Annotated[str, Field(max_length=120)] | None = None
    per: Literal["100g", "serving"]
    serving_label: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    serving_grams: Annotated[float, Field(gt=0, le=5000)] | None = None
    kcal: Annotated[float, Field(ge=0, le=10000)]
    protein_g: Grams
    carbs_g: Grams
    fat_g: Grams
    fiber_g: Grams | None = None
    sugar_g: Grams | None = None
    sodium_mg: Annotated[float, Field(ge=0, le=100000)] | None = None

    @model_validator(mode="after")
    def _serving(self) -> "CustomFoodIn":
        if (self.serving_label is None) != (self.serving_grams is None):
            raise ValueError("Give a serving both a name and a weight")
        if self.per == "serving" and self.serving_grams is None:
            raise ValueError("Per serving needs the serving's name and weight")
        if self.name.strip() == "":
            raise ValueError("Enter a name")
        return self


def _scale(v: float, factor: Decimal) -> Decimal:
    return (Decimal(str(v)) * factor).quantize(CENT, rounding=ROUND_HALF_UP)


def _values(body: CustomFoodIn) -> dict[str, Any]:
    factor = (
        Decimal(100) / Decimal(str(body.serving_grams))
        if body.per == "serving" and body.serving_grams
        else Decimal(1)
    )
    kcal = _scale(body.kcal, factor)
    protein = _scale(body.protein_g, factor)
    carbs = _scale(body.carbs_g, factor)
    fat = _scale(body.fat_g, factor)
    if protein + carbs + fat > 100:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Protein, carbs and fat add up to more than the food weighs. Check the amounts.",
        )
    if kcal > 950:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That is more calories than any food has."
        )
    # Flag (not refuse) labels where kcal and 4P + 4C + 9F differ by more than 15%.
    from_macros = 4 * protein + 4 * carbs + 9 * fat
    larger = max(kcal, from_macros)
    return {
        "name": body.name.strip(),
        "brand": (body.brand or "").strip() or None,
        "kcal_100": kcal,
        "protein_100": protein,
        "carbs_100": carbs,
        "fat_100": fat,
        "fiber_100": None if body.fiber_g is None else _scale(body.fiber_g, factor),
        "sugar_100": None if body.sugar_g is None else _scale(body.sugar_g, factor),
        "sodium_mg_100": None if body.sodium_mg is None else _scale(body.sodium_mg, factor),
        "kcal_mismatch": bool(larger > 0 and abs(kcal - from_macros) > MISMATCH * larger),
    }


def _set_serving(s: Session, food_id: uuid.UUID, body: CustomFoodIn) -> None:
    # Past entries keep their own unit label and grams, so the old unit can simply go.
    s.execute(text("DELETE FROM serving_units WHERE food_id = :f AND is_default"), {"f": food_id})
    if body.serving_label and body.serving_grams:
        s.add(
            ServingUnit(
                food_id=food_id,
                label=body.serving_label.strip(),
                grams=Decimal(str(body.serving_grams)).quantize(CENT, rounding=ROUND_HALF_UP),
                is_default=True,
            )
        )


def _custom_out(s: Session, food_id: uuid.UUID) -> FoodOut:
    s.flush()
    row = s.execute(
        text(f"SELECT {FOOD_COLUMNS} FROM foods f WHERE f.id = :f"),  # noqa: S608
        {"f": food_id},
    ).one()
    return _food_out(row, "personal", _servings(s, [food_id])[food_id])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_custom_food(body: CustomFoodIn, user: ActiveUserDep) -> FoodOut:
    """A private food, also used when search finds nothing (manual entry)."""
    with user_session(user.user_id) as s:
        food = Food(owner_id=user.user_id, source="custom", **_values(body))
        s.add(food)
        s.flush()
        _set_serving(s, food.id, body)
        return _custom_out(s, food.id)


@router.patch("/{food_id}")
def edit_custom_food(food_id: uuid.UUID, body: CustomFoodIn, user: ActiveUserDep) -> FoodOut:
    """Edits the user's own custom food. Past entries keep their snapshot; shared foods and
    other users' foods are 404."""
    values = _values(body)
    with user_session(user.user_id) as s:
        sets = ", ".join(f"{k} = :{k}" for k in values)
        changed = s.execute(
            # Column names come from the fixed keys of _values, never from input.
            text(
                f"UPDATE foods SET {sets}, updated_at = now() "  # noqa: S608
                "WHERE id = :id AND owner_id = :u AND source = 'custom' AND deleted_at IS NULL"
            ),
            {**values, "id": food_id, "u": user.user_id},
        )
        if changed.rowcount != 1:  # type: ignore[attr-defined]
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        _set_serving(s, food_id, body)
        return _custom_out(s, food_id)
