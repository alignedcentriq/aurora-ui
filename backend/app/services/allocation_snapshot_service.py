"""
Allocation snapshot foundation — the single source of truth for "current" capacity.

The `employee_allocations` table is a feed of MONTHLY SNAPSHOTS (one row per
employee × project × month), spanning ~Jan-2024 through two months of forward-
planned ("pipeline") months. An employee averages ~21 rows. Naively summing
`efforts_percent` across every row therefore yields absurd loads (>1000%).

This module computes capacity from the LATEST snapshot per employee only, so load
is realistic (median ~100%). Every downstream feature — resource matching, the
skill-supply overlay, the bench/leadership/lead dashboards — reads from here so the
"what does current allocation mean?" question has exactly one deterministic answer.

DATA SEMANTICS (verified against the live data, 2026-06):
  • `allocation_date`  → the snapshot month (month-first dates). Rows dated AFTER
                         the latest month ≤ today are forward-planned PIPELINE.
  • `efforts_percent`  → percent of the person on that project that month (0..100+).
  • `status`           → "Active" / "Inactive" (employee active in that snapshot).
  • `project_status`   → "Ongoing" / "Completed" (the REAL completion signal —
                         note: `completion_status` is a "Done/Not Done" record flag,
                         NOT project completion, so we never key off it).
  • `billing`          → "Billable" / "Pipeline" / "For Allocation" (bench) / …
  • `expected_end_date`→ the employee's Last Working Day (ATTRITION) — intentionally
                         NOT used as a project rolloff date.

Pure SQL/SQLAlchemy aggregation. No LLM anywhere.
"""

import datetime
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import EmployeeAllocation

# A holder counts as "deployable" with at least this much free capacity.
DEPLOYABLE_FREE_PCT = 40.0
# Booked holders rolling off within this horizon are "freeing up soon".
ROLLOFF_HORIZON_DAYS = 45
# `billing` values that mark someone as on the bench.
_BENCH_BILLING = {"pipeline", "for allocation"}


def _today() -> datetime.date:
    return datetime.date.today()


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _project_completed(project_status: Optional[str]) -> bool:
    """True only when EVERY comma-part of project_status is 'completed'
    (handles 'Completed', 'Completed,Completed'; 'Ongoing,Completed' is NOT done)."""
    parts = {p.strip() for p in _norm(project_status).split(",") if p.strip()}
    return bool(parts) and parts <= {"completed"}


def _counts_as_load(a: EmployeeAllocation) -> bool:
    """Does this latest-snapshot row consume current capacity?"""
    if _norm(a.status) == "inactive":
        return False
    if _project_completed(a.project_status):
        return False
    return True


# ── snapshot dates ────────────────────────────────────────────────────────────

def latest_snapshot_date(db: Session, as_of: Optional[datetime.date] = None) -> Optional[datetime.date]:
    """The most recent snapshot month that is on/before `as_of` (default today)."""
    as_of = as_of or _today()
    return (db.query(func.max(EmployeeAllocation.allocation_date))
            .filter(EmployeeAllocation.allocation_date <= as_of)
            .scalar())


def next_snapshot_date(db: Session, after: datetime.date) -> Optional[datetime.date]:
    """The earliest snapshot month strictly after `after` (the next planned month)."""
    return (db.query(func.min(EmployeeAllocation.allocation_date))
            .filter(EmployeeAllocation.allocation_date > after)
            .scalar())


# ── latest-snapshot rows ──────────────────────────────────────────────────────

def _latest_rows(db: Session, names: Optional[Iterable[str]] = None,
                 as_of: Optional[datetime.date] = None) -> list[EmployeeAllocation]:
    """All allocation rows that fall in each employee's own latest snapshot ≤ as_of.

    Windowed via a correlated max(allocation_date) grouped by employee_name, so each
    person contributes only their most recent month's rows.
    """
    as_of = as_of or _today()
    sub = (db.query(
                EmployeeAllocation.employee_name.label("nm"),
                func.max(EmployeeAllocation.allocation_date).label("latest"))
           .filter(EmployeeAllocation.allocation_date <= as_of))
    if names is not None:
        lowered = [n.lower() for n in names if n]
        if not lowered:
            return []
        sub = sub.filter(func.lower(EmployeeAllocation.employee_name).in_(lowered))
    sub = sub.group_by(EmployeeAllocation.employee_name).subquery()

    return (db.query(EmployeeAllocation)
            .join(sub, (EmployeeAllocation.employee_name == sub.c.nm)
                       & (EmployeeAllocation.allocation_date == sub.c.latest))
            .all())


def current_load_map(db: Session, names: Optional[Iterable[str]] = None,
                     as_of: Optional[datetime.date] = None) -> dict[str, dict]:
    """name(lower) → {load, free, earliest_free, is_bench, active, projects[], rows[]}.

    `load` = Σ efforts_percent over the person's latest-snapshot rows that count as
    load; `free` = max(0, 100 − load). `earliest_free` is the soonest project rolloff
    derived from the next planned snapshot (see `rolloff_map`). A name with no rows is
    simply absent (callers treat absent as fully free, matching prior convention).
    """
    as_of = as_of or _today()
    rows = _latest_rows(db, names, as_of)

    by_name: dict[str, list[EmployeeAllocation]] = {}
    for a in rows:
        by_name.setdefault(_norm(a.employee_name), []).append(a)

    rolloff = rolloff_map(db, by_name.keys(), as_of) if by_name else {}

    out: dict[str, dict] = {}
    for key, allocs in by_name.items():
        load_rows = [a for a in allocs if _counts_as_load(a)]
        load = sum(float(a.efforts_percent or 0) for a in load_rows)
        billing = {_norm(a.billing) for a in allocs if a.billing}
        active = any(_norm(a.status) == "active" for a in allocs)
        free = max(0.0, 100.0 - load)
        is_bench = bool(billing & _BENCH_BILLING) or (active and free >= DEPLOYABLE_FREE_PCT
                                                      and not any(_norm(a.billing) == "billable"
                                                                  for a in load_rows))
        # Primary function = the function of the person's highest-effort current row.
        primary = max(load_rows, key=lambda a: float(a.efforts_percent or 0), default=None)
        out[key] = {
            "load": load,
            "free": free,
            "earliest_free": rolloff.get(key),
            "is_bench": is_bench,
            "active": active,
            "function": (primary.function if primary else None),
            "billable": any(_norm(a.billing) == "billable" for a in load_rows),
            "projects": sorted({a.project_name for a in load_rows if a.project_name}),
            "rows": load_rows,
        }
    return out


def availability_for(db: Session, name: Optional[str] = None,
                     employee_id: Optional[str] = None,
                     as_of: Optional[datetime.date] = None) -> dict:
    """Single-person availability. Tries name first, then employee_id code.
    Returns the same shape as a `current_load_map` entry; fully-free default if absent."""
    if name:
        m = current_load_map(db, {name}, as_of)
        entry = m.get(_norm(name))
        if entry:
            return entry
    if employee_id:
        rows = (db.query(EmployeeAllocation)
                .filter(func.lower(EmployeeAllocation.employee_id) == employee_id.lower())
                .filter(EmployeeAllocation.allocation_date <= (as_of or _today()))
                .all())
        if rows:
            latest = max(a.allocation_date for a in rows if a.allocation_date)
            load_rows = [a for a in rows if a.allocation_date == latest and _counts_as_load(a)]
            load = sum(float(a.efforts_percent or 0) for a in load_rows)
            return {
                "load": load, "free": max(0.0, 100.0 - load), "earliest_free": None,
                "is_bench": False, "active": any(_norm(a.status) == "active" for a in load_rows),
                "projects": sorted({a.project_name for a in load_rows if a.project_name}),
                "rows": load_rows,
            }
    return {"load": 0.0, "free": 100.0, "earliest_free": None, "is_bench": True,
            "active": False, "projects": [], "rows": []}


# ── rolloff (project ending) — distinct from attrition/LWD ────────────────────

def rolloff_map(db: Session, names: Iterable[str],
                as_of: Optional[datetime.date] = None) -> dict[str, datetime.date]:
    """name(lower) → soonest date a current project rolls off, derived from the NEXT
    planned snapshot: a project the person holds now but NOT in the next month is
    treated as ending at that next snapshot's date. Empty when there's no forward data."""
    as_of = as_of or _today()
    latest = latest_snapshot_date(db, as_of)
    if not latest:
        return {}
    nxt = next_snapshot_date(db, latest)
    if not nxt:
        return {}

    lowered = [n.lower() for n in names if n]
    if not lowered:
        return {}

    # Projects each person holds in the next planned snapshot.
    nxt_rows = (db.query(EmployeeAllocation)
                .filter(EmployeeAllocation.allocation_date == nxt)
                .filter(func.lower(EmployeeAllocation.employee_name).in_(lowered))
                .all())
    next_projects: dict[str, set] = {}
    for a in nxt_rows:
        next_projects.setdefault(_norm(a.employee_name), set()).add(_norm(a.project_name))

    # Current projects (latest snapshot) that vanish next month → rolling off at `nxt`.
    cur_rows = _latest_rows(db, lowered, as_of)
    out: dict[str, datetime.date] = {}
    for a in cur_rows:
        if not _counts_as_load(a):
            continue
        key = _norm(a.employee_name)
        held_next = next_projects.get(key, set())
        if _norm(a.project_name) not in held_next:
            out.setdefault(key, nxt)
    return out


# ── leadership involvement (Project Lead / Delivery Manager) ──────────────────

def leading_projects_map(db: Session, as_of: Optional[datetime.date] = None) -> dict[str, list[str]]:
    """name(lower) → sorted distinct project names where they're listed as Project Lead
    or Delivery Manager in the LATEST snapshot (scanning every row, not just their own).

    Directors/Leads/Delivery Managers are typically never staffed as a team member —
    they only ever show up in these two columns on their team's rows — so `current_load_map`
    (keyed off each person's OWN rows) can't see they're actively managing anything. A
    name with rows here but none in `current_load_map` must NOT be treated as fully free;
    callers should flag them as involved rather than reporting a free-capacity number, since
    there's no real effort-% for a managerial role to compute one from."""
    latest = latest_snapshot_date(db, as_of)
    if not latest:
        return {}
    rows = (db.query(EmployeeAllocation.project_lead, EmployeeAllocation.delivery_manager,
                     EmployeeAllocation.project_name)
            .filter(EmployeeAllocation.allocation_date == latest)
            .all())
    out: dict[str, set] = {}
    for lead, dm, proj in rows:
        if not proj:
            continue
        for person in (lead, dm):
            key = _norm(person)
            if key:
                out.setdefault(key, set()).add(proj)
    return {k: sorted(v) for k, v in out.items()}


# ── project roster (real projects, from live allocations) ─────────────────────

def list_active_projects(db: Session, as_of: Optional[datetime.date] = None) -> list[dict]:
    """One row per distinct project in the latest snapshot, active-only (excludes any
    project whose status resolves to fully 'Completed' via `_project_completed`)."""
    latest = latest_snapshot_date(db, as_of)
    if not latest:
        return []
    rows = (db.query(EmployeeAllocation)
            .filter(EmployeeAllocation.allocation_date == latest)
            .all())

    by_project: dict[str, list[EmployeeAllocation]] = {}
    for a in rows:
        if a.project_name:
            by_project.setdefault(a.project_name, []).append(a)

    out: list[dict] = []
    for name, members in by_project.items():
        status_parts = {_norm(m.project_status) for m in members if m.project_status}
        if _project_completed(",".join(status_parts)):
            continue
        lead = next((m.project_lead for m in members if m.project_lead), None)
        delivery_mgr = next((m.delivery_manager for m in members if m.delivery_manager), None)
        out.append({
            "name": name,
            "status": "Ongoing",
            "owner": lead or delivery_mgr,
            "team_size": len({m.employee_name for m in members if m.employee_name}),
        })
    out.sort(key=lambda p: p["name"].lower())
    return out


def project_detail(db: Session, name: str) -> Optional[dict]:
    """Full detail for one project: its real start date (earliest allocation on
    record, across all history — not just the latest snapshot) and the current
    member roster (latest snapshot only). None if the project has no allocation
    history at all (e.g. a manually-created project with no one staffed yet)."""
    rows = (db.query(EmployeeAllocation)
            .filter(EmployeeAllocation.project_name == name)
            .all())
    if not rows:
        return None

    dated = [r for r in rows if r.allocation_date]
    start_date = min((r.allocation_date for r in dated), default=None)
    # "Current" members means as-of-now, not as-of-the-forward-planned-pipeline —
    # exclude rows beyond today the same way latest_snapshot_date() does everywhere else.
    today = _today()
    current_dated = [d for d in (r.allocation_date for r in dated) if d <= today]
    latest = max(current_dated, default=None)

    current = [r for r in rows if r.allocation_date == latest]
    members = sorted({r.employee_name for r in current if r.employee_name})
    lead = next((r.project_lead for r in current if r.project_lead), None)
    dm = next((r.delivery_manager for r in current if r.delivery_manager), None)

    return {"name": name, "start_date": start_date, "owner": lead or dm, "members": members}


# ── pipeline demand (forward-planned months) ──────────────────────────────────

def pipeline_demand(db: Session, group_by: str = "project_name",
                    as_of: Optional[datetime.date] = None) -> list[dict]:
    """Aggregate forward-planned snapshots (allocation_date > latest month ≤ today)
    into demand rows grouped by one of project_name / function / client_master /
    billing. Returns [{key, planned_headcount, planned_effort, months:[...]}]."""
    as_of = as_of or _today()
    latest = latest_snapshot_date(db, as_of)
    if not latest:
        return []
    col = {
        "project_name": EmployeeAllocation.project_name,
        "function": EmployeeAllocation.function,
        "client_master": EmployeeAllocation.client_master,
        "billing": EmployeeAllocation.billing,
    }.get(group_by, EmployeeAllocation.project_name)

    rows = (db.query(
                col.label("key"),
                func.count(func.distinct(EmployeeAllocation.employee_name)).label("headcount"),
                func.sum(EmployeeAllocation.efforts_percent).label("effort"))
            .filter(EmployeeAllocation.allocation_date > latest)
            .group_by(col)
            .order_by(func.count(func.distinct(EmployeeAllocation.employee_name)).desc())
            .all())
    return [{"key": r.key, "planned_headcount": int(r.headcount or 0),
             "planned_effort": float(r.effort or 0)} for r in rows if r.key]
