"""Task 3.11: the glance-test seed fills a fresh account with a month and its answer key."""

import pytest
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.helpers import user_row
from tests.test_logs import signed_in
from tools.seed_glance_month import PAST_KCAL, seed


def count(owner_engine: Engine, table: str, user_id: object) -> int:
    with owner_engine.connect() as conn:
        n: int = conn.execute(
            text(f"SELECT count(*) FROM {table} WHERE user_id = :u"),
            {"u": user_id},
        ).scalar_one()
    return n


def test_seeds_a_month_and_the_answer_key(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    key = seed(owner_engine, email)
    uid = user_row(owner_engine, email).id
    logged = sum(k is not None for k in PAST_KCAL) + 1
    assert count(owner_engine, "food_logs", uid) == logged
    assert count(owner_engine, "weight_entries", uid) == 30
    assert count(owner_engine, "targets", uid) == 1

    assert key.kcal_left_today == 526
    assert key.weight_kg_per_week < 0
    assert 0 <= key.days_on_target_this_week <= key.logged_days_this_week <= 7
    assert key.lines()[0] == "1. Calories left today: 526 kcal"

    # The account sees it all through the API, as the dashboard will.
    today = client.get("/api/logs/last-time").json()["eaten_at"]
    assert today is not None
    weights = client.get("/api/weights").json()
    assert len(weights) == 30


def test_refuses_an_account_with_data(client: CsrfClient, owner_engine: Engine) -> None:
    email = signed_in(client)
    seed(owner_engine, email)
    with pytest.raises(SystemExit, match="already has data"):
        seed(owner_engine, email)


def test_unknown_account(owner_engine: Engine) -> None:
    with pytest.raises(SystemExit, match="No account"):
        seed(owner_engine, "nobody@example.com")
