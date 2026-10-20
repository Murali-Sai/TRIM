"""Task 3.2: food search waterfall. AC: recorded-fixture tests per tier.

Parsers and request shapes use the FDC and OFF fixtures in tests/fixtures; the endpoint tests
run the real waterfall against the database with fake sources serving those fixtures.
"""

from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine, text

from app.ids import uuid7
from app.routers.foods import EXTERNAL_DOWN, OFF_SEARCHES_PER_MINUTE
from app.services.fooddata import (
    FDC_SEARCH_URL,
    FdcClient,
    FoodSourceError,
    OffClient,
    kcal_mismatch,
    parse_fdc_food,
    parse_off_product,
    per_100,
)
from tests.conftest import CsrfClient
from tests.fakes import Fakes, fdc_fixture, load_fixture, off_fixture
from tests.helpers import log_in, sign_up, user_row

FDC = load_fixture("fdc_search_greek_yogurt.json")["foods"]
OFF = load_fixture("off_search_skyr.json")["products"]


# --- normalization --------------------------------------------------------------------------


def test_per_100_from_a_serving() -> None:
    assert per_100(150, 250) == 60


@pytest.mark.parametrize(
    ("kcal", "p", "c", "f", "flag"),
    [(97, 9.0, 3.98, 5.0, False), (150, 5, 10, 2, True), (0, 0, 0, 0, False), (0, 1, 0, 0, True)],
)
def test_kcal_mismatch_over_15_percent(
    kcal: float, p: float, c: float, f: float, flag: bool
) -> None:
    assert kcal_mismatch(kcal, p, c, f) is flag


# --- FoodData Central (fixture) ---------------------------------------------------------------


def test_fdc_foundation_food_uses_atwater_energy_and_skips_kj() -> None:
    food = parse_fdc_food(FDC[0])
    assert food is not None
    assert (food.source, food.source_ref, food.name) == (
        "fdc",
        "9100001",
        "Yogurt, Greek, plain, nonfat",
    )
    assert (food.kcal_100, food.protein_100, food.carbs_100, food.fat_100) == (61, 10.3, 3.64, 0.37)
    assert food.fiber_100 is None  # unknown, not zero
    assert [(s.label, s.grams, s.is_default) for s in food.servings] == [("100 g", 100.0, True)]


def test_fdc_sr_legacy_reads_every_nutrient() -> None:
    food = parse_fdc_food(FDC[1])
    assert food is not None
    assert (food.fiber_100, food.sugar_100, food.sodium_mg_100) == (0, 4.0, 35)
    assert food.kcal_mismatch is False


def test_fdc_branded_serving_becomes_the_default_unit() -> None:
    food = parse_fdc_food(FDC[2])
    assert food is not None
    assert food.brand == "EXAMPLE FARMS"
    assert [(s.label, s.grams, s.is_default) for s in food.servings] == [
        ("1 container", 150.0, True),
        ("100 g", 100.0, False),
    ]


def test_fdc_drinks_in_ml_use_density_one() -> None:
    food = parse_fdc_food(FDC[3])
    assert food is not None
    assert food.density_g_ml == 1.0
    assert food.brand == "Example Dairy Co."
    assert [s.label for s in food.servings] == ["1 bottle", "100 ml"]


def test_fdc_skips_foods_without_macros_and_flags_mismatches() -> None:
    assert parse_fdc_food(FDC[4]) is None
    bar = parse_fdc_food(FDC[5])
    assert bar is not None and bar.kcal_mismatch is True
    assert [f.source_ref for f in fdc_fixture()] == [
        "9100001",
        "9100002",
        "9100003",
        "9100004",
        "9100006",
    ]


def test_fdc_request_shape_and_key_stays_out_of_errors() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"foods": FDC})

    client = FdcClient(httpx.Client(transport=httpx.MockTransport(handler)), "secret-key")
    assert len(client.search("greek yogurt", 25)) == 5
    url = seen[0].url
    assert str(url).startswith(FDC_SEARCH_URL)
    assert url.params["query"] == "greek yogurt"
    assert url.params["dataType"] == "Foundation,SR Legacy,Branded"
    assert url.params["pageSize"] == "25"
    assert "api_key" not in url.params
    assert seen[0].headers["x-api-key"] == "secret-key"

    down = FdcClient(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429))), "secret-key"
    )
    with pytest.raises(FoodSourceError) as err:
        down.search("greek yogurt", 25)
    assert "secret-key" not in str(err.value)
    assert err.value.__cause__ is None


# --- Open Food Facts (fixture) ----------------------------------------------------------------


def test_off_100g_values_sodium_in_mg_and_first_brand() -> None:
    food = parse_off_product(OFF[0])
    assert food is not None
    assert (food.source, food.source_ref, food.brand) == ("off", "0000000000017", "Examplefarm")
    assert (food.kcal_100, food.protein_100, food.carbs_100, food.fat_100) == (63, 11, 4, 0.2)
    assert food.sodium_mg_100 == pytest.approx(40)
    assert food.fiber_100 is None
    assert [(s.label, s.grams, s.is_default) for s in food.servings] == [
        ("150 g", 150.0, True),
        ("100 g", 100.0, False),
    ]


def test_off_kj_only_is_converted() -> None:
    food = parse_off_product(OFF[1])
    assert food is not None
    assert food.kcal_100 == pytest.approx(340 / 4.184)


def test_off_per_serving_values_are_normalized() -> None:
    food = parse_off_product(OFF[2])
    assert food is not None
    assert (food.kcal_100, food.protein_100, food.carbs_100, food.fat_100) == pytest.approx(
        (60, 6, 7.2, 0.6)
    )
    assert food.servings[0].label == "1 bottle (250 ml)"


def test_off_skips_products_without_nutrients_or_name() -> None:
    assert parse_off_product(OFF[3]) is None
    assert parse_off_product(OFF[4]) is None
    assert len(off_fixture()) == 3


def test_off_sends_the_configured_user_agent() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"products": OFF})

    client = OffClient(httpx.Client(transport=httpx.MockTransport(handler)), "TRIM/1.0 (ops@x)")
    assert len(client.search("skyr", 10)) == 3
    assert seen[0].headers["user-agent"] == "TRIM/1.0 (ops@x)"
    assert seen[0].url.params["search_terms"] == "skyr"
    assert seen[0].url.params["json"] == "1"
    assert "nutriments" in seen[0].url.params["fields"]

    down = OffClient(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503))), "x"
    )
    with pytest.raises(FoodSourceError):
        down.search("skyr", 10)


# --- the waterfall ----------------------------------------------------------------------------


@pytest.fixture
def user(client: CsrfClient) -> CsrfClient:
    assert log_in(client, sign_up(client)).status_code == 200
    return client


def search(c: CsrfClient, q: str) -> Any:
    res = c.get("/api/foods/search", params={"q": q})
    assert res.status_code == 200, res.text
    return res.json()


def add_cache_food(owner_engine: Engine, name: str, updated_at: datetime | None = None) -> Any:
    """A shared cache row, fresh unless `updated_at` (on the fake clock) says otherwise."""
    with owner_engine.begin() as conn:
        return conn.execute(
            text(
                "INSERT INTO foods (id, owner_id, source, source_ref, name, kcal_100, "
                "protein_100, carbs_100, fat_100, updated_at) VALUES (:id, NULL, 'fdc', :ref, "
                ":n, 100, 5, 10, 2, coalesce(:at, now())) RETURNING id"
            ),
            {"id": uuid7(), "ref": uuid7().hex, "n": name, "at": updated_at},
        ).scalar_one()


def test_fdc_tier_fills_and_caches(user: CsrfClient, fakes: Fakes) -> None:
    fakes.fdc.results = fdc_fixture()
    first = search(user, "greek yogurt")
    assert fakes.fdc.calls == ["greek yogurt"]
    assert [r["tier"] for r in first["results"]] == ["fdc"] * 5
    vanilla = next(r for r in first["results"] if r["name"] == "GREEK YOGURT, VANILLA")
    assert vanilla["servings"] == [
        {"label": "1 container", "grams": 150.0, "is_default": True},
        {"label": "100 g", "grams": 100.0, "is_default": False},
    ]
    assert first["notice"] is None

    # Same query again: served from the cache, FDC is not asked.
    second = search(user, "Greek  yogurt")
    assert fakes.fdc.calls == ["greek yogurt"]
    assert {r["tier"] for r in second["results"]} == {"cache"}
    assert {r["id"] for r in second["results"]} == {r["id"] for r in first["results"]}


def test_cache_rows_are_shared_across_users(user: CsrfClient, fakes: Fakes) -> None:
    fakes.fdc.results = fdc_fixture()
    search(user, "greek yogurt")
    other = CsrfClient(user.app)
    other.get("/api/auth/csrf")
    assert log_in(other, sign_up(other)).status_code == 200
    again = search(other, "greek yogurt")
    assert len(fakes.fdc.calls) == 1
    assert {r["tier"] for r in again["results"]} == {"cache"}


def test_enough_fresh_cache_skips_fdc(user: CsrfClient, fakes: Fakes, owner_engine: Engine) -> None:
    for i in range(10):
        add_cache_food(owner_engine, f"Lentil soup {i}")
    fakes.fdc.results = fdc_fixture()
    res = search(user, "lentil soup")
    assert fakes.fdc.calls == []
    assert len(res["results"]) == 10


def test_stale_cache_is_not_served(user: CsrfClient, fakes: Fakes, owner_engine: Engine) -> None:
    add_cache_food(owner_engine, "Barley stale", fakes.clock.now - timedelta(days=31))
    res = search(user, "barley stale")
    assert res["results"] == []
    assert fakes.fdc.calls == ["barley stale"]


def test_off_only_when_under_five(user: CsrfClient, fakes: Fakes) -> None:
    fakes.fdc.results = fdc_fixture()[:2]
    fakes.off.results = off_fixture()
    res = search(user, "skyr")
    assert fakes.off.calls == ["skyr"]
    assert [r["tier"] for r in res["results"]] == ["fdc", "fdc", "off", "off", "off"]


def test_off_not_asked_with_five_or_more(user: CsrfClient, fakes: Fakes) -> None:
    fakes.fdc.results = fdc_fixture()
    fakes.off.results = off_fixture()
    search(user, "yogurt")
    assert fakes.off.calls == []


def test_off_shared_budget_per_minute(user: CsrfClient, fakes: Fakes) -> None:
    fakes.off.results = []
    for i in range(OFF_SEARCHES_PER_MINUTE + 2):
        search(user, f"rare item {i}")
    assert len(fakes.off.calls) == OFF_SEARCHES_PER_MINUTE
    fakes.clock.advance(minutes=1, seconds=1)
    search(user, "rare item later")
    assert len(fakes.off.calls) == OFF_SEARCHES_PER_MINUTE + 1


def test_each_source_asked_once_per_query_in_30_days(
    user: CsrfClient, fakes: Fakes, owner_engine: Engine
) -> None:
    search(user, "nothing anywhere")
    search(user, "nothing anywhere")
    assert fakes.fdc.calls == ["nothing anywhere"]
    assert fakes.off.calls == ["nothing anywhere"]
    with owner_engine.begin() as conn:
        conn.execute(text("UPDATE food_queries SET fetched_at = fetched_at - interval '31 days'"))
    search(user, "nothing anywhere")
    assert len(fakes.fdc.calls) == len(fakes.off.calls) == 2


def test_outage_falls_back_with_a_notice(
    user: CsrfClient, fakes: Fakes, owner_engine: Engine
) -> None:
    add_cache_food(owner_engine, "Quinoa cooked")
    fakes.fdc.fail = True
    fakes.off.fail = True
    res = search(user, "quinoa")
    assert [r["name"] for r in res["results"]] == ["Quinoa cooked"]
    assert res["notice"] == EXTERNAL_DOWN
    # A failure is not remembered: the next search asks again.
    fakes.fdc.fail = False
    search(user, "quinoa")
    assert len(fakes.fdc.calls) == 2


def test_personal_foods_come_first_and_stay_private(
    user: CsrfClient, fakes: Fakes, owner_engine: Engine
) -> None:
    me = user_row(owner_engine, user.get("/api/me").json()["email"]).id
    shared = add_cache_food(owner_engine, "Oat milk barista")
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO foods (id, owner_id, source, name, kcal_100, protein_100, carbs_100, "
                "fat_100) VALUES (:id, :u, 'custom', 'Oat milk homemade', 40, 1, 6, 1.5)"
            ),
            {"id": uuid7(), "u": me},
        )
        conn.execute(
            text(
                "INSERT INTO food_logs (id, user_id, food_id, log_group_id, eaten_at, logged_on, "
                "name, kcal, protein_g, carbs_g, fat_g, source) VALUES (:id, :u, :f, :g, now(), "
                "'2026-10-17', 'Oat milk barista', 60, 1, 7, 3, 'search')"
            ),
            {"id": uuid7(), "u": me, "f": shared, "g": uuid7()},
        )
    res = search(user, "oat milk")
    tiers = [(r["name"], r["tier"]) for r in res["results"]]
    # Logged once beats never logged; both are personal and come before anything else.
    assert tiers[:2] == [("Oat milk barista", "personal"), ("Oat milk homemade", "personal")]

    stranger = CsrfClient(user.app)
    stranger.get("/api/auth/csrf")
    assert log_in(stranger, sign_up(stranger)).status_code == 200
    names = [(r["name"], r["tier"]) for r in search(stranger, "oat milk")["results"]]
    assert ("Oat milk homemade", "personal") not in names
    assert all(n != "Oat milk homemade" for n, _ in names)
    assert ("Oat milk barista", "cache") in names


def test_like_wildcards_are_literal(user: CsrfClient, owner_engine: Engine) -> None:
    add_cache_food(owner_engine, "Rice crackers")
    assert search(user, "%%")["results"] == []
    assert search(user, "r_ce")["results"] == []


@pytest.mark.parametrize("q", ["a", "x" * 101])
def test_query_length(user: CsrfClient, q: str) -> None:
    assert user.get("/api/foods/search", params={"q": q}).status_code == 422


def test_cache_food_refuses_custom_rows(user: CsrfClient, owner_engine: Engine) -> None:
    from sqlalchemy.exc import DBAPIError

    from app.db import user_session

    me = user_row(owner_engine, user.get("/api/me").json()["email"]).id
    with pytest.raises(DBAPIError, match="only fdc and off"), user_session(me) as s:
        s.execute(
            text("SELECT cache_food(CAST(:p AS jsonb))"),
            {"p": '{"source": "custom", "source_ref": "x", "name": "Mine"}'},
        )


def test_kcal_mismatch_is_reported(user: CsrfClient, fakes: Fakes) -> None:
    fakes.fdc.results = fdc_fixture()
    res = search(user, "greek yogurt bar")
    bar = next(r for r in res["results"] if r["name"] == "GREEK YOGURT BAR")
    assert bar["kcal_mismatch"] is True
