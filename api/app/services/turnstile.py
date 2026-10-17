"""Cloudflare Turnstile server-side check. Tokens are single use and valid for 5 minutes."""

import logging
from typing import Protocol

import httpx

log = logging.getLogger(__name__)

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
MAX_TOKEN_LENGTH = 2048


class HumanCheck(Protocol):
    def verify(self, token: str, remote_ip: str | None) -> bool: ...


class Turnstile:
    def __init__(self, client: httpx.Client, secret: str) -> None:
        self._client = client
        self._secret = secret

    def verify(self, token: str, remote_ip: str | None) -> bool:
        if not token or len(token) > MAX_TOKEN_LENGTH:
            return False
        data = {"secret": self._secret, "response": token}
        if remote_ip:
            data["remoteip"] = remote_ip
        try:
            res = self._client.post(SITEVERIFY_URL, data=data, timeout=5.0)
            res.raise_for_status()
            body = res.json()
        except (httpx.HTTPError, ValueError):
            # Fail closed: without the check we cannot tell a person from a bot.
            log.warning("Turnstile siteverify unavailable")
            return False
        if not body.get("success"):
            log.info("Turnstile rejected token: %s", body.get("error-codes"))
            return False
        return True
