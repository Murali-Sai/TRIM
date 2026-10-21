"""What should I eat? (SPEC page 3, My staples and "What should I eat?"). Deterministic, no AI.

A small mixed-integer program solved with scipy.optimize.milp (HiGHS). One binary x[i,k] per
staple i and allowed amount k: at most one amount per staple, 1 to max_items staples, and total
kcal at most 1.05 x the calorie budget. The objective is the weighted distance from the budget,
sum of w_m x |total_m - B_m| / target_m (the Fits my macros weights), minus a small bonus of
0.005 x score for every good pair on the plate. Match % = 100 x (1 - distance).

After each solve a constraint forbids that exact set of staples, so the next answer is a
different combination (Shuffle passes the sets already shown). Pairs scored -1 or lower, and the
user's "never" pairs, are never on one plate.

Speed. Proving the very best plate among thousands that match within a few tenths of a percent
takes HiGHS seconds, and the difference is invisible on a card. So each solve stops after
NODE_LIMIT branch-and-bound nodes (or once it is within GAP of proven best), with strong
branching and the sub-MIP heuristics off; same input, same answer. Measured on 20 everyday
staples, that lands within 0.5 points of the exhaustive best on average. TIME_BUDGET is only a
safety net on a slow machine, shared by the solves of one request, so a request stays under
the 300 ms in SPEC.
"""

import time
import warnings
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

from app.fit import MACROS, WEIGHTS

Nutrients = dict[str, float]

KCAL_CAP = 1.05
MIN_MATCH = 80.0
PAIR_BONUS = 0.005
FORBIDDEN_AT = -1.0
MAX_ITEMS = 5
NODE_LIMIT = 50
# 0.001 of distance is 0.1 match points, the precision a card shows.
GAP = 0.001
TIME_BUDGET = 0.25
# HiGHS option names; scipy passes the ones it does not know to HiGHS as they are.
HIGHS = {
    "mip_rel_gap": 0.0,
    "mip_abs_gap": GAP,
    "mip_max_nodes": NODE_LIMIT,
    "mip_pscost_minreliable": 0,
    "mip_detect_symmetry": False,
    "mip_heuristic_run_rens": False,
    "mip_heuristic_run_rins": False,
    "mip_heuristic_run_root_reduced_cost": False,
}


@dataclass(frozen=True)
class Staple:
    id: str
    # Nutrients in one unit.
    per_unit: Mapping[str, float]
    # The amounts (in units) a suggestion may use.
    amounts: tuple[float, ...]


@dataclass(frozen=True)
class Suggestion:
    # (staple id, units), in the staples' order.
    items: tuple[tuple[str, float], ...]
    totals: Nutrients
    # Budget minus totals; negative when a suggestion goes over.
    leaves: Nutrients
    distance: float
    match_pct: float


def budget(
    targets: Mapping[str, float],
    eaten: Mapping[str, float],
    *,
    fraction: float | None = None,
    kcal: float | None = None,
) -> Nutrients:
    """What is left today (a met macro is 0), or a share of it: a fraction ("Next meal" 25%,
    33%, 50%) or typed calories, with every macro scaled by the same share."""
    if fraction is not None and kcal is not None:
        raise ValueError("Use a fraction or calories, not both")
    left = {m: max(float(targets[m]) - float(eaten.get(m, 0)), 0.0) for m in MACROS}
    if kcal is not None:
        fraction = kcal / left["kcal"] if left["kcal"] > 0 else 0.0
    if fraction is None:
        return left
    return {m: left[m] * fraction for m in MACROS}


def distance(
    totals: Mapping[str, float], b: Mapping[str, float], targets: Mapping[str, float]
) -> float:
    return sum(WEIGHTS[m] * abs(totals[m] - b[m]) / max(float(targets[m]), 1.0) for m in MACROS)


class _Model:
    """The program for one request; `forbid` adds a constraint for every solve after it."""

    def __init__(
        self,
        pool: list[Staple],
        b: Mapping[str, float],
        targets: Mapping[str, float],
        max_items: int,
        locked: Mapping[str, float | None],
        banned: set[frozenset[str]],
        good: list[tuple[tuple[int, int], float]],
    ) -> None:
        self.pool = pool
        self.index = {st.id: i for i, st in enumerate(pool)}
        cap = KCAL_CAP * float(b["kcal"])
        # x columns: every staple and amount that fits under the calorie cap on its own.
        self.cols = [
            (i, a)
            for i, st in enumerate(pool)
            for a in st.amounts
            if a * st.per_unit["kcal"] <= cap + 1e-9
        ]
        nx, nd = len(self.cols), len(MACROS)
        self.nx = nx
        # Then d_m (distance per macro, in daily targets), then y per good pair.
        n = nx + nd + len(good)
        scale = {m: max(float(targets[m]), 1.0) for m in MACROS}

        self.c = np.zeros(n)
        for j, m in enumerate(MACROS):
            self.c[nx + j] = WEIGHTS[m]
        for j, (_, v) in enumerate(good):
            self.c[nx + nd + j] = -PAIR_BONUS * v

        self.z = [np.zeros(n) for _ in pool]
        for col, (i, _) in enumerate(self.cols):
            self.z[i][col] = 1
        self.rows: list[np.ndarray] = []
        self.lo: list[float] = []
        self.hi: list[float] = []

        for i, row in enumerate(self.z):
            self._add(row, 1 if pool[i].id in locked else 0, 1)
        every = np.zeros(n)
        every[:nx] = 1
        self._add(every, 1, max_items)
        for j, m in enumerate(MACROS):
            total = np.zeros(n)
            for col, (i, a) in enumerate(self.cols):
                total[col] = a * pool[i].per_unit[m] / scale[m]
            if m == "kcal":
                self._add(total.copy(), -np.inf, cap / scale[m])
            # d_m >= |total_m - B_m|, as two rows.
            over = total.copy()
            over[nx + j] = -1
            self._add(over, -np.inf, float(b[m]) / scale[m])
            under = -total
            under[nx + j] = -1
            self._add(under, -np.inf, -float(b[m]) / scale[m])
        for p in banned:
            ids = [self.index[x] for x in p if x in self.index]
            if len(ids) == 2:
                self._add(self.z[ids[0]] + self.z[ids[1]], -np.inf, 1)
        for j, ((a, b2), _) in enumerate(good):
            for i in (a, b2):
                row = -self.z[i]
                row[nx + nd + j] = 1
                self._add(row, -np.inf, 0)

        self.lower = np.zeros(n)
        self.upper = np.ones(n)
        self.upper[nx : nx + nd] = np.inf
        for col, (i, a) in enumerate(self.cols):
            if locked.get(pool[i].id) == a:
                self.lower[col] = 1
        self.integrality = np.zeros(n)
        self.integrality[:nx] = 1

    def _add(self, row: np.ndarray, low: float, high: float) -> None:
        self.rows.append(row)
        self.lo.append(low)
        self.hi.append(high)

    def forbid(self, ids: frozenset[str]) -> None:
        """Sum of z in the set minus sum outside it <= |set| - 1: only that exact set is out."""
        if not ids or not ids <= self.index.keys():
            return
        row = -sum(self.z, np.zeros_like(self.c))
        for sid in ids:
            row = row + 2 * self.z[self.index[sid]]
        self._add(row, -np.inf, len(ids) - 1)

    def solve(self, seconds: float) -> list[tuple[int, float]] | None:
        with warnings.catch_warnings():
            # scipy warns that it hands the HiGHS options on unchanged, which is the intent.
            warnings.simplefilter("ignore", RuntimeWarning)
            res = milp(
                self.c,
                constraints=LinearConstraint(np.array(self.rows), self.lo, self.hi),
                integrality=self.integrality,
                bounds=Bounds(self.lower, self.upper),
                options={**HIGHS, "time_limit": max(seconds, 0.01)},
            )
        # 0 is proven best; 1 and 4 stop at a limit with the best plate found so far. Anything
        # else (2 is infeasible) means no other set fits.
        if res.x is None or res.status not in (0, 1, 4):
            return None
        return sorted(
            (self.cols[col] for col in range(self.nx) if res.x[col] > 0.5), key=lambda t: t[0]
        )


def suggest(
    staples: list[Staple],
    budget: Mapping[str, float],
    targets: Mapping[str, float],
    *,
    max_items: int = 3,
    count: int = 3,
    excluded: Iterable[str] = (),
    locked: Mapping[str, float | None] | None = None,
    exclude_sets: Iterable[Iterable[str]] = (),
    pair_scores: Mapping[frozenset[str], float] | None = None,
    never: Iterable[frozenset[str]] = (),
    min_match: float = MIN_MATCH,
) -> list[Suggestion]:
    """Up to `count` suggestions, best first, each a different set of staples."""
    if not 1 <= max_items <= MAX_ITEMS:
        raise ValueError("max_items is 1 to 5")
    out = set(excluded)
    pool = [st for st in staples if st.id not in out and st.amounts]
    ids = {st.id: st for st in pool}
    locked = dict(locked or {})
    for sid, amount in locked.items():
        if sid not in ids:
            raise ValueError(f"Locked staple {sid} is not available")
        if amount is not None and amount not in ids[sid].amounts:
            raise ValueError(f"Locked amount {amount} is not allowed for {sid}")
    if not pool or len(locked) > max_items:
        return []

    scores = pair_scores or {}
    banned = {frozenset(p) for p in never} | {p for p, v in scores.items() if v <= FORBIDDEN_AT}
    order = {st.id: i for i, st in enumerate(pool)}
    good = [
        ((order[a], order[b]), v)
        for p, v in scores.items()
        if v > 0 and p not in banned and len(p) == 2 and p <= ids.keys()
        for a, b in [sorted(p, key=order.__getitem__)]
    ]
    model = _Model(pool, budget, targets, max_items, locked, banned, good)
    if any(a is not None and (order[sid], a) not in model.cols for sid, a in locked.items()):
        return []  # a locked amount alone goes over the calorie cap
    for shown in exclude_sets:
        model.forbid(frozenset(shown))

    started = time.perf_counter()
    results: list[Suggestion] = []
    # A good-pair bonus can put a lower match ahead, so look a little past the first miss.
    tries = count + (10 if good else 0)
    while len(results) < count and tries > 0:
        left = TIME_BUDGET - (time.perf_counter() - started)
        chosen = model.solve(left / max(count - len(results), 1))
        tries -= 1
        if chosen is None:
            break
        items = tuple((pool[i].id, a) for i, a in chosen)
        totals = {m: sum(a * pool[i].per_unit[m] for i, a in chosen) for m in MACROS}
        d = distance(totals, budget, targets)
        match = round(100 * (1 - d), 1)
        model.forbid(frozenset(sid for sid, _ in items))
        if match < min_match:
            if not good:
                break
            continue
        results.append(
            Suggestion(
                items=items,
                totals=totals,
                leaves={m: float(budget[m]) - totals[m] for m in MACROS},
                distance=d,
                match_pct=match,
            )
        )
    return results
