"""Water and fiber tracking (task 3.13, SPEC page 3, Water and Fiber).

Settings say what the user tracks: water is off until turned on; fiber is on. Water is stored
in ml, whatever the display unit; each add is a row so the last one can be undone.
"""

import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text

from app.db import user_session
from app.deps import ServicesDep
from app.models import WaterLog
from app.security.sessions import ActiveUserDep
from app.timeutil import local_date

router = APIRouter(tags=["tracking"])

WaterUnit = Literal["ml", "fl_oz"]
MAX_ML = 5000
# Phone clocks drift; an add a few minutes "ahead" of the server is still now.
CLOCK_SKEW = timedelta(minutes=5)
MAX_DAYS_RANGE = 3660


class SettingsOut(BaseModel):
    track_water: bool
    track_fiber: bool
    water_unit: WaterUnit
    # Streaks, goals and badges shown (they are always kept, so turning back on restores them).
    gamification: bool
    # Local time for the streak reminder ("20:00"), or None when off.
    streak_reminder: str | None
    # The weekly check-in by email too (off by default).
    checkin_email: bool = False


class SettingsPatch(BaseModel):
    track_water: bool | None = None
    track_fiber: bool | None = None
    water_unit: WaterUnit | None = None
    gamification: bool | None = None
    # Send null to turn the reminder off.
    streak_reminder: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    checkin_email: bool | None = None


DEFAULTS = SettingsOut(
    track_water=False,
    track_fiber=True,
    water_unit="ml",
    gamification=True,
    streak_reminder=None,
)


def _settings(s: Any, user_id: Any) -> SettingsOut:
    row = s.execute(
        text(
            "SELECT track_water, track_fiber, water_unit, gamification, streak_reminder, "
            "checkin_email FROM user_settings "
            "WHERE user_id = :u"
        ),
        {"u": user_id},
    ).one_or_none()
    if row is None:
        return DEFAULTS
    return SettingsOut(
        track_water=row.track_water,
        track_fiber=row.track_fiber,
        water_unit=row.water_unit,
        gamification=row.gamification,
        streak_reminder=row.streak_reminder,
        checkin_email=row.checkin_email,
    )


@router.get("/me/settings")
def get_settings(user: ActiveUserDep) -> SettingsOut:
    with user_session(user.user_id) as s:
        return _settings(s, user.user_id)


@router.patch("/me/settings")
def patch_settings(body: SettingsPatch, user: ActiveUserDep) -> SettingsOut:
    with user_session(user.user_id) as s:
        change = body.model_dump(exclude_none=True)
        if "streak_reminder" in body.model_fields_set:
            change["streak_reminder"] = body.streak_reminder
        merged = _settings(s, user.user_id).model_copy(update=change)
        s.execute(
            text(
                "INSERT INTO user_settings (user_id, track_water, track_fiber, water_unit, "
                "gamification, streak_reminder, checkin_email) "
                "VALUES (:u, :w, :f, :unit, :g, :r, :c) "
                "ON CONFLICT (user_id) DO UPDATE SET track_water = :w, track_fiber = :f, "
                "water_unit = :unit, gamification = :g, streak_reminder = :r, "
                "checkin_email = :c, updated_at = now()"
            ),
            {
                "u": user.user_id,
                "w": merged.track_water,
                "f": merged.track_fiber,
                "unit": merged.water_unit,
                "g": merged.gamification,
                "r": merged.streak_reminder,
                "c": merged.checkin_email,
            },
        )
        return merged


class WaterIn(BaseModel):
    ml: Annotated[int, Field(gt=0, le=MAX_ML)]
    logged_at: AwareDatetime | None = None  # defaults to now


class WaterOut(BaseModel):
    id: uuid.UUID
    logged_at: datetime
    logged_on: date
    ml: int


class WaterDayOut(BaseModel):
    date: date
    ml: int


def _timezone(s: Any, user_id: Any) -> str:
    tz: str = s.execute(
        text("SELECT timezone FROM user_profiles WHERE user_id = :u"), {"u": user_id}
    ).scalar_one()
    return tz


def _check_range(a: date, b: date) -> None:
    if b < a or (b - a) > timedelta(days=MAX_DAYS_RANGE - 1):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Choose a range of 1 to {MAX_DAYS_RANGE} days.",
        )


@router.get("/water")
def list_water(
    user: ActiveUserDep,
    date_from: Annotated[date, Query()],
    date_to: Annotated[date | None, Query()] = None,
) -> list[WaterOut]:
    """Adds whose local date is in the range, oldest first."""
    end = date_to or date_from
    _check_range(date_from, end)
    with user_session(user.user_id) as s:
        rows = s.execute(
            text(
                "SELECT id, logged_at, logged_on, ml FROM water_logs WHERE user_id = :u "
                "AND deleted_at IS NULL AND logged_on BETWEEN :a AND :b ORDER BY logged_at, id"
            ),
            {"u": user.user_id, "a": date_from, "b": end},
        ).all()
    return [WaterOut(id=r.id, logged_at=r.logged_at, logged_on=r.logged_on, ml=r.ml) for r in rows]


@router.get("/water/days")
def water_days(
    user: ActiveUserDep,
    date_from: Annotated[date, Query()],
    date_to: Annotated[date, Query()],
) -> list[WaterDayOut]:
    """Total per local day with any water, oldest first, for the charts."""
    _check_range(date_from, date_to)
    with user_session(user.user_id) as s:
        rows = s.execute(
            text(
                "SELECT logged_on, sum(ml) AS ml FROM water_logs WHERE user_id = :u "
                "AND deleted_at IS NULL AND logged_on BETWEEN :a AND :b "
                "GROUP BY logged_on ORDER BY logged_on"
            ),
            {"u": user.user_id, "a": date_from, "b": date_to},
        ).all()
    return [WaterDayOut(date=r.logged_on, ml=int(r.ml)) for r in rows]


@router.post("/water", status_code=status.HTTP_201_CREATED)
def add_water(body: WaterIn, user: ActiveUserDep, services: ServicesDep) -> WaterOut:
    now = services.clock()
    at = body.logged_at or now
    if at > now + CLOCK_SKEW:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That time is in the future.")
    with user_session(user.user_id) as s:
        row = WaterLog(
            user_id=user.user_id,
            logged_at=at,
            logged_on=local_date(at, _timezone(s, user.user_id)),
            ml=body.ml,
        )
        s.add(row)
        s.flush()
        return WaterOut(id=row.id, logged_at=row.logged_at, logged_on=row.logged_on, ml=row.ml)


@router.delete("/water/{water_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_water(water_id: uuid.UUID, user: ActiveUserDep) -> None:
    """Undo an add. Another user's id is 404."""
    with user_session(user.user_id) as s:
        gone = s.execute(
            text(
                "UPDATE water_logs SET deleted_at = now() WHERE id = :id AND user_id = :u "
                "AND deleted_at IS NULL RETURNING id"
            ),
            {"id": water_id, "u": user.user_id},
        ).first()
    if gone is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
