"""Only the same-origin proxy may call the API in production.

The Cloudflare Pages Function adds a shared secret header (web/edge/proxy.ts). With
TRIM_PROXY_SECRET set, any /api request without it is refused, so nobody can reach Cloud Run
directly to skip the proxy or forge X-Forwarded-For (which the login lockout relies on).
"""

import hmac
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app.config import get_settings

PROXY_SECRET_HEADER = "x-trim-proxy-secret"  # noqa: S105 (a header name, not a secret)


def install_proxy_guard(app: FastAPI) -> None:
    @app.middleware("http")
    async def proxy_guard(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        secret = get_settings().proxy_secret
        request.state.via_proxy = False
        if secret is not None and request.url.path.startswith("/api/"):
            sent = request.headers.get(PROXY_SECRET_HEADER, "")
            if not hmac.compare_digest(sent, secret.get_secret_value()):
                return JSONResponse(status_code=403, content={"detail": "Forbidden"})
            request.state.via_proxy = True
        return await call_next(request)
