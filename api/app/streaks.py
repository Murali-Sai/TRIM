"""Streak engine (SPEC page 3, Streaks and gamification). Rewards logging only: a day counts
when anything was logged, whatever it adds up to.

Logging streak. Day D counts when an entry with logged_on = D was added by the end of D + 1
(the repair window: a backfill for yesterday counts if added today). Days up to two days ago
are final: they are walked forward from `through` (the stored last_counted_date), and that walk
writes streak_events. Yesterday, still repairable, and today are provisional: applied to a copy
for display only. So a missed day uses a freeze or breaks the streak only once it can no longer
be repaired, and nothing ever has to be undone.

Freezes: one is earned each time the streak reaches a multiple of 7, up to 2 held. A missed day
uses one automatically; the streak keeps its length and the day shows a snowflake.

Weigh-in streak: a Monday to Sunday week counts with 3 or more weigh-ins. The current week
counts as soon as it has 3, and never breaks the streak before it ends.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Literal

MAX_FREEZES = 2
FREEZE_EVERY = 7
WEIGH_INS_PER_WEEK = 3
ONE_DAY = timedelta(days=1)

EventKind = Literal["counted", "freeze_earned", "freeze_used", "repaired", "broken"]


@dataclass(frozen=True)
class StreakState:
    current: int = 0
    longest: int = 0
    freezes: int = 0
    # The last final day walked (last_counted_date); None before the first walk.
    through: date | None = None


@dataclass(frozen=True)
class Event:
    on: date
    kind: EventKind


def _step(state: StreakState, day: date, logged: bool | None) -> tuple[StreakState, list[Event]]:
    """One day. `logged` is None for a missed day, else whether it was saved by a repair."""
    events: list[Event] = []
    current, freezes = state.current, state.freezes
    if logged is not None:
        current += 1
        events.append(Event(day, "counted"))
        if logged:
            events.append(Event(day, "repaired"))
        if current % FREEZE_EVERY == 0 and freezes < MAX_FREEZES:
            freezes += 1
            events.append(Event(day, "freeze_earned"))
    elif current > 0 and freezes > 0:
        freezes -= 1
        events.append(Event(day, "freeze_used"))
    elif current > 0:
        current = 0
        events.append(Event(day, "broken"))
    return (
        StreakState(current, max(state.longest, current), freezes, day),
        events,
    )


def advance(
    state: StreakState, logged: Mapping[date, bool], until: date
) -> tuple[StreakState, list[Event]]:
    """Walk final days from the day after `state.through` to `until`, inclusive.

    `logged` maps each counting day to True when it was saved only by a backfill. A first walk
    starts at the first logged day."""
    start = state.through + ONE_DAY if state.through else min(logged, default=until + ONE_DAY)
    events: list[Event] = []
    day = start
    while day <= until:
        state, new = _step(state, day, logged.get(day))
        events += new
        day += ONE_DAY
    if state.through is None or state.through < until:
        state = replace(state, through=until)
    return state, events


@dataclass(frozen=True)
class StreakView:
    current: int
    longest: int
    freezes: int
    today_logged: bool
    # Days a freeze covered in this view's walk (final and provisional), for the calendar.
    freeze_days: list[date] = field(default_factory=list)


def final_until(today: date) -> date:
    """The last day that can no longer be repaired."""
    return today - 2 * ONE_DAY


def view(state: StreakState, logged: Mapping[date, bool], today: date) -> StreakView:
    """The streak as shown today: final days walked, then yesterday and today applied
    provisionally. Today counts once something is logged; until then it changes nothing."""
    s, events = advance(state, logged, final_until(today))
    yesterday = today - ONE_DAY
    if s.through is not None and s.through < yesterday:
        s, more = _step(s, yesterday, logged.get(yesterday))
        events += more
    today_logged = today in logged
    if today_logged:
        s, more = _step(s, today, logged[today])
        events += more
    return StreakView(
        current=s.current,
        longest=s.longest,
        freezes=s.freezes,
        today_logged=today_logged,
        freeze_days=[e.on for e in events if e.kind == "freeze_used"],
    )


def broken_message(v: StreakView) -> str | None:
    """After a break, a fresh start (no guilt wording)."""
    if v.current == 0 and v.longest > 0:
        return (
            f"New streak starts today. Longest: {v.longest} {'day' if v.longest == 1 else 'days'}."
        )
    return None


# --- weigh-in streak (weekly) ----------------------------------------------------------------


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


@dataclass(frozen=True)
class WeekState:
    current: int = 0
    longest: int = 0
    # Monday of the last final week walked.
    through: date | None = None


def advance_weeks(state: WeekState, counts: Mapping[date, int], until_monday: date) -> WeekState:
    """Walk final weeks (keyed by Monday) after `state.through` up to `until_monday`."""
    start = (
        state.through + timedelta(weeks=1)
        if state.through
        else min(counts, default=until_monday + timedelta(weeks=1))
    )
    week = start
    current, longest = state.current, state.longest
    while week <= until_monday:
        current = current + 1 if counts.get(week, 0) >= WEIGH_INS_PER_WEEK else 0
        longest = max(longest, current)
        week += timedelta(weeks=1)
    through = state.through
    if through is None or through < until_monday:
        through = until_monday
    return WeekState(current, longest, through)


@dataclass(frozen=True)
class WeekView:
    current: int
    longest: int
    this_week: int


def week_view(state: WeekState, counts: Mapping[date, int], today: date) -> WeekView:
    this = monday_of(today)
    s = advance_weeks(state, counts, this - timedelta(weeks=1))
    n = counts.get(this, 0)
    current = s.current + 1 if n >= WEIGH_INS_PER_WEEK else s.current
    return WeekView(current=current, longest=max(s.longest, current), this_week=n)
