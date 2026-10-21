"""Diet phases (task 4.5): date ranges called a cut, maintain, bulk or the user's own label.

No two of a user's phases overlap; an ongoing phase (no end date) runs on, so a new phase after
it needs its end date first (or `end_current`). Creating or editing a phase never changes
targets: the web app offers "Also update targets" as a separate, explicit step.

Each phase has a summary (SPEC page 3, Diet phases), up to today for an ongoing phase:
- days, and days with food logged;
- average kcal on logged days vs the average target in effect on those days;
- days on target: calories within 5% of the target in effect (the Calories card's band);
- weight trend change: the trend (alpha 0.1, over all weigh-ins) on the phase's first and last
  weigh-in, and the weekly rate, that change over the days between them times 7 (shown only
  once they are 7 or more days apart);
- each switched-on measurement's change from its first to its latest reading in the phase.
"""

import uuid
from datetime import date, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db import user_session
from app.deps import ServicesDep
from app.ids import uuid7
from app.security.sessions import ActiveUserDep
from app.timeutil import local_date
from app.trend import WEIGHT_ALPHA, Reading, compute_trend

router = APIRouter(tags=["phases"])

Kind = Literal["cut", "maintain", "bulk", "custom"]
Label = Annotated[str, Field(min_length=1, max_length=40)]
Note = Annotated[str, Field(max_length=500)]
NOT_FOUND = "Phase not found"
KIND_NAMES = {"cut": "Cut", "maintain": "Maintain", "bulk": "Bulk", "custom": "Phase"}
# How far ahead a phase may start: far enough to plan, not so far it is a typo.
MAX_AHEAD = timedelta(days=366)
MIN_RATE_DAYS = 7


class PhaseIn(BaseModel):
    kind: Kind
    label: Label | None = None
    start_date: date
    end_date: date | None = None
    note: Note | None = None
    # End the ongoing phase the day before this one starts.
    end_current: bool = False


class PhasePatch(BaseModel):
    kind: Kind | None = None
    label: Label | None = None
    start_date: date | None = None
    # Send null to make the phase ongoing again.
    end_date: date | None = None
    note: Note | None = None


class WeightChange(BaseModel):
    start_kg: float
    end_kg: float
    change_kg: float
    # None until the first and last weigh-ins are a week apart.
    weekly_kg: float | None


class MeasurementChange(BaseModel):
    type_id: uuid.UUID
    name: str
    side: Literal["left", "right"] | None
    unit: str
    start: float
    end: float
    change: float


class Summary(BaseModel):
    days: int
    logged_days: int
    avg_kcal: int | None
    avg_target_kcal: int | None
    days_on_target: int
    weight: WeightChange | None
    measurements: list[MeasurementChange]


class PhaseOut(BaseModel):
    id: uuid.UUID
    kind: Kind
    label: str | None
    name: str
    start_date: date
    end_date: date | None
    note: str | None
    status: Literal["upcoming", "ongoing", "ended"]
    summary: Summary | None


def _check_shape(kind: str, label: str | None, start: date, end: date | None) -> None:
    """422 with a message the web app shows as it is."""
    problem = None
    if kind == "custom" and not (label and label.strip()):
        problem = "Give your phase a name."
    elif end is not None and end < start:
        problem = "The end date cannot be before the start date."
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)


def _name(kind: str, label: str | None) -> str:
    return label.strip() if label and label.strip() else KIND_NAMES[kind]


def _day(d: date) -> str:
    return f"{d.day} {d:%b %Y}"


def _range(start: date, end: date | None) -> str:
    return f"from {_day(start)} to {_day(end)}" if end else f"from {_day(start)}, still going"


def _overlap(
    s: Session, user_id: Any, start: date, end: date | None, skip: uuid.UUID | None
) -> Any:
    return s.execute(
        text(
            "SELECT id, kind, label, start_date, end_date FROM diet_phases "
            "WHERE user_id = :u AND deleted_at IS NULL AND (CAST(:skip AS uuid) IS NULL "
            "OR id <> :skip) AND daterange(start_date, end_date, '[]') "
            "&& daterange(:a, :b, '[]') ORDER BY start_date LIMIT 1"
        ),
        {"u": user_id, "a": start, "b": end, "skip": skip},
    ).first()


def _reject_overlap(other: Any) -> None:
    name = _name(other.kind, other.label)
    if other.end_date is None:
        message = (
            f"Your {name} {_range(other.start_date, None)}. End it before starting a new phase."
        )
    else:
        message = (
            f"This overlaps your {name} {_range(other.start_date, other.end_date)}. "
            "Phases cannot overlap."
        )
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


def _tz(s: Session, user_id: Any) -> str:
    tz: str = s.execute(
        text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user_id}
    ).scalar_one()
    return tz


def summarize(s: Session, user_id: Any, tz: str, start: date, end: date) -> Summary:
    days = s.execute(
        text(
            "SELECT logged_on, sum(kcal) AS kcal FROM food_logs WHERE user_id = :u "
            "AND deleted_at IS NULL AND logged_on BETWEEN :a AND :b GROUP BY logged_on"
        ),
        {"u": user_id, "a": start, "b": end},
    ).all()
    targets = s.execute(
        text(
            "SELECT effective_from, kcal FROM targets WHERE user_id = :u AND deleted_at IS NULL "
            "AND effective_from <= :b ORDER BY effective_from DESC, created_at DESC, id DESC"
        ),
        {"u": user_id, "b": end},
    ).all()
    on_target = 0
    eaten: list[float] = []
    aimed: list[int] = []
    for d in days:
        eaten.append(float(d.kcal))
        t = next((t for t in targets if t.effective_from <= d.logged_on), None)
        if t is None:
            continue
        aimed.append(t.kcal)
        if abs(float(d.kcal) - t.kcal) * 20 <= t.kcal:
            on_target += 1

    weighs = s.execute(
        text(
            "SELECT measured_at, (measured_at AT TIME ZONE :tz)::date AS day, kg "
            "FROM weight_entries WHERE user_id = :u AND deleted_at IS NULL "
            "AND (measured_at AT TIME ZONE :tz)::date <= :b ORDER BY measured_at"
        ),
        {"u": user_id, "tz": tz, "b": end},
    ).all()
    trend = compute_trend(
        [Reading(str(w.day), w.measured_at.isoformat(), float(w.kg)) for w in weighs],
        alpha=WEIGHT_ALPHA,
    )
    inside = [
        (p.day, p.trend)
        for p in trend.points
        if p.counted and p.trend is not None and p.day >= start.isoformat()
    ]
    weight = None
    if len(inside) >= 2:
        (first_day, first), (last_day, last) = inside[0], inside[-1]
        change = last - first
        span = (date.fromisoformat(last_day) - date.fromisoformat(first_day)).days
        weight = WeightChange(
            start_kg=round(first, 2),
            end_kg=round(last, 2),
            change_kg=round(change, 2),
            weekly_kg=round(change / span * 7, 2) if span >= MIN_RATE_DAYS else None,
        )

    rows = s.execute(
        text(
            "SELECT t.id, t.name, t.side, t.unit, first_r.value AS v0, last_r.value AS v1 "
            "FROM measurement_types t "
            "JOIN LATERAL (SELECT value FROM measurement_entries e WHERE e.type_id = t.id "
            "AND e.deleted_at IS NULL AND e.value IS NOT NULL "
            "AND (e.measured_at AT TIME ZONE :tz)::date BETWEEN :a AND :b "
            "ORDER BY measured_at, id LIMIT 1) first_r ON true "
            "JOIN LATERAL (SELECT value, count(*) OVER () AS n FROM measurement_entries e "
            "WHERE e.type_id = t.id AND e.deleted_at IS NULL AND e.value IS NOT NULL "
            "AND (e.measured_at AT TIME ZONE :tz)::date BETWEEN :a AND :b "
            "ORDER BY measured_at DESC, id DESC LIMIT 1) last_r ON last_r.n >= 2 "
            "WHERE t.user_id = :u AND t.deleted_at IS NULL AND t.archived_at IS NULL "
            "AND t.is_active ORDER BY t.sort_order, t.created_at, t.id"
        ),
        {"u": user_id, "tz": tz, "a": start, "b": end},
    ).all()
    measurements = [
        MeasurementChange(
            type_id=r.id,
            name=r.name,
            side=r.side,
            unit=r.unit,
            start=float(r.v0),
            end=float(r.v1),
            change=round(float(r.v1) - float(r.v0), 3),
        )
        for r in rows
    ]
    return Summary(
        days=(end - start).days + 1,
        logged_days=len(days),
        avg_kcal=round(sum(eaten) / len(eaten)) if eaten else None,
        avg_target_kcal=round(sum(aimed) / len(aimed)) if aimed else None,
        days_on_target=on_target,
        weight=weight,
        measurements=measurements,
    )


def _out(s: Session, user_id: Any, tz: str, r: Any, today: date, with_summary: bool) -> PhaseOut:
    if r.start_date > today:
        state: Literal["upcoming", "ongoing", "ended"] = "upcoming"
    elif r.end_date is not None and r.end_date < today:
        state = "ended"
    else:
        state = "ongoing"
    summary = None
    if with_summary and state != "upcoming":
        last = min(r.end_date, today) if r.end_date else today
        summary = summarize(s, user_id, tz, r.start_date, last)
    return PhaseOut(
        id=r.id,
        kind=r.kind,
        label=r.label,
        name=_name(r.kind, r.label),
        start_date=r.start_date,
        end_date=r.end_date,
        note=r.note,
        status=state,
        summary=summary,
    )


def _phase(s: Session, user_id: Any, phase_id: uuid.UUID) -> Any:
    row = s.execute(
        text("SELECT * FROM diet_phases WHERE id = :id AND user_id = :u AND deleted_at IS NULL"),
        {"id": phase_id, "u": user_id},
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return row


def _write(s: Session, sql: str, params: dict[str, Any]) -> Any:
    """Run an insert or update ... RETURNING; the trigger's overlap error (a race) becomes a
    422."""
    try:
        with s.begin_nested():
            return s.execute(text(sql), params).first()
    except DBAPIError as e:
        if "phase_overlap" in str(e.orig):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Phases cannot overlap."
            ) from None
        raise


def _not_too_far(start: date, today: date) -> None:
    if start > today + MAX_AHEAD:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "A phase can start up to a year ahead."
        )


@router.get("/phases")
def list_phases(
    user: ActiveUserDep, services: ServicesDep, summaries: Annotated[bool, Query()] = True
) -> list[PhaseOut]:
    """Every phase, newest first, each with its summary (charts ask without them)."""
    with user_session(user.user_id) as s:
        tz = _tz(s, user.user_id)
        today = local_date(services.clock(), tz)
        rows = s.execute(
            text(
                "SELECT * FROM diet_phases WHERE user_id = :u AND deleted_at IS NULL "
                "ORDER BY start_date DESC"
            ),
            {"u": user.user_id},
        ).all()
        return [_out(s, user.user_id, tz, r, today, summaries) for r in rows]


@router.post("/phases", status_code=status.HTTP_201_CREATED)
def create_phase(body: PhaseIn, user: ActiveUserDep, services: ServicesDep) -> PhaseOut:
    """Add a phase. It never touches targets."""
    with user_session(user.user_id) as s:
        tz = _tz(s, user.user_id)
        today = local_date(services.clock(), tz)
        _check_shape(body.kind, body.label, body.start_date, body.end_date)
        _not_too_far(body.start_date, today)
        other = _overlap(s, user.user_id, body.start_date, body.end_date, None)
        if (
            other is not None
            and body.end_current
            and other.end_date is None
            and other.start_date < body.start_date
        ):
            _write(
                s,
                "UPDATE diet_phases SET end_date = :e, updated_at = now() WHERE id = :id "
                "RETURNING id",
                {"e": body.start_date - timedelta(days=1), "id": other.id},
            )
            other = _overlap(s, user.user_id, body.start_date, body.end_date, None)
        if other is not None:
            _reject_overlap(other)
        row = _write(
            s,
            "INSERT INTO diet_phases (id, user_id, kind, label, start_date, end_date, note) "
            "VALUES (:id, :u, :k, :l, :a, :b, :n) RETURNING *",
            {
                "id": uuid7(),
                "u": user.user_id,
                "k": body.kind,
                "l": body.label.strip() if body.label else None,
                "a": body.start_date,
                "b": body.end_date,
                "n": body.note or None,
            },
        )
        return _out(s, user.user_id, tz, row, today, True)


@router.patch("/phases/{phase_id}")
def edit_phase(
    phase_id: uuid.UUID, body: PhasePatch, user: ActiveUserDep, services: ServicesDep
) -> PhaseOut:
    """Change the kind, name, dates or note. It never touches targets."""
    with user_session(user.user_id) as s:
        tz = _tz(s, user.user_id)
        today = local_date(services.clock(), tz)
        row = _phase(s, user.user_id, phase_id)
        sent = body.model_fields_set
        kind = body.kind if body.kind is not None else row.kind
        label = body.label if "label" in sent else row.label
        start = body.start_date if body.start_date is not None else row.start_date
        end = body.end_date if "end_date" in sent else row.end_date
        note = body.note if "note" in sent else row.note
        _check_shape(kind, label, start, end)
        if start != row.start_date:
            _not_too_far(start, today)
        other = _overlap(s, user.user_id, start, end, row.id)
        if other is not None:
            _reject_overlap(other)
        row = _write(
            s,
            "UPDATE diet_phases SET kind = :k, label = :l, start_date = :a, end_date = :b, "
            "note = :n, updated_at = now() WHERE id = :id RETURNING *",
            {
                "k": kind,
                "l": label.strip() if label else None,
                "a": start,
                "b": end,
                "n": note or None,
                "id": row.id,
            },
        )
        return _out(s, user.user_id, tz, row, today, True)


@router.delete("/phases/{phase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_phase(phase_id: uuid.UUID, user: ActiveUserDep, services: ServicesDep) -> None:
    """Remove a phase. Food, weight and targets stay as they are."""
    with user_session(user.user_id) as s:
        row = _phase(s, user.user_id, phase_id)
        s.execute(
            text("UPDATE diet_phases SET deleted_at = :t WHERE id = :id"),
            {"t": services.clock(), "id": row.id},
        )
