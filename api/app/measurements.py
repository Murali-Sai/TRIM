"""Custom measurements (task 4.1, SPEC page 2 Data model and page 3).

Values are stored in cm, kg or %; a metric's unit only chooses how it is shown ("in" shows a
cm value in inches, "lb" a kg value in pounds). Presets are copied into every new account,
switched off until the user picks them (sign-up step 4 or Manage metrics).
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.ids import uuid7
from app.models import MeasurementType

# What each unit stores, and the readings a person could plausibly enter (in stored units).
STORED = {"cm": "cm", "in": "cm", "kg": "kg", "lb": "kg", "%": "%", "text": "text"}
RANGES = {"cm": (1.0, 400.0), "kg": (1.0, 700.0), "%": (0.1, 100.0)}
MAX_TYPES = 50


@dataclass(frozen=True)
class Preset:
    name: str
    unit: str  # "cm" becomes "in" for an imperial account
    precision: int = 1
    paired: bool = False


PRESETS: tuple[Preset, ...] = (
    Preset("Waist", "cm"),
    Preset("Hips", "cm"),
    Preset("Chest", "cm"),
    Preset("Neck", "cm"),
    Preset("Upper arm", "cm", paired=True),
    Preset("Thigh", "cm", paired=True),
    Preset("Body fat", "%"),
)


def same_kind(a: str, b: str) -> bool:
    """Whether a metric can switch between these units without converting its history."""
    return STORED[a] == STORED[b]


def out_of_range(unit: str, value: float) -> bool:
    lo, hi = RANGES[STORED[unit]]
    return not lo <= value <= hi


def seed_presets(s: Session, user_id: uuid.UUID, unit_system: str) -> None:
    """Copies the presets into a new account, switched off, in the account's length unit."""
    order = 0
    for p in PRESETS:
        unit = "in" if p.unit == "cm" and unit_system == "imperial" else p.unit
        pair = uuid7() if p.paired else None
        for side in ("left", "right") if p.paired else (None,):
            s.add(
                MeasurementType(
                    user_id=user_id,
                    name=p.name,
                    unit=unit,
                    precision=p.precision,
                    side=side,
                    pair_id=pair,
                    is_preset=True,
                    is_active=False,
                    sort_order=order,
                )
            )
            order += 1
