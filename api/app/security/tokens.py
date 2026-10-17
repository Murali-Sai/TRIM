import hashlib
import hmac
import secrets


def new_token() -> tuple[str, bytes]:
    """A random 256-bit token for a link or cookie, and the SHA-256 hash that is stored."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> bytes:
    return hashlib.sha256(raw.encode()).digest()


def hash_ip(ip: str | None, pepper: str) -> bytes | None:
    if not ip:
        return None
    return hmac.new(pepper.encode(), ip.encode(), hashlib.sha256).digest()
