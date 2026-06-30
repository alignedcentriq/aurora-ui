"""
Udemy Business SCIM mock service.

Drop-in replacement for udemy_scim_service when real SCIM credentials are not
yet confirmed working. Maintains mutable in-memory state (resets on backend
restart) so every operation — provision, deactivate, group CRUD, license-pool
assignment — behaves exactly as the real SCIM service would, just against
seeded fake data.

Activate by switching the import in udemy_routes.py (search for SCIM_MOCK).
"""

from __future__ import annotations

import threading
import uuid
from copy import deepcopy
from typing import Optional

_lock = threading.Lock()

_USER_SCHEMA  = "urn:ietf:params:scim:schemas:core:2.0:User"
_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group"
_LIST_SCHEMA  = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp"

_ORG_DOMAIN = "alignedautomation.com"


# ── Seed data ────────────────────────────────────────────────────────────────
# (uid, first, last, active, role)
_SEED_USERS = [
    ("u001", "Jordan",  "Blake",   True,  "student"),
    ("u002", "Morgan",  "Chase",   True,  "student"),
    ("u003", "Riley",   "Stone",   True,  "student"),
    ("u004", "Casey",   "Wren",    True,  "student"),
    ("u005", "Skyler",  "Knox",    True,  "group_admin"),
    ("u006", "Avery",   "Hart",    True,  "student"),
    ("u007", "Quinn",   "Mercer",  True,  "student"),
    ("u008", "Taylor",  "Reed",    False, "student"),   # deactivated
    ("u009", "Drew",    "Sutton",  True,  "student"),
    ("u010", "Alex",    "Vance",   True,  "group_admin"),
    ("u011", "Sam",     "Wilde",   True,  "student"),
    ("u012", "Reese",   "Ford",    True,  "student"),
    ("u013", "Logan",   "Perry",   True,  "student"),
    ("u014", "Parker",  "Mills",   False, "student"),   # deactivated
    ("u015", "Devon",   "Cruz",    True,  "student"),
    ("u016", "Phoenix", "West",    True,  "student"),
    ("u017", "Sage",    "Bright",  True,  "student"),
    ("u018", "Lane",    "Frost",   True,  "student"),
    ("u019", "Blair",   "Cole",    True,  "student"),
    ("u020", "Harper",  "Dunn",    True,  "admin"),
    ("u021", "Emery",   "Marsh",   True,  "student"),
    ("u022", "Finley",  "Drake",   True,  "student"),
    ("u023", "Rowan",   "Steele",  True,  "student"),
    ("u024", "Shay",    "Griffon", True,  "student"),
    ("u025", "Elliot",  "Archer",  True,  "group_admin"),
]

# (gid, displayName, member_uids)
_SEED_GROUPS = [
    ("g001", "Engineering",        ["u001", "u002", "u003", "u009", "u016", "u022"]),
    ("g002", "Marketing",          ["u004", "u006", "u011", "u019", "u024"]),
    ("g003", "Data & Analytics",   ["u007", "u010", "u012", "u017", "u023"]),
    ("g004", "Design",             ["u013", "u015", "u018", "u021"]),
    ("g005", "Leadership",         ["u005", "u010", "u020", "u025"]),
    ("g006", "Pro License Pool",   ["u001", "u005", "u007", "u010", "u020", "u025"]),
]


def _email(first: str, last: str) -> str:
    return f"{first.lower()}.{last.lower()}@{_ORG_DOMAIN}"


def _build_user(uid: str, first: str, last: str, active: bool, role: str) -> dict:
    em = _email(first, last)
    return {
        "id": uid,
        "schemas": [_USER_SCHEMA],
        "userName": em,
        "name": {"givenName": first, "familyName": last},
        "emails": [{"value": em, "primary": True}],
        "active": active,
        "meta": {"resourceType": "User"},
        "_role": role,
    }


def _build_group(gid: str, name: str, member_uids: list[str], users: dict) -> dict:
    return {
        "id": gid,
        "schemas": [_GROUP_SCHEMA],
        "displayName": name,
        "members": [
            {"value": uid, "display": users[uid]["userName"]}
            for uid in member_uids if uid in users
        ],
        "meta": {"resourceType": "Group"},
    }


# Mutable in-memory state
_users: dict[str, dict]  = {u[0]: _build_user(*u) for u in _SEED_USERS}
_groups: dict[str, dict] = {g[0]: _build_group(g[0], g[1], g[2], _users) for g in _SEED_GROUPS}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _list_response(resources: list) -> dict:
    return {
        "ok": True,
        "status": 200,
        "data": {
            "schemas": [_LIST_SCHEMA],
            "totalResults": len(resources),
            "startIndex": 1,
            "itemsPerPage": len(resources),
            "Resources": resources,
        },
    }


def _ok(data: dict = None, *, status: int = 200) -> dict:
    return {"ok": True, "status": status, "data": data or {}}


def _err(error: str, message: str = "", *, status: int = 400) -> dict:
    return {"ok": False, "status": status, "error": error, "message": message}


# ── Public API (mirrors udemy_scim_service exactly) ──────────────────────────

def configured() -> bool:
    return True


def status() -> dict:
    return {"configured": True, "reachable": True, "mock": True}


def find_user_by_email(email: str) -> Optional[dict]:
    email = (email or "").strip().lower()
    if not email:
        return None
    with _lock:
        for u in _users.values():
            if u["userName"].lower() == email:
                return deepcopy(u)
    return None


def get_user(scim_id: str) -> dict:
    with _lock:
        u = _users.get(scim_id)
    if not u:
        return _err("not_found", f"User {scim_id} not found.", status=404)
    return _ok(deepcopy(u))


def provision_user(email: str, *, given_name: str = "", family_name: str = "",
                   active: bool = True) -> dict:
    email = (email or "").strip().lower()
    if not email:
        return _err("invalid", "email is required")
    existing = find_user_by_email(email)
    if existing:
        return {"ok": True, "status": 200, "data": existing, "already": True}
    uid = "u" + uuid.uuid4().hex[:6]
    user = {
        "id": uid,
        "schemas": [_USER_SCHEMA],
        "userName": email,
        "name": {"givenName": given_name, "familyName": family_name},
        "emails": [{"value": email, "primary": True}],
        "active": active,
        "meta": {"resourceType": "User"},
        "_role": "student",
    }
    with _lock:
        _users[uid] = user
    return _ok(deepcopy(user), status=201)


def _set_active(email: str, active: bool) -> dict:
    user = find_user_by_email(email)
    if not user:
        return _err("not_found", f"No mock user found for {email}.", status=404)
    with _lock:
        _users[user["id"]]["active"] = active
    return _ok()


def deactivate_user(email: str) -> dict:
    return _set_active(email, False)


def reactivate_user(email: str) -> dict:
    return _set_active(email, True)


def update_user(email: str, *, new_email: Optional[str] = None,
                given_name: Optional[str] = None,
                family_name: Optional[str] = None) -> dict:
    user = find_user_by_email(email)
    if not user:
        return _err("not_found", f"No mock user found for {email}.", status=404)
    uid = user["id"]
    ops = []
    if new_email:
        ops.append("email")
    if given_name is not None:
        ops.append("givenName")
    if family_name is not None:
        ops.append("familyName")
    if not ops:
        return _err("invalid", "Nothing to update.")
    with _lock:
        if new_email:
            ne = new_email.strip().lower()
            _users[uid]["userName"] = ne
            _users[uid]["emails"] = [{"value": ne, "primary": True}]
        if given_name is not None:
            _users[uid]["name"]["givenName"] = given_name
        if family_name is not None:
            _users[uid]["name"]["familyName"] = family_name
    return _ok()


# ── Groups ───────────────────────────────────────────────────────────────────

def list_groups(*, count: int = 100, start_index: int = 1) -> dict:
    with _lock:
        all_groups = list(_groups.values())
    start = max(0, start_index - 1)
    page = all_groups[start: start + max(1, count)]
    return _list_response([deepcopy(g) for g in page])


def find_group_by_name(display_name: str) -> Optional[dict]:
    name = (display_name or "").strip().lower()
    with _lock:
        for g in _groups.values():
            if g["displayName"].lower() == name:
                return deepcopy(g)
    return None


def create_group(display_name: str, member_emails: Optional[list[str]] = None) -> dict:
    gid = "g" + uuid.uuid4().hex[:6]
    members = []
    for em in member_emails or []:
        u = find_user_by_email(em)
        if u:
            members.append({"value": u["id"], "display": u["userName"]})
    group = {
        "id": gid,
        "schemas": [_GROUP_SCHEMA],
        "displayName": display_name,
        "members": members,
        "meta": {"resourceType": "Group"},
    }
    with _lock:
        _groups[gid] = group
    return _ok(deepcopy(group), status=201)


def rename_group(group_id: str, new_name: str) -> dict:
    with _lock:
        if group_id not in _groups:
            return _err("not_found", f"Group {group_id} not found.", status=404)
        _groups[group_id]["displayName"] = new_name
    return _ok()


def delete_group(group_id: str) -> dict:
    with _lock:
        if group_id not in _groups:
            return _err("not_found", f"Group {group_id} not found.", status=404)
        del _groups[group_id]
    return _ok(status=204)


def _group_member_op(group_id: str, email: str, op: str) -> dict:
    user = find_user_by_email(email)
    if not user:
        return _err("not_found", f"No mock user found for {email}.", status=404)
    uid = user["id"]
    with _lock:
        if group_id not in _groups:
            return _err("not_found", f"Group {group_id} not found.", status=404)
        members = _groups[group_id]["members"]
        if op == "add":
            if not any(m["value"] == uid for m in members):
                members.append({"value": uid, "display": user["userName"]})
        else:
            _groups[group_id]["members"] = [m for m in members if m["value"] != uid]
    return _ok()


def add_member_to_group(group_id: str, email: str) -> dict:
    return _group_member_op(group_id, email, "add")


def remove_member_from_group(group_id: str, email: str) -> dict:
    return _group_member_op(group_id, email, "remove")


def move_user_between_groups(email: str, from_group_id: str, to_group_id: str) -> dict:
    removed = remove_member_from_group(from_group_id, email)
    if not removed.get("ok") and removed.get("error") != "not_found":
        return removed
    return add_member_to_group(to_group_id, email)


def add_user_to_license_pool(email: str, pool_group_id: str) -> dict:
    return add_member_to_group(pool_group_id, email)


def assign_pro_license(email: str, pro_pool_group_id: str) -> dict:
    return add_member_to_group(pro_pool_group_id, email)
