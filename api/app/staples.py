"""Staple units and allowed amounts (SPEC page 3, My staples).

A staple's unit is its default serving ("100 g", "1 egg", "1 cup"). Countable units (eggs,
bottles, slices) default to 1 to 4 in steps of 1; everything else to 0.5 to 3 in steps of 0.5.
A suggestion picks one of the allowed amounts, so there are at most 7 per staple (20 x 7 = 140
binary variables in the optimizer).
"""

import re
from dataclasses import dataclass
from decimal import Decimal

MAX_STAPLES = 20
MAX_AMOUNTS = 7
MAX_UNITS = Decimal(99)
MEAL_UNIT = "1 meal"

# Words that measure an amount rather than name a thing you can count.
MEASURES = frozenset(
    {
        "g",
        "gram",
        "grams",
        "kg",
        "mg",
        "oz",
        "ounce",
        "ounces",
        "lb",
        "lbs",
        "pound",
        "pounds",
        "ml",
        "l",
        "litre",
        "litres",
        "liter",
        "liters",
        "dl",
        "cl",
        "fl",
        "floz",
        "cup",
        "cups",
        "tbsp",
        "tablespoon",
        "tablespoons",
        "tsp",
        "teaspoon",
        "teaspoons",
        "pint",
        "pints",
        "quart",
        "quarts",
        "serving",
        "servings",
        "portion",
        "portions",
        "meal",
        "meals",
    }
)


@dataclass(frozen=True)
class Amounts:
    step: Decimal
    min: Decimal
    max: Decimal


COUNTABLE = Amounts(Decimal(1), Decimal(1), Decimal(4))
MEASURED = Amounts(Decimal("0.5"), Decimal("0.5"), Decimal(3))


def is_countable(unit_label: str) -> bool:
    """True for "1 egg", "1 large egg", "1 bottle (500 ml)" or "2 slices"; false for "100 g",
    "1 cup (240 ml)", "1 tbsp" or "1 serving". What is in brackets only describes the unit."""
    words = re.findall(r"[a-z]+", re.sub(r"\([^)]*\)", " ", unit_label.lower()))
    return bool(words) and not any(w in MEASURES for w in words)


def default_amounts(unit_label: str) -> Amounts:
    return COUNTABLE if is_countable(unit_label) else MEASURED


def amounts_error(a: Amounts) -> str | None:
    """Why these amounts cannot be used, or None when they can."""
    if a.step <= 0 or a.min <= 0:
        return "Amounts must be more than 0."
    if a.max < a.min:
        return "The largest amount must be at least the smallest."
    if a.max > MAX_UNITS:
        return f"The largest amount can be at most {MAX_UNITS}."
    if (a.max - a.min) % a.step != 0:
        return "The step must fit evenly between the smallest and largest amounts."
    if (a.max - a.min) / a.step + 1 > MAX_AMOUNTS:
        return f"Allow at most {MAX_AMOUNTS} amounts. Use a bigger step or a narrower range."
    return None


def allowed(a: Amounts) -> list[Decimal]:
    """Every amount a suggestion may use, smallest first."""
    out = []
    v = a.min
    while v <= a.max:
        out.append(v)
        v += a.step
    return out
