from typing import Annotated

from fastapi import Depends, Request

from app.config import Settings, get_settings
from app.services.registry import Services


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


def client_ip(request: Request) -> str | None:
    """The caller's IP, for rate limits and audit hashes.

    X-Forwarded-For is trusted only when the request came through our proxy (it sets the first
    hop from Cloudflare's CF-Connecting-IP; the host may append more) or in local development.
    Anyone else could put any address there.
    """
    settings = get_settings()
    trusted = getattr(request.state, "via_proxy", False) or settings.env == "dev"
    forwarded = request.headers.get("x-forwarded-for")
    if trusted and forwarded:
        return forwarded.split(",", 1)[0].strip() or None
    return request.client.host if request.client else None


ServicesDep = Annotated[Services, Depends(get_services)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ClientIpDep = Annotated[str | None, Depends(client_ip)]
