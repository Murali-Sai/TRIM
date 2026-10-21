"""Never pairs (task 3.23): "Don't suggest these together" on a suggestion card. Such a pair of
staples is never on one suggestion again, whatever the pairing data says."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import user_session
from app.ids import uuid7
from app.security.sessions import ActiveUserDep

router = APIRouter(prefix="/pair-preferences", tags=["suggestions"])

NOT_FOUND = "Pair not found"


class PairIn(BaseModel):
    staple_ids: Annotated[list[uuid.UUID], Field(min_length=2, max_length=2)]


class PairOut(BaseModel):
    id: uuid.UUID
    staple_ids: list[uuid.UUID]
    names: list[str]
    created_at: datetime


def _rows(s: Session, user_id: Any, pair_id: uuid.UUID | None = None) -> list[PairOut]:
    rows = s.execute(
        text(
            "SELECT p.id, p.staple_a_id, p.staple_b_id, p.created_at, "
            "coalesce(fa.name, ma.name, '') AS name_a, coalesce(fb.name, mb.name, '') AS name_b "
            "FROM pair_preferences p "
            "JOIN staples a ON a.id = p.staple_a_id JOIN staples b ON b.id = p.staple_b_id "
            "LEFT JOIN foods fa ON fa.id = a.food_id LEFT JOIN saved_meals ma "
            "ON ma.id = a.saved_meal_id LEFT JOIN foods fb ON fb.id = b.food_id "
            "LEFT JOIN saved_meals mb ON mb.id = b.saved_meal_id "
            "WHERE p.user_id = :u AND p.deleted_at IS NULL "
            "AND (CAST(:p AS uuid) IS NULL OR p.id = :p) ORDER BY p.created_at, p.id"
        ),
        {"u": user_id, "p": pair_id},
    ).all()
    return [
        PairOut(
            id=r.id,
            staple_ids=[r.staple_a_id, r.staple_b_id],
            names=[r.name_a, r.name_b],
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("")
def list_pairs(user: ActiveUserDep) -> list[PairOut]:
    with user_session(user.user_id) as s:
        return _rows(s, user.user_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def add_pair(body: PairIn, user: ActiveUserDep) -> PairOut:
    """Both staples must be the user's own; asking twice keeps one pair."""
    a, b = sorted(body.staple_ids)
    if a == b:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick two different staples")
    with user_session(user.user_id) as s:
        mine = s.execute(
            text(
                "SELECT count(*) FROM staples WHERE user_id = :u AND deleted_at IS NULL "
                "AND id = ANY(:ids)"
            ),
            {"u": user.user_id, "ids": [a, b]},
        ).scalar_one()
        if mine != 2:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Staple not found")
        pair_id = s.execute(
            text(
                "INSERT INTO pair_preferences (id, user_id, staple_a_id, staple_b_id) "
                "VALUES (:id, :u, :a, :b) ON CONFLICT (user_id, staple_a_id, staple_b_id) "
                "DO UPDATE SET deleted_at = NULL RETURNING id"
            ),
            {"id": uuid7(), "u": user.user_id, "a": a, "b": b},
        ).scalar_one()
        return _rows(s, user.user_id, pair_id)[0]


@router.delete("/{pair_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pair(pair_id: uuid.UUID, user: ActiveUserDep) -> None:
    """Undo: the two staples may be suggested together again."""
    with user_session(user.user_id) as s:
        gone = s.execute(
            text("DELETE FROM pair_preferences WHERE id = :p AND user_id = :u RETURNING id"),
            {"p": pair_id, "u": user.user_id},
        ).first()
        if gone is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
