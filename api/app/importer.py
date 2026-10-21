"""JSON import (task 5.2): restore or move an account from a "Download my data" JSON file.

Imports go into an empty account only: one with no food, weigh-ins, measurements, water,
meals, custom foods, staples or phases yet. The targets and measurement presets that sign-up
creates are replaced by the file's. Every row gets a new id (so a file can be imported next
to the account it came from) and references are remapped. A food log that points at a shared
food this server does not have keeps its nutrient snapshot and loses the link.

Not imported: daily totals (worked out from the logs), weekly check-ins (made each week) and
streak events (the streak engine counts them again from the logs). Badges keep their dates.
"""

import hashlib
import json
import uuid
from collections.abc import Callable, Iterable
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ids import uuid7

MAX_ROWS = 200_000


class ImportProblem(ValueError):
    """A file that cannot be imported; the message is safe to show."""


class Row(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Unit(Row):
    label: Annotated[str, Field(min_length=1, max_length=60)]
    grams: Decimal
    is_default: bool = False


class FoodIn(Row):
    id: uuid.UUID
    source: Literal["custom", "fdc", "off"] = "custom"
    source_ref: str | None = None
    name: Annotated[str, Field(min_length=1, max_length=200)]
    brand: Annotated[str, Field(max_length=200)] | None = None
    kcal_100: Decimal
    protein_100: Decimal
    carbs_100: Decimal
    fat_100: Decimal
    fiber_100: Decimal | None = None
    sugar_100: Decimal | None = None
    sodium_mg_100: Decimal | None = None
    density_g_ml: Decimal | None = None
    kcal_mismatch: bool = False
    units: list[Unit] = []


class MealItemIn(Row):
    food_id: uuid.UUID | None = None
    grams: Decimal
    quantity: Decimal | None = None
    unit_label: str | None = None
    sort_order: int = 0


class MealIn(Row):
    id: uuid.UUID
    name: Annotated[str, Field(min_length=1, max_length=200)]
    note: str | None = None
    is_favourite: bool = False
    use_count: int = 0
    last_used_at: AwareDatetime | None = None
    archived_at: AwareDatetime | None = None
    items: list[MealItemIn] = []


class StapleIn(Row):
    id: uuid.UUID
    food_id: uuid.UUID | None = None
    saved_meal_id: uuid.UUID | None = None
    food_group: str | None = None
    unit_label: str
    unit_grams: Decimal | None = None
    step_units: Decimal
    min_units: Decimal
    max_units: Decimal
    is_available: bool = True
    sort_order: int = 0


class PairIn(Row):
    staple_a_id: uuid.UUID
    staple_b_id: uuid.UUID
    kind: str = "never"


class StaplesIn(Row):
    staples: list[StapleIn] = []
    never_pairs: list[PairIn] = []


class LogIn(Row):
    food_id: uuid.UUID | None = None
    saved_meal_id: uuid.UUID | None = None
    log_group_id: uuid.UUID
    eaten_at: AwareDatetime
    logged_on: date
    name: Annotated[str, Field(min_length=1, max_length=200)]
    brand: str | None = None
    grams: Decimal | None = None
    quantity: Decimal | None = None
    unit_label: str | None = None
    kcal: Decimal
    protein_g: Decimal
    carbs_g: Decimal
    fat_g: Decimal
    fiber_g: Decimal | None = None
    sugar_g: Decimal | None = None
    sodium_mg: Decimal | None = None
    source: str


class WeightIn(Row):
    measured_at: AwareDatetime
    kg: Decimal
    note: str | None = None


class TypeIn(Row):
    id: uuid.UUID
    name: Annotated[str, Field(min_length=1, max_length=40)]
    unit: str
    precision: int = 1
    side: str | None = None
    pair_id: uuid.UUID | None = None
    is_preset: bool = False
    is_active: bool = True
    sort_order: int = 0
    archived_at: AwareDatetime | None = None


class EntryIn(Row):
    type_id: uuid.UUID
    value: Decimal | None = None
    value_text: str | None = None
    measured_at: AwareDatetime
    note: str | None = None


class MeasurementsIn(Row):
    types: list[TypeIn] = []
    entries: list[EntryIn] = []


class WaterIn(Row):
    logged_at: AwareDatetime
    logged_on: date
    ml: int


class TargetIn(Row):
    effective_from: date
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    fiber_g: int | None = None
    water_ml: int | None = None
    source: str
    calc_inputs: dict[str, Any] | None = None
    bmr: int | None = None
    tdee: int | None = None
    tolerance_pct: int = 5


class PhaseIn(Row):
    kind: str
    label: str | None = None
    start_date: date
    end_date: date | None = None
    note: str | None = None


class BadgeIn(Row):
    badge: str
    earned_at: AwareDatetime


class StreaksIn(Row):
    badges: list[BadgeIn] = []


class ProfileFields(Row):
    display_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    timezone: str | None = None
    unit_system: Literal["metric", "imperial"] | None = None
    sex: Literal["male", "female"] | None = None
    age_years: int | None = None
    age_recorded_on: date | None = None
    height_cm: Decimal | None = None
    goal_weight_kg: Decimal | None = None
    theme: Literal["system", "light", "dark"] | None = None


class SettingsFields(Row):
    track_water: bool | None = None
    track_fiber: bool | None = None
    water_unit: Literal["ml", "fl_oz"] | None = None
    gamification: bool | None = None
    streak_reminder: str | None = None


class ProfileIn(Row):
    profile: ProfileFields = ProfileFields()
    settings: SettingsFields = SettingsFields()


class Datasets(Row):
    profile: ProfileIn | None = None
    custom_foods: list[FoodIn] = []
    saved_meals: list[MealIn] = []
    staples: StaplesIn = StaplesIn()
    food_log: list[LogIn] = []
    weight: list[WeightIn] = []
    measurements: MeasurementsIn | None = None
    water: list[WaterIn] = []
    targets: list[TargetIn] | None = None
    phases: list[PhaseIn] = []
    streaks: StreaksIn = StreaksIn()


class Document(Row):
    format: Literal["trim-export"]
    version: Literal[1]
    datasets: Datasets


def parse(raw: bytes) -> Document:
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ImportProblem("This is not a JSON file from TRIM.") from None
    if not isinstance(data, dict) or data.get("format") != "trim-export":
        raise ImportProblem("This is not a JSON file from TRIM.")
    if data.get("version") != 1:
        raise ImportProblem("This file is from a newer version of TRIM.")
    try:
        doc = Document.model_validate(data)
    except ValidationError as e:
        loc = [str(p) for p in (e.errors()[0]["loc"] if e.errors() else ())]
        if loc[:1] == ["datasets"]:
            loc = loc[1:]
        where = ".".join(loc[:2])
        raise ImportProblem(f"Part of this file is not in the expected shape ({where}).") from None
    d = doc.datasets
    total = (
        len(d.custom_foods)
        + len(d.saved_meals)
        + len(d.staples.staples)
        + len(d.food_log)
        + len(d.weight)
        + len(d.water)
        + len(d.phases)
        + (len(d.measurements.entries) if d.measurements else 0)
    )
    if total > MAX_ROWS:
        raise ImportProblem("This file is too big to import.")
    return doc


# --- writing ---------------------------------------------------------------------------------

USER_DATA = (
    ("food_logs", "user_id"),
    ("weight_entries", "user_id"),
    ("measurement_entries", "user_id"),
    ("water_logs", "user_id"),
    ("saved_meals", "user_id"),
    ("foods", "owner_id"),
    ("staples", "user_id"),
    ("diet_phases", "user_id"),
)


def is_empty(s: Session, user_id: uuid.UUID) -> bool:
    for table, col in USER_DATA:
        # Table and column names come from the fixed list above.
        found = s.execute(
            text(f"SELECT 1 FROM {table} WHERE {col} = :u AND deleted_at IS NULL LIMIT 1"),  # noqa: S608
            {"u": user_id},
        ).first()
        if found is not None:
            return False
    return True


def _insert(s: Session, table: str, values: dict[str, Any]) -> None:
    cols = ", ".join(values)
    marks = ", ".join(f":{k}" for k in values)
    # Column names come from the models in this module, never from the file.
    s.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({marks})"), values)  # noqa: S608


def _shared_foods(s: Session, ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    wanted = list({i for i in ids if i is not None})
    if not wanted:
        return set()
    rows = s.execute(
        text("SELECT id FROM foods WHERE id = ANY(:ids) AND owner_id IS NULL"), {"ids": wanted}
    ).scalars()
    return set(rows)


def run(s: Session, user_id: uuid.UUID, doc: Document) -> dict[str, int]:
    """Write the file's rows for `user_id`. Returns how many rows each dataset brought in."""
    d = doc.datasets
    counts: dict[str, int] = {}
    shared = _shared_foods(
        s,
        [x.food_id for x in d.food_log if x.food_id]
        + [i.food_id for m in d.saved_meals for i in m.items if i.food_id]
        + [x.food_id for x in d.staples.staples if x.food_id],
    )
    foods: dict[uuid.UUID, uuid.UUID] = {}

    def food(old: uuid.UUID | None) -> uuid.UUID | None:
        if old is None:
            return None
        return foods.get(old) or (old if old in shared else None)

    if d.profile is not None:
        p = d.profile.profile.model_dump(exclude_none=True)
        if p:
            sets = ", ".join(f"{k} = :{k}" for k in p)
            s.execute(
                text(f"UPDATE user_profiles SET {sets}, updated_at = now() WHERE user_id = :u"),  # noqa: S608
                {**p, "u": user_id},
            )
        st = d.profile.settings.model_dump(exclude_none=True)
        if st:
            cols = ", ".join(st)
            marks = ", ".join(f":{k}" for k in st)
            updates = ", ".join(f"{k} = EXCLUDED.{k}" for k in st)
            s.execute(
                text(
                    f"INSERT INTO user_settings (user_id, {cols}) VALUES (:u, {marks}) "  # noqa: S608
                    f"ON CONFLICT (user_id) DO UPDATE SET {updates}"
                ),
                {**st, "u": user_id},
            )
        counts["profile"] = 1

    for f in d.custom_foods:
        new = uuid7()
        foods[f.id] = new
        values = f.model_dump(exclude={"id", "units"})
        _insert(s, "foods", {"id": new, "owner_id": user_id, **values})
        for u in f.units:
            _insert(s, "serving_units", {"id": uuid7(), "food_id": new, **u.model_dump()})
    counts["custom_foods"] = len(d.custom_foods)

    meals: dict[uuid.UUID, uuid.UUID] = {}
    for m in d.saved_meals:
        new = uuid7()
        meals[m.id] = new
        _insert(
            s,
            "saved_meals",
            {"id": new, "user_id": user_id, **m.model_dump(exclude={"id", "items"})},
        )
        for i in m.items:
            _insert(
                s,
                "saved_meal_items",
                {
                    "id": uuid7(),
                    "user_id": user_id,
                    "saved_meal_id": new,
                    **i.model_dump(exclude={"food_id"}),
                    "food_id": food(i.food_id),
                },
            )
    counts["saved_meals"] = len(d.saved_meals)

    staples: dict[uuid.UUID, uuid.UUID] = {}
    for st_in in d.staples.staples:
        food_id = food(st_in.food_id)
        meal_id = meals.get(st_in.saved_meal_id) if st_in.saved_meal_id else None
        if food_id is None and meal_id is None:
            continue  # its food is not on this server
        new = uuid7()
        staples[st_in.id] = new
        _insert(
            s,
            "staples",
            {
                "id": new,
                "user_id": user_id,
                **st_in.model_dump(exclude={"id", "food_id", "saved_meal_id"}),
                "food_id": food_id,
                "saved_meal_id": meal_id,
            },
        )
    for pr in d.staples.never_pairs:
        a, b = staples.get(pr.staple_a_id), staples.get(pr.staple_b_id)
        if a and b:
            lo, hi = sorted([a, b])
            _insert(
                s,
                "pair_preferences",
                {
                    "id": uuid7(),
                    "user_id": user_id,
                    "staple_a_id": lo,
                    "staple_b_id": hi,
                    "kind": pr.kind,
                },
            )
    counts["staples"] = len(staples)

    groups: dict[uuid.UUID, uuid.UUID] = {}
    for log in d.food_log:
        group = groups.setdefault(log.log_group_id, uuid7())
        _insert(
            s,
            "food_logs",
            {
                "id": uuid7(),
                "user_id": user_id,
                **log.model_dump(exclude={"food_id", "saved_meal_id", "log_group_id"}),
                "food_id": food(log.food_id),
                "saved_meal_id": meals.get(log.saved_meal_id) if log.saved_meal_id else None,
                "log_group_id": group,
            },
        )
    counts["food_log"] = len(d.food_log)

    for w in d.weight:
        _insert(s, "weight_entries", {"id": uuid7(), "user_id": user_id, **w.model_dump()})
    counts["weight"] = len(d.weight)

    if d.measurements is not None:
        # Sign-up's presets make way for the file's metrics (the account has no readings).
        s.execute(text("DELETE FROM measurement_types WHERE user_id = :u"), {"u": user_id})
        types: dict[uuid.UUID, uuid.UUID] = {}
        pairs: dict[uuid.UUID, uuid.UUID] = {}
        for t in d.measurements.types:
            new = uuid7()
            types[t.id] = new
            pair = pairs.setdefault(t.pair_id, uuid7()) if t.pair_id else None
            _insert(
                s,
                "measurement_types",
                {
                    "id": new,
                    "user_id": user_id,
                    **t.model_dump(exclude={"id", "pair_id"}),
                    "pair_id": pair,
                },
            )
        n = 0
        for e in d.measurements.entries:
            type_id = types.get(e.type_id)
            if type_id is None:
                raise ImportProblem("A measurement points at a metric that is not in the file.")
            _insert(
                s,
                "measurement_entries",
                {
                    "id": uuid7(),
                    "user_id": user_id,
                    **e.model_dump(exclude={"type_id"}),
                    "type_id": type_id,
                },
            )
            n += 1
        counts["measurements"] = n

    for wa in d.water:
        _insert(s, "water_logs", {"id": uuid7(), "user_id": user_id, **wa.model_dump()})
    counts["water"] = len(d.water)

    if d.targets is not None:
        s.execute(text("DELETE FROM targets WHERE user_id = :u"), {"u": user_id})
        for t_in in d.targets:
            values = t_in.model_dump()
            values["calc_inputs"] = (
                json.dumps(values["calc_inputs"]) if values["calc_inputs"] is not None else None
            )
            s.execute(
                text(
                    "INSERT INTO targets (id, user_id, effective_from, kcal, protein_g, carbs_g, "
                    "fat_g, fiber_g, water_ml, source, calc_inputs, bmr, tdee, tolerance_pct) "
                    "VALUES (:id, :u, :effective_from, :kcal, :protein_g, :carbs_g, :fat_g, "
                    ":fiber_g, :water_ml, :source, CAST(:calc_inputs AS jsonb), :bmr, :tdee, "
                    ":tolerance_pct)"
                ),
                {"id": uuid7(), "u": user_id, **values},
            )
        counts["targets"] = len(d.targets)

    for ph in d.phases:
        _insert(s, "diet_phases", {"id": uuid7(), "user_id": user_id, **ph.model_dump()})
    counts["phases"] = len(d.phases)

    for badge in d.streaks.badges:
        s.execute(
            text(
                "INSERT INTO user_badges (id, user_id, badge, earned_at) VALUES (:id, :u, :b, :t) "
                "ON CONFLICT (user_id, badge) DO NOTHING"
            ),
            {"id": uuid7(), "u": user_id, "b": badge.badge, "t": badge.earned_at},
        )
    counts["streaks"] = len(d.streaks.badges)
    return counts


# --- checksums -------------------------------------------------------------------------------

IGNORED = {"id", "created_at", "updated_at", "deleted_at"}


def _norm(v: Any) -> Any:
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str):
        try:
            # Times compare as instants, whatever offset they were written with.
            return datetime.fromisoformat(v).timestamp() if "T" in v else v
        except ValueError:
            return v
    return v


def _clean(row: dict[str, Any], refs: dict[str, Callable[[Any], Any]]) -> dict[str, Any]:
    out = {}
    for k, v in row.items():
        if k in IGNORED or k == "log_group_id":
            continue
        out[k] = refs[k](v) if k in refs else _norm(v)
    return out


def _digest(rows: Iterable[dict[str, Any]]) -> str:
    lines = sorted(json.dumps(r, sort_keys=True, default=str) for r in rows)
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def checksums(datasets: dict[str, Any]) -> dict[str, tuple[int, str]]:
    """(rows, sha256) per dataset with ids replaced by what they point at (a metric's name, a
    meal's name), so an export and the export of its import match."""
    foods = {f["id"]: f["name"] for f in datasets.get("custom_foods", [])}
    meals = {m["id"]: m["name"] for m in datasets.get("saved_meals", [])}
    staple_rows = datasets.get("staples", {}).get("staples", [])
    staple = {
        st["id"]: foods.get(st["food_id"], st["food_id"]) or meals.get(st["saved_meal_id"])
        for st in staple_rows
    }
    types = {
        t["id"]: f"{t['name']}/{t['side']}"
        for t in (datasets.get("measurements") or {}).get("types", [])
    }

    def food(v: Any) -> Any:
        return foods.get(v, v)

    def meal(v: Any) -> Any:
        return meals.get(v, v)

    def pair(v: Any) -> Any:
        return v is not None

    out: dict[str, tuple[int, str]] = {}
    for key, value in datasets.items():
        if key == "custom_foods":
            rows = [
                {**_clean(f, {}), "units": sorted(json.dumps(_clean(u, {})) for u in f["units"])}
                for f in value
            ]
        elif key == "saved_meals":
            rows = [
                {
                    **_clean({k: v for k, v in m.items() if k != "items"}, {}),
                    "items": sorted(
                        json.dumps(_clean(i, {"food_id": food}), default=str) for i in m["items"]
                    ),
                }
                for m in value
            ]
        elif key == "staples":
            rows = [_clean(st, {"food_id": food, "saved_meal_id": meal}) for st in value["staples"]]
            rows += [
                {
                    "pair": sorted(
                        [str(staple.get(p["staple_a_id"])), str(staple.get(p["staple_b_id"]))]
                    )
                }
                for p in value["never_pairs"]
            ]
        elif key == "food_log":
            rows = [_clean(r, {"food_id": food, "saved_meal_id": meal}) for r in value]
        elif key == "measurements":
            rows = [_clean(t, {"pair_id": pair}) for t in value["types"]]
            rows += [_clean(e, {"type_id": lambda v: types.get(v, v)}) for e in value["entries"]]
        elif key == "streaks":
            rows = [_clean(b, {}) for b in value["badges"]]
        elif key == "profile":
            rows = [{"profile": value["profile"], "settings": value["settings"]}]
        elif isinstance(value, list):
            rows = [_clean(r, {}) for r in value]
        else:
            continue
        out[key] = (len(rows), _digest(rows))
    return out
