"""Indexed change (SPEC page 3) against the shared vectors. AC of task 4.3: 90.0 to 87.3 gives
-3.0%."""

import json
from pathlib import Path

import pytest

from app.measure_math import indexed_change

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "measurement_vectors.json").read_text()
)


@pytest.mark.parametrize("v", VECTORS["indexed_change"], ids=lambda v: f"{v['base']}->{v['value']}")
def test_indexed_change(v: dict[str, float]) -> None:
    assert round(indexed_change(v["value"], v["base"]), 1) == v["pct"]


def test_ac_waist_90_to_87_3_is_minus_3_percent() -> None:
    assert f"{indexed_change(87.3, 90.0):.1f}" == "-3.0"
