"""Task 3.14: Fits my macros. AC: the SPEC page 3 worked example ranks chicken 0.60, yogurt
0.35, peanut butter 0.28 and rice 0.27."""

import pytest

from app.fit import fit_score, fits_up_to_g, label_for

# 300 kcal, 40 P, 25 C, 8 F left of a 2,300 / 150 / 250 / 70 day.
LEFT = {"kcal": 300.0, "protein_g": 40.0, "carbs_g": 25.0, "fat_g": 8.0}
TARGET = {"kcal": 2300.0, "protein_g": 150.0, "carbs_g": 250.0, "fat_g": 70.0}


def at(grams: float, kcal: float, p: float, c: float, f: float) -> dict[str, float]:
    """Nutrients for `grams` of a food given per 100 g."""
    k = grams / 100
    return {"kcal": kcal * k, "protein_g": p * k, "carbs_g": c * k, "fat_g": f * k}


# Per 100 g. Chicken breast and rice are the SPEC's own numbers; yogurt and peanut butter are
# USDA FoodData Central values for nonfat plain Greek yogurt and smooth peanut butter.
EXAMPLE = {
    "chicken breast 120 g": (at(120, 165, 31, 0, 3.6), 0.60, "Great fit"),
    "Greek yogurt 0% 200 g": (at(200, 59, 10.19, 3.6, 0.39), 0.35, "Partial fit"),
    "peanut butter 32 g": (at(32, 588, 25, 20, 50), 0.28, "Partial fit"),
    "cooked rice 150 g": (at(150, 130, 2.7, 28.2, 0.3), 0.27, "Partial fit"),
}


@pytest.mark.parametrize("name", list(EXAMPLE))
def test_worked_example_scores(name: str) -> None:
    item, score, label = EXAMPLE[name]
    fit = fit_score(item, LEFT, TARGET)
    assert round(fit.score, 2) == score
    assert label_for(fit.score) == label


def test_ac_ranking() -> None:
    ranked = sorted(EXAMPLE, key=lambda n: -fit_score(EXAMPLE[n][0], LEFT, TARGET).score)
    assert ranked == [
        "chicken breast 120 g",
        "Greek yogurt 0% 200 g",
        "peanut butter 32 g",
        "cooked rice 150 g",
    ]


def test_chicken_matches_the_spec_nutrients() -> None:
    item = EXAMPLE["chicken breast 120 g"][0]
    assert round(item["kcal"]) == 198
    assert round(item["protein_g"], 1) == 37.2
    assert round(item["fat_g"], 1) == 4.3


def test_overflow_is_named() -> None:
    assert fit_score(EXAMPLE["peanut butter 32 g"][0], LEFT, TARGET).overflows == ["fat_g"]
    assert fit_score(EXAMPLE["cooked rice 150 g"][0], LEFT, TARGET).overflows == ["carbs_g"]
    fills = fit_score(EXAMPLE["chicken breast 120 g"][0], LEFT, TARGET).fills
    assert fills["carbs_g"] == 0
    assert round(fills["protein_g"], 2) == 0.93


def test_a_met_macro_counts_any_amount_as_overflow() -> None:
    left = {**LEFT, "fat_g": -2.0}  # fat already over
    item = {"kcal": 100.0, "protein_g": 10.0, "carbs_g": 5.0, "fat_g": 7.0}
    fit = fit_score(item, left, TARGET)
    expected = (
        0.25 * 100 / 300
        + 0.35 * 10 / 40
        + 0.20 * 5 / 25  # coverage
        - 0.20 * 7 / 70  # fat: w x n / target
    )
    assert fit.score == pytest.approx(expected)
    assert fit.overflows == ["fat_g"]


def test_labels_and_hiding() -> None:
    assert label_for(0.5) == "Great fit"
    assert label_for(0.499) == "Great fit"  # shown as 0.50
    assert label_for(0.30) == "Partial fit"
    assert label_for(0.24) is None


def test_fits_up_to() -> None:
    # 300 kcal left of a 165 kcal/100 g food: 181.8 g, shown as 180 g.
    assert fits_up_to_g(165, 300) == 180
    assert fits_up_to_g(165, 0) is None
    assert fits_up_to_g(0, 300) is None
    assert fits_up_to_g(900, 20) is None  # less than 5 g
