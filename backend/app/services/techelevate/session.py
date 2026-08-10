"""
Shared per-user TechElevate JWT cache.

Populated by techelevate_routes.py's POST /connect (id_token exchange) and read by both
the routes themselves and techelevate_local_service.py's flywheel functions (PMO chat tools,
bench-upskill, team-readiness, manager routes) — none of which have a live HTTP request to
carry a bearer token, so this in-memory cache (keyed by email, ~55 min TTL) is what lets
server-side callers reuse the session a user's browser already established.
"""

import time

_te_session: dict[str, tuple[str, float]] = {}

_TTL_SECONDS = 55 * 60


def cache_token(email: str, token: str, *, ttl_seconds: int = _TTL_SECONDS) -> None:
    _te_session[email] = (token, time.time() + ttl_seconds)


def get_cached_token(email: str) -> str | None:
    cached = _te_session.get(email)
    if cached and cached[1] > time.time():
        return cached[0]
    return None
