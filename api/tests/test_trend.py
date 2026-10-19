"""Trend math against shared/trend_vectors.json, the same cases as web/src/lib/trend.test.ts."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.trend import Reading, compute_trend, gap_alpha, weekly_rate

VECTORS: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "trend_vectors.json").read_text()
)


def ids(cases: list[dict[str, Any]]) -> list[str]:
    return [c["name"] for c in cases]


def near(actual: float | None, want: float | None, tol: float, what: str) -> None:
    if want is None:
        assert actual is None, what
    else:
        assert actual is not None, what
        assert abs(actual - want) <= tol, f"{what}: {actual} vs {want}"


@pytest.mark.parametrize("v", VECTORS["gap_alpha"], ids=ids(VECTORS["gap_alpha"]))
def test_gap_alpha(v: dict[str, Any]) -> None:
    near(gap_alpha(v["alpha"], v["days"]), v["expect"], 0.001, "a_eff")


@pytest.mark.parametrize("v", VECTORS["trend"], ids=ids(VECTORS["trend"]))
def test_compute_trend(v: dict[str, Any]) -> None:
    readings = [Reading(**r) for r in v["readings"]]
    kwargs = {"alpha": v["alpha"]} if "alpha" in v else {}
    result = compute_trend(readings, **kwargs)
    expect = v["expect"]
    assert len(result.points) == len(expect["points"])
    for i, (got, want) in enumerate(zip(result.points, expect["points"], strict=True)):
        assert (got.day, got.outlier, got.counted) == (
            want["day"],
            want["outlier"],
            want["counted"],
        )
        near(got.trend, want["trend"], 0.01, f"points[{i}].trend")
    assert (result.visible, result.readings_needed, result.days_needed) == (
        expect["visible"],
        expect["readings_needed"],
        expect["days_needed"],
    )


@pytest.mark.parametrize("v", VECTORS["weekly_rate"], ids=ids(VECTORS["weekly_rate"]))
def test_weekly_rate(v: dict[str, Any]) -> None:
    points = [(p["day"], p["trend"]) for p in v["points"]]
    near(weekly_rate(points), v["expect"], 0.01, "kg per week")


def test_weekly_rate_rounds_to_spec_figure() -> None:
    points = [(p["day"], p["trend"]) for p in VECTORS["weekly_rate"][0]["points"]]
    rate = weekly_rate(points)
    assert rate is not None and round(rate, 2) == -0.45
