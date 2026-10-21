"""JSON import (task 5.2): POST /api/import with the JSON file from Download my data."""

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import DBAPIError
from starlette.concurrency import run_in_threadpool

from app import importer
from app.db import user_session
from app.security.sessions import ActiveUserDep, CurrentUser

router = APIRouter(tags=["import"])

MAX_BYTES = 32 * 1024 * 1024
NOT_EMPTY = (
    "Import works into an empty account, and this one already has data. Sign up with another "
    "email to import there, or delete this account's data first."
)


class ImportOut(BaseModel):
    imported: dict[str, int]


def _run(user: CurrentUser, raw: bytes) -> dict[str, int]:
    try:
        doc = importer.parse(raw)
    except importer.ImportProblem as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    try:
        with user_session(user.user_id) as s:
            if not importer.is_empty(s, user.user_id):
                raise HTTPException(status.HTTP_409_CONFLICT, NOT_EMPTY)
            return importer.run(s, user.user_id, doc)
    except importer.ImportProblem as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    except DBAPIError:
        # A row the database refuses (a value out of range, two phases that overlap): nothing
        # was written, since it all runs in one transaction.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Some rows in this file could not be imported, so nothing was. Check that it is an "
            "unchanged TRIM export.",
        ) from None


@router.post("/import")
async def import_json(request: Request, user: ActiveUserDep) -> ImportOut:
    """Restore an account from its JSON export, all or nothing."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "This file is too big to import.")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE, "This file is too big to import."
            )
        chunks.append(chunk)
    counts = await run_in_threadpool(_run, user, b"".join(chunks))
    return ImportOut(imported=counts)
