from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 256

# OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1.
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)

# A real hash of a random string, verified against when an account does not exist so that
# response time does not reveal which emails are registered.
_DUMMY_HASH = _hasher.hash("trim-dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def burn_time(password: str) -> None:
    """Spends the same work as a real verify, for the account-does-not-exist path."""
    verify_password(_DUMMY_HASH, password)


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)
