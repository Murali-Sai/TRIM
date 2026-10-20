from datetime import datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.db import user_session
from app.deps import ServicesDep
from app.security.sessions import CurrentUserDep, verify_deadline

router = APIRouter(tags=["me"])

# Which sign-up step comes next: body stats (step 2), targets (step 3), or none.
SetupStep = Literal["body_stats", "targets", "done"]


class MeOut(BaseModel):
    email: str
    display_name: str
    timezone: str
    unit_system: str
    theme: str
    email_verified: bool
    # Set while unverified: after this, data endpoints refuse until the email is confirmed.
    verify_deadline: datetime | None
    verify_required: bool
    setup: SetupStep


@router.get("/me")
def me(user: CurrentUserDep, services: ServicesDep) -> MeOut:
    with user_session(user.user_id) as s:
        row = s.execute(
            text(
                "SELECT u.email, p.display_name, p.timezone, p.unit_system, p.theme, "
                "(p.sex IS NOT NULL AND p.age_years IS NOT NULL AND p.height_cm IS NOT NULL "
                " AND p.activity_level IS NOT NULL "
                " AND EXISTS (SELECT 1 FROM weight_entries w "
                "             WHERE w.user_id = u.id AND w.deleted_at IS NULL)) AS has_stats, "
                "EXISTS (SELECT 1 FROM targets t "
                "        WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS has_targets "
                "FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.id = :u"
            ),
            {"u": user.user_id},
        ).one()
    deadline = verify_deadline(user)
    # Targets can only be saved after body stats, so once they exist setup is done, even if
    # the user later deletes every weigh-in.
    step: SetupStep = "done" if row.has_targets else "targets" if row.has_stats else "body_stats"
    return MeOut(
        email=row.email,
        display_name=row.display_name,
        timezone=row.timezone,
        unit_system=row.unit_system,
        theme=row.theme,
        email_verified=user.email_verified,
        verify_deadline=deadline,
        verify_required=deadline is not None and services.clock() >= deadline,
        setup=step,
    )
