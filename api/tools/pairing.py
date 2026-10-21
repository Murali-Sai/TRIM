"""Food pairing scores from What We Eat in America (task 3.22, SPEC page 3, Food pairing).

Pure functions, so the rules are tested on small fixtures (tests/test_pairing_build.py); the
command-line build that reads the NHANES and FNDDS files is tools/build_pairing.py.

- A plate is one participant's eating occasion on one survey day (SEQN, day, time, occasion).
- Its context comes from the occasion name: breakfast, lunch, dinner or snack. Drinks, infant
  feeding, extended consumption and unknown occasions are left out.
- Each food code maps to its WWEIA category, and each category to one of the 23 groups (or to
  none, for beverages, water, alcohol, infant formula and the like). A group counts once per
  plate however many of its foods are on it.
- The category-to-group table is written next to the scores (pairing_categories.csv) so a
  person can check it before the table is committed.
- For each context and each pair of groups: lift = P(both on one plate) / (P(a) x P(b)) and
  score = log2(lift), clipped to -2 to +2. Pairs seen on fewer than 30 plates score 0
  (unknown). Counts are unweighted (no survey weights in v1).
"""

import csv
import math
import re
from collections import Counter
from collections.abc import Hashable, Iterable, Mapping
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path

from app.models import FOOD_GROUPS

CONTEXTS = ("breakfast", "lunch", "dinner", "snack")
MIN_PLATES = 30
CLIP = 2.0

# NHANES DR1_030Z / DR2_030Z, "Name of eating occasion", in English and Spanish. The build
# refuses a code that is not listed here, so a changed codebook cannot slip through.
OCCASIONS: dict[int, str | None] = {
    1: "breakfast",  # Breakfast
    2: "lunch",  # Lunch
    3: "dinner",  # Dinner
    4: "dinner",  # Supper
    5: "breakfast",  # Brunch
    6: "snack",  # Snack
    7: None,  # Drink
    8: None,  # Infant feeding
    9: None,  # Extended consumption
    10: "breakfast",  # Desayuno
    11: "lunch",  # Almuerzo
    12: "lunch",  # Comida
    13: "snack",  # Merienda
    14: "dinner",  # Cena
    15: "snack",  # Entre comida
    16: "snack",  # Botana
    17: "snack",  # Bocadillo
    18: "snack",  # Tentempie
    19: None,  # Bebida
    91: None,  # Other
    99: None,  # Don't know
}

# WWEIA category description -> group, first match wins. Matching on the description rather
# than the number keeps the table readable; the build stops on any category that matches
# nothing, so a new or renamed category is decided by a person, never guessed.
CATEGORY_RULES: list[tuple[str, str | None]] = [
    # Left out of plates: drinks and things that are not a food choice.
    (r"juice|soft drink|fruit drink|sport and energy|coffee|\btea\b|beer|wine|liquor", None),
    (r"water|smoothies|baby food|infant formula|human milk|not included", None),
    (r"sugar substitutes", None),
    (
        r"protein and nutritional powders|nutritional beverages|nutrition bars|cereal bars",
        "shakes_bars",
    ),
    (r"milk shakes", "shakes_bars"),
    (r"vegetable mixed dishes", "vegetables"),
    (r"pasta sauces|dips, gravies|other sauces", "sauces_condiments"),
    (
        r"mixed dishes|macaroni|turnovers|fried rice|stir-fry|egg rolls|dumplings|sushi|"
        r"burritos|tacos|nachos|mexican|pizza|burgers|sandwiches|soups",
        "mixed_dishes",
    ),
    (r"yogurt", "yogurt"),
    (r"cottage|ricotta|^cheese", "cheese"),
    (r"cream cheese|sour cream|whipped cream|cream and cream substitutes", "fats_oils"),
    (r"butter and animal fats|margarine|mayonnaise|salad dressings|vegetable oils", "fats_oils"),
    (r"milk", "milk"),
    (r"chicken|turkey|poultry", "poultry"),
    (r"beef|pork|lamb|organ meats|cold cuts|cured meats|bacon|frankfurters|sausages", "red_meat"),
    (r"fish|shellfish", "fish_seafood"),
    (r"eggs", "eggs"),
    (r"beans, peas, legumes", "beans_legumes"),
    (r"nuts and seeds", "nuts_butters"),
    (r"soy products", "tofu_plant_protein"),
    (r"^rice", "rice_grains"),
    (r"pasta|noodles|cooked grains", "pasta"),
    (r"cereal|oatmeal|grits", "cereal_oats"),
    (r"chips|popcorn|pretzels|crackers", "savory_snacks"),
    (
        r"^cakes|pies|cookies|brownies|doughnuts|pastries|candy|ice cream|pudding|gelatins",
        "sweets_desserts",
    ),
    (r"sugars and honey|jams, syrups", "sweets_desserts"),
    (
        r"bread|rolls|buns|bagels|english muffins|tortillas$|biscuits|muffins|pancakes",
        "bread_tortillas",
    ),
    (r"potato|french fries", "potatoes"),
    (r"condiments|olives, pickles", "sauces_condiments"),
    (r"apples|bananas|grapes|peaches|strawberries|berries|citrus|melons|dried fruits", "fruit"),
    (r"fruits|pears|pineapple|mango", "fruit"),
    (r"tomatoes|carrots|vegetables|lettuce|string beans|onions|corn", "vegetables"),
]


def group_for(description: str) -> str | None:
    d = description.strip().lower()
    for pattern, group in CATEGORY_RULES:
        if re.search(pattern, d):
            return group
    raise KeyError(description)


def category_groups(categories: Mapping[int, str]) -> dict[int, str | None]:
    """WWEIA category number -> group, for every category; refuses any it cannot place."""
    out: dict[int, str | None] = {}
    unknown: list[str] = []
    for number, description in categories.items():
        try:
            out[number] = group_for(description)
        except KeyError:
            unknown.append(f"{number} {description}")
    if unknown:
        raise ValueError("No group for these WWEIA categories: " + "; ".join(sorted(unknown)))
    return out


@dataclass(frozen=True)
class Record:
    """One food on one plate."""

    plate: Hashable
    occasion: int
    food_code: int


@dataclass(frozen=True)
class PairScore:
    context: str
    group_a: str
    group_b: str
    plates: int  # plates in this context with both groups
    lift: float | None
    score: float


def plates_by_context(
    records: Iterable[Record], food_groups: Mapping[int, str | None]
) -> dict[str, list[frozenset[str]]]:
    """Each context's plates, as the set of groups on each."""
    groups: dict[Hashable, set[str]] = {}
    context: dict[Hashable, str] = {}
    for r in records:
        if r.occasion not in OCCASIONS:
            raise ValueError(f"Unknown eating occasion code {r.occasion}")
        ctx = OCCASIONS[r.occasion]
        if ctx is None:
            continue
        if r.food_code not in food_groups:
            raise ValueError(f"Food code {r.food_code} has no WWEIA category")
        context[r.plate] = ctx
        g = food_groups[r.food_code]
        groups.setdefault(r.plate, set())
        if g is not None:
            groups[r.plate].add(g)
    out: dict[str, list[frozenset[str]]] = {c: [] for c in CONTEXTS}
    for plate, gs in groups.items():
        if gs:
            out[context[plate]].append(frozenset(gs))
    return out


def scores(plates: Mapping[str, list[frozenset[str]]]) -> list[PairScore]:
    """Every pair of two different groups in every context (4 x 253 rows; SPEC's "about 4 x
    276" also counts a group with itself, which says nothing as a group counts once per
    plate), alphabetical within a pair."""
    out: list[PairScore] = []
    for ctx in CONTEXTS:
        ps = plates.get(ctx, [])
        n = len(ps)
        single: Counter[str] = Counter(g for p in ps for g in p)
        both: Counter[tuple[str, str]] = Counter(
            pair for p in ps for pair in combinations(sorted(p), 2)
        )
        for a, b in combinations(sorted(FOOD_GROUPS), 2):
            k = both[(a, b)]
            if k < MIN_PLATES or n == 0:
                out.append(PairScore(ctx, a, b, k, None, 0.0))
                continue
            lift = k * n / (single[a] * single[b])
            score = max(-CLIP, min(CLIP, math.log2(lift)))
            out.append(PairScore(ctx, a, b, k, lift, round(score, 4)))
    return out


FIELDS = ("context", "group_a", "group_b", "plates", "lift", "score", "data_version")


def write_csv(rows: Iterable[PairScore], path: Path, data_version: str) -> None:
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(FIELDS)
        for r in rows:
            lift = "" if r.lift is None else f"{r.lift:.4f}"
            w.writerow([r.context, r.group_a, r.group_b, r.plates, lift, r.score, data_version])


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f))
