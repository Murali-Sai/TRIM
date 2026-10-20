"""Task 3.15: the streak engine, tests first (SPEC page 3, Streaks and gamification).

Day D counts when the user logged food with logged_on = D and the entry was added by the end
of D + 1 (the repair window). Days up to two days ago are final and are walked lazily; yesterday
(still repairable) and today are provisional, applied only for display."""

from datetime import date, timedelta

from app.streaks import (
    MAX_FREEZES,
    StreakState,
    WeekState,
    advance,
    broken_message,
    view,
    week_view,
)

D0 = date(2026, 10, 1)  # a Thursday


def days(start: date, n: int) -> list[date]:
    return [start + timedelta(days=i) for i in range(n)]


def logged(*ds: date) -> dict[date, bool]:
    """Logged days; True marks a day saved only by a backfill (a repair)."""
    return dict.fromkeys(ds, False)


# --- the 13-day example --------------------------------------------------------------------


def test_ac_the_13_day_example_plays_out_exactly() -> None:
    first13 = days(D0, 13)  # 1 to 13 Oct
    today = D0 + timedelta(days=13)  # 14 Oct
    log = logged(*first13)

    # Before logging today: 13 days and 1 freeze (earned at 7). Today not logged yet does not
    # break anything.
    v = view(StreakState(), log, today)
    assert (v.current, v.freezes, v.today_logged) == (13, 1, False)

    # Logging today makes 14 and earns a second freeze.
    log[today] = False
    v = view(StreakState(), log, today)
    assert (v.current, v.freezes, v.today_logged) == (14, 2, True)

    # Missing tomorrow (15 Oct) uses one freeze once it has passed: 14 kept, 1 left.
    v = view(StreakState(), log, today + timedelta(days=2))
    assert (v.current, v.freezes) == (14, 1)
    # Missing the day after uses the other.
    v = view(StreakState(), log, today + timedelta(days=3))
    assert (v.current, v.freezes) == (14, 0)
    # A third missed day in a row breaks it.
    v = view(StreakState(), log, today + timedelta(days=4))
    assert (v.current, v.longest, v.freezes) == (0, 14, 0)
    assert broken_message(v) == "New streak starts today. Longest: 14 days."


def test_the_example_writes_its_events_once_final() -> None:
    log = logged(*days(D0, 14))
    state, events = advance(StreakState(), log, D0 + timedelta(days=16))  # final through 17 Oct
    kinds = [(e.on.day, e.kind) for e in events if e.kind != "counted"]
    assert kinds == [
        (7, "freeze_earned"),
        (14, "freeze_earned"),
        (15, "freeze_used"),
        (16, "freeze_used"),
        (17, "broken"),
    ]
    assert (state.current, state.longest, state.freezes, state.through) == (
        0,
        14,
        0,
        date(2026, 10, 17),
    )
    # Walking again from where it stopped writes nothing new.
    again, more = advance(state, log, D0 + timedelta(days=16))
    assert (again, more) == (state, [])


# --- rules -----------------------------------------------------------------------------------


def test_freezes_cap_at_two() -> None:
    v = view(StreakState(), logged(*days(D0, 28)), D0 + timedelta(days=28))
    assert v.current == 28
    assert v.freezes == MAX_FREEZES == 2


def test_a_freeze_day_does_not_add_to_the_streak() -> None:
    log = logged(*days(D0, 7), *days(D0 + timedelta(days=8), 3))  # 8 Oct missed
    v = view(StreakState(), log, D0 + timedelta(days=11))
    assert (v.current, v.freezes) == (10, 0)
    assert v.freeze_days == [date(2026, 10, 8)]


def test_today_not_logged_never_breaks_and_yesterday_is_pending() -> None:
    log = logged(*days(D0, 3))  # 1 to 3 Oct, no freeze yet
    # 4 Oct, nothing yet: still 3.
    assert view(StreakState(), log, date(2026, 10, 4)).current == 3
    # 5 Oct: 4 Oct is missed and could still be backfilled today, but with no freeze the
    # streak shows as broken until it is.
    assert view(StreakState(), log, date(2026, 10, 5)).current == 0


def test_repair_counts_a_backfill_for_yesterday() -> None:
    log = logged(*days(D0, 3))
    log[date(2026, 10, 4)] = True  # added on 5 Oct for 4 Oct: inside the window
    v = view(StreakState(), log, date(2026, 10, 5))
    assert v.current == 4
    state, events = advance(StreakState(), log, date(2026, 10, 4))
    assert ("repaired", 4) in [(e.kind, e.on.day) for e in events]
    assert state.current == 4


def test_a_day_over_target_still_counts() -> None:
    # The engine sees only whether something was logged; how much never matters.
    v = view(StreakState(), logged(*days(D0, 5)), D0 + timedelta(days=4))
    assert v.current == 5


def test_lazy_walk_resumes_from_last_counted_date() -> None:
    log = logged(*days(D0, 20))
    state, first = advance(StreakState(), log, date(2026, 10, 10))
    state, second = advance(state, log, date(2026, 10, 18))
    whole, all_events = advance(StreakState(), log, date(2026, 10, 18))
    assert state == whole
    assert first + second == all_events


def test_no_logs_no_streak() -> None:
    v = view(StreakState(), {}, D0)
    assert (v.current, v.longest, v.today_logged) == (0, 0, False)
    assert broken_message(v) is None


# --- weekly weigh-ins ------------------------------------------------------------------------

MON = date(2026, 9, 28)


def test_weigh_in_weeks_need_three_and_the_current_week_never_breaks() -> None:
    counts = {MON: 3, MON + timedelta(weeks=1): 4, MON + timedelta(weeks=2): 1}
    # During week 3 (only 1 weigh-in so far): 2 weeks, not broken.
    w = week_view(WeekState(), counts, MON + timedelta(weeks=2, days=4))
    assert (w.current, w.longest) == (2, 2)
    # Week 3 reaches 3 weigh-ins: it counts at once.
    counts[MON + timedelta(weeks=2)] = 3
    assert week_view(WeekState(), counts, MON + timedelta(weeks=2, days=5)).current == 3
    # A week that ends with 2 weigh-ins breaks it.
    counts[MON + timedelta(weeks=3)] = 2
    w = week_view(WeekState(), counts, MON + timedelta(weeks=4))
    assert (w.current, w.longest) == (0, 3)
