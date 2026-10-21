"""Task 3.20: the suggestion optimizer (SPEC page 3, My staples and "What should I eat?").
Tests first. AC: the worked example returns the same three combinations and match % (97.5,
97.2, 97.0); 20 staples solve under 300 ms.

The worked example's staples come from SPEC; their allowed amounts are the defaults (0.5 to 3
in steps of 0.5, eggs and bananas counted) except yogurt, banana and peanut butter, which allow
up to 2 units (SPEC states this next to the example)."""

import itertools
import random
import time

import pytest

from app import suggest as s
from app.fit import MACROS, WEIGHTS

TARGETS = {"kcal": 2300, "protein_g": 150, "carbs_g": 280, "fat_g": 65}
EATEN = {"kcal": 1400, "protein_g": 90, "carbs_g": 180, "fat_g": 40}
HALF = (0.5, 1, 1.5, 2, 2.5, 3)
UP_TO_2 = (0.5, 1, 1.5, 2)


def per(kcal: float, p: float, c: float, f: float) -> dict[str, float]:
    return {"kcal": kcal, "protein_g": p, "carbs_g": c, "fat_g": f}


STAPLES = [
    s.Staple("chicken", per(165, 31, 0, 3.6), HALF),
    s.Staple("rice", per(130, 2.7, 28.2, 0.3), HALF),
    s.Staple("egg", per(72, 6.3, 0.4, 4.8), (1, 2, 3, 4)),
    s.Staple("yogurt", per(100, 17.3, 6.1, 0.7), UP_TO_2),
    s.Staple("banana", per(105, 1.3, 27, 0.4), (1, 2)),
    s.Staple("pb", per(94, 4, 3.1, 8.2), UP_TO_2),
]
LEFT = s.budget(TARGETS, EATEN)


def plate(sug: s.Suggestion) -> dict[str, float]:
    return dict(sug.items)


def run(**kw: object) -> list[s.Suggestion]:
    args: dict[str, object] = {"staples": STAPLES, "budget": LEFT, "targets": TARGETS}
    args.update(kw)
    return s.suggest(**args)  # type: ignore[arg-type]


# --- acceptance ---------------------------------------------------------------------------


def test_ac_worked_example_numbers_only() -> None:
    assert per(900, 60, 100, 25) == LEFT
    out = run()
    assert [plate(x) for x in out] == [
        {"rice": 3, "egg": 4, "yogurt": 1.5},
        {"chicken": 1.5, "rice": 3, "pb": 2},
        {"chicken": 1, "rice": 3, "egg": 4},
    ]
    assert [x.match_pct for x in out] == [97.5, 97.2, 97.0]
    # Items come in the staples' own order.
    assert [i for i, _ in out[0].items] == ["rice", "egg", "yogurt"]


def test_worked_example_totals_and_what_is_left() -> None:
    first = run()[0]
    assert {m: round(v, 2) for m, v in first.totals.items()} == per(828, 59.25, 95.35, 21.15)
    assert {m: round(v, 2) for m, v in first.leaves.items()} == per(72, 0.75, 4.65, 3.85)


def test_worked_example_with_dinner_pairing() -> None:
    """The fixture scores from SPEC: odd pairs at -1 or lower, three good pairs at +1.5."""
    bad = [("rice", "yogurt"), ("rice", "pb"), ("rice", "banana"), ("chicken", "pb")]
    bad += [("chicken", "banana")]
    good = [("chicken", "rice"), ("yogurt", "banana"), ("banana", "pb")]
    scores = {frozenset(p): -1.0 for p in bad} | {frozenset(p): 1.5 for p in good}
    out = run(pair_scores=scores)
    assert [plate(x) for x in out] == [
        {"chicken": 1, "rice": 3, "egg": 4},
        {"egg": 4, "yogurt": 2, "banana": 2},
        {"yogurt": 2, "banana": 2, "pb": 2},
    ]
    assert [x.match_pct for x in out] == [97.0, 93.8, 89.3]
    assert [round(x.totals["kcal"]) for x in out] == [843, 698, 598]
    assert [round(x.totals["protein_g"]) for x in out] == [64, 62, 45]
    assert [round(x.totals["carbs_g"]) for x in out] == [86, 68, 72]
    assert [round(x.totals["fat_g"]) for x in out] == [24, 21, 19]


def twenty() -> list[s.Staple]:
    rng = random.Random(20)  # noqa: S311 (a fixed test fixture)
    out = []
    for i in range(20):
        p, c, f = rng.uniform(0, 30), rng.uniform(0, 40), rng.uniform(0, 15)
        kcal = 4 * p + 4 * c + 9 * f
        amounts = (1, 2, 3, 4) if i % 3 == 0 else (0.5, 1, 1.5, 2, 2.5, 3, 3.5)
        out.append(s.Staple(f"s{i}", per(kcal, p, c, f), amounts))
    return out


def test_ac_20_staples_solve_under_300_ms() -> None:
    staples = twenty()
    s.suggest(staples, LEFT, TARGETS, max_items=5)  # warm the solver up once
    start = time.perf_counter()
    out = s.suggest(staples, LEFT, TARGETS, max_items=5)
    assert time.perf_counter() - start < 0.3
    assert len(out) == 3


# --- rules --------------------------------------------------------------------------------


def test_the_5_percent_calorie_cap_is_never_exceeded() -> None:
    rng = random.Random(5)  # noqa: S311 (a fixed test fixture)
    staples = twenty()
    for _ in range(25):
        kcal = rng.uniform(150, 1500)
        b = per(kcal, rng.uniform(0, 100), rng.uniform(0, 150), rng.uniform(0, 50))
        for x in s.suggest(staples, b, TARGETS, max_items=rng.randint(1, 5), min_match=0):
            assert x.totals["kcal"] <= 1.05 * kcal + 1e-6


def test_three_distinct_sets() -> None:
    sets = [frozenset(plate(x)) for x in run()]
    assert len(set(sets)) == 3


def test_shuffle_never_repeats_a_set_shown() -> None:
    shown: list[frozenset[str]] = []
    while True:
        out = run(exclude_sets=shown, min_match=0)
        if not out:
            break
        for x in out:
            assert frozenset(plate(x)) not in shown
            shown.append(frozenset(plate(x)))
    # Every non-empty set of up to 3 of the 6 staples that fits under the cap, once each.
    assert len(shown) == len(set(shown))
    assert len(shown) == sum(1 for k in (1, 2, 3) for _ in itertools.combinations(STAPLES, k))


def test_shuffle_skips_sets_but_allows_supersets() -> None:
    first = frozenset(plate(run()[0]))
    out = run(exclude_sets=[first], count=10, min_match=0)
    assert all(frozenset(plate(x)) != first for x in out)
    assert any(frozenset(plate(x)) > first for x in out) or len(first) == 3


@pytest.mark.parametrize("n", [1, 5])
def test_max_items(n: int) -> None:
    out = s.suggest(twenty(), LEFT, TARGETS, max_items=n, min_match=0)
    assert out
    assert all(1 <= len(x.items) <= n for x in out)
    if n == 1:
        assert all(len(x.items) == 1 for x in out)


def test_excluded_staples_never_appear() -> None:
    out = run(excluded={"rice", "egg"}, min_match=0)
    assert out
    assert all(not ({"rice", "egg"} & set(plate(x))) for x in out)


def test_locked_items_always_appear() -> None:
    out = run(locked={"banana": None}, min_match=0)
    assert out
    assert all("banana" in plate(x) for x in out)
    out = run(locked={"chicken": 2.0}, min_match=0)
    assert all(plate(x).get("chicken") == 2.0 for x in out)


def test_a_locked_amount_must_be_allowed() -> None:
    with pytest.raises(ValueError, match="amount"):
        run(locked={"egg": 1.5})


def test_a_locked_amount_over_the_cap_gives_nothing() -> None:
    small = per(200, 20, 20, 5)
    assert run(budget=small, locked={"chicken": 3.0}, min_match=0) == []


def test_never_pairs_are_always_excluded() -> None:
    out = run(never={frozenset(("rice", "egg"))}, count=10, min_match=0)
    assert all(not {"rice", "egg"} <= set(plate(x)) for x in out)


def test_forbidden_pairs_unless_scored_above_minus_1() -> None:
    scores = {frozenset(("rice", "egg")): -1.0, frozenset(("rice", "yogurt")): -0.9}
    out = run(pair_scores=scores, count=10, min_match=0)
    assert all(not {"rice", "egg"} <= set(plate(x)) for x in out)
    assert any({"rice", "yogurt"} <= set(plate(x)) for x in out)


def test_suggestions_under_80_percent_are_not_shown() -> None:
    out = run(count=50)
    assert out
    assert all(x.match_pct >= 80 for x in out)
    assert len(run(count=50, min_match=0)) > len(out)


def test_match_is_100_times_one_minus_distance() -> None:
    x = run()[0]
    d = sum(WEIGHTS[m] * abs(x.totals[m] - LEFT[m]) / TARGETS[m] for m in MACROS)
    assert x.match_pct == round(100 * (1 - d), 1)


def test_nothing_fits_under_the_cap() -> None:
    big = [s.Staple("pizza", per(800, 30, 90, 35), (1, 2))]
    assert s.suggest(big, per(300, 20, 30, 10), TARGETS, min_match=0) == []


# --- budget -------------------------------------------------------------------------------


def test_a_met_macro_has_budget_0() -> None:
    eaten = {**EATEN, "protein_g": 160}
    assert s.budget(TARGETS, eaten)["protein_g"] == 0


def test_next_meal_fractions_scale_every_macro() -> None:
    assert s.budget(TARGETS, EATEN, fraction=0.25) == per(225, 15, 25, 6.25)
    third = s.budget(TARGETS, EATEN, fraction=1 / 3)
    assert third["kcal"] == pytest.approx(300)
    assert third["protein_g"] == pytest.approx(20)


def test_typed_calories_scale_the_macros_by_the_same_fraction() -> None:
    b = s.budget(TARGETS, EATEN, kcal=450)
    assert b == per(450, 30, 50, 12.5)


def test_budget_needs_one_mode() -> None:
    with pytest.raises(ValueError):
        s.budget(TARGETS, EATEN, fraction=0.5, kcal=400)


def test_with_a_met_macro_suggestions_still_respect_the_cap() -> None:
    eaten = {**EATEN, "protein_g": 160}
    b = s.budget(TARGETS, eaten)
    for x in s.suggest(STAPLES, b, TARGETS, min_match=0):
        assert x.totals["kcal"] <= 1.05 * b["kcal"] + 1e-6
