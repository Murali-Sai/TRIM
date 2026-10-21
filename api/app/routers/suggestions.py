"""What should I eat? (task 3.20, SPEC page 3). Combines the user's available staples to fit
what is left of a day, with the optimizer in app/suggest.py. Display only: nothing here logs
food or changes a target."""

import datetime as dt
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

from app import suggest as engine
from app.db import user_session
from app.deps import ServicesDep
from app.fit import MACROS
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


class SuggestIn(BaseModel):
    date: dt.date | None = None
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


class SuggestOut(BaseModel):
    date: dt.date
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

    mine = {st.id: st for st in staples}
    for lock in body.locked:
        if lock.staple_id not in mine:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Staple not found")

    def answer(state: State, **kw: Any) -> SuggestOut:
        return SuggestOut(
            date=day,
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
    try:
        found = engine.suggest(
            pool,
            b,
            goal,
            max_items=body.max_items,
            locked={str(lock.staple_id): lock.units for lock in body.locked},
            exclude_sets=[[str(x) for x in shown] for shown in body.exclude_sets],
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
            )
            for x in found
        ],
    )
