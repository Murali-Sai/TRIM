"""Every /api endpoint, and how the isolation harness calls it as user B.

AGENTS.md: "Every new endpoint must be added to the isolation test suite before merge."
test_every_endpoint_is_registered fails the build when a route exists that is not listed here.

For each endpoint:
- requires_session: without a session cookie it must answer 401.
- body: what B sends. The harness also slips A's ids into every JSON body (user_id, id), which
  must be ignored: the user always comes from the session.
- params: query string B sends (the harness always adds A's user_id too).
- path_params: for endpoints that take an id in the path, the harness passes A's id and expects
  404 (not 403, so B cannot even learn that the id exists).
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tests.helpers import PASSWORD, new_email

WORKED = json.loads(
    (Path(__file__).resolve().parents[3] / "shared" / "tdee_vectors.json").read_text()
)["calculate"][1]["input"]


@dataclass(frozen=True)
class Ctx:
    """What the harness knows while calling an endpoint as B."""

    a_user_id: str
    a_session_ids: list[str]
    b_email: str
    a_weight_ids: list[str]  # live weigh-ins
    a_deleted_weight_ids: list[str]  # deleted, still restorable by A
    a_food_ids: list[str]  # A's custom foods
    a_log_ids: list[str]  # A's food log entries
    a_group_ids: list[str]  # the log_group_id of A's entries
    a_meal_ids: list[str]  # A's saved meals
    a_water_ids: list[str]  # A's water adds
    a_staple_ids: list[str]  # A's staples
    a_pair_ids: list[str]  # A's never pairs
    a_measurement_type_ids: list[str]  # A's metrics (the presets and any of its own)
    a_measurement_ids: list[str]  # A's readings
    a_phase_ids: list[str]  # A's diet phases


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    requires_session: bool
    body: Callable[[Ctx], Any] | None = None
    path_params: Callable[[Ctx], dict[str, str]] | None = None
    params: Callable[[Ctx], dict[str, str]] | None = None


BODY_STATS = {
    "sex": "female",
    "age": 41,
    "height_cm": 170,
    "activity_level": "light",
    "unit_system": "metric",
    "weight_kg": 70,
}
TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX"

ENDPOINTS: list[Endpoint] = [
    # Public, before sign-in. None of these take an id.
    Endpoint("GET", "/api/health", requires_session=False),
    Endpoint("GET", "/api/auth/csrf", requires_session=False),
    Endpoint(
        "POST",
        "/api/auth/signup",
        requires_session=False,
        body=lambda c: {
            "email": new_email(),
            "password": PASSWORD,
            "display_name": "Someone",
            "timezone": "UTC",
            "unit_system": "metric",
            "turnstile_token": TURNSTILE,
        },
    ),
    Endpoint("POST", "/api/auth/verify", requires_session=False, body=lambda c: {"token": "x"}),
    Endpoint(
        "POST",
        "/api/auth/login",
        requires_session=False,
        body=lambda c: {"email": c.b_email, "password": PASSWORD},
    ),
    # Ends B's own session if there is one; fine without.
    Endpoint("POST", "/api/auth/logout", requires_session=False),
    Endpoint(
        "POST",
        "/api/auth/forgot",
        requires_session=False,
        body=lambda c: {"email": c.b_email, "turnstile_token": TURNSTILE},
    ),
    Endpoint(
        "POST",
        "/api/auth/reset",
        requires_session=False,
        body=lambda c: {"token": "x", "password": "a brand new passphrase"},
    ),
    # Signed in, acting only on the session's own user.
    Endpoint("POST", "/api/auth/resend-verify", requires_session=True),
    Endpoint("GET", "/api/me", requires_session=True),
    Endpoint("GET", "/api/me/body-stats", requires_session=True),
    Endpoint("PATCH", "/api/me/body-stats", requires_session=True, body=lambda c: BODY_STATS),
    Endpoint("POST", "/api/tdee/calculate", requires_session=True, body=lambda c: WORKED),
    Endpoint(
        "POST", "/api/targets/apply-calculation", requires_session=True, body=lambda c: WORKED
    ),
    Endpoint("GET", "/api/targets", requires_session=True),
    Endpoint(
        "POST",
        "/api/targets",
        requires_session=True,
        body=lambda c: {"kcal": 2100, "protein_g": 120, "fat_g": 60, "basis": WORKED},
    ),
    Endpoint(
        "PATCH",
        "/api/me/profile",
        requires_session=True,
        body=lambda c: {"display_name": "B renamed", "timezone": "Asia/Tokyo", "theme": "dark"},
    ),
    Endpoint(
        "POST",
        "/api/me/password",
        requires_session=True,
        body=lambda c: {"current_password": PASSWORD, "new_password": "b brand new passphrase"},
    ),
    Endpoint("GET", "/api/me/sessions", requires_session=True),
    Endpoint("DELETE", "/api/me/sessions", requires_session=True),
    Endpoint(
        "DELETE",
        "/api/me",
        requires_session=True,
        body=lambda c: {"password": PASSWORD, "confirm": "DELETE"},
    ),
    # Signed in, with another user's id in the path: must be 404.
    Endpoint(
        "DELETE",
        "/api/me/sessions/{session_id}",
        requires_session=True,
        path_params=lambda c: {"session_id": c.a_session_ids[0]},
    ),
    Endpoint(
        "PUT", "/api/me/goal-weight", requires_session=True, body=lambda c: {"goal_weight_kg": 65}
    ),
    Endpoint("GET", "/api/weights", requires_session=True),
    Endpoint("POST", "/api/weights", requires_session=True, body=lambda c: {"kg": 72.5}),
    Endpoint(
        "PATCH",
        "/api/weights/{entry_id}",
        requires_session=True,
        body=lambda c: {"kg": 99.0, "note": "changed by B"},
        path_params=lambda c: {"entry_id": c.a_weight_ids[0]},
    ),
    Endpoint(
        "DELETE",
        "/api/weights/{entry_id}",
        requires_session=True,
        path_params=lambda c: {"entry_id": c.a_weight_ids[0]},
    ),
    Endpoint(
        "POST",
        "/api/weights/{entry_id}/restore",
        requires_session=True,
        path_params=lambda c: {"entry_id": c.a_deleted_weight_ids[0]},
    ),
    # A has a custom food named "Overnight oats" and one log on 17 Oct
    # (tests.helpers.seed_food_rows). B may not log A's food or read A's logs.
    Endpoint(
        "POST",
        "/api/logs",
        requires_session=True,
        body=lambda c: {
            "eaten_at": "2026-10-17T12:00:00Z",
            "items": [{"food_id": c.a_food_ids[0], "grams": 100}],
        },
    ),
    Endpoint(
        "GET", "/api/logs", requires_session=True, params=lambda c: {"date_from": "2026-10-17"}
    ),
    Endpoint("GET", "/api/logs/last-time", requires_session=True),
    Endpoint(
        "GET",
        "/api/logs/days",
        requires_session=True,
        params=lambda c: {"date_from": "2026-10-01", "date_to": "2026-10-31"},
    ),
    Endpoint(
        "PATCH",
        "/api/logs/{log_id}",
        requires_session=True,
        body=lambda c: {"grams": 1, "eaten_at": "2026-10-17T08:00:00Z"},
        path_params=lambda c: {"log_id": c.a_log_ids[0]},
    ),
    Endpoint(
        "DELETE",
        "/api/logs/{log_id}",
        requires_session=True,
        path_params=lambda c: {"log_id": c.a_log_ids[0]},
    ),
    Endpoint(
        "POST",
        "/api/logs/{log_id}/restore",
        requires_session=True,
        path_params=lambda c: {"log_id": c.a_log_ids[0]},
    ),
    Endpoint(
        "POST",
        "/api/logs/move",
        requires_session=True,
        body=lambda c: {"ids": c.a_log_ids, "eaten_at": "2026-10-17T08:00:00Z"},
    ),
    Endpoint(
        "POST",
        "/api/logs/copy",
        requires_session=True,
        body=lambda c: {"ids": c.a_log_ids, "eaten_at": "2026-10-17T08:00:00Z"},
    ),
    Endpoint("GET", "/api/foods/quick", requires_session=True),
    # A has a custom food, a favourite and a saved meal; B must see none of them.
    Endpoint(
        "GET",
        "/api/foods/fits-my-macros",
        requires_session=True,
        params=lambda c: {"on": "2026-10-17"},
    ),
    Endpoint(
        "PUT",
        "/api/foods/{food_id}/favourite",
        requires_session=True,
        path_params=lambda c: {"food_id": c.a_food_ids[0]},
    ),
    Endpoint(
        "DELETE",
        "/api/foods/{food_id}/favourite",
        requires_session=True,
        path_params=lambda c: {"food_id": c.a_food_ids[0]},
    ),
    Endpoint(
        "POST",
        "/api/foods",
        requires_session=True,
        body=lambda c: {
            "name": "B's bar",
            "per": "100g",
            "kcal": 350,
            "protein_g": 30,
            "carbs_g": 35,
            "fat_g": 10,
        },
    ),
    Endpoint(
        "PATCH",
        "/api/foods/{food_id}",
        requires_session=True,
        body=lambda c: {
            "name": "Changed by B",
            "per": "100g",
            "kcal": 1,
            "protein_g": 0,
            "carbs_g": 0,
            "fat_g": 0,
        },
        path_params=lambda c: {"food_id": c.a_food_ids[0]},
    ),
    # A has a custom food named "Overnight oats" (tests.helpers.seed_food_rows).
    Endpoint(
        "GET",
        "/api/foods/search",
        requires_session=True,
        params=lambda c: {"q": "Overnight oats"},
    ),
    # A has a saved meal "Morning jar" (tests.helpers.seed_food_rows).
    Endpoint(
        "DELETE",
        "/api/logs/groups/{log_group_id}",
        requires_session=True,
        path_params=lambda c: {"log_group_id": c.a_group_ids[0]},
    ),
    Endpoint("GET", "/api/meals", requires_session=True, params=lambda c: {"archived": "false"}),
    Endpoint(
        "POST",
        "/api/meals",
        requires_session=True,
        body=lambda c: {"name": "B meal", "items": [{"food_id": c.a_food_ids[0], "grams": 100}]},
    ),
    Endpoint(
        "POST",
        "/api/meals/from-logs",
        requires_session=True,
        body=lambda c: {"name": "B meal", "log_ids": c.a_log_ids},
    ),
    Endpoint(
        "GET",
        "/api/meals/{meal_id}",
        requires_session=True,
        path_params=lambda c: {"meal_id": c.a_meal_ids[0]},
    ),
    Endpoint(
        "PATCH",
        "/api/meals/{meal_id}",
        requires_session=True,
        body=lambda c: {"name": "Changed by B", "archived": True},
        path_params=lambda c: {"meal_id": c.a_meal_ids[0]},
    ),
    Endpoint(
        "DELETE",
        "/api/meals/{meal_id}",
        requires_session=True,
        path_params=lambda c: {"meal_id": c.a_meal_ids[0]},
    ),
    Endpoint(
        "POST",
        "/api/meals/{meal_id}/log",
        requires_session=True,
        body=lambda c: {"eaten_at": "2026-10-17T12:00:00Z"},
        path_params=lambda c: {"meal_id": c.a_meal_ids[0]},
    ),
    # A has a staple "Overnight oats", 1 jar (tests.helpers.seed_food_rows).
    Endpoint("GET", "/api/staples", requires_session=True),
    Endpoint(
        "POST",
        "/api/staples",
        requires_session=True,
        body=lambda c: {"food_id": c.a_food_ids[0]},
    ),
    Endpoint(
        "POST",
        "/api/staples",
        requires_session=True,
        body=lambda c: {"saved_meal_id": c.a_meal_ids[0]},
    ),
    Endpoint(
        "PUT", "/api/staples/order", requires_session=True, body=lambda c: {"ids": c.a_staple_ids}
    ),
    Endpoint("GET", "/api/staples/prompt", requires_session=True),
    Endpoint("POST", "/api/staples/prompt", requires_session=True, body=lambda c: {"accept": True}),
    Endpoint(
        "PATCH",
        "/api/staples/{staple_id}",
        requires_session=True,
        body=lambda c: {"is_available": False, "max_units": 2},
        path_params=lambda c: {"staple_id": c.a_staple_ids[0]},
    ),
    Endpoint(
        "DELETE",
        "/api/staples/{staple_id}",
        requires_session=True,
        path_params=lambda c: {"staple_id": c.a_staple_ids[0]},
    ),
    # Suggestions use only B's own staples; A's staple ids are unknown to B (404 when locked).
    Endpoint(
        "POST",
        "/api/suggestions",
        requires_session=True,
        body=lambda c: {
            "excluded_staple_ids": c.a_staple_ids,
            "exclude_sets": [c.a_staple_ids],
            "locked": [{"staple_id": c.a_staple_ids[0]}],
        },
    ),
    Endpoint(
        "POST",
        "/api/suggestions/log",
        requires_session=True,
        body=lambda c: {
            "eaten_at": "2026-10-17T12:00:00Z",
            "items": [{"staple_id": c.a_staple_ids[0], "units": 1}],
        },
    ),
    Endpoint(
        "POST",
        "/api/suggestions/save-meal",
        requires_session=True,
        body=lambda c: {"name": "B plate", "items": [{"staple_id": c.a_staple_ids[0], "units": 1}]},
    ),
    # A has a never pair between its two staples (tests.helpers.seed_food_rows).
    Endpoint("GET", "/api/pair-preferences", requires_session=True),
    Endpoint(
        "POST",
        "/api/pair-preferences",
        requires_session=True,
        body=lambda c: {"staple_ids": c.a_staple_ids[:2]},
    ),
    Endpoint(
        "DELETE",
        "/api/pair-preferences/{pair_id}",
        requires_session=True,
        path_params=lambda c: {"pair_id": c.a_pair_ids[0]},
    ),
    # A has the presets and a waist reading (tests.helpers.seed_food_rows).
    Endpoint("GET", "/api/measurement-types", requires_session=True),
    Endpoint(
        "POST",
        "/api/measurement-types",
        requires_session=True,
        body=lambda c: {"name": "B metric", "unit": "cm"},
    ),
    Endpoint(
        "PUT",
        "/api/measurement-types/order",
        requires_session=True,
        body=lambda c: {"ids": c.a_measurement_type_ids},
    ),
    Endpoint(
        "PATCH",
        "/api/measurement-types/{type_id}",
        requires_session=True,
        body=lambda c: {"name": "Renamed by B", "archived": True},
        path_params=lambda c: {"type_id": c.a_measurement_type_ids[0]},
    ),
    Endpoint(
        "GET",
        "/api/measurements",
        requires_session=True,
        params=lambda c: {"date_from": "2026-10-01"},
    ),
    Endpoint(
        "POST",
        "/api/measurements",
        requires_session=True,
        body=lambda c: {"items": [{"type_id": c.a_measurement_type_ids[0], "value": 80}]},
    ),
    Endpoint(
        "PATCH",
        "/api/measurements/{entry_id}",
        requires_session=True,
        body=lambda c: {"value": 70},
        path_params=lambda c: {"entry_id": c.a_measurement_ids[0]},
    ),
    Endpoint(
        "DELETE",
        "/api/measurements/{entry_id}",
        requires_session=True,
        path_params=lambda c: {"entry_id": c.a_measurement_ids[0]},
    ),
    # A has a cut from 1 to 28 Sep 2026 (tests.helpers.seed_food_rows). B's phases on the
    # same dates are fine: phases only clash with the owner's own.
    Endpoint("GET", "/api/phases", requires_session=True),
    Endpoint(
        "POST",
        "/api/phases",
        requires_session=True,
        body=lambda c: {"kind": "cut", "start_date": "2026-09-01", "end_date": "2026-09-28"},
    ),
    Endpoint(
        "PATCH",
        "/api/phases/{phase_id}",
        requires_session=True,
        body=lambda c: {"note": "Changed by B"},
        path_params=lambda c: {"phase_id": c.a_phase_ids[0]},
    ),
    Endpoint(
        "DELETE",
        "/api/phases/{phase_id}",
        requires_session=True,
        path_params=lambda c: {"phase_id": c.a_phase_ids[0]},
    ),
    # JSON, so the harness can search the file for A's ids, names and email. B gets only its own.
    Endpoint(
        "POST",
        "/api/export",
        requires_session=True,
        body=lambda c: {"format": "json"},
    ),
    # B imports into its own (empty) account; nothing reaches A.
    Endpoint(
        "POST",
        "/api/import",
        requires_session=True,
        body=lambda c: {"format": "trim-export", "version": 1, "datasets": {}},
    ),
    # A tracks water and has one 250 ml add on 17 Oct (tests.helpers.seed_food_rows).
    Endpoint("GET", "/api/me/settings", requires_session=True),
    Endpoint(
        "PATCH",
        "/api/me/settings",
        requires_session=True,
        body=lambda c: {"track_water": False, "water_unit": "fl_oz"},
    ),
    Endpoint(
        "GET", "/api/water", requires_session=True, params=lambda c: {"date_from": "2026-10-17"}
    ),
    Endpoint(
        "GET",
        "/api/water/days",
        requires_session=True,
        params=lambda c: {"date_from": "2026-10-01", "date_to": "2026-10-31"},
    ),
    Endpoint("POST", "/api/water", requires_session=True, body=lambda c: {"ml": 250}),
    Endpoint(
        "DELETE",
        "/api/water/{water_id}",
        requires_session=True,
        path_params=lambda c: {"water_id": c.a_water_ids[0]},
    ),
    # A has a stored streak (tests.helpers.seed_food_rows); B gets only its own.
    Endpoint("GET", "/api/streaks", requires_session=True, params=lambda c: {"month": "2026-10"}),
    # A has a weekly goal and a badge (tests.helpers.seed_food_rows).
    Endpoint("GET", "/api/goals", requires_session=True),
    Endpoint("GET", "/api/badges", requires_session=True),
    # A has a push subscription (tests.helpers.seed_food_rows); B may only add or remove its own.
    Endpoint("GET", "/api/push/config", requires_session=True),
    Endpoint(
        "POST",
        "/api/push/subscriptions",
        requires_session=True,
        body=lambda c: {
            "endpoint": "https://push.example.com/b-browser",
            "keys": {"p256dh": "k", "auth": "a"},
        },
    ),
    Endpoint(
        "DELETE",
        "/api/push/subscriptions",
        requires_session=True,
        params=lambda c: {"endpoint": "https://push.example.com/a-browser"},
    ),
    # The hourly job takes no session; without the job token it is refused.
    Endpoint("POST", "/api/internal/jobs/hourly", requires_session=False),
]
