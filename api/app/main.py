from fastapi import APIRouter, FastAPI

from app.config import get_settings
from app.routers import auth
from app.services.registry import Services, build_services

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    """Public liveness check; the frontend also pings it on load to wake Cloud Run."""
    return {"status": "ok"}


api.include_router(auth.router)


def create_app(services: Services | None = None) -> FastAPI:
    app = FastAPI(title="TRIM API", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.services = services or build_services(get_settings())
    app.include_router(api)
    return app


app = create_app()
