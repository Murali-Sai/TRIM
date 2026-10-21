"""Food pairing in suggestions (task 3.23, SPEC page 3, Food pairing). Pure rules; the router
reads the scores, the user's history and their never pairs.

- Context comes from the time chip: before 10:30 breakfast, to 15:00 lunch, to 17:30 snack,
  then dinner (the user can change it).
- Two staples score what their food groups score in that context in pairing_scores (0 for the
  same group or no data).
- Personal history overrides it: staples logged together in one time block 3 or more times in
  the last 180 days always count as a good pair, score at least +1, so a pair the generic data
  forbids is allowed for this user.
- A card says "Often eaten together at dinner" when every pair on it scores 0.5 or higher.
"""

from collections.abc import Iterable, Mapping
from datetime import time
from itertools import combinations

PERSONAL_TIMES = 3
HISTORY_DAYS = 180
PERSONAL_SCORE = 1.0
LABEL_AT = 0.5


def context_for(t: time) -> str:
    if t < time(10, 30):
        return "breakfast"
    if t < time(15, 0):
        return "lunch"
    if t < time(17, 30):
        return "snack"
    return "dinner"


def personal_pairs(blocks: Iterable[set[str]]) -> set[frozenset[str]]:
    """Pairs of staples that share a time block at least PERSONAL_TIMES times."""
    seen: dict[frozenset[str], int] = {}
    for block in blocks:
        for a, b in combinations(sorted(block), 2):
            key = frozenset((a, b))
            seen[key] = seen.get(key, 0) + 1
    return {p for p, n in seen.items() if n >= PERSONAL_TIMES}


def pair_scores(
    groups: Mapping[str, str | None],
    generic: Mapping[tuple[str, str], float],
    personal: set[frozenset[str]],
) -> dict[frozenset[str], float]:
    """A score for every pair of staples (by id) that is not 0."""
    out: dict[frozenset[str], float] = {}
    for a, b in combinations(sorted(groups), 2):
        ga, gb = groups[a], groups[b]
        score = 0.0
        if ga and gb and ga != gb:
            lo, hi = sorted((ga, gb))
            score = generic.get((lo, hi), 0.0)
        if frozenset((a, b)) in personal:
            score = max(score, PERSONAL_SCORE)
        if score:
            out[frozenset((a, b))] = score
    return out


def label(
    staple_ids: list[str], scores: Mapping[frozenset[str], float], context: str
) -> str | None:
    if len(staple_ids) < 2:
        return None
    pairs = [frozenset(p) for p in combinations(staple_ids, 2)]
    if all(scores.get(p, 0.0) >= LABEL_AT for p in pairs):
        return f"Often eaten together at {context}"
    return None
