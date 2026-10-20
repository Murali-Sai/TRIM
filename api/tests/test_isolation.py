"""Task 1.9: isolation harness. AC: fails the build if any endpoint lets user B touch A's data.

Every /api route must be listed in tests/isolation/registry.py; each one is then called as
user B against a fully set up user A (see tests/isolation/harness.py). The self-tests at the end
prove the harness catches a leaky endpoint, so a green run means something.
"""

import uuid
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI
from sqlalchemy import Engine, text

from tests.conftest import CsrfClient
from tests.fakes import Fakes
from tests.isolation.harness import check_endpoint, check_needs_session, registry_mismatch
from tests.isolation.registry import ENDPOINTS, Ctx, Endpoint

SIGNED_IN = [e for e in ENDPOINTS if e.requires_session]


def endpoint_id(e: Endpoint) -> str:
    return f"{e.method} {e.path}"


def test_every_endpoint_is_registered(client: CsrfClient) -> None:
    missing, stale = registry_mismatch(client.app)  # type: ignore[arg-type]
    assert not missing, f"add these to tests/isolation/registry.py: {sorted(missing)}"
    assert not stale, f"no such routes, remove from the registry: {sorted(stale)}"


@pytest.mark.parametrize("ep", ENDPOINTS, ids=endpoint_id)
def test_user_b_cannot_reach_user_a(client: CsrfClient, owner_engine: Engine, ep: Endpoint) -> None:
    check_endpoint(client.app, owner_engine, ep)  # type: ignore[arg-type]


@pytest.mark.parametrize("ep", SIGNED_IN, ids=endpoint_id)
def test_signed_in_endpoints_need_a_session(client: CsrfClient, ep: Endpoint) -> None:
    check_needs_session(client.app, ep)  # type: ignore[arg-type]


# --- the harness bites ----------------------------------------------------------------------


def leaky_app(fakes: Fakes, owner_engine: Engine) -> FastAPI:
    """The real app plus two endpoints that break the rules, reading as the owner (no RLS)."""
    from app.main import create_app

    leak = APIRouter(prefix="/api/leak")

    @leak.get("/{user_id}")
    def read_any_user(user_id: uuid.UUID) -> dict[str, Any]:
        with owner_engine.connect() as conn:
            row = conn.execute(text("SELECT email FROM users WHERE id = :u"), {"u": user_id})
            return {"email": row.scalar_one_or_none()}

    @leak.patch("/profile")
    def rename_from_body(body: dict[str, Any]) -> None:
        with owner_engine.begin() as conn:
            conn.execute(
                text("UPDATE user_profiles SET display_name = 'Hacked' WHERE user_id = :u"),
                {"u": body["user_id"]},
            )

    app = create_app(fakes.services())
    app.include_router(leak)
    return app


READ_LEAK = Endpoint(
    "GET",
    "/api/leak/{user_id}",
    requires_session=False,
    path_params=lambda c: {"user_id": c.a_user_id},
)
WRITE_LEAK = Endpoint("PATCH", "/api/leak/profile", requires_session=True, body=lambda c: {})


def test_harness_catches_unregistered_routes(fakes: Fakes, owner_engine: Engine) -> None:
    missing, _ = registry_mismatch(leaky_app(fakes, owner_engine))
    assert missing == {("GET", "/api/leak/{user_id}"), ("PATCH", "/api/leak/profile")}


@pytest.mark.parametrize(
    ("ep", "reason"),
    [(READ_LEAK, "expected 404"), (WRITE_LEAK, "changed user A's rows")],
    ids=["read by path id", "write trusting body user_id"],
)
def test_harness_catches_a_leak(
    client: CsrfClient, fakes: Fakes, owner_engine: Engine, ep: Endpoint, reason: str
) -> None:
    with pytest.raises(AssertionError, match=reason):
        check_endpoint(leaky_app(fakes, owner_engine), owner_engine, ep)


def test_harness_catches_a_missing_session_check(fakes: Fakes, owner_engine: Engine) -> None:
    with pytest.raises(AssertionError, match="without a session"):
        check_needs_session(leaky_app(fakes, owner_engine), WRITE_LEAK)


def test_ctx_carries_only_ids() -> None:
    # The harness hands B nothing but ids and B's own email.
    assert set(Ctx.__dataclass_fields__) == {
        "a_user_id",
        "a_session_ids",
        "b_email",
        "a_weight_ids",
        "a_deleted_weight_ids",
        "a_food_ids",
    }


def test_harness_catches_data_shown_to_b(fakes: Fakes, owner_engine: Engine) -> None:
    """A leak that answers 404 but still puts A's email in the body."""
    from app.main import create_app

    leak = APIRouter(prefix="/api/leak")

    @leak.get("/echo")
    def echo(user_id: uuid.UUID) -> Any:
        from fastapi.responses import JSONResponse

        with owner_engine.connect() as conn:
            email = conn.execute(
                text("SELECT email FROM users WHERE id = :u"), {"u": user_id}
            ).scalar_one()
        return JSONResponse({"detail": email}, status_code=404)

    app = create_app(fakes.services())
    app.include_router(leak)
    with pytest.raises(AssertionError, match="showed A's data"):
        check_endpoint(app, owner_engine, Endpoint("GET", "/api/leak/echo", requires_session=True))
