"""Food search waterfall (task 3.2, SPEC page 3).

1. Personal: the user's custom foods, favourites and foods they have logged before, most used
   first.
2. Cache: shared rows from earlier lookups, fresh within 30 days.
3. USDA FoodData Central, when tiers 1 and 2 return fewer than FDC_WHEN_UNDER.
4. Open Food Facts, only when tiers 1 to 3 return fewer than 5 and the shared OFF budget
   allows (their search limit is 10 a minute per IP, and every user shares our IP).
New FDC and OFF results are written to the cache through cache_food(), and each source is asked
at most once per query in 30 days (food_queries), so repeat searches stay in the database.
"""

import hashlib
import json
import uuid
from dataclasses import asdict
from datetime import timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import user_session
from app.deps import ServicesDep
from app.ids import uuid7
from app.security import ratelimit
from app.security.sessions import ActiveUserDep
from app.services.fooddata import FoodCandidate, FoodSource, FoodSourceError

router = APIRouter(prefix="/foods", tags=["foods"])

MAX_RESULTS = 25
FDC_WHEN_UNDER = 10
OFF_WHEN_UNDER = 5
CACHE_FRESH = timedelta(days=30)
# Our share of Open Food Facts' 10 searches a minute, with headroom for other instances.
OFF_SEARCHES_PER_MINUTE = 8
EXTERNAL_DOWN = "Some food databases are not answering right now, so results may be incomplete."

Tier = Literal["personal", "cache", "fdc", "off"]
FOOD_COLUMNS = (
    "f.id, f.owner_id, f.source, f.name, f.brand, f.kcal_100, f.protein_100, f.carbs_100, "
    "f.fat_100, f.fiber_100, f.sugar_100, f.sodium_mg_100, f.density_g_ml, f.kcal_mismatch"
)


class ServingOut(BaseModel):
    label: str
    grams: float
    is_default: bool


class FoodOut(BaseModel):
    id: uuid.UUID
    name: str
    brand: str | None
    source: Literal["custom", "fdc", "off"]
    tier: Tier
    kcal_100: float
    protein_100: float
    carbs_100: float
    fat_100: float
    fiber_100: float | None
    sugar_100: float | None
    sodium_mg_100: float | None
    density_g_ml: float | None
    kcal_mismatch: bool
    servings: list[ServingOut]


class SearchOut(BaseModel):
    results: list[FoodOut]
    notice: str | None = None


def _words(query: str) -> list[str]:
    return [w for w in query.lower().split() if w][:6]


def _match(words: list[str]) -> tuple[str, dict[str, str]]:
    """Every word must appear in the name or brand. LIKE wildcards in input are escaped."""
    clauses, params = [], {}
    for i, w in enumerate(words):
        escaped = w.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params[f"w{i}"] = f"%{escaped}%"
        clauses.append(f"(lower(f.name) LIKE :w{i} OR lower(coalesce(f.brand, '')) LIKE :w{i})")
    return " AND ".join(clauses) or "true", params


def _personal(s: Session, user_id: Any, words: list[str]) -> list[Any]:
    match, params = _match(words)
    return list(
        s.execute(
            text(
                f"SELECT {FOOD_COLUMNS}, count(l.id) AS uses FROM foods f "  # noqa: S608
                "LEFT JOIN food_logs l ON l.food_id = f.id AND l.user_id = :u "
                "AND l.deleted_at IS NULL "
                "WHERE f.deleted_at IS NULL AND (f.owner_id = :u OR l.id IS NOT NULL "
                "OR EXISTS (SELECT 1 FROM food_favourites v WHERE v.food_id = f.id "
                "AND v.user_id = :u)) "
                f"AND {match} GROUP BY f.id ORDER BY uses DESC, lower(f.name) LIMIT :n"
            ),
            {**params, "u": user_id, "n": MAX_RESULTS},
        ).all()
    )


def _cache(s: Session, words: list[str], query: str, fresh_since: Any) -> list[Any]:
    match, params = _match(words)
    return list(
        s.execute(
            text(
                f"SELECT {FOOD_COLUMNS} FROM foods f "  # noqa: S608
                "WHERE f.owner_id IS NULL AND f.deleted_at IS NULL "
                f"AND f.updated_at >= :fresh AND {match} "
                "ORDER BY (lower(f.name) = :q) DESC, (lower(f.name) LIKE :prefix) DESC, "
                "length(f.name), f.name LIMIT :n"
            ),
            {
                **params,
                "fresh": fresh_since,
                "q": query.lower(),
                "prefix": params.get("w0", "%")[1:],
                "n": MAX_RESULTS,
            },
        ).all()
    )


def _cache_candidates(s: Session, found: list[FoodCandidate]) -> list[uuid.UUID]:
    ids = []
    for c in found:
        payload = {
            **asdict(c),
            "id": str(uuid7()),
            "kcal_mismatch": c.kcal_mismatch,
            "servings": [{**asdict(sv), "id": str(uuid7())} for sv in c.servings],
        }
        ids.append(
            s.execute(
                text("SELECT cache_food(CAST(:p AS jsonb))"), {"p": json.dumps(payload)}
            ).scalar_one()
        )
    return ids


def _rows_by_id(s: Session, ids: list[uuid.UUID]) -> list[Any]:
    if not ids:
        return []
    rows = s.execute(
        text(f"SELECT {FOOD_COLUMNS} FROM foods f WHERE f.id = ANY(:ids)"),  # noqa: S608
        {"ids": ids},
    ).all()
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def _servings(s: Session, food_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[ServingOut]]:
    out: dict[uuid.UUID, list[ServingOut]] = {i: [] for i in food_ids}
    if not food_ids:
        return out
    for r in s.execute(
        text(
            "SELECT food_id, label, grams, is_default FROM serving_units "
            "WHERE food_id = ANY(:ids) AND deleted_at IS NULL ORDER BY is_default DESC, grams"
        ),
        {"ids": food_ids},
    ):
        out[r.food_id].append(
            ServingOut(label=r.label, grams=float(r.grams), is_default=r.is_default)
        )
    return out


def _food_out(r: Any, tier: Tier, servings: list[ServingOut]) -> FoodOut:
    return FoodOut(
        id=r.id,
        name=r.name,
        brand=r.brand,
        source=r.source,
        tier=tier,
        kcal_100=float(r.kcal_100),
        protein_100=float(r.protein_100),
        carbs_100=float(r.carbs_100),
        fat_100=float(r.fat_100),
        fiber_100=None if r.fiber_100 is None else float(r.fiber_100),
        sugar_100=None if r.sugar_100 is None else float(r.sugar_100),
        sodium_mg_100=None if r.sodium_mg_100 is None else float(r.sodium_mg_100),
        density_g_ml=None if r.density_g_ml is None else float(r.density_g_ml),
        kcal_mismatch=r.kcal_mismatch,
        servings=servings,
    )


def _off_allowed(now: Any) -> bool:
    key = ratelimit.rate_key(
        "off_search", "global", get_settings().ip_hash_pepper.get_secret_value()
    )
    if ratelimit.count_recent(key, now - timedelta(minutes=1)) >= OFF_SEARCHES_PER_MINUTE:
        return False
    ratelimit.hit(key, now)
    return True


def _query_hash(query: str) -> bytes:
    return hashlib.sha256(query.lower().encode()).digest()


def _asked_recently(s: Session, source: str, query: str, now: Any) -> bool:
    return bool(
        s.execute(
            text("SELECT food_query_fresh(:s, :h, :since)"),
            {"s": source, "h": _query_hash(query), "since": now - CACHE_FRESH},
        ).scalar_one()
    )


def _external(
    user_id: Any, name: str, source: FoodSource, query: str, now: Any
) -> tuple[list[FoodCandidate], bool]:
    """(results, failed). A successful answer, even an empty one, is remembered for 30 days;
    its results are in the cache by then."""
    try:
        found = source.search(query, MAX_RESULTS)
    except FoodSourceError:
        return [], True
    with user_session(user_id) as s:
        s.execute(
            text("SELECT food_query_mark(:s, :h, :at)"),
            {"s": name, "h": _query_hash(query), "at": now},
        )
    return found, False


@router.get("/search")
def search_foods(
    user: ActiveUserDep,
    services: ServicesDep,
    q: Annotated[str, Query(min_length=2, max_length=100)],
) -> SearchOut:
    query = " ".join(q.split())
    words = _words(query)
    now = services.clock()
    picked: list[tuple[Any, Tier]] = []
    seen: set[uuid.UUID] = set()
    failed = False

    def add(rows: list[Any], tier: Tier) -> None:
        for r in rows:
            if r.id not in seen:
                seen.add(r.id)
                picked.append((r, tier))

    with user_session(user.user_id) as s:
        add(_personal(s, user.user_id, words), "personal")
        add(_cache(s, words, query, now - CACHE_FRESH), "cache")
        fdc_recent = _asked_recently(s, "fdc", query, now)
        off_recent = _asked_recently(s, "off", query, now)

    if len(picked) < FDC_WHEN_UNDER and not fdc_recent:
        found, down = _external(user.user_id, "fdc", services.fdc, query, now)
        failed |= down
        if found:
            with user_session(user.user_id) as s:
                add(_rows_by_id(s, _cache_candidates(s, found)), "fdc")

    if len(picked) < OFF_WHEN_UNDER and not off_recent and _off_allowed(now):
        found, down = _external(user.user_id, "off", services.off, query, now)
        failed |= down
        if found:
            with user_session(user.user_id) as s:
                add(_rows_by_id(s, _cache_candidates(s, found)), "off")

    picked = picked[:MAX_RESULTS]
    with user_session(user.user_id) as s:
        servings = _servings(s, [r.id for r, _ in picked])
    results = [_food_out(r, tier, servings[r.id]) for r, tier in picked]
    return SearchOut(results=results, notice=EXTERNAL_DOWN if failed else None)
