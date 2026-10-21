"""Loads data/pairing_scores.csv into pairing_scores (task 3.22), replacing what is there.

Run from api/ with the owner role (the app role can only read the table):

    TRIM_OWNER_URL=postgresql+psycopg://... \\
        uv run python tools/load_pairing.py data/pairing_scores.csv
"""

import os
import sys
from pathlib import Path

from sqlalchemy import Engine, create_engine, text

from app.models import FOOD_GROUPS, PAIRING_CONTEXTS
from tools.pairing import read_csv

EXPECTED_ROWS = len(PAIRING_CONTEXTS) * len(FOOD_GROUPS) * (len(FOOD_GROUPS) - 1) // 2


def load(engine: Engine, path: Path) -> int:
    rows = read_csv(path)
    if len(rows) != EXPECTED_ROWS:
        raise ValueError(f"Expected {EXPECTED_ROWS} rows, found {len(rows)}")
    versions = {r["data_version"] for r in rows}
    if len(versions) != 1:
        raise ValueError(f"One data version expected, found {sorted(versions)}")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM pairing_scores"))
        conn.execute(
            text(
                "INSERT INTO pairing_scores (context, group_a, group_b, plates, lift, score, "
                "data_version) VALUES (:context, :group_a, :group_b, :plates, :lift, :score, "
                ":data_version)"
            ),
            [
                {
                    **r,
                    "plates": int(r["plates"]),
                    "lift": float(r["lift"]) if r["lift"] else None,
                    "score": float(r["score"]),
                }
                for r in rows
            ],
        )
    return len(rows)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    url = os.environ.get("TRIM_OWNER_URL")
    if not url:
        print("Set TRIM_OWNER_URL to the owner role's database URL.")
        return 2
    n = load(create_engine(url), Path(argv[0]))
    print(f"Loaded {n} pair scores.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
