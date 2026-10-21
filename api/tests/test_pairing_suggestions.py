"""Task 3.23: pairing in suggestions. AC: the SPEC worked example returns the three dinner
combinations with fixture scores; locked items always appear; Shuffle never repeats a set."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, text

from app import pairing
from app.food_groups import guess_group
from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.test_suggestions import NOBODY, ask, plates, worked_example

GROUPS = {
    "chicken": "poultry",
    "rice": "rice_grains",
    "egg": "eggs",
    "yogurt": "yogurt",
    "banana": "fruit",
    "pb": "nuts_butters",
}
# SPEC page 3, worked example: placeholder dinner scores for the test fixture.
FIXTURE = {
    ("rice_grains", "yogurt"): -1.0,
    ("nuts_butters", "rice_grains"): -1.0,
    ("fruit", "rice_grains"): -1.0,
    ("nuts_butters", "poultry"): -1.0,
    ("fruit", "poultry"): -1.0,
    ("poultry", "rice_grains"): 1.5,
    ("fruit", "yogurt"): 1.5,
    ("fruit", "nuts_butters"): 1.5,
}


@pytest.fixture(autouse=True)
def evening(fakes: Fakes) -> None:
    """19:00 in New York on 17 Oct 2026, as in tests.test_suggestions."""
    fakes.clock.now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)


@pytest.fixture
def dinner_scores(owner_engine: Engine) -> Iterator[None]:
    with owner_engine.begin() as conn:
        conn.execute(text("DELETE FROM pairing_scores"))
        for (a, b), score in FIXTURE.items():
            conn.execute(
                text(
                    "INSERT INTO pairing_scores (context, group_a, group_b, plates, score, "
                    "data_version) VALUES ('dinner', :a, :b, 100, :s, 'SPEC fixture')"
                ),
                {"a": a, "b": b, "s": score},
            )
    yield
    with owner_engine.begin() as conn:
        conn.execute(text("DELETE FROM pairing_scores"))


def grouped(client: CsrfClient, owner_engine: Engine) -> tuple[dict[str, str], Any]:
    ids, uid = worked_example(client, owner_engine)
    for name, group in GROUPS.items():
        res = client.patch(f"/api/staples/{ids[name]}", json={"food_group": group})
        assert res.status_code == 200, res.text
    return ids, uid


# --- acceptance ---------------------------------------------------------------------------


@pytest.mark.usefixtures("dinner_scores")
def test_ac_worked_example_at_dinner(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = grouped(client, owner_engine)
    out = ask(client, context="dinner")
    assert out["context"] == "dinner"
    assert plates(out, ids) == [
        {"chicken": 1, "rice": 3, "egg": 4},
        {"egg": 4, "yogurt": 2, "banana": 2},
        {"yogurt": 2, "banana": 2, "pb": 2},
    ]
    assert [x["match_pct"] for x in out["suggestions"]] == [97.0, 93.8, 89.3]
    assert [round(x["totals"]["kcal"]) for x in out["suggestions"]] == [843, 698, 598]
    # Each card has a pair that scores under 0.5 (eggs with anything here), so no label.
    assert [x["label"] for x in out["suggestions"]] == [None, None, None]


@pytest.mark.usefixtures("dinner_scores")
def test_lunch_has_no_fixture_scores_so_numbers_only(
    client: CsrfClient, owner_engine: Engine
) -> None:
    grouped(client, owner_engine)
    out = ask(client, context="lunch")
    assert [x["match_pct"] for x in out["suggestions"]] == [97.5, 97.2, 97.0]


@pytest.mark.usefixtures("dinner_scores")
def test_ac_locked_items_always_appear_and_shuffle_never_repeats(
    client: CsrfClient, owner_engine: Engine
) -> None:
    ids, _ = grouped(client, owner_engine)
    shown: list[list[str]] = []
    lock = [{"staple_id": ids["yogurt"]}]
    for _ in range(10):
        out = ask(client, context="dinner", locked=lock, exclude_sets=shown)
        if out["state"] != "ok":
            break
        for p in plates(out, ids):
            assert "yogurt" in p
            # Forbidden at dinner: rice with yogurt.
            assert "rice" not in p
        shown += [[i["staple_id"] for i in x["items"]] for x in out["suggestions"]]
    assert shown
    assert len({frozenset(x) for x in shown}) == len(shown)


@pytest.mark.usefixtures("dinner_scores")
def test_the_label_when_every_pair_scores_well(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = grouped(client, owner_engine)
    out = ask(
        client,
        context="dinner",
        max_items=2,
        locked=[{"staple_id": ids["chicken"]}, {"staple_id": ids["rice"]}],
    )
    assert plates(out, ids)[0].keys() == {"chicken", "rice"}
    assert out["suggestions"][0]["label"] == "Often eaten together at dinner"


# --- never pairs and personal history -----------------------------------------------------


@pytest.mark.usefixtures("dinner_scores")
def test_a_never_pair_is_always_excluded(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = grouped(client, owner_engine)
    res = client.post("/api/pair-preferences", json={"staple_ids": [ids["rice"], ids["egg"]]})
    assert res.status_code == 201, res.text
    pair = res.json()
    assert set(pair["names"]) == {"Rice", "Egg"}
    out = ask(client, context="lunch", max_items=3)
    assert all(not {"rice", "egg"} <= p.keys() for p in plates(out, ids))
    # Undo brings them back.
    assert client.delete(f"/api/pair-preferences/{pair['id']}").status_code == 204
    out = ask(client, context="lunch")
    assert {"rice", "egg"} <= plates(out, ids)[0].keys()


@pytest.mark.usefixtures("dinner_scores")
def test_personal_history_allows_a_forbidden_pair(client: CsrfClient, owner_engine: Engine) -> None:
    """Chicken with banana is forbidden at dinner, unless this user eats them together."""
    ids, uid = grouped(client, owner_engine)
    both = [{"staple_id": ids["chicken"]}, {"staple_id": ids["banana"]}]
    assert ask(client, context="dinner", locked=both)["state"] == "no_fit"
    foods = client.get("/api/staples").json()["staples"]
    food = {s["id"]: s["food_id"] for s in foods}
    with owner_engine.begin() as conn:
        for n in range(3):
            on = date(2026, 10, 10) - timedelta(days=n)
            for sid in (ids["chicken"], ids["banana"]):
                conn.execute(
                    text(
                        "INSERT INTO food_logs (id, user_id, food_id, log_group_id, eaten_at, "
                        "logged_on, name, grams, kcal, protein_g, carbs_g, fat_g, source) "
                        "VALUES (gen_random_uuid(), :u, :f, :g, :at, :d, 'x', 100, 100, 1, 1, 1, "
                        "'search')"
                    ),
                    {
                        "u": uid,
                        "f": food[sid],
                        "g": f"00000000-0000-4000-8000-00000000000{n}",
                        "at": f"{on}T23:00:00Z",
                        "d": on,
                    },
                )
    out = ask(client, context="dinner", locked=both)
    assert out["state"] == "ok"
    assert all({"chicken", "banana"} <= p.keys() for p in plates(out, ids))


def test_context_defaults_to_the_time_now(client: CsrfClient, owner_engine: Engine) -> None:
    worked_example(client, owner_engine)
    # The clock is 19:00 in New York.
    assert ask(client)["context"] == "dinner"


# --- pair preferences ---------------------------------------------------------------------


def test_pair_preferences(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    body = {"staple_ids": [ids["egg"], ids["rice"]]}
    first = client.post("/api/pair-preferences", json=body).json()
    again = client.post(
        "/api/pair-preferences", json={"staple_ids": [ids["rice"], ids["egg"]]}
    ).json()
    assert first["id"] == again["id"]
    assert len(client.get("/api/pair-preferences").json()) == 1
    same = {"staple_ids": [ids["egg"], ids["egg"]]}
    assert client.post("/api/pair-preferences", json=same).status_code == 422
    other = {"staple_ids": [ids["egg"], NOBODY]}
    assert client.post("/api/pair-preferences", json=other).status_code == 404
    assert client.delete(f"/api/pair-preferences/{first['id']}").status_code == 204
    assert client.delete(f"/api/pair-preferences/{first['id']}").status_code == 404
    # Removing a staple removes its pairs.
    client.post("/api/pair-preferences", json=body)
    client.delete(f"/api/staples/{ids['egg']}")
    assert client.get("/api/pair-preferences").json() == []


def test_a_new_staple_gets_a_guessed_group(client: CsrfClient, owner_engine: Engine) -> None:
    ids, _ = worked_example(client, owner_engine)
    staples = {s["id"]: s for s in client.get("/api/staples").json()["staples"]}
    assert staples[ids["rice"]]["food_group"] == "rice_grains"
    assert staples[ids["pb"]]["food_group"] == "nuts_butters"
    assert staples[ids["yogurt"]]["food_group"] == "yogurt"


# --- the rules ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("at", "context"),
    [
        (time(10, 29), "breakfast"),
        (time(10, 30), "lunch"),
        (time(14, 59), "lunch"),
        (time(15, 0), "snack"),
        (time(17, 29), "snack"),
        (time(17, 30), "dinner"),
        (time(23, 59), "dinner"),
        (time(0, 0), "breakfast"),
    ],
)
def test_context_from_the_time(at: time, context: str) -> None:
    assert pairing.context_for(at) == context


def test_personal_pairs_need_3_blocks() -> None:
    blocks = [{"a", "b"}, {"a", "b", "c"}, {"a", "c"}, {"a", "b"}]
    assert pairing.personal_pairs(blocks) == {frozenset("ab")}


def test_pair_scores() -> None:
    groups = {"a": "poultry", "b": "rice_grains", "c": "poultry", "d": None}
    generic = {("poultry", "rice_grains"): -1.5}
    scores = pairing.pair_scores(groups, generic, set())
    # Same group, or no group, is 0 and left out.
    assert scores == {frozenset("ab"): -1.5, frozenset("bc"): -1.5}
    scores = pairing.pair_scores(groups, generic, {frozenset("ab"), frozenset("ad")})
    assert scores[frozenset("ab")] == 1.0
    assert scores[frozenset("ad")] == 1.0


def test_label_needs_every_pair_at_half_or_more() -> None:
    scores = {frozenset("ab"): 0.5, frozenset("bc"): 1.5, frozenset("ac"): 0.49}
    assert pairing.label(["a", "b"], scores, "lunch") == "Often eaten together at lunch"
    assert pairing.label(["a", "b", "c"], scores, "lunch") is None
    assert pairing.label(["a"], scores, "lunch") is None


@pytest.mark.parametrize(
    ("name", "group"),
    [
        ("Chicken soup", "mixed_dishes"),
        ("Peanut butter", "nuts_butters"),
        ("Greek yogurt 0%", "yogurt"),
        ("Egg noodles", "pasta"),
        ("Large egg", "eggs"),
        ("Cooked white rice", "rice_grains"),
        ("Overnight oats", "cereal_oats"),
        ("Medium banana", "fruit"),
        ("Olive oil", "fats_oils"),
        ("Protein shake, vanilla", "shakes_bars"),
        ("Hummus", "beans_legumes"),
        ("Salmon fillet", "fish_seafood"),
        ("Breakfast burrito", "mixed_dishes"),
        ("Sparkling water", None),
    ],
)
def test_group_guesses(name: str, group: str | None) -> None:
    assert guess_group(name) == group
