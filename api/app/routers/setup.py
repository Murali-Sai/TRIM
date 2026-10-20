"""Body stats, the TDEE calculator and applying its result as targets (task 1.6b).

The server always recalculates from the inputs; numbers computed in the browser are only
for instant display and are never stored.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import user_session
from app.deps import ServicesDep
from app.models import Target, WeightEntry
from app.security.sessions import ActiveUserDep
from app.tdee import (
    AGE_RANGE,
    DEFICITS,
    HEIGHT_CM_RANGE,
    WEIGHT_KG_RANGE,
    CalcInput,
    CalcResult,
    calculate,
    carbs_for_rest,
    fiber_default,
)
from app.timeutil import local_date, whole_years_between

router = APIRouter(tags=["setup"])

SexIn = Literal["male", "female"]
ActivityIn = Literal["sedentary", "light", "moderate", "heavy", "athlete"]
Age = Annotated[int, Field(ge=AGE_RANGE[0], le=AGE_RANGE[1])]
WeightKg = Annotated[float, Field(ge=WEIGHT_KG_RANGE[0], le=WEIGHT_KG_RANGE[1])]
HeightCm = Annotated[float, Field(ge=HEIGHT_CM_RANGE[0], le=HEIGHT_CM_RANGE[1])]


# --- body stats ---------------------------------------------------------------------------


class BodyStatsIn(BaseModel):
    sex: SexIn
    age: Age
    height_cm: HeightCm
    activity_level: ActivityIn
    unit_system: Literal["metric", "imperial"]
    # Sent at sign-up: it also becomes the first weight entry.
    weight_kg: WeightKg | None = None


class BodyStatsOut(BaseModel):
    sex: SexIn | None
    age: int | None
    height_cm: float | None
    activity_level: ActivityIn | None
    unit_system: Literal["metric", "imperial"]
    latest_weight_kg: float | None
    goal_weight_kg: float | None


def _profile(s: Session, user_id: Any) -> Any:
    return s.execute(
        text(
            "SELECT sex, age_years, age_recorded_on, height_cm, activity_level, unit_system, "
            "timezone, goal_weight_kg FROM user_profiles WHERE user_id = :u"
        ),
        {"u": user_id},
    ).one()


def _latest_weight(s: Session, user_id: Any) -> Decimal | None:
    value: Decimal | None = s.execute(
        text(
            "SELECT kg FROM weight_entries WHERE user_id = :u AND deleted_at IS NULL "
            "ORDER BY measured_at DESC LIMIT 1"
        ),
        {"u": user_id},
    ).scalar_one_or_none()
    return value


def _current_age(age_years: int | None, recorded_on: date | None, today: date) -> int | None:
    if age_years is None or recorded_on is None:
        return None
    return age_years + whole_years_between(recorded_on, today)


@router.get("/me/body-stats")
def get_body_stats(user: ActiveUserDep, services: ServicesDep) -> BodyStatsOut:
    with user_session(user.user_id) as s:
        p = _profile(s, user.user_id)
        latest = _latest_weight(s, user.user_id)
    today = local_date(services.clock(), p.timezone)
    return BodyStatsOut(
        sex=p.sex,
        age=_current_age(p.age_years, p.age_recorded_on, today),
        height_cm=float(p.height_cm) if p.height_cm is not None else None,
        activity_level=p.activity_level,
        unit_system=p.unit_system,
        latest_weight_kg=float(latest) if latest is not None else None,
        goal_weight_kg=float(p.goal_weight_kg) if p.goal_weight_kg is not None else None,
    )


class GoalWeightIn(BaseModel):
    goal_weight_kg: WeightKg | None  # null clears the goal


@router.put("/me/goal-weight")
def put_goal_weight(body: GoalWeightIn, user: ActiveUserDep) -> GoalWeightIn:
    """Display only: the goal line on the weight chart and the goal-date projection."""
    goal = round(body.goal_weight_kg, 2) if body.goal_weight_kg is not None else None
    with user_session(user.user_id) as s:
        s.execute(
            text(
                "UPDATE user_profiles SET goal_weight_kg = :g, updated_at = now() "
                "WHERE user_id = :u"
            ),
            {"g": goal, "u": user.user_id},
        )
    return GoalWeightIn(goal_weight_kg=goal)


def _save_body_stats(
    s: Session, user_id: Any, sex: str, age: int, height_cm: float, activity: str, today: date
) -> None:
    s.execute(
        text(
            "UPDATE user_profiles SET sex = :sex, age_years = :age, age_recorded_on = :today, "
            "height_cm = :h, activity_level = :act, updated_at = now() WHERE user_id = :u"
        ),
        {
            "sex": sex,
            "age": age,
            "today": today,
            "h": round(height_cm, 1),
            "act": activity,
            "u": user_id,
        },
    )


@router.patch("/me/body-stats")
def patch_body_stats(body: BodyStatsIn, user: ActiveUserDep, services: ServicesDep) -> BodyStatsOut:
    now = services.clock()
    with user_session(user.user_id) as s:
        p = _profile(s, user.user_id)
        today = local_date(now, p.timezone)
        _save_body_stats(
            s, user.user_id, body.sex, body.age, body.height_cm, body.activity_level, today
        )
        s.execute(
            text("UPDATE user_profiles SET unit_system = :us WHERE user_id = :u"),
            {"us": body.unit_system, "u": user.user_id},
        )
        latest = _latest_weight(s, user.user_id)
        if body.weight_kg is not None:
            kg = Decimal(str(round(body.weight_kg, 3)))
            in_setup = not s.execute(
                text("SELECT EXISTS (SELECT 1 FROM targets WHERE user_id = :u)"),
                {"u": user.user_id},
            ).scalar_one()
            if latest is None:
                # The sign-up weight becomes the first weight entry.
                s.add(WeightEntry(user_id=user.user_id, measured_at=now, kg=kg))
                latest = kg
            elif in_setup:
                # Still in sign-up: going back to fix a typo corrects that first entry.
                s.execute(
                    text(
                        "UPDATE weight_entries SET kg = :kg, updated_at = :now "
                        "WHERE user_id = :u AND deleted_at IS NULL"
                    ),
                    {"kg": kg, "now": now, "u": user.user_id},
                )
                latest = kg
            # After sign-up, weigh-ins go through the weight log instead.
    return BodyStatsOut(
        sex=body.sex,
        age=body.age,
        height_cm=round(body.height_cm, 1),
        activity_level=body.activity_level,
        unit_system=body.unit_system,
        latest_weight_kg=float(latest) if latest is not None else None,
        goal_weight_kg=float(p.goal_weight_kg) if p.goal_weight_kg is not None else None,
    )


# --- calculator ---------------------------------------------------------------------------


class CalcIn(BaseModel):
    sex: SexIn
    age: Age
    weight_kg: WeightKg
    height_cm: HeightCm
    activity: ActivityIn
    plan: Literal["maintain", "lose"] | None = None
    deficit_kcal: int = 650

    @model_validator(mode="after")
    def _deficit_choice(self) -> "CalcIn":
        if self.deficit_kcal not in DEFICITS:
            raise ValueError("deficit_kcal must be 600, 650 or 700")
        return self

    def to_input(self) -> CalcInput:
        return CalcInput(
            sex=self.sex,
            age=self.age,
            weight_kg=self.weight_kg,
            height_cm=self.height_cm,
            activity=self.activity,
            plan=self.plan,
            deficit_kcal=self.deficit_kcal,
        )


class CalcOut(BaseModel):
    bmr: int
    tdee: int
    weekly_tdee: int
    bmi: float
    suggested_plan: Literal["maintain", "lose"]
    plan: Literal["maintain", "lose"]
    rule_set: Literal["standard", "high_bmi"]
    deficit_kcal: int
    target_kcal: int
    floor_applied: bool
    protein_g: int
    fat_g: int
    carbs_g: int
    carbs_clamped: bool
    pace_kg_per_week: float

    @classmethod
    def of(cls, r: CalcResult) -> "CalcOut":
        return cls(**{k: getattr(r, k) for k in cls.model_fields})


@router.post("/tdee/calculate")
def tdee_calculate(body: CalcIn, user: ActiveUserDep) -> CalcOut:
    """No side effects: the result is only shown."""
    return CalcOut.of(calculate(body.to_input()))


# --- targets ------------------------------------------------------------------------------


class FormulaOut(BaseModel):
    """The calculator inputs a target row came from, so "Reset to formula" can recompute it."""

    sex: SexIn
    age: int
    weight_kg: float
    height_cm: float
    activity: ActivityIn
    plan: Literal["maintain", "lose"]
    deficit_kcal: int


class TargetOut(BaseModel):
    effective_from: date
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    fiber_g: int | None
    water_ml: int | None
    source: Literal["calculator", "custom"]
    bmr: int | None
    tdee: int | None
    tolerance_pct: int
    formula: FormulaOut | None


def _formula(calc_inputs: dict[str, Any] | None) -> FormulaOut | None:
    if not calc_inputs:
        return None
    c = calc_inputs
    return FormulaOut(
        sex=c["sex"],
        age=c["age"],
        weight_kg=c["weight_kg"],
        height_cm=c["height_cm"],
        activity=c["activity_level"],
        plan=c["plan"],
        # A Maintain row stores 0; the chip it would reset to is the default.
        deficit_kcal=c["deficit_kcal"] or 650,
    )


def _calc_inputs(body: CalcIn, result: CalcResult) -> dict[str, Any]:
    return {
        "age": body.age,
        "sex": body.sex,
        "weight_kg": body.weight_kg,
        "height_cm": body.height_cm,
        "activity_level": body.activity,
        "bmi": result.bmi,
        "plan": result.plan,
        "deficit_kcal": result.deficit_kcal,
        "rule_set": result.rule_set,
        "floor_applied": result.floor_applied,
    }


def _target_out(row: Target) -> TargetOut:
    return TargetOut(
        effective_from=row.effective_from,
        kcal=row.kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        fat_g=row.fat_g,
        # Rows from before fiber targets fall back to the default for their calories.
        fiber_g=row.fiber_g if row.fiber_g is not None else fiber_default(row.kcal),
        water_ml=row.water_ml,
        source=row.source,
        bmr=row.bmr,
        tdee=row.tdee,
        tolerance_pct=row.tolerance_pct if row.tolerance_pct is not None else 5,
        formula=_formula(row.calc_inputs),
    )


def _current(s: Session, user_id: Any) -> Any:
    return s.execute(
        text(
            "SELECT kcal, fiber_g, water_ml FROM targets WHERE user_id = :u "
            "AND deleted_at IS NULL ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1"
        ),
        {"u": user_id},
    ).one_or_none()


def _current_water(s: Session, user_id: Any) -> int | None:
    row = _current(s, user_id)
    return None if row is None else row.water_ml


def _fiber_for(s: Session, user_id: Any, kcal: int) -> int:
    """A fiber target the user set carries over; otherwise the default for these calories."""
    row = _current(s, user_id)
    if row is not None and row.fiber_g is not None and row.fiber_g != fiber_default(row.kcal):
        fiber: int = row.fiber_g
        return fiber
    return fiber_default(kcal)


@router.post("/targets/apply-calculation", status_code=status.HTTP_201_CREATED)
def apply_calculation(body: CalcIn, user: ActiveUserDep, services: ServicesDep) -> TargetOut:
    """Saves a calculator result as the new targets, only when the user taps the button."""
    result = calculate(body.to_input())
    if result.target_kcal <= 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Calorie target must be positive"
        )
    now = services.clock()
    with user_session(user.user_id) as s:
        p = _profile(s, user.user_id)
        today = local_date(now, p.timezone)
        _save_body_stats(s, user.user_id, body.sex, body.age, body.height_cm, body.activity, today)
        row = Target(
            user_id=user.user_id,
            effective_from=today,
            kcal=result.target_kcal,
            protein_g=result.protein_g,
            carbs_g=result.carbs_g,
            fat_g=result.fat_g,
            fiber_g=_fiber_for(s, user.user_id, result.target_kcal),
            # Water has no default; a target the user set carries over.
            water_ml=_current_water(s, user.user_id),
            source="calculator",
            calc_inputs=_calc_inputs(body, result),
            bmr=result.bmr,
            tdee=result.tdee,
            created_at=now,
        )
        s.add(row)
        s.flush()
        s.refresh(row)
        out = _target_out(row)
    return out


KCAL_RANGE = (500, 10000)
GRAMS_MAX = 1500


class CustomTargetIn(BaseModel):
    """A custom edit from the Targets editor. Omit carbs_g (or send null) and carbs fill the
    rest of the calories with protein and fat as given, the same rule the calculator uses."""

    kcal: Annotated[int, Field(ge=KCAL_RANGE[0], le=KCAL_RANGE[1])]
    protein_g: Annotated[int, Field(ge=0, le=GRAMS_MAX)]
    fat_g: Annotated[int, Field(ge=0, le=GRAMS_MAX)]
    carbs_g: Annotated[int, Field(ge=0, le=GRAMS_MAX)] | None = None
    # Omitted: a fiber target the user set carries over, else the default for these calories
    # (14 g per 1,000 kcal).
    fiber_g: Annotated[int, Field(ge=0, le=200)] | None = None
    # Omitted: the current water target carries over; null turns it off.
    water_ml: Annotated[int, Field(ge=250, le=10000)] | None = None
    # The calculator result being adjusted, when there is no saved formula yet (the "Adjust"
    # button at sign-up). Otherwise the formula of the targets in effect carries over.
    basis: CalcIn | None = None


@router.post("/targets", status_code=status.HTTP_201_CREATED)
def save_custom_targets(
    body: CustomTargetIn, user: ActiveUserDep, services: ServicesDep
) -> TargetOut:
    """Saves an edit as a new row (source = custom), only when the user taps Save."""
    carbs = body.carbs_g
    if carbs is None:
        carbs = carbs_for_rest(body.kcal, body.protein_g, body.fat_g).carbs_g
    now = services.clock()
    with user_session(user.user_id) as s:
        p = _profile(s, user.user_id)
        today = local_date(now, p.timezone)
        calc_inputs: dict[str, Any] | None = None
        bmr: int | None = None
        tdee: int | None = None
        if body.basis is not None:
            result = calculate(body.basis.to_input())
            calc_inputs, bmr, tdee = _calc_inputs(body.basis, result), result.bmr, result.tdee
        else:
            current = s.execute(
                text(
                    "SELECT calc_inputs, bmr, tdee FROM targets "
                    "WHERE user_id = :u AND deleted_at IS NULL "
                    "ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1"
                ),
                {"u": user.user_id},
            ).one_or_none()
            if current is not None:
                calc_inputs, bmr, tdee = current.calc_inputs, current.bmr, current.tdee
        water = (
            body.water_ml
            if "water_ml" in body.model_fields_set
            else _current_water(s, user.user_id)
        )
        row = Target(
            user_id=user.user_id,
            effective_from=today,
            kcal=body.kcal,
            protein_g=body.protein_g,
            carbs_g=carbs,
            fat_g=body.fat_g,
            fiber_g=body.fiber_g
            if body.fiber_g is not None
            else _fiber_for(s, user.user_id, body.kcal),
            water_ml=water,
            source="custom",
            calc_inputs=calc_inputs,
            bmr=bmr,
            tdee=tdee,
            created_at=now,
        )
        s.add(row)
        s.flush()
        s.refresh(row)
        out = _target_out(row)
    return out


@router.get("/targets")
def list_targets(user: ActiveUserDep) -> list[TargetOut]:
    """Target history, newest first. The first row is the one in effect now."""
    with user_session(user.user_id) as s:
        rows = (
            s.execute(
                select(Target)
                .where(Target.user_id == user.user_id, Target.deleted_at.is_(None))
                .order_by(Target.effective_from.desc(), Target.created_at.desc(), Target.id.desc())
            )
            .scalars()
            .all()
        )
        return [_target_out(r) for r in rows]
