from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def valid_timezone(tz: str) -> str:
    """An IANA timezone name such as America/New_York; days are computed in it."""
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown timezone") from None
    return tz
