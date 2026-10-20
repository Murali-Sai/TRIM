"""Weight log (task 2.2): list, add, edit and delete weigh-ins.

Stored in kg (grams precision); the browser converts for display. Deletes are soft, so the quick
entry can offer Undo; deleted rows are never returned and are purged with the account.
"""

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import user_session
from app.deps import ServicesDep
from app.models import WeightEntry
from app.security.sessions import ActiveUserDep
from app.tdee import WEIGHT_KG_RANGE
from app.timeutil import local_date

router = APIRouter(prefix="/weights", tags=["weights"])

WeightKg = Annotated[float, Field(ge=WEIGHT_KG_RANGE[0], le=WEIGHT_KG_RANGE[1])]
Note = Annotated[str, Field(max_length=500)]
# Phone clocks drift; a weigh-in a few minutes "ahead" of the server is still now.
CLOCK_SKEW = timedelta(minutes=5)


class WeightIn(BaseModel):
    kg: WeightKg
    measured_at: AwareDatetime | None = None  # defaults to now
    note: Note | None = None


class WeightPatch(BaseModel):
    kg: WeightKg | None = None
    measured_at: AwareDatetime | None = None
    note: Note | None = None


class WeightOut(BaseModel):
    id: uuid.UUID
    measured_at: datetime
    day: date  # the user's local date
    kg: float
    note: str | None


def _timezone(s: Session, user_id: Any) -> str:
    tz: str = s.execute(
        text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user_id}
    ).scalar_one()
    return tz


def _out(row: Any, tz: str) -> WeightOut:
    return WeightOut(
        id=row.id,
        measured_at=row.measured_at,
        day=local_date(row.measured_at, tz),
        kg=float(row.kg),
        note=row.note,
    )


def _kg(value: float) -> Decimal:
    return Decimal(str(round(value, 3)))


def _not_future(at: datetime, now: datetime) -> datetime:
    if at > now + CLOCK_SKEW:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That time is in the future.")
    return at


def _get(s: Session, user_id: Any, entry_id: uuid.UUID) -> Any:
    # RLS hides other users' rows, so their ids are simply not found: 404.
    row = s.execute(
        text(
            "SELECT id, measured_at, kg, note FROM weight_entries "
            "WHERE id = :id AND user_id = :u AND deleted_at IS NULL"
        ),
        {"id": entry_id, "u": user_id},
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


@router.get("")
def list_weights(
    user: ActiveUserDep,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> list[WeightOut]:
    """Weigh-ins oldest first, optionally limited to local dates from..to (inclusive)."""
    with user_session(user.user_id) as s:
        tz = _timezone(s, user.user_id)
        rows = s.execute(
            text(
                "SELECT id, measured_at, kg, note FROM weight_entries "
                "WHERE user_id = :u AND deleted_at IS NULL ORDER BY measured_at, id"
            ),
            {"u": user.user_id},
        ).all()
    out = [_out(r, tz) for r in rows]
    return [
        w
        for w in out
        if (date_from is None or w.day >= date_from) and (date_to is None or w.day <= date_to)
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
def add_weight(body: WeightIn, user: ActiveUserDep, services: ServicesDep) -> WeightOut:
    now = services.clock()
    at = _not_future(body.measured_at, now) if body.measured_at else now
    entry = WeightEntry(user_id=user.user_id, measured_at=at, kg=_kg(body.kg), note=body.note)
    with user_session(user.user_id) as s:
        s.add(entry)
        s.flush()
        tz = _timezone(s, user.user_id)
        return _out(entry, tz)


@router.patch("/{entry_id}")
def edit_weight(
    entry_id: uuid.UUID, body: WeightPatch, user: ActiveUserDep, services: ServicesDep
) -> WeightOut:
    now = services.clock()
    changes = body.model_dump(exclude_unset=True)
    with user_session(user.user_id) as s:
        row = _get(s, user.user_id, entry_id)
        kg = _kg(changes["kg"]) if changes.get("kg") is not None else row.kg
        at = _not_future(changes["measured_at"], now) if changes.get("measured_at") else None
        s.execute(
            text(
                "UPDATE weight_entries SET kg = :kg, measured_at = coalesce(:at, measured_at), "
                "note = :note, updated_at = :now WHERE id = :id AND user_id = :u"
            ),
            {
                "kg": kg,
                "at": at,
                "note": changes.get("note", row.note),
                "now": now,
                "id": entry_id,
                "u": user.user_id,
            },
        )
        return _out(_get(s, user.user_id, entry_id), _timezone(s, user.user_id))


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_weight(entry_id: uuid.UUID, user: ActiveUserDep, services: ServicesDep) -> None:
    with user_session(user.user_id) as s:
        _get(s, user.user_id, entry_id)
        s.execute(
            text("UPDATE weight_entries SET deleted_at = :now WHERE id = :id AND user_id = :u"),
            {"now": services.clock(), "id": entry_id, "u": user.user_id},
        )


@router.post("/{entry_id}/restore")
def restore_weight(entry_id: uuid.UUID, user: ActiveUserDep) -> WeightOut:
    """Undo a delete."""
    with user_session(user.user_id) as s:
        restored = s.execute(
            text(
                "UPDATE weight_entries SET deleted_at = NULL "
                "WHERE id = :id AND user_id = :u AND deleted_at IS NOT NULL"
            ),
            {"id": entry_id, "u": user.user_id},
        )
        if restored.rowcount != 1:  # type: ignore[attr-defined]
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
        return _out(_get(s, user.user_id, entry_id), _timezone(s, user.user_id))
