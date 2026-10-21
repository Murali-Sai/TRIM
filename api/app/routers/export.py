"""Download my data (task 5.1): POST /api/export streams the user's own rows as a file.

Open to every signed-in account, even one whose email is still unconfirmed past the deadline:
people can always take their data with them. One export a minute; each writes an `exports`
row and an `export` audit event. The file is built in a temporary file and streamed out; it
is never stored.
"""

import tempfile
from collections.abc import Iterator
from datetime import date
from typing import IO, Annotated, Literal, get_args

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from app import export as ex
from app.db import user_session
from app.deps import ClientIpDep, ServicesDep, SettingsDep
from app.models import AuditLog, Export
from app.security.sessions import CurrentUserDep
from app.security.tokens import hash_ip
from app.timeutil import local_date

router = APIRouter(tags=["export"])

Dataset = Literal[
    "food_log",
    "daily_totals",
    "saved_meals",
    "staples",
    "weight",
    "measurements",
    "water",
    "targets",
    "phases",
    "checkins",
    "streaks",
    "custom_foods",
    "profile",
]
CHUNK = 64 * 1024
# Small exports stay in memory; bigger ones spill to disk.
SPOOL = 8 * 1024 * 1024
TOO_SOON = "You can download your data once a minute. Try again in a moment."
NO_DATA = "No data in this range."


class ExportIn(BaseModel):
    format: ex.Format = "xlsx"
    date_from: date | None = None
    date_to: date | None = None
    # All of them by default.
    datasets: Annotated[list[Dataset], Field(min_length=1)] = Field(
        default_factory=lambda: list(get_args(Dataset))
    )


def _stream(f: IO[bytes]) -> Iterator[bytes]:
    try:
        f.seek(0)
        while chunk := f.read(CHUNK):
            yield chunk
    finally:
        f.close()


@router.post("/export")
def export(
    body: ExportIn,
    user: CurrentUserDep,
    services: ServicesDep,
    settings: SettingsDep,
    ip: ClientIpDep,
) -> StreamingResponse:
    """The chosen datasets in the user's units and timezone (Excel, CSV) or stored units (JSON)."""
    if body.date_from and body.date_to and body.date_from > body.date_to:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The start date is after the end date."
        )
    now = services.clock()
    keys: list[str] = [k for k in ex.DATASETS if k in set(body.datasets)]
    # Closed by _stream once sent, or below on an error.
    f = tempfile.SpooledTemporaryFile(max_size=SPOOL)  # noqa: SIM115
    try:
        with user_session(user.user_id) as s:
            recent = s.execute(
                text("SELECT 1 FROM exports WHERE user_id = :u AND created_at > :since LIMIT 1"),
                {"u": user.user_id, "since": now - ex.ONE_MINUTE},
            ).first()
            if recent is not None:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_SOON)
            prof = s.execute(
                text(
                    "SELECT p.timezone, p.unit_system, coalesce(st.water_unit, 'ml') AS water "
                    "FROM user_profiles p LEFT JOIN user_settings st ON st.user_id = p.user_id "
                    "WHERE p.user_id = :u"
                ),
                {"u": user.user_id},
            ).one()
            today = local_date(now, prof.timezone)
            ctx = ex.Ctx(
                s=s,
                user_id=user.user_id,
                tz=prof.timezone,
                imperial=prof.unit_system == "imperial",
                fl_oz=prof.water == "fl_oz",
                date_from=body.date_from,
                date_to=body.date_to,
            )
            if body.format == "json":
                rows = ex.write_json(ctx, keys, today, now, f)
            else:
                sheets = ex.build_sheets(ctx, keys, today)
                rows = ex.counted_rows(sheets)
                (ex.write_xlsx if body.format == "xlsx" else ex.write_csv_zip)(sheets, f)
            # The profile is never empty, so a file with it always has something in it.
            if rows == 0 and "profile" not in keys:
                raise HTTPException(status.HTTP_404_NOT_FOUND, NO_DATA)
            s.add(
                Export(
                    user_id=user.user_id,
                    format=body.format,
                    date_from=body.date_from,
                    date_to=body.date_to,
                    datasets=keys,
                    row_count=rows,
                    created_at=now,
                )
            )
            s.add(
                AuditLog(
                    user_id=user.user_id,
                    event="export",
                    at=now,
                    ip_hash=hash_ip(ip, settings.ip_hash_pepper.get_secret_value()),
                )
            )
    except BaseException:
        f.close()
        raise
    name = ex.file_name(body.format, today)
    return StreamingResponse(
        _stream(f),
        media_type=ex.MEDIA_TYPES[body.format],
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )
