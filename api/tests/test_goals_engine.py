"""Task 3.16: weekly goals and badges (SPEC page 3). AC: a user not tracking water never gets
the water goal; each badge is awarded once (the once is enforced by the database; see
test_goals.py)."""

from datetime import date

import pytest

from app.goals import (
    ALWAYS,
    BADGES,
    Tracks,
    WeekData,
    choose_goals,
    earned_badges,
    eligible,
    goal_progress,
)

MON = date(2026, 10, 12)

ALL = Tracks(has_target=True, track_water=True, has_weighed=True, has_measurements=True)


def test_log_food_is_always_one_of_the_three() -> None:
    goals = choose_goals(ALL, "user-1", MON)
    assert len(goals) == 3
    assert goals[0] == ALWAYS == "log_food"
    assert len(set(goals)) == 3


@pytest.mark.parametrize("n", range(200))
def test_ac_no_water_goal_without_water_tracking(n: int) -> None:
    tracks = Tracks(has_target=True, track_water=False, has_weighed=True, has_measurements=False)
    week = date.fromordinal(MON.toordinal() + 7 * n)
    goals = choose_goals(tracks, f"user-{n}", week)
    assert "water" not in goals
    assert "measurement" not in goals


def test_the_pool_holds_only_what_the_user_tracks() -> None:
    assert eligible(Tracks(False, False, False, False)) == ["weigh_in"]
    assert eligible(Tracks(True, False, False, False)) == ["protein", "calories", "weigh_in"]
    assert eligible(ALL) == ["protein", "calories", "weigh_in", "water", "measurement"]
    # With only one goal in the pool there are two goals that week, not a made-up third.
    assert choose_goals(Tracks(False, False, False, False), "u", MON) == ["log_food", "weigh_in"]


def test_the_choice_is_stable_for_a_week_and_varies_between_weeks() -> None:
    a = choose_goals(ALL, "user-1", MON)
    assert choose_goals(ALL, "user-1", MON) == a
    weeks = {
        tuple(choose_goals(ALL, "user-1", date.fromordinal(MON.toordinal() + 7 * i)))
        for i in range(12)
    }
    assert len(weeks) > 1


def test_progress_against_each_goal() -> None:
    week = WeekData(
        logged_days=5,
        protein_days=3,
        calorie_days=4,
        weigh_ins=2,
        water_days=5,
        measurements=1,
    )
    assert goal_progress("log_food", week) == (5, 5)
    assert goal_progress("protein", week) == (3, 4)
    assert goal_progress("calories", week) == (4, 4)
    assert goal_progress("weigh_in", week) == (2, 3)
    assert goal_progress("water", week) == (5, 5)
    assert goal_progress("measurement", week) == (1, 1)
    # Progress never shows more than the goal.
    assert goal_progress("log_food", WeekData(7, 0, 0, 0, 0, 0)) == (5, 5)


def test_badges_from_the_numbers() -> None:
    assert (
        earned_badges(longest_days=6, longest_weeks=0, saved_meals=0, entries=99, perfect_weeks=0)
        == set()
    )
    got = earned_badges(
        longest_days=30, longest_weeks=4, saved_meals=1, entries=100, perfect_weeks=10
    )
    assert got == {
        "streak_7",
        "streak_30",
        "weigh_in_4",
        "first_saved_meal",
        "entries_100",
        "perfect_weeks_10",
    }
    every = earned_badges(
        longest_days=365, longest_weeks=52, saved_meals=3, entries=1000, perfect_weeks=10
    )
    assert {"streak_100", "streak_365", "weigh_in_12", "weigh_in_52", "entries_1000"} <= every


def test_every_badge_rewards_logging_and_says_how_to_earn_it() -> None:
    for b in BADGES:
        assert b.how
        for word in ("deficit", "lose", "less", "fast"):
            assert word not in b.how.lower()
            assert word not in b.name.lower()
