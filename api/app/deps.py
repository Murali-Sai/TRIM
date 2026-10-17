from typing import Annotated

from fastapi import Depends, Request

from app.config import Settings, get_settings
from app.services.registry import Services


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


def client_ip(request: Request) -> str | None:
    # Behind the Pages Function proxy and Cloud Run, the first X-Forwarded-For hop is the client.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip() or None
    return request.client.host if request.client else None


ServicesDep = Annotated[Services, Depends(get_services)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ClientIpDep = Annotated[str | None, Depends(client_ip)]
