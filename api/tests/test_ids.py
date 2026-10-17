import uuid

import pytest

from app.ids import uuid7


def test_version_and_variant() -> None:
    u = uuid7()
    assert u.version == 7
    assert u.variant == uuid.RFC_4122


def test_timestamp_prefix() -> None:
    ms = 1_760_659_200_000  # 2025-10-17T00:00:00Z
    u = uuid7(ms)
    assert u.int >> 80 == ms


def test_ordered_by_time() -> None:
    assert uuid7(1_000) < uuid7(2_000)


def test_unique() -> None:
    assert len({uuid7(5) for _ in range(1000)}) == 1000


def test_rejects_out_of_range() -> None:
    with pytest.raises(ValueError):
        uuid7(-1)
    with pytest.raises(ValueError):
        uuid7(1 << 48)
