"""What should I eat? (tasks 3.20 and 3.21, SPEC page 3). Combines the user's available staples
to fit what is left of a day, with the optimizer in app/suggest.py. Suggesting never changes a
target; a suggestion is logged or saved only when the user taps Log or Save as meal."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Any, Literal, cast
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, status
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import pairing
from app import suggest as engine
from app.db import user_session
from app.deps import ServicesDep
from app.fit import MACROS
from app.food_groups import guess_group
from app.ids import uuid7
from app.models import FoodLog, SavedMealItem
from app.routers.logs import MAX_GRAMS, LogOut, _check_time, _nutrient, _out, _timezone
from app.routers.meals import NUTRIENTS, PER_100, MealOut, _create, _items, _one, _q
from app.routers.staples import StapleOut, staple_rows
from app.security.sessions import ActiveUserDep
from app.timeutil import local_date

router = APIRouter(prefix="/suggestions", tags=["suggestions"])

State = Literal[
    "ok", "no_target", "target_reached", "within_100", "need_staples", "no_fit", "no_more"
]
MESSAGES: dict[str, str] = {
    "no_target": "Set your targets to get suggestions.",
    "target_reached": "You've reached today's calorie target.",
    "within_100": "You're within 100 kcal of your target.",
    "need_staples": "Add at least 2 staples to get suggestions.",
    "no_fit": (
        "No combination fits within 5% of your calories. "
        "Try allowing more items or smaller amounts."
    ),
    "no_more": ("No more good combinations. Try allowing more items or turning a staple back on."),
}
MIN_LEFT_KCAL = 100
MAX_SHOWN_SETS = 300


class Budget(BaseModel):
    """Everything left today, a share of it ("Next meal"), or typed calories."""

    mode: Literal["rest_of_day", "fraction", "kcal"] = "rest_of_day"
    fraction: Annotated[float, Field(gt=0, le=1)] | None = None
    kcal: Annotated[float, Field(gt=0, le=10000)] | None = None

    @model_validator(mode="after")
    def _value(self) -> "Budget":
        if (self.mode == "fraction") != (self.fraction is not None):
            raise ValueError("A fraction budget needs fraction, and only it")
        if (self.mode == "kcal") != (self.kcal is not None):
            raise ValueError("A calorie budget needs kcal, and only it")
        return self


class Lock(BaseModel):
    staple_id: uuid.UUID
    # Keep this amount too; None keeps the staple at any allowed amount.
    units: Annotated[float, Field(gt=0, le=99)] | None = None


Context = Literal["breakfast", "lunch", "dinner", "snack"]


class SuggestIn(BaseModel):
    date: dt.date | None = None
    # Preset from the time chip; the server uses the time now when it is missing.
    context: Context | None = None
    budget: Budget = Budget()
    max_items: Annotated[int, Field(ge=1, le=engine.MAX_ITEMS)] = 3
    excluded_staple_ids: Annotated[list[uuid.UUID], Field(max_length=20)] = []
    locked: Annotated[list[Lock], Field(max_length=engine.MAX_ITEMS)] = []
    # Sets already shown in this sheet (Shuffle): never suggested again.
    exclude_sets: Annotated[
        list[Annotated[list[uuid.UUID], Field(max_length=engine.MAX_ITEMS)]],
        Field(max_length=MAX_SHOWN_SETS),
    ] = []


class Macros(BaseModel):
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class SuggestedItem(BaseModel):
    staple_id: uuid.UUID
    food_id: uuid.UUID | None
    saved_meal_id: uuid.UUID | None
    name: str
    unit_label: str
    units: float
    # The amount in grams, for a food; None for a saved meal (its own items carry grams).
    grams: float | None
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class SuggestionOut(BaseModel):
    items: list[SuggestedItem]
    totals: Macros
    # Budget minus totals ("Leaves 72 kcal, 1 g protein, ..."); negative when over.
    leaves: Macros
    match_pct: float
    # "Often eaten together at dinner" when every pair on the card scores 0.5 or more.
    label: str | None = None


class SuggestOut(BaseModel):
    date: dt.date
    context: Context
    state: State
    message: str | None
    budget: Macros | None
    left_today: Macros | None
    suggestions: list[SuggestionOut]


def _macros(d: dict[str, float]) -> Macros:
    return Macros(**{m: round(d[m], 2) for m in MACROS})


def _item(st: StapleOut, units: float) -> SuggestedItem:
    k = units
    return SuggestedItem(
        staple_id=st.id,
        food_id=st.food_id,
        saved_meal_id=st.saved_meal_id,
        name=st.name or "",
        unit_label=st.unit_label,
        units=units,
        grams=None if st.unit_grams is None else round(st.unit_grams * units, 2),
        kcal=round(st.per_unit.kcal * k, 2),
        protein_g=round(st.per_unit.protein_g * k, 2),
        carbs_g=round(st.per_unit.carbs_g * k, 2),
        fat_g=round(st.per_unit.fat_g * k, 2),
    )


def _history(s: Session, user_id: Any, staples: list[StapleOut], day: dt.date) -> list[set[str]]:
    """The user's time blocks in the last 180 days, as the staples each one holds."""
    by_food = {st.food_id: str(st.id) for st in staples if st.food_id}
    by_meal = {st.saved_meal_id: str(st.id) for st in staples if st.saved_meal_id}
    if len(by_food) + len(by_meal) < 2:
        return []
    blocks: dict[Any, set[str]] = {}
    for r in s.execute(
        text(
            "SELECT log_group_id, food_id, saved_meal_id FROM food_logs WHERE user_id = :u "
            "AND deleted_at IS NULL AND logged_on > :since AND logged_on <= :d "
            "AND (food_id = ANY(:f) OR saved_meal_id = ANY(:m))"
        ),
        {
            "u": user_id,
            "since": day - dt.timedelta(days=pairing.HISTORY_DAYS),
            "d": day,
            "f": list(by_food),
            "m": list(by_meal),
        },
    ):
        sid = by_meal.get(r.saved_meal_id) or by_food.get(r.food_id)
        if sid:
            blocks.setdefault(r.log_group_id, set()).add(sid)
    return [b for b in blocks.values() if len(b) > 1]


@router.post("")
def suggestions(body: SuggestIn, user: ActiveUserDep, services: ServicesDep) -> SuggestOut:
    """Up to three combinations of available staples, best match first, each a different set.
    Locked staples always appear; sets in exclude_sets never do."""
    with user_session(user.user_id) as s:
        tz: str = s.execute(
            text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user.user_id}
        ).scalar_one()
        day = body.date or local_date(services.clock(), tz)
        staples = staple_rows(s, user.user_id)
        target = s.execute(
            text(
                "SELECT kcal, protein_g, carbs_g, fat_g FROM targets WHERE user_id = :u "
                "AND deleted_at IS NULL AND effective_from <= :d "
                "ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1"
            ),
            {"u": user.user_id, "d": day},
        ).one_or_none()
        eaten = s.execute(
            text(
                "SELECT coalesce(sum(kcal), 0) AS kcal, coalesce(sum(protein_g), 0) AS protein_g, "
                "coalesce(sum(carbs_g), 0) AS carbs_g, coalesce(sum(fat_g), 0) AS fat_g "
                "FROM food_logs WHERE user_id = :u AND deleted_at IS NULL AND logged_on = :d"
            ),
            {"u": user.user_id, "d": day},
        ).one()
        ctx: Context = body.context or cast(
            Context, pairing.context_for(services.clock().astimezone(ZoneInfo(tz)).time())
        )
        generic = {
            (r.group_a, r.group_b): float(r.score)
            for r in s.execute(
                text(
                    "SELECT group_a, group_b, score FROM pairing_scores "
                    "WHERE context = :c AND score <> 0"
                ),
                {"c": ctx},
            )
        }
        blocks = _history(s, user.user_id, staples, day)
        never = [
            frozenset((str(r.staple_a_id), str(r.staple_b_id)))
            for r in s.execute(
                text(
                    "SELECT staple_a_id, staple_b_id FROM pair_preferences "
                    "WHERE user_id = :u AND deleted_at IS NULL"
                ),
                {"u": user.user_id},
            )
        ]

    mine = {st.id: st for st in staples}
    for lock in body.locked:
        if lock.staple_id not in mine:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Staple not found")

    def answer(state: State, **kw: Any) -> SuggestOut:
        return SuggestOut(
            date=day,
            context=ctx,
            state=state,
            message=MESSAGES.get(state),
            budget=kw.get("budget"),
            left_today=kw.get("left_today"),
            suggestions=kw.get("suggestions", []),
        )

    if target is None:
        return answer("no_target")
    goal = {m: float(getattr(target, m)) for m in MACROS}
    left = engine.budget(goal, {m: float(getattr(eaten, m)) for m in MACROS})
    if left["kcal"] <= 0:
        return answer("target_reached", left_today=_macros(left))
    if left["kcal"] < MIN_LEFT_KCAL:
        return answer("within_100", left_today=_macros(left))

    b = engine.budget(
        goal,
        {m: float(getattr(eaten, m)) for m in MACROS},
        fraction=body.budget.fraction,
        kcal=min(body.budget.kcal, left["kcal"]) if body.budget.kcal is not None else None,
    )
    excluded = set(body.excluded_staple_ids)
    usable = [
        st
        for st in staples
        if st.is_available and not st.missing and st.id not in excluded and st.amounts
    ]
    locked_ids = {lock.staple_id for lock in body.locked}
    if any(sid not in {st.id for st in usable} for sid in locked_ids):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "A locked staple is turned off or excluded."
        )
    if len(usable) < 2:
        return answer("need_staples", budget=_macros(b), left_today=_macros(left))

    pool = [
        engine.Staple(
            str(st.id),
            st.per_unit.model_dump(),
            tuple(st.amounts),
        )
        for st in usable
    ]
    groups = {str(st.id): st.food_group or guess_group(st.name or "") for st in usable}
    scores = pairing.pair_scores(groups, generic, pairing.personal_pairs(blocks))
    try:
        found = engine.suggest(
            pool,
            b,
            goal,
            max_items=body.max_items,
            locked={str(lock.staple_id): lock.units for lock in body.locked},
            exclude_sets=[[str(x) for x in shown] for shown in body.exclude_sets],
            pair_scores=scores,
            never=never,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    if not found:
        return answer(
            "no_more" if body.exclude_sets else "no_fit",
            budget=_macros(b),
            left_today=_macros(left),
        )
    return answer(
        "ok",
        budget=_macros(b),
        left_today=_macros(left),
        suggestions=[
            SuggestionOut(
                items=[_item(mine[uuid.UUID(sid)], units) for sid, units in x.items],
                totals=_macros(x.totals),
                leaves=_macros(x.leaves),
                match_pct=x.match_pct,
                label=pairing.label([sid for sid, _ in x.items], scores, ctx),
            )
            for x in found
        ],
    )


# --- acting on a suggestion (task 3.21) ---------------------------------------------------


class PlateItem(BaseModel):
    staple_id: uuid.UUID
    units: Annotated[float, Field(gt=0, le=99)]


Plate = Annotated[list[PlateItem], Field(min_length=1, max_length=engine.MAX_ITEMS)]


class LogPlateIn(BaseModel):
    eaten_at: AwareDatetime
    items: Plate


class SavePlateIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    items: Plate


def _plate(s: Session, user_id: Any, items: list[PlateItem]) -> list[tuple[Any, Decimal]]:
    """Each staple row with its units; another user's staple, or a repeat, is refused."""
    ids = [i.staple_id for i in items]
    if len(set(ids)) != len(ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each staple once")
    rows = {
        r.id: r
        for r in s.execute(
            text(
                "SELECT * FROM staples WHERE user_id = :u AND deleted_at IS NULL AND id = ANY(:ids)"
            ),
            {"u": user_id, "ids": ids},
        ).all()
    }
    if len(rows) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staple not found")
    return [(rows[i.staple_id], Decimal(str(i.units))) for i in items]


def _food_row(s: Session, food_id: Any) -> Any:
    food = s.execute(
        text("SELECT * FROM foods WHERE id = :f AND deleted_at IS NULL"), {"f": food_id}
    ).one_or_none()
    if food is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A staple's food is gone")
    return food


def _meal_items(s: Session, user_id: Any, meal_id: Any) -> tuple[Any, list[Any]]:
    meal = s.execute(
        text("SELECT * FROM saved_meals WHERE id = :m AND user_id = :u AND deleted_at IS NULL"),
        {"m": meal_id, "u": user_id},
    ).one_or_none()
    if meal is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A staple's meal is gone")
    return meal, [r for r in _items(s, [meal.id])[meal.id] if r.food_name is not None]


def _by_unit(st: Any, units: Decimal) -> tuple[Decimal, Decimal | None, str | None]:
    """Grams, and the quantity and unit when the staple's unit is a serving ("2 x 1 egg")."""
    grams = _q(st.unit_grams * units)
    if st.unit_label == "100 g":
        return grams, None, None
    return grams, units, st.unit_label


@router.post("/log", status_code=status.HTTP_201_CREATED)
def log_plate(body: LogPlateIn, user: ActiveUserDep, services: ServicesDep) -> list[LogOut]:
    """Log a suggestion as one time block (a shared log_group_id), source `suggestion`. A saved
    meal staple adds its items, scaled by the units; every entry keeps its own snapshot."""
    now = services.clock()
    with user_session(user.user_id) as s:
        tz = _timezone(s, user.user_id)
        at = _check_time(body.eaten_at, now, tz)
        group = uuid7()
        rows: list[FoodLog] = []

        def add(food: Any, per: Any, grams: Decimal, **extra: Any) -> None:
            if grams <= 0 or grams > MAX_GRAMS:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Amount out of range")
            row = FoodLog(
                user_id=user.user_id,
                food_id=food.id if food is not None else per.food_id,
                log_group_id=group,
                eaten_at=at,
                logged_on=local_date(at, tz),
                name=per.food_name if food is None else food.name,
                brand=per.food_brand if food is None else food.brand,
                grams=grams,
                **{n: _nutrient(getattr(per, PER_100[n]), grams) for n in NUTRIENTS},
                source="suggestion",
                created_at=now,
                **extra,
            )
            s.add(row)
            rows.append(row)

        for st, units in _plate(s, user.user_id, body.items):
            if st.food_id is not None:
                food = _food_row(s, st.food_id)
                grams, quantity, unit_label = _by_unit(st, units)
                add(food, food, grams, quantity=quantity, unit_label=unit_label)
            else:
                meal, items = _meal_items(s, user.user_id, st.saved_meal_id)
                for r in items:
                    add(
                        None,
                        r,
                        _q(r.grams * units),
                        quantity=None
                        if r.quantity is None
                        else (r.quantity * units).quantize(Decimal("0.001")),
                        unit_label=r.unit_label,
                        saved_meal_id=meal.id,
                    )
                s.execute(
                    text(
                        "UPDATE saved_meals SET use_count = use_count + 1, last_used_at = :now "
                        "WHERE id = :m"
                    ),
                    {"now": now, "m": meal.id},
                )
        if not rows:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing left to log")
        s.flush()
        return [_out(r) for r in rows]


@router.post("/save-meal", status_code=status.HTTP_201_CREATED)
def save_plate(body: SavePlateIn, user: ActiveUserDep) -> MealOut:
    """Save a suggestion as a meal at its amounts; a saved meal staple adds its items."""
    with user_session(user.user_id) as s:
        plate = _plate(s, user.user_id, body.items)
        meal_id = _create(s, user.user_id, body.name, None)
        order = 0
        for st, units in plate:
            if st.food_id is not None:
                _food_row(s, st.food_id)
                grams, quantity, unit_label = _by_unit(st, units)
                parts = [(st.food_id, grams, quantity, unit_label)]
            else:
                _, items = _meal_items(s, user.user_id, st.saved_meal_id)
                parts = [
                    (
                        r.food_id,
                        _q(r.grams * units),
                        None if r.quantity is None else r.quantity * units,
                        r.unit_label,
                    )
                    for r in items
                ]
            for food_id, grams, quantity, unit_label in parts:
                s.add(
                    SavedMealItem(
                        user_id=user.user_id,
                        saved_meal_id=meal_id,
                        food_id=food_id,
                        grams=grams,
                        quantity=quantity,
                        unit_label=unit_label,
                        sort_order=order,
                    )
                )
                order += 1
        if order == 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to save")
        s.flush()
        return _one(s, user.user_id, meal_id)
