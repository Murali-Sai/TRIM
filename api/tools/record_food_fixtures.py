"""Re-records the food search fixtures from the live APIs.

Run from api/ with network access, a data.gov key and a real User-Agent:
    TRIM_FDC_API_KEY=... TRIM_OFF_USER_AGENT="TRIM/1.0 (you@example.com)" \\
        uv run python tools/record_food_fixtures.py
Then check the tests still pass and review the diff: they assert on specific items.
"""

import json
import os
import sys
from datetime import date
from pathlib import Path

import httpx

from app.services.fooddata import FDC_DATA_TYPES, FDC_SEARCH_URL, OFF_FIELDS, OFF_SEARCH_URL

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def save(name: str, data: dict[str, object]) -> None:
    data = {"_fixture": f"Recorded from the live API on {date.today().isoformat()}.", **data}
    (FIXTURES / name).write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {name}")


def main() -> int:
    key = os.environ.get("TRIM_FDC_API_KEY")
    agent = os.environ.get("TRIM_OFF_USER_AGENT")
    if not key or not agent:
        print("Set TRIM_FDC_API_KEY and TRIM_OFF_USER_AGENT.", file=sys.stderr)
        return 1
    with httpx.Client(timeout=20) as client:
        fdc = client.get(
            FDC_SEARCH_URL,
            params={"query": "greek yogurt", "dataType": FDC_DATA_TYPES, "pageSize": 6},
            headers={"X-Api-Key": key},
        )
        fdc.raise_for_status()
        save("fdc_search_greek_yogurt.json", fdc.json())
        off = client.get(
            OFF_SEARCH_URL,
            params={
                "search_terms": "skyr",
                "search_simple": 1,
                "action": "process",
                "json": 1,
                "page_size": 5,
                "fields": OFF_FIELDS,
            },
            headers={"User-Agent": agent},
        )
        off.raise_for_status()
        save("off_search_skyr.json", off.json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
