from fastapi import APIRouter, FastAPI

from app.config import get_settings
from app.routers import (
    account,
    auth,
    foods,
    goals,
    logs,
    me,
    meals,
    my_foods,
    password,
    push,
    setup,
    streaks,
    tracking,
    weights,
)
from app.security.csrf import install_csrf
from app.security.proxy_guard import install_proxy_guard
from app.services.registry import Services, build_services

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    """Public liveness check; the frontend also pings it on load to wake Cloud Run."""
    return {"status": "ok"}


api.include_router(auth.router)
api.include_router(password.router)
api.include_router(me.router)
api.include_router(account.router)
api.include_router(setup.router)
api.include_router(weights.router)
api.include_router(tracking.router)
api.include_router(streaks.router)
api.include_router(goals.router)
api.include_router(push.router)
api.include_router(foods.router)
api.include_router(my_foods.router)
api.include_router(meals.router)
api.include_router(logs.router)


def create_app(services: Services | None = None) -> FastAPI:
    app = FastAPI(title="TRIM API", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.services = services or build_services(get_settings())
    install_csrf(app)
    # Added last so it runs first: requests that skipped the proxy never reach anything else.
    install_proxy_guard(app)
    app.include_router(api)
    return app


app = create_app()
