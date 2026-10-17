import os
import time
import uuid


def uuid7(unix_ms: int | None = None) -> uuid.UUID:
    """RFC 9562 UUID version 7: 48-bit Unix milliseconds, then 74 random bits.

    Time-ordered, so new rows land at the end of B-tree indexes.
    Python 3.12 has no uuid.uuid7 (added in 3.14) and Postgres 16 has no uuidv7().
    """
    ms = time.time_ns() // 1_000_000 if unix_ms is None else unix_ms
    if not 0 <= ms < 1 << 48:
        raise ValueError("timestamp out of range for UUIDv7")
    rand = int.from_bytes(os.urandom(10), "big")
    rand_a = rand >> 68  # 12 bits
    rand_b = rand & ((1 << 62) - 1)  # 62 bits
    value = (ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    return uuid.UUID(int=value)
