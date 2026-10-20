"""TDEE calculator and default macro targets, exactly as in SPEC page 3.

Mirrors web/src/lib/tdee.ts; both pass shared/tdee_vectors.json. Everything is computed
unrounded and rounded once at the end.
"""

import math
from dataclasses import dataclass, field
from typing import Literal

Sex = Literal["male", "female"]
ActivityLevel = Literal["sedentary", "light", "moderate", "heavy", "athlete"]
Plan = Literal["maintain", "lose"]
RuleSet = Literal["standard", "high_bmi"]

KCAL_PER_G_PROTEIN = 4
KCAL_PER_G_CARBS = 4
KCAL_PER_G_FAT = 9
LB_IN_KG = 0.45359237
CM_PER_IN = 2.54

ACTIVITY_FACTORS: dict[str, float] = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "heavy": 1.725,
    "athlete": 1.9,
}

DEFICITS = (600, 650, 700)
DEFAULT_DEFICIT = 650
CALORIE_FLOOR: dict[str, int] = {"male": 1500, "female": 1200}
KCAL_PER_KG_FAT = 7700

AGE_RANGE = (18, 100)
WEIGHT_KG_RANGE = (30.0, 300.0)
HEIGHT_CM_RANGE = (120.0, 230.0)


def round_half_up(x: float, digits: int = 0) -> float:
    """Round half up to `digits` decimals. The value is first snapped to 9 decimals so binary
    noise (1780 x 1.725 = 3070.4999...) rounds the way the decimal arithmetic in the SPEC does.
    Python's round() rounds half to even, which would not match the TypeScript side."""
    scale = 10.0**digits
    return math.floor(round(x * scale, 9) + 0.5) / scale


def round_int(x: float) -> int:
    return int(round_half_up(x))


def lb_to_kg(lb: float) -> float:
    return lb * LB_IN_KG


def kg_to_lb(kg: float) -> float:
    return kg / LB_IN_KG


def ft_in_to_cm(ft: float, inches: float) -> float:
    return (ft * 12 + inches) * CM_PER_IN


def bmr(sex: Sex, age: int, weight_kg: float, height_cm: float) -> float:
    """Mifflin-St Jeor."""
    return 10 * weight_kg + 6.25 * height_cm - 5 * age + (5 if sex == "male" else -161)


def bmi(weight_kg: float, height_cm: float) -> float:
    """BMI as shown to the user (one decimal). Plan and rule choices use this same value."""
    m = height_cm / 100
    return round_half_up(weight_kg / (m * m), 1)


def suggested_plan(bmi_value: float) -> Plan:
    return "lose" if bmi_value >= 25 else "maintain"


def rule_set_for(bmi_value: float) -> RuleSet:
    """BMI 30 or more uses 0.7 g/lb protein and 25% fat, whichever plan the user picks."""
    return "high_bmi" if bmi_value >= 30 else "standard"


@dataclass(frozen=True)
class Macros:
    protein_g: int
    fat_g: int
    carbs_g: int
    # True when protein and fat alone use the whole target, so carbs were set to 0.
    carbs_clamped: bool
    raw: dict[str, float] = field(default_factory=dict)


def macros_for(target_kcal: float, weight_kg: float, rule_set: RuleSet) -> Macros:
    lb = kg_to_lb(weight_kg)
    protein = (0.7 if rule_set == "high_bmi" else 0.8) * lb
    fat = 0.25 * target_kcal / KCAL_PER_G_FAT if rule_set == "high_bmi" else 0.3 * lb
    carbs_raw = (
        target_kcal - KCAL_PER_G_PROTEIN * protein - KCAL_PER_G_FAT * fat
    ) / KCAL_PER_G_CARBS
    clamped = carbs_raw < 0
    carbs = 0.0 if clamped else carbs_raw
    return Macros(
        protein_g=round_int(protein),
        fat_g=round_int(fat),
        carbs_g=round_int(carbs),
        carbs_clamped=clamped,
        raw={"protein_g": protein, "fat_g": fat, "carbs_g": carbs},
    )


@dataclass(frozen=True)
class Carbs:
    carbs_g: int
    # True when protein and fat alone exceed the calorie target, so carbs were set to 0.
    carbs_clamped: bool


def carbs_for_rest(kcal: int, protein_g: int, fat_g: int) -> Carbs:
    """Custom edits (SPEC page 3, "Custom targets"): protein and fat stay as the user has them
    and carbs fill the rest of the calorie target."""
    rest = (kcal - KCAL_PER_G_PROTEIN * protein_g - KCAL_PER_G_FAT * fat_g) / KCAL_PER_G_CARBS
    if rest < 0:
        return Carbs(carbs_g=0, carbs_clamped=True)
    return Carbs(carbs_g=round_int(rest), carbs_clamped=False)


@dataclass(frozen=True)
class CalcInput:
    sex: Sex
    age: int
    weight_kg: float
    height_cm: float
    activity: ActivityLevel
    # None uses the suggested plan.
    plan: Plan | None = None
    # Used only for the Lose plan.
    deficit_kcal: int = DEFAULT_DEFICIT


@dataclass(frozen=True)
class CalcResult:
    bmr: int
    tdee: int
    weekly_tdee: int
    bmi: float
    suggested_plan: Plan
    plan: Plan
    rule_set: RuleSet
    deficit_kcal: int
    target_kcal: int
    floor_applied: bool
    protein_g: int
    fat_g: int
    carbs_g: int
    carbs_clamped: bool
    # Rough weekly loss at 7,700 kcal per kg, for display only.
    pace_kg_per_week: float
    raw: dict[str, float]


def calculate(i: CalcInput) -> CalcResult:
    if i.deficit_kcal not in DEFICITS:
        raise ValueError("deficit must be 600, 650 or 700")
    bmr_raw = bmr(i.sex, i.age, i.weight_kg, i.height_cm)
    tdee_raw = bmr_raw * ACTIVITY_FACTORS[i.activity]
    bmi_value = bmi(i.weight_kg, i.height_cm)
    suggested = suggested_plan(bmi_value)
    plan: Plan = i.plan or suggested
    rule_set = rule_set_for(bmi_value)

    deficit = i.deficit_kcal if plan == "lose" else 0
    target = tdee_raw - deficit
    # The floor guards against too steep a deficit; maintenance is left as calculated.
    floor = CALORIE_FLOOR[i.sex]
    floor_applied = plan == "lose" and target < floor
    if floor_applied:
        target = float(floor)

    m = macros_for(target, i.weight_kg, rule_set)
    actual_deficit = max(0.0, tdee_raw - target)
    return CalcResult(
        bmr=round_int(bmr_raw),
        tdee=round_int(tdee_raw),
        weekly_tdee=round_int(tdee_raw * 7),
        bmi=bmi_value,
        suggested_plan=suggested,
        plan=plan,
        rule_set=rule_set,
        deficit_kcal=deficit,
        target_kcal=round_int(target),
        floor_applied=floor_applied,
        protein_g=m.protein_g,
        fat_g=m.fat_g,
        carbs_g=m.carbs_g,
        carbs_clamped=m.carbs_clamped,
        pace_kg_per_week=(
            round_half_up(actual_deficit * 7 / KCAL_PER_KG_FAT, 2) if plan == "lose" else 0
        ),
        raw={
            "bmr": bmr_raw,
            "tdee": tdee_raw,
            "weight_lb": kg_to_lb(i.weight_kg),
            "target_kcal": target,
            **m.raw,
        },
    )


def validate_body_stats(age: float, weight_kg: float, height_cm: float) -> dict[str, str]:
    """Errors keyed by field, in form order. Empty when everything is in range."""
    errors: dict[str, str] = {}
    if age != int(age) or not AGE_RANGE[0] <= age <= AGE_RANGE[1]:
        errors["age"] = "Enter an age from 18 to 100."
    if not WEIGHT_KG_RANGE[0] <= weight_kg <= WEIGHT_KG_RANGE[1]:
        errors["weight_kg"] = "Enter a weight from 30 to 300 kg (66 to 661 lb)."
    if not HEIGHT_CM_RANGE[0] <= height_cm <= HEIGHT_CM_RANGE[1]:
        errors["height_cm"] = "Enter a height from 120 to 230 cm (3 ft 11 in to 7 ft 6 in)."
    return errors
