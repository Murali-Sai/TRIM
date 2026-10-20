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
    # A has a custom food named "Overnight oats" (tests.helpers.seed_food_rows).
    Endpoint(
        "GET",
        "/api/foods/search",
        requires_session=True,
        params=lambda c: {"q": "Overnight oats"},
    ),
]
