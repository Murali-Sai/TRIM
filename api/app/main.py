from fastapi import APIRouter, FastAPI

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    """Public liveness check; the frontend also pings it on load to wake Cloud Run."""
    return {"status": "ok"}


def create_app() -> FastAPI:
    app = FastAPI(title="TRIM API", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.include_router(api)
    return app


app = create_app()
