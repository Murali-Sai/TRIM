from datetime import timedelta

from fastapi import Response

from app.config import Settings

SESSION_COOKIE = "trim_session"
CSRF_COOKIE = "trim_csrf"
CSRF_HEADER = "x-csrf-token"


def cookie_name(base: str, settings: Settings) -> str:
    # __Host- cookies must be Secure, Path=/ and have no Domain, so no subdomain can set them.
    return f"__Host-{base}" if settings.cookie_secure else base


def set_session_cookie(
    response: Response, token: str, max_age: timedelta | None, settings: Settings
) -> None:
    response.set_cookie(
        cookie_name(SESSION_COOKIE, settings),
        token,
        max_age=int(max_age.total_seconds()) if max_age else None,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        cookie_name(SESSION_COOKIE, settings),
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def set_csrf_cookie(response: Response, token: str, settings: Settings) -> None:
    # Readable by the page (not HttpOnly): the client echoes it in the X-CSRF-Token header.
    response.set_cookie(
        cookie_name(CSRF_COOKIE, settings),
        token,
        path="/",
        secure=settings.cookie_secure,
        httponly=False,
        samesite="lax",
    )
