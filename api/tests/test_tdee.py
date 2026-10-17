"""TDEE and macro rules against shared/tdee_vectors.json, the same cases as
web/src/lib/tdee.test.ts."""

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pytest

from app.tdee import CalcInput, calculate, ft_in_to_cm, lb_to_kg, macros_for, validate_body_stats

VECTORS: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "tdee_vectors.json").read_text()
)


def check(actual: dict[str, Any], expected: dict[str, Any]) -> None:
    for key, want in expected.items():
        if key == "raw":
            continue
        assert {key: actual[key]} == {key: want}
    for key, want in expected.get("raw", {}).items():
        assert abs(actual["raw"][key] - want) <= 0.01, f"raw.{key}"


def ids(cases: list[dict[str, Any]]) -> list[str]:
    return [c["name"] for c in cases]


@pytest.mark.parametrize("case", VECTORS["calculate"], ids=ids(VECTORS["calculate"]))
def test_calculate(case: dict[str, Any]) -> None:
    check(asdict(calculate(CalcInput(**case["input"]))), case["expect"])


@pytest.mark.parametrize("case", VECTORS["macros"], ids=ids(VECTORS["macros"]))
def test_macros(case: dict[str, Any]) -> None:
    i = case["input"]
    m = macros_for(i["target_kcal"], i["weight_kg"], i["rule_set"])
    expected = dict(case["expect"])
    from_rounded = expected.pop("kcal_from_rounded", None)
    check(asdict(m), expected)
    if from_rounded is not None:
        assert 4 * m.protein_g + 4 * m.carbs_g + 9 * m.fat_g == from_rounded


@pytest.mark.parametrize("case", VECTORS["units"], ids=ids(VECTORS["units"]))
def test_units(case: dict[str, Any]) -> None:
    if "lb" in case:
        assert abs(lb_to_kg(case["lb"]) - case["expect_kg"]) <= 0.01
    if "ft" in case:
        assert abs(ft_in_to_cm(case["ft"], case["in"]) - case["expect_cm"]) <= 0.01


@pytest.mark.parametrize("case", VECTORS["validation"], ids=ids(VECTORS["validation"]))
def test_validation(case: dict[str, Any]) -> None:
    i = case["input"]
    assert list(validate_body_stats(i["age"], i["weight_kg"], i["height_cm"])) == case["errors"]
