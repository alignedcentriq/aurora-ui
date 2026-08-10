"""
Shared HTTP helpers for proxying the real TechElevate API
(https://training.alignedautomation.com/api).

Every resource module (trainings.py, assignments.py, ...) is a thin pass-through: build
query/body, call one of the helpers below, return TechElevate's JSON as-is. TechElevate does
its own role enforcement (admin vs. instructor vs. employee) — these helpers don't duplicate
that; a 401/403 from TechElevate is surfaced as PermissionError so routes can turn it into a
"connect your Microsoft account" / "insufficient permissions" response.
"""

import logging

import httpx

from app.config import settings

log = logging.getLogger("aurora-logger")

_BASE = settings.TECHELEVATE_BASE_URL.rstrip("/")


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _check(resp: httpx.Response, label: str) -> dict | list | None:
    if resp.status_code in (401, 403):
        raise PermissionError(resp.text[:300] or "not_connected")
    if resp.status_code == 204:
        return None
    if not resp.is_success:
        log.warning("[techelevate] %s -> %s %s", label, resp.status_code, resp.text[:300])
        resp.raise_for_status()
    if not resp.content:
        return None
    return resp.json()


def get(token: str, path: str, *, params: dict | None = None, timeout: float = 20) -> dict | list | None:
    with httpx.Client(timeout=timeout) as c:
        resp = c.get(f"{_BASE}{path}", headers=_headers(token), params=params)
    return _check(resp, f"GET {path}")


def post(token: str, path: str, *, json: dict | None = None, params: dict | None = None,
         files: dict | None = None, data: dict | None = None, timeout: float = 30) -> dict | list | None:
    with httpx.Client(timeout=timeout) as c:
        resp = c.post(f"{_BASE}{path}", headers=_headers(token), json=json, params=params,
                      files=files, data=data)
    return _check(resp, f"POST {path}")


def put(token: str, path: str, *, json: dict | None = None, params: dict | None = None,
        timeout: float = 30) -> dict | list | None:
    with httpx.Client(timeout=timeout) as c:
        resp = c.put(f"{_BASE}{path}", headers=_headers(token), json=json, params=params)
    return _check(resp, f"PUT {path}")


def delete(token: str, path: str, *, params: dict | None = None, timeout: float = 20) -> dict | list | None:
    with httpx.Client(timeout=timeout) as c:
        resp = c.delete(f"{_BASE}{path}", headers=_headers(token), params=params)
    return _check(resp, f"DELETE {path}")
