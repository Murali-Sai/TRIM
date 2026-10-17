from datetime import date, datetime
from zoneinfo import ZoneInfo


def local_date(at: datetime, timezone: str) -> date:
    """The calendar day `at` falls on for a user in `timezone`."""
    return at.astimezone(ZoneInfo(timezone)).date()


def whole_years_between(start: date, end: date) -> int:
    years = end.year - start.year
    if (end.month, end.day) < (start.month, start.day):
        years -= 1
    return max(0, years)
