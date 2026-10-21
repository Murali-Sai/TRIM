"""Measurement math shared with the web app (SPEC page 3, Algorithms). Mirrors
web/src/lib/measureSeries.ts; both pass shared/measurement_vectors.json."""


def indexed_change(value: float, base: float) -> float:
    """100 x (v / v_base - 1): waist 90.0 to 87.3 cm is -3.0%."""
    return 100 * (value / base - 1)
