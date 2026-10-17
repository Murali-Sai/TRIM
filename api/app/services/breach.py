"""Breached-password check against the Pwned Passwords range API (k-anonymity).

Only the first 5 hex characters of the SHA-1 leave the server; the match happens locally.
"""

import hashlib
import logging
from typing import Protocol

import httpx

log = logging.getLogger(__name__)

RANGE_URL = "https://api.pwnedpasswords.com/range/"


class BreachChecker(Protocol):
    def is_breached(self, password: str) -> bool: ...


class PwnedPasswords:
    def __init__(self, client: httpx.Client, user_agent: str = "TRIM password check") -> None:
        self._client = client
        self._headers = {"Add-Padding": "true", "User-Agent": user_agent}

    def is_breached(self, password: str) -> bool:
        digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
        prefix, suffix = digest[:5], digest[5:]
        try:
            res = self._client.get(RANGE_URL + prefix, headers=self._headers, timeout=3.0)
            res.raise_for_status()
        except httpx.HTTPError:
            # Fail open: an outage should not block sign-up. Length rules still apply.
            log.warning("Pwned Passwords check unavailable; skipping")
            return False
        for line in res.text.splitlines():
            found, _, count = line.partition(":")
            # Padding rows have a count of 0 and are not real matches.
            if found.strip() == suffix and count.strip() not in ("", "0"):
                return True
        return False


class NoBreachCheck:
    def is_breached(self, password: str) -> bool:
        return False
