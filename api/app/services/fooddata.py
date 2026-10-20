"""USDA FoodData Central and Open Food Facts text search (SPEC page 3, Food search waterfall).

Both are called only from the backend: the FDC key never reaches the browser, and every Open
Food Facts request carries the User-Agent from config. Results are normalized to per 100 g with
serving units as rows. Failures raise FoodSourceError so search can fall back to what it has.
"""

import math
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import httpx

FDC_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
FDC_DATA_TYPES = "Foundation,SR Legacy,Branded"
OFF_FIELDS = "code,product_name,brands,nutriments,serving_quantity,serving_size"
KJ_PER_KCAL = 4.184
MISMATCH_LIMIT = 0.15
TIMEOUT = httpx.Timeout(6.0)

# FoodData Central nutrient ids. Foundation foods often report energy only as the Atwater
# factors (2047 general, 2048 specific) instead of 1008.
FDC_ENERGY_KCAL = (1008, 2047, 2048)
FDC_NUTRIENTS = {
    "protein_100": 1003,
    "fat_100": 1004,
    "carbs_100": 1005,
    "fiber_100": 1079,
    "sugar_100": 2000,
    "sodium_mg_100": 1093,
}


class FoodSourceError(Exception):
    """The source is down, slow, rate limited or answered something unusable."""


@dataclass(frozen=True)
class Serving:
    label: str
    grams: float
    is_default: bool = False


@dataclass(frozen=True)
class FoodCandidate:
    """One normalized result, per 100 g (or 100 ml at density_g_ml)."""

    source: Literal["fdc", "off"]
    source_ref: str
    name: str
    brand: str | None
    kcal_100: float
    protein_100: float
    carbs_100: float
    fat_100: float
    fiber_100: float | None = None
    sugar_100: float | None = None
    sodium_mg_100: float | None = None
    density_g_ml: float | None = None
    servings: tuple[Serving, ...] = field(default_factory=tuple)

    @property
    def kcal_mismatch(self) -> bool:
        return kcal_mismatch(self.kcal_100, self.protein_100, self.carbs_100, self.fat_100)


class FoodSource(Protocol):
    def search(self, query: str, limit: int) -> list[FoodCandidate]: ...


def kcal_mismatch(kcal: float, protein: float, carbs: float, fat: float) -> bool:
    """Energy differs from 4P + 4C + 9F by more than 15% (SPEC page 3, Normalization)."""
    computed = 4 * protein + 4 * carbs + 9 * fat
    if kcal <= 0:
        return computed > 0
    return abs(kcal - computed) / kcal > MISMATCH_LIMIT


def per_100(per_serving: float, serving_g: float) -> float:
    """per100 = per_serving / serving_g x 100."""
    return per_serving / serving_g * 100


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) and n >= 0 else None


def _clean(text: Any) -> str | None:
    if not isinstance(text, str):
        return None
    cleaned = " ".join(text.split())
    return cleaned or None


# --- FoodData Central -----------------------------------------------------------------------


def parse_fdc_food(item: dict[str, Any]) -> FoodCandidate | None:
    """One `foods[]` entry of /foods/search. Nutrient values there are per 100 g (or 100 ml for
    branded drinks). None when the core nutrients are missing."""
    fdc_id = item.get("fdcId")
    name = _clean(item.get("description"))
    if fdc_id is None or name is None:
        return None
    values: dict[int, float] = {}
    for n in item.get("foodNutrients") or []:
        nid, value = n.get("nutrientId"), _num(n.get("value"))
        if isinstance(nid, int) and value is not None and nid not in values:
            # kJ rows share an id with kcal on some records; keep kcal only.
            if nid in FDC_ENERGY_KCAL and str(n.get("unitName", "")).upper() != "KCAL":
                continue
            values[nid] = value
    kcal = next((values[i] for i in FDC_ENERGY_KCAL if i in values), None)
    core = [values.get(FDC_NUTRIENTS[k]) for k in ("protein_100", "carbs_100", "fat_100")]
    if kcal is None or any(v is None for v in core):
        return None
    protein, carbs, fat = (float(v) for v in core if v is not None)

    servings: list[Serving] = []
    size, unit = _num(item.get("servingSize")), str(item.get("servingSizeUnit") or "").lower()
    density = None
    if size and unit in ("g", "grm", "ml", "mlt"):
        if unit in ("ml", "mlt"):
            density = 1.0  # SPEC: per 100 ml at a default density of 1.0 g/ml
        household = _clean(item.get("householdServingFullText"))
        label = household or f"1 serving ({size:g} {'ml' if density else 'g'})"
        servings.append(Serving(label, size, is_default=True))
    servings.append(Serving("100 ml" if density else "100 g", 100.0, is_default=not servings))

    return FoodCandidate(
        source="fdc",
        source_ref=str(fdc_id),
        name=name,
        brand=_clean(item.get("brandName")) or _clean(item.get("brandOwner")),
        kcal_100=kcal,
        protein_100=protein,
        carbs_100=carbs,
        fat_100=fat,
        fiber_100=values.get(FDC_NUTRIENTS["fiber_100"]),
        sugar_100=values.get(FDC_NUTRIENTS["sugar_100"]),
        sodium_mg_100=values.get(FDC_NUTRIENTS["sodium_mg_100"]),
        density_g_ml=density,
        servings=tuple(servings),
    )


class FdcClient:
    def __init__(self, client: httpx.Client, api_key: str) -> None:
        self._client = client
        self._key = api_key

    def search(self, query: str, limit: int) -> list[FoodCandidate]:
        try:
            res = self._client.get(
                FDC_SEARCH_URL,
                params={"query": query, "dataType": FDC_DATA_TYPES, "pageSize": limit},
                # In a header (api.data.gov accepts X-Api-Key), so the key is never in a URL
                # that could end up in a log.
                headers={"X-Api-Key": self._key},
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            foods = res.json().get("foods") or []
        except (httpx.HTTPError, ValueError, AttributeError) as e:
            # The message names only the exception type, never the request.
            raise FoodSourceError(f"FoodData Central: {type(e).__name__}") from None
        return [c for c in (parse_fdc_food(f) for f in foods) if c is not None]


# --- Open Food Facts ------------------------------------------------------------------------


def parse_off_product(item: dict[str, Any]) -> FoodCandidate | None:
    """One `products[]` entry of the search API. Uses the _100g values, falling back to
    per-serving values divided by the serving size, and kJ when kcal is missing."""
    code = _clean(item.get("code"))
    name = _clean(item.get("product_name"))
    nutriments = item.get("nutriments") or {}
    if code is None or name is None or not isinstance(nutriments, dict):
        return None
    serving_g = _num(item.get("serving_quantity"))

    def value(key: str) -> float | None:
        v = _num(nutriments.get(f"{key}_100g"))
        if v is None and serving_g:
            per_serving = _num(nutriments.get(f"{key}_serving"))
            v = per_100(per_serving, serving_g) if per_serving is not None else None
        return v

    kcal = value("energy-kcal")
    if kcal is None:
        kj = value("energy-kj")
        if kj is None:
            kj = value("energy")  # OFF's plain energy field is in kJ
        kcal = kj / KJ_PER_KCAL if kj is not None else None
    protein, carbs, fat = value("proteins"), value("carbohydrates"), value("fat")
    if kcal is None or protein is None or carbs is None or fat is None:
        return None
    sodium_g = value("sodium")

    servings: list[Serving] = []
    if serving_g:
        label = _clean(item.get("serving_size")) or f"1 serving ({serving_g:g} g)"
        servings.append(Serving(label, serving_g, is_default=True))
    servings.append(Serving("100 g", 100.0, is_default=not servings))

    brands = _clean(item.get("brands"))
    return FoodCandidate(
        source="off",
        source_ref=code,
        name=name,
        brand=brands.split(",")[0].strip() if brands else None,
        kcal_100=kcal,
        protein_100=protein,
        carbs_100=carbs,
        fat_100=fat,
        fiber_100=value("fiber"),
        sugar_100=value("sugars"),
        # OFF reports sodium in grams.
        sodium_mg_100=sodium_g * 1000 if sodium_g is not None else None,
        servings=tuple(servings),
    )


class OffClient:
    def __init__(self, client: httpx.Client, user_agent: str) -> None:
        self._client = client
        self._user_agent = user_agent

    def search(self, query: str, limit: int) -> list[FoodCandidate]:
        try:
            res = self._client.get(
                OFF_SEARCH_URL,
                params={
                    "search_terms": query,
                    "search_simple": 1,
                    "action": "process",
                    "json": 1,
                    "page_size": limit,
                    "fields": OFF_FIELDS,
                },
                headers={"User-Agent": self._user_agent},
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            products = res.json().get("products") or []
        except (httpx.HTTPError, ValueError, AttributeError) as e:
            raise FoodSourceError(f"Open Food Facts: {type(e).__name__}") from None
        return [c for c in (parse_off_product(p) for p in products) if c is not None]


class NoFoodSource:
    """Used when a source is not configured (no FDC key in development)."""

    def search(self, query: str, limit: int) -> list[FoodCandidate]:
        raise FoodSourceError("not configured")
