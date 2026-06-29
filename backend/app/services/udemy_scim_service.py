"""
Udemy Business SCIM 2.0 client — real provisioning / deprovisioning / groups / licenses.

This is the WRITE side of the Udemy integration and is intentionally separate from
``udemy_business_service.py`` (read-only catalog + reporting, HTTP Basic auth). SCIM is
a *different registered Udemy app* with its own Bearer token and base URL, taken from
Udemy admin → Settings → Provisioning. The IdP that normally drives this is Azure AD
(Microsoft Entra), but Udemy also supports Custom / OneLogin / Okta — all SCIM 2.0, so
this same client speaks to any of them as a generic SCIM service-provider call.

Capabilities (mirrors Udemy's SCIM feature list):
  • provision a user (POST /Users) and assign access
  • deprovision / deactivate a user (PATCH active=false)
  • reactivate a previously-deprovisioned user (PATCH active=true)
  • update user details (name, email)
  • create / rename / delete groups
  • manage group membership (add/remove, move between groups)
  • add users to License Pools / assign Udemy Business Pro licenses

Safety: every call goes through ``_request`` which returns a uniform
``{ok, status, data|error}`` dict and NEVER raises into the caller. When the token/URL
aren't configured, ``configured()`` is False and every operation short-circuits to
``{"ok": False, "error": "not_configured"}`` — so the feature is dormant (not broken)
until the SCIM app is wired. License-pool / Pro-license operations follow Udemy's
convention of modelling a pool as a SCIM Group; the pool id/name is the group, so they
reuse the group-membership path (documented at each function).

SCIM refs: RFC 7643 (schema), RFC 7644 (protocol / PatchOp).
"""

from __future__ import annotations

import functools
import logging
from typing import Optional

import httpx

from app.config import settings

log = logging.getLogger("aurora-logger")


def _not_configured() -> dict:
    return {"ok": False, "error": "not_configured",
            "message": "Udemy SCIM isn't connected. Set UDEMY_SCIM_BASE_URL and UDEMY_SCIM_TOKEN."}


def _requires_scim(fn):
    """Short-circuit a public op to not_configured when the SCIM app isn't wired, so
    callers get an honest reason instead of a misleading downstream not_found."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        if not configured():
            return _not_configured()
        return fn(*args, **kwargs)
    return wrapper

_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group"
_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
_SCIM_CONTENT_TYPE = "application/scim+json"


# ── Wiring ───────────────────────────────────────────────────────────────────

def configured() -> bool:
    """True only when the SCIM app is fully wired (enabled + base URL + token)."""
    return bool(settings.UDEMY_SCIM_ENABLED and settings.UDEMY_SCIM_BASE_URL and settings.UDEMY_SCIM_TOKEN)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.UDEMY_SCIM_TOKEN}",
        "Content-Type": _SCIM_CONTENT_TYPE,
        "Accept": _SCIM_CONTENT_TYPE,
    }


def _url(path: str) -> str:
    return f"{settings.UDEMY_SCIM_BASE_URL}/{path.lstrip('/')}"


def _request(method: str, path: str, *, params: dict | None = None, json: dict | None = None) -> dict:
    """One SCIM call → uniform result. Never raises; logs + returns {ok, status, ...}."""
    if not configured():
        return {"ok": False, "error": "not_configured",
                "message": "Udemy SCIM isn't connected. Set UDEMY_SCIM_BASE_URL and UDEMY_SCIM_TOKEN."}
    try:
        with httpx.Client(timeout=30) as c:
            resp = c.request(method, _url(path), headers=_headers(), params=params, json=json)
    except Exception as exc:  # network / DNS / timeout
        log.warning("[udemy-scim] %s %s transport error: %s", method, path, exc)
        return {"ok": False, "error": "transport", "message": str(exc)}

    if resp.status_code in (401, 403):
        return {"ok": False, "status": resp.status_code, "error": "unauthorized",
                "message": "SCIM token rejected or lacks permission for this operation."}
    if resp.status_code == 404:
        return {"ok": False, "status": 404, "error": "not_found"}
    if not resp.is_success:
        log.warning("[udemy-scim] %s %s → %s %s", method, path, resp.status_code, resp.text[:300])
        return {"ok": False, "status": resp.status_code, "error": "scim_error",
                "message": resp.text[:300]}
    # 204 No Content (common for DELETE / some PATCH) has no body.
    if resp.status_code == 204 or not resp.content:
        return {"ok": True, "status": resp.status_code, "data": {}}
    try:
        return {"ok": True, "status": resp.status_code, "data": resp.json()}
    except Exception:
        return {"ok": True, "status": resp.status_code, "data": {}}


def _patch_body(*operations: dict) -> dict:
    return {"schemas": [_PATCH_SCHEMA], "Operations": list(operations)}


# ── Users ────────────────────────────────────────────────────────────────────

def find_user_by_email(email: str) -> Optional[dict]:
    """Resolve a SCIM user resource by email (userName). Returns the resource or None."""
    email = (email or "").strip()
    if not email:
        return None
    # SCIM filter syntax (RFC 7644 §3.4.2.2). Quote the value.
    res = _request("GET", "/Users", params={"filter": f'userName eq "{email}"'})
    if not res.get("ok"):
        return None
    resources = (res.get("data") or {}).get("Resources") or []
    return resources[0] if resources else None


def get_user(scim_id: str) -> dict:
    """GET /Users/{id}."""
    return _request("GET", f"/Users/{scim_id}")


@_requires_scim
def provision_user(email: str, *, given_name: str = "", family_name: str = "", active: bool = True) -> dict:
    """Provision (create) a user and grant access — POST /Users. Idempotent-ish: if the
    user already exists we return that resource instead of erroring."""
    email = (email or "").strip()
    if not email:
        return {"ok": False, "error": "invalid", "message": "email is required"}
    existing = find_user_by_email(email)
    if existing:
        return {"ok": True, "status": 200, "data": existing, "already": True}
    body = {
        "schemas": [_USER_SCHEMA],
        "userName": email,
        "name": {"givenName": given_name, "familyName": family_name},
        "emails": [{"value": email, "primary": True}],
        "active": active,
    }
    return _request("POST", "/Users", json=body)


@_requires_scim
def _set_active(email: str, active: bool) -> dict:
    user = find_user_by_email(email)
    if not user:
        return {"ok": False, "error": "not_found", "message": f"No Udemy user for {email}."}
    return _request("PATCH", f"/Users/{user['id']}",
                    json=_patch_body({"op": "replace", "path": "active", "value": active}))


def deactivate_user(email: str) -> dict:
    """Deprovision: PATCH active=false → frees the seat. The seat-reclaim action."""
    return _set_active(email, False)


def reactivate_user(email: str) -> dict:
    """Reactivate a previously-deprovisioned user (only if PII not anonymized)."""
    return _set_active(email, True)


@_requires_scim
def update_user(email: str, *, new_email: Optional[str] = None,
                given_name: Optional[str] = None, family_name: Optional[str] = None) -> dict:
    """Update user details (name and/or email) — PATCH /Users/{id}."""
    user = find_user_by_email(email)
    if not user:
        return {"ok": False, "error": "not_found", "message": f"No Udemy user for {email}."}
    ops = []
    if new_email:
        ops.append({"op": "replace", "path": "userName", "value": new_email})
        ops.append({"op": "replace", "path": "emails[primary eq true].value", "value": new_email})
    if given_name is not None:
        ops.append({"op": "replace", "path": "name.givenName", "value": given_name})
    if family_name is not None:
        ops.append({"op": "replace", "path": "name.familyName", "value": family_name})
    if not ops:
        return {"ok": False, "error": "invalid", "message": "Nothing to update."}
    return _request("PATCH", f"/Users/{user['id']}", json=_patch_body(*ops))


# ── Groups ───────────────────────────────────────────────────────────────────

def list_groups(*, count: int = 100, start_index: int = 1) -> dict:
    """GET /Groups (paginated per SCIM: startIndex is 1-based)."""
    return _request("GET", "/Groups", params={"count": count, "startIndex": start_index})


def find_group_by_name(display_name: str) -> Optional[dict]:
    name = (display_name or "").strip()
    if not name:
        return None
    res = _request("GET", "/Groups", params={"filter": f'displayName eq "{name}"'})
    if not res.get("ok"):
        return None
    resources = (res.get("data") or {}).get("Resources") or []
    return resources[0] if resources else None


@_requires_scim
def create_group(display_name: str, member_emails: Optional[list[str]] = None) -> dict:
    """Create a group (POST /Groups), optionally seeding members by email."""
    members = []
    for em in member_emails or []:
        u = find_user_by_email(em)
        if u:
            members.append({"value": u["id"]})
    body = {"schemas": [_GROUP_SCHEMA], "displayName": display_name, "members": members}
    return _request("POST", "/Groups", json=body)


def rename_group(group_id: str, new_name: str) -> dict:
    """Edit a group's name — PATCH /Groups/{id}."""
    return _request("PATCH", f"/Groups/{group_id}",
                    json=_patch_body({"op": "replace", "path": "displayName", "value": new_name}))


def delete_group(group_id: str) -> dict:
    """Remove a group — DELETE /Groups/{id}."""
    return _request("DELETE", f"/Groups/{group_id}")


@_requires_scim
def _group_member_op(group_id: str, email: str, op: str) -> dict:
    user = find_user_by_email(email)
    if not user:
        return {"ok": False, "error": "not_found", "message": f"No Udemy user for {email}."}
    if op == "add":
        operation = {"op": "add", "path": "members", "value": [{"value": user["id"]}]}
    else:  # remove a specific member (RFC 7644 path filter form)
        operation = {"op": "remove", "path": f'members[value eq "{user["id"]}"]'}
    return _request("PATCH", f"/Groups/{group_id}", json=_patch_body(operation))


def add_member_to_group(group_id: str, email: str) -> dict:
    """Add a user to a group (manage group membership)."""
    return _group_member_op(group_id, email, "add")


def remove_member_from_group(group_id: str, email: str) -> dict:
    """Remove a user from a group (manage group membership)."""
    return _group_member_op(group_id, email, "remove")


@_requires_scim
def move_user_between_groups(email: str, from_group_id: str, to_group_id: str) -> dict:
    """Move a user between groups (changing groups) — remove then add."""
    removed = remove_member_from_group(from_group_id, email)
    if not removed.get("ok") and removed.get("error") != "not_found":
        return removed
    return add_member_to_group(to_group_id, email)


# ── License pools / Pro licenses ───────────────────────────────────────────────
# Udemy models a *License Pool* as a SCIM Group: adding a user to the pool's group
# grants that pool's license; a dedicated Pro-license pool group grants Udemy Business
# Pro. So both reuse the group-membership path. The pool/Pro group id comes from
# list_groups() (or Udemy admin). If your tenant exposes pools via a custom SCIM
# extension instead, swap the group id for the extension attribute here.

def add_user_to_license_pool(email: str, pool_group_id: str) -> dict:
    """Add a user to a License Pool (modelled as a SCIM group)."""
    return add_member_to_group(pool_group_id, email)


def assign_pro_license(email: str, pro_pool_group_id: str) -> dict:
    """Assign a Udemy Business Pro license by adding the user to the Pro license-pool group."""
    return add_member_to_group(pro_pool_group_id, email)


# ── Status ─────────────────────────────────────────────────────────────────────

def status() -> dict:
    """Connectivity probe for the UI. When configured, does a cheap read-only call so
    the dashboard can show green/red without exposing the token."""
    if not configured():
        return {"configured": False, "reachable": False}
    probe = _request("GET", "/Users", params={"count": 1, "startIndex": 1})
    return {
        "configured": True,
        "reachable": bool(probe.get("ok")),
        "error": None if probe.get("ok") else probe.get("error"),
    }
