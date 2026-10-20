"""What fits my macros (SPEC page 3, Planning and review features). Display only.

Remaining today R_m = target_m - eaten_m. With weights w (kcal 0.25, protein 0.35, carbs 0.20,
fat 0.20): coverage = sum w_m x min(n_m / R_m, 1), overflow = sum w_m x max(n_m / R_m - 1, 0),
and fit score = coverage - overflow. A macro already met (R_m at or below 0) counts any amount
of it as overflow: w_m x n_m / target_m.
"""

import math
from dataclasses import dataclass
from typing import Literal

MACROS = ("kcal", "protein_g", "carbs_g", "fat_g")
WEIGHTS = {"kcal": 0.25, "protein_g": 0.35, "carbs_g": 0.20, "fat_g": 0.20}
GREAT = 0.5
PARTIAL = 0.25
# "Fits up to" rounds down to a tidy amount.
FITS_STEP_G = 5

Nutrients = dict[str, float]
Label = Literal["Great fit", "Partial fit"]


@dataclass(frozen=True)
class Fit:
    score: float
    # How much of what is left each macro fills (0 to 1), for the small bars.
    fills: dict[str, float]
    # Macros pushed past what is left (or already met).
    overflows: list[str]


def remaining(target: Nutrients, eaten: Nutrients) -> Nutrients:
    return {m: target[m] - eaten.get(m, 0.0) for m in MACROS}


def fit_score(item: Nutrients, left: Nutrients, target: Nutrients) -> Fit:
    coverage = 0.0
    overflow = 0.0
    fills: dict[str, float] = {}
    overflows: list[str] = []
    for m in MACROS:
        n, r, w = item[m], left[m], WEIGHTS[m]
        if r <= 0:
            fills[m] = 0.0
            if n > 0 and target[m] > 0:
                overflow += w * n / target[m]
                overflows.append(m)
            continue
        ratio = n / r
        fills[m] = min(ratio, 1.0)
        coverage += w * min(ratio, 1.0)
        if ratio > 1:
            overflow += w * (ratio - 1)
            overflows.append(m)
    return Fit(score=coverage - overflow, fills=fills, overflows=overflows)


def label_for(score: float) -> Label | None:
    """Below 0.25 is hidden from this sort. The edges compare the score rounded as shown."""
    shown = round(score, 2)
    if shown >= GREAT:
        return "Great fit"
    if shown >= PARTIAL:
        return "Partial fit"
    return None


def fits_up_to_g(kcal_100: float, left_kcal: float) -> int | None:
    """The largest grams (rounded down to 5 g) that keep calories within what is left."""
    if kcal_100 <= 0 or left_kcal <= 0:
        return None
    grams = math.floor(left_kcal / (kcal_100 / 100) / FITS_STEP_G) * FITS_STEP_G
    return grams if grams > 0 else None
