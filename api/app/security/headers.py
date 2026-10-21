"""Security headers on every API response (task 5.4). The Pages proxy passes them through.

The API only ever answers JSON, files and redirects, so its CSP allows nothing to load. The
interactive docs page (/api/docs) is the one exception: it pulls Swagger UI from a CDN.
"""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

HEADERS = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
}
DOCS_CSP = (
    "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src https://cdn.jsdelivr.net; img-src https://fastapi.tiangolo.com data:; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
)
DOCS_PATH = "/api/docs"


def install_security_headers(app: FastAPI) -> None:
    @app.middleware("http")
    async def security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for name, value in HEADERS.items():
            response.headers.setdefault(name, value)
        if request.url.path == DOCS_PATH:
            response.headers["Content-Security-Policy"] = DOCS_CSP
        return response
