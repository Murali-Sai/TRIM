"""The isolation check itself: can user B see or change anything user A owns?

check_endpoint creates A through the API, snapshots every row A owns in the RLS tables, then
calls one endpoint as B with A's ids slipped into the query string and the JSON body (and into
the path, for endpoints that take an id). It fails when B gets a 5xx, gets anything but 404 for
A's id in the path, changes any of A's rows, or sees A's email, name or ids in the response.
"""

import uuid
from collections.abc import Iterator
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy import Engine, text

from app.models import RLS_TABLES
from tests.conftest import CsrfClient
from tests.helpers import log_in, sign_up, user_row
from tests.isolation.registry import BODY_STATS, ENDPOINTS, WORKED, Ctx, Endpoint


def _flatten(routes: list[Any]) -> Iterator[tuple[str, set[str]]]:
    """(path, methods) for every endpoint, including those inside included routers.

    FastAPI 0.14x wraps each include_router in an object whose endpoints are listed by
    effective_route_contexts instead of in app.routes; older versions add APIRoutes directly.
    """
    for route in routes:
        if isinstance(route, APIRoute):
            yield route.path, set(route.methods or ())
        contexts = getattr(route, "effective_route_contexts", None)
        if contexts is not None:
            for c in contexts() if callable(contexts) else contexts:
                yield c.path, set(c.methods or ())


def app_routes(app: FastAPI) -> set[tuple[str, str]]:
    """Every (method, path) the app serves under /api, except the docs FastAPI adds itself."""
    docs = {app.docs_url, app.openapi_url, app.redoc_url, app.swagger_ui_oauth2_redirect_url}
    return {
        (method, path)
        for path, methods in _flatten(app.routes)
        if path.startswith("/api/") and path not in docs
        for method in methods
        if method not in ("HEAD", "OPTIONS")
    }


def registry_mismatch(
    app: FastAPI, endpoints: list[Endpoint] = ENDPOINTS
) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    """(routes missing from the registry, registry entries with no route)."""
    served = app_routes(app)
    listed = {(e.method, e.path) for e in endpoints}
    return served - listed, listed - served


def snapshot(owner_engine: Engine, user_id: Any) -> dict[str, list[tuple[str, ...]]]:
    """Every row the user owns, as sorted text tuples, read as the owner (bypasses RLS)."""
    out: dict[str, list[tuple[str, ...]]] = {}
    with owner_engine.connect() as conn:
        for table, col in RLS_TABLES.items():
            rows = conn.execute(text(f"SELECT * FROM {table} WHERE {col} = :u"), {"u": user_id})
            out[table] = sorted(tuple(str(v) for v in row) for row in rows)
    return out


def create_user_a(app: FastAPI, owner_engine: Engine) -> tuple[str, str, dict[str, Any]]:
    """A signed-in user with data in every RLS table. Returns (email, marker name, user row)."""
    a = CsrfClient(app)
    a.get("/api/auth/csrf")
    marker = f"Marker {uuid.uuid4().hex[:8]}"
    email = sign_up(a, display_name=marker)
    assert log_in(a, email).status_code == 200
    assert a.patch("/api/me/body-stats", json=BODY_STATS).status_code == 200
    assert a.post("/api/targets/apply-calculation", json=WORKED).status_code == 201
    assert a.post("/api/weights", json={"kg": 69.4}).status_code == 201
    assert a.put("/api/me/goal-weight", json={"goal_weight_kg": 62}).status_code == 200
    gone = a.post("/api/weights", json={"kg": 69.1}).json()["id"]
    assert a.delete(f"/api/weights/{gone}").status_code == 204
    row = user_row(owner_engine, email)
    return email, marker, row._asdict()


def b_client(app: FastAPI) -> tuple[CsrfClient, str]:
    b = CsrfClient(app)
    b.get("/api/auth/csrf")
    email = sign_up(b, display_name="Bea")
    assert log_in(b, email).status_code == 200
    return b, email


def call(client: CsrfClient, ep: Endpoint, ctx: Ctx) -> Any:
    path = ep.path.format(**ep.path_params(ctx)) if ep.path_params else ep.path
    kwargs: dict[str, Any] = {"params": {"user_id": ctx.a_user_id}}
    if ep.method != "GET":
        body = ep.body(ctx) if ep.body else {}
        if isinstance(body, dict):
            # The user comes only from the session; these must be ignored.
            body = {**body, "user_id": ctx.a_user_id, "id": ctx.a_session_ids[0]}
        kwargs["json"] = body
    return client.request(ep.method, path, **kwargs)


def check_endpoint(app: FastAPI, owner_engine: Engine, ep: Endpoint) -> None:
    """Raise AssertionError if B, calling `ep`, can reach A's data."""
    a_email, marker, a_row = create_user_a(app, owner_engine)
    a_id = a_row["id"]
    before = snapshot(owner_engine, a_id)
    empty = [t for t, rows in before.items() if not rows]
    assert not empty, f"user A has no rows in {empty}; the check would prove nothing"
    session_ids = [r[0] for r in before["sessions"]]

    b, b_email = b_client(app)
    with owner_engine.connect() as conn:
        weights = conn.execute(
            text("SELECT id, deleted_at FROM weight_entries WHERE user_id = :u ORDER BY id"),
            {"u": a_id},
        ).all()
    ctx = Ctx(
        a_user_id=str(a_id),
        a_session_ids=session_ids,
        b_email=b_email,
        a_weight_ids=[str(w.id) for w in weights if w.deleted_at is None],
        a_deleted_weight_ids=[str(w.id) for w in weights if w.deleted_at is not None],
    )
    res = call(b, ep, ctx)
    name = f"{ep.method} {ep.path}"

    assert res.status_code < 500, f"{name}: {res.status_code}"
    if ep.path_params:
        assert res.status_code == 404, f"{name} with A's id: {res.status_code}, expected 404"
    assert snapshot(owner_engine, a_id) == before, f"{name} changed user A's rows"
    secrets = [a_email, marker, str(a_id), *session_ids]
    secrets += [*ctx.a_weight_ids, *ctx.a_deleted_weight_ids]
    for secret in secrets:
        assert secret.lower() not in res.text.lower(), f"{name} showed A's data to B"


def check_needs_session(app: FastAPI, ep: Endpoint) -> None:
    """Raise AssertionError unless `ep` answers 401 without a session."""
    anon = CsrfClient(app)
    anon.get("/api/auth/csrf")
    some = [str(uuid.uuid4())]
    ctx = Ctx(str(uuid.uuid4()), some, "", a_weight_ids=some, a_deleted_weight_ids=some)
    res = call(anon, ep, ctx)
    assert res.status_code == 401, f"{ep.method} {ep.path} without a session: {res.status_code}"
