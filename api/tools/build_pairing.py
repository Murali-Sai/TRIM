"""Builds the food pairing table from NHANES (task 3.22). The rules are in tools/pairing.py.

Inputs, from the most recent What We Eat in America cycle (download them by hand):
- the day-1 and day-2 Individual Foods files (DR1IFF_*.xpt and DR2IFF_*.xpt) from the CDC
  NHANES site, read with pandas (uv run --with pandas ...);
- the FNDDS "Foods and Beverages" table for the same cycle from USDA ARS, saved as CSV, with
  the columns "Food code", "WWEIA Category number" and "WWEIA Category description".

Run from api/:

    uv run --with pandas python tools/build_pairing.py \\
        --day1 DR1IFF_L.xpt --day2 DR2IFF_L.xpt --fndds fndds_foods.csv \\
        --version "NHANES 2021-2023 (DR1IFF_L, DR2IFF_L); FNDDS 2021-2023" --out data/

It writes data/pairing_scores.csv (loaded into pairing_scores by tools/load_pairing.py) and
data/pairing_categories.csv (every WWEIA category and the group it went to) for review. It
stops on any eating occasion code or WWEIA category it does not know.
"""

import argparse
import csv
import sys
from collections.abc import Iterator
from pathlib import Path

from tools.pairing import Record, category_groups, plates_by_context, scores, write_csv


def read_fndds(path: Path) -> tuple[dict[int, int], dict[int, str]]:
    """Food code -> WWEIA category number, and category number -> description."""
    codes: dict[int, int] = {}
    names: dict[int, str] = {}
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = int(row["Food code"])
            number = int(row["WWEIA Category number"])
            codes[code] = number
            names[number] = row["WWEIA Category description"]
    return codes, names


def read_day(path: Path, day: int) -> Iterator[Record]:
    import pandas as pd  # only the build needs pandas, so it is not an app dependency

    p = f"DR{day}"
    frame = pd.read_sas(path, format="xport")
    for seqn, when, occasion, code in frame[
        ["SEQN", f"{p}_020", f"{p}_030Z", f"{p}IFDCD"]
    ].itertuples(index=False):
        if pd.isna(occasion) or pd.isna(code):
            continue
        yield Record(plate=(int(seqn), day, when), occasion=int(occasion), food_code=int(code))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--day1", type=Path, required=True)
    ap.add_argument("--day2", type=Path, required=True)
    ap.add_argument("--fndds", type=Path, required=True)
    ap.add_argument("--version", required=True, help="the data version stored with each row")
    ap.add_argument("--out", type=Path, default=Path("data"))
    args = ap.parse_args(argv)

    codes, names = read_fndds(args.fndds)
    groups = category_groups(names)
    food_groups = {code: groups[number] for code, number in codes.items()}
    records = [*read_day(args.day1, 1), *read_day(args.day2, 2)]
    plates = plates_by_context(records, food_groups)
    rows = scores(plates)

    args.out.mkdir(parents=True, exist_ok=True)
    write_csv(rows, args.out / "pairing_scores.csv", args.version)
    with (args.out / "pairing_categories.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["wweia_category", "description", "group"])
        for number in sorted(names):
            w.writerow([number, names[number], groups[number] or ""])
    counts = {c: len(p) for c, p in plates.items()}
    print(f"Plates per context: {counts}")
    print(f"Wrote {len(rows)} pair scores to {args.out / 'pairing_scores.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
