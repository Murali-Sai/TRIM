import os

from fastapi import APIRouter, FastAPI

from app.config import get_settings
from app.routers import (
    account,
    auth,
    checkins,
    export,
    foods,
    goals,
    imports,
    logs,
    me,
    meals,
    measurements,
    my_foods,
    pairs,
    password,
    phases,
    push,
    setup,
    staples,
    streaks,
    suggestions,
    tracking,
    weights,
)
from app.security.csrf import install_csrf
from app.security.headers import install_security_headers
from app.security.proxy_guard import install_proxy_guard
from app.services.registry import Services, build_services

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    """Public liveness check; the frontend also pings it on load to wake the API from sleep.

    On Render it also names the running commit, so a deploy can wait for the new version.
    """
    commit = os.environ.get("RENDER_GIT_COMMIT")
    return {"status": "ok", "commit": commit} if commit else {"status": "ok"}


api.include_router(auth.router)
api.include_router(password.router)
api.include_router(me.router)
api.include_router(account.router)
api.include_router(setup.router)
api.include_router(weights.router)
api.include_router(measurements.router)
api.include_router(phases.router)
api.include_router(export.router)
api.include_router(imports.router)
api.include_router(checkins.router)
api.include_router(tracking.router)
api.include_router(streaks.router)
api.include_router(goals.router)
api.include_router(push.router)
api.include_router(foods.router)
api.include_router(my_foods.router)
api.include_router(meals.router)
api.include_router(staples.router)
api.include_router(suggestions.router)
api.include_router(pairs.router)
api.include_router(logs.router)


def create_app(services: Services | None = None) -> FastAPI:
    app = FastAPI(title="TRIM API", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.services = services or build_services(get_settings())
    install_csrf(app)
    # Added last so it runs first: requests that skipped the proxy never reach anything else.
    install_proxy_guard(app)
    # Outermost, so even the proxy guard's refusals carry them.
    install_security_headers(app)
    app.include_router(api)
    return app


app = create_app()
