"""Task 3.22: the pairing build. AC: fixture values match hand calculations; pairs under 30
plates score 0. (The real table needs the NHANES files: see tools/build_pairing.py.)"""

from pathlib import Path

import pytest
from sqlalchemy import Engine, text

from app.db import user_session
from app.ids import uuid7
from tools import pairing as p
from tools.load_pairing import EXPECTED_ROWS, load

# Dinner, 640 plates in all (each line: how many plates, and the groups on each):
#   50 poultry + rice, 50 poultry, 50 rice          -> n_p = 100, n_r = 100, both 50
#   30 yogurt + pasta, 170 yogurt, 210 pasta        -> n_y = 200, n_pa = 240, both 30
#   40 fish + potatoes                              -> n = 40 each, both 40
#   29 eggs + cheese, 11 vegetables
# lift(poultry, rice)   = 50 x 640 / (100 x 100) = 3.2   -> score log2(3.2) = 1.6781
# lift(pasta, yogurt)   = 30 x 640 / (200 x 240) = 0.4   -> score log2(0.4) = -1.3219
# lift(fish, potatoes)  = 40 x 640 / (40 x 40)   = 16    -> log2 16 = 4, clipped to 2
# eggs + cheese on 29 plates: under 30, so 0 (unknown).
DINNER = (
    [{"poultry", "rice_grains"}] * 50
    + [{"poultry"}] * 50
    + [{"rice_grains"}] * 50
    + [{"yogurt", "pasta"}] * 30
    + [{"yogurt"}] * 170
    + [{"pasta"}] * 210
    + [{"fish_seafood", "potatoes"}] * 40
    + [{"eggs", "cheese"}] * 29
    + [{"vegetables"}] * 11
)


def table() -> dict[tuple[str, str, str], p.PairScore]:
    rows = p.scores({"dinner": [frozenset(x) for x in DINNER]})
    return {(r.context, r.group_a, r.group_b): r for r in rows}


def test_ac_fixture_scores_match_hand_calculations() -> None:
    t = table()
    assert len(DINNER) == 640
    pr = t[("dinner", "poultry", "rice_grains")]
    assert (pr.plates, round(pr.lift or 0, 4), pr.score) == (50, 3.2, 1.6781)
    py = t[("dinner", "pasta", "yogurt")]
    assert (py.plates, round(py.lift or 0, 4), py.score) == (30, 0.4, -1.3219)
    fp = t[("dinner", "fish_seafood", "potatoes")]
    assert (fp.lift, fp.score) == (16, 2.0)


def test_ac_pairs_under_30_plates_score_0() -> None:
    ec = table()[("dinner", "cheese", "eggs")]
    assert (ec.plates, ec.lift, ec.score) == (29, None, 0.0)
    # Never together at all is unknown too, not the strongest "avoid".
    assert table()[("dinner", "poultry", "yogurt")].score == 0.0


def test_every_pair_in_every_context() -> None:
    rows = p.scores({"dinner": [frozenset(x) for x in DINNER]})
    assert len(rows) == 4 * 253 == EXPECTED_ROWS
    assert all(r.group_a < r.group_b for r in rows)
    # A context with no plates is all zeros.
    assert all(r.score == 0 for r in rows if r.context == "breakfast")


def test_a_clip_at_minus_2() -> None:
    # 2,000 snack plates: milk and pasta on 500 each, together on 30.
    # lift = 30 x 2000 / (500 x 500) = 0.24 -> log2 = -2.06, clipped to -2.
    plates = [frozenset({"milk", "pasta"})] * 30 + [frozenset({"milk"})] * 470
    plates += [frozenset({"pasta"})] * 470 + [frozenset({"fruit"})] * 1030
    s = {(r.group_a, r.group_b): r for r in p.scores({"snack": plates}) if r.context == "snack"}
    assert (round(s[("milk", "pasta")].lift or 0, 2), s[("milk", "pasta")].score) == (0.24, -2.0)


# --- plates from survey records ------------------------------------------------------------

CODES = {
    11111000: 1004,  # milk
    58106230: 3202,  # pizza
    56205000: 4002,  # rice
    56205050: 4002,  # another rice
    24120120: 2202,  # chicken
    92101000: 7302,  # coffee
}
CATEGORIES = {
    1004: "Milk, reduced fat",
    3202: "Pizza",
    4002: "Rice",
    2202: "Chicken, whole pieces",
    7302: "Coffee",
}


def food_groups() -> dict[int, str | None]:
    groups = p.category_groups(CATEGORIES)
    return {code: groups[cat] for code, cat in CODES.items()}


def test_plates_from_records() -> None:
    records = [
        # One supper: two rice foods count once, coffee is left out.
        p.Record(("a", 1, 64800), 4, 56205000),
        p.Record(("a", 1, 64800), 4, 56205050),
        p.Record(("a", 1, 64800), 4, 24120120),
        p.Record(("a", 1, 64800), 4, 92101000),
        # Desayuno is breakfast.
        p.Record(("b", 1, 27000), 10, 11111000),
        # A drink occasion, and a plate of only coffee, are not plates.
        p.Record(("c", 2, 30000), 7, 11111000),
        p.Record(("d", 1, 50000), 6, 92101000),
    ]
    out = p.plates_by_context(records, food_groups())
    assert out["dinner"] == [frozenset({"rice_grains", "poultry"})]
    assert out["breakfast"] == [frozenset({"milk"})]
    assert out["lunch"] == out["snack"] == []


def test_unknown_codes_stop_the_build() -> None:
    with pytest.raises(ValueError, match="eating occasion code 42"):
        p.plates_by_context([p.Record("x", 42, 11111000)], food_groups())
    with pytest.raises(ValueError, match="Food code 1"):
        p.plates_by_context([p.Record("x", 1, 1)], food_groups())
    with pytest.raises(ValueError, match="9999 Moon rocks"):
        p.category_groups({**CATEGORIES, 9999: "Moon rocks"})


@pytest.mark.parametrize(
    ("description", "group"),
    [
        ("Pasta sauces, tomato-based", "sauces_condiments"),
        ("Pasta, noodles, cooked grains", "pasta"),
        ("Doughnuts, sweet rolls, pastries", "sweets_desserts"),
        ("Pancakes, waffles, French toast", "bread_tortillas"),
        ("Burritos and tacos", "mixed_dishes"),
        ("Vegetable mixed dishes", "vegetables"),
        ("Ice cream and frozen dairy desserts", "sweets_desserts"),
        ("Cream cheese, sour cream, whipped cream", "fats_oils"),
        ("Yogurt, Greek", "yogurt"),
        ("Potato chips", "savory_snacks"),
        ("White potatoes, baked or boiled", "potatoes"),
        ("Nuts and seeds", "nuts_butters"),
        ("Processed soy products", "tofu_plant_protein"),
        ("Nutrition bars", "shakes_bars"),
        ("Tea", None),
        ("Tap water", None),
    ],
)
def test_category_rules(description: str, group: str | None) -> None:
    assert p.group_for(description) == group


# --- the CSV and the table -----------------------------------------------------------------


def test_csv_round_trip_and_load(tmp_path: Path, owner_engine: Engine) -> None:
    rows = p.scores({"dinner": [frozenset(x) for x in DINNER]})
    path = tmp_path / "pairing_scores.csv"
    p.write_csv(rows, path, "fixture 1")
    assert load(owner_engine, path) == EXPECTED_ROWS
    # Every user can read it; nobody but the owner can change it.
    with user_session(uuid7()) as s:
        score = s.execute(
            text(
                "SELECT score FROM pairing_scores WHERE context = 'dinner' "
                "AND group_a = 'poultry' AND group_b = 'rice_grains'"
            )
        ).scalar_one()
        assert float(score) == 1.6781
    with pytest.raises(Exception, match="permission denied"), user_session(uuid7()) as s:
        s.execute(text("DELETE FROM pairing_scores"))
    with owner_engine.begin() as conn:
        conn.execute(text("DELETE FROM pairing_scores"))


def test_load_refuses_a_partial_table(tmp_path: Path, owner_engine: Engine) -> None:
    rows = p.scores({"dinner": [frozenset(x) for x in DINNER]})[:10]
    path = tmp_path / "short.csv"
    p.write_csv(rows, path, "fixture 1")
    with pytest.raises(ValueError, match="Expected 1012 rows"):
        load(owner_engine, path)
