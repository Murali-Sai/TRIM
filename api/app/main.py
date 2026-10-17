from fastapi import APIRouter, FastAPI

from app.config import get_settings
from app.routers import account, auth, me, password, setup
from app.security.csrf import install_csrf
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


def create_app(services: Services | None = None) -> FastAPI:
    app = FastAPI(title="TRIM API", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.services = services or build_services(get_settings())
    install_csrf(app)
    app.include_router(api)
    return app


app = create_app()
