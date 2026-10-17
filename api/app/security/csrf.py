"""Double-submit CSRF check on every write under /api, on top of SameSite=Lax cookies."""

import hmac
import secrets
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.security.cookies import CSRF_COOKIE, CSRF_HEADER, cookie_name, set_csrf_cookie

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# Server-to-server callers authenticate another way (the scheduler uses OIDC).
EXEMPT_PREFIXES = ("/api/internal/",)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def install_csrf(app: FastAPI) -> None:
    @app.middleware("http")
    async def csrf_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        settings = get_settings()
        name = cookie_name(CSRF_COOKIE, settings)
        cookie = request.cookies.get(name)
        path = request.url.path
        if (
            path.startswith("/api/")
            and request.method not in SAFE_METHODS
            and not path.startswith(EXEMPT_PREFIXES)
        ):
            header = request.headers.get(CSRF_HEADER)
            if not cookie or not header or not hmac.compare_digest(cookie, header):
                return JSONResponse(status_code=403, content={"detail": "CSRF check failed"})

        response = await call_next(request)
        already_set = any(
            h.startswith(f"{name}=".encode()) for k, h in response.raw_headers if k == b"set-cookie"
        )
        if not cookie and not already_set:
            set_csrf_cookie(response, new_csrf_token(), settings)
        return response
