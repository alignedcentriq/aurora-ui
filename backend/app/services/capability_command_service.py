"""
Leadership Capability Command — org-wide, read-only workforce intelligence.

Four deterministic-SQL panels for leadership (NO LLM, no per-row guesswork):

  1. Capability Heat Map      — skill × function holder counts (where is capability
                                strong / thin / concentrated).
  2. Pipeline Readiness Score — % of forward-planned demand staffable from current
                                free capacity, per function and overall.
  3. Single-Point-of-Failure  — skills held by ≤2 people (delivery + retention risk).
  4. Bench Cost & Opportunity — monthly cost of idle bench (ROI cost model) + the
                                training that would make the most people billable.

Capacity comes from allocation_snapshot_service (latest snapshot per person); skills
from EmployeeSkill (joined by employee name); cost from the shared ROI assumptions.
"""

import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import TeTraining
from app.services import allocation_snapshot_service as snap
from app.services import workforce_directory as wd


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


# ── 1. Capability Heat Map ────────────────────────────────────────────────────

def capability_heatmap(db: Session, load_map: dict, skills_map: dict, top_skills: int = 12) -> dict:
    """skill × function → distinct holder count. Marks thin (≤2) cells as risk.

    Skills are name-keyed (Zoho-sourced); function comes from the allocation snapshot."""
    cells: dict[tuple[str, str], set[str]] = {}
    skill_totals: dict[str, int] = {}
    skill_display: dict[str, str] = {}
    functions: set[str] = set()
    for name, v in load_map.items():
        fn = v.get("function") or "Unassigned"
        functions.add(fn)
        for sk in skills_map.get(name, set()):
            key = _norm(sk)
            skill_display.setdefault(key, sk)
            cells.setdefault((key, fn), set()).add(name)
            skill_totals[key] = skill_totals.get(key, 0) + 1

    top = sorted(skill_totals.items(), key=lambda kv: kv[1], reverse=True)[:top_skills]
    skill_keys = [s for s, _ in top]
    fn_list = sorted(functions)
    matrix = []
    for key in skill_keys:
        row = {"skill": skill_display.get(key, key), "total": skill_totals[key], "cells": []}
        for fn in fn_list:
            cnt = len(cells.get((key, fn), set()))
            row["cells"].append({"function": fn, "count": cnt, "thin": 0 < cnt <= 2})
        matrix.append(row)
    return {"functions": fn_list, "skills": [skill_display.get(k, k) for k in skill_keys],
            "matrix": matrix}


# ── 2. Pipeline Readiness Score ───────────────────────────────────────────────

def pipeline_readiness(db: Session, load_map: dict, as_of: datetime.date) -> dict:
    """Per-function: forward-planned demand (next snapshot headcount) vs current free
    supply (people with ≥ deployable free capacity). Readiness = supply/demand."""
    latest = snap.latest_snapshot_date(db, as_of)
    nxt = snap.next_snapshot_date(db, latest) if latest else None

    # Free supply per function, now.
    supply: dict[str, int] = {}
    for v in load_map.values():
        if v["free"] >= snap.DEPLOYABLE_FREE_PCT and v.get("active"):
            fn = v.get("function") or "Unassigned"
            supply[fn] = supply.get(fn, 0) + 1

    # Demand per function = distinct planned headcount in the next snapshot.
    demand: dict[str, int] = {}
    if nxt:
        from app.models import EmployeeAllocation
        rows = (db.query(EmployeeAllocation.function,
                         func.count(func.distinct(EmployeeAllocation.employee_name)))
                .filter(EmployeeAllocation.allocation_date == nxt)
                .group_by(EmployeeAllocation.function).all())
        for fn, cnt in rows:
            demand[fn or "Unassigned"] = int(cnt or 0)

    rows = []
    total_demand = total_covered = 0
    for fn in sorted(set(demand) | set(supply)):
        d = demand.get(fn, 0)
        sup = supply.get(fn, 0)
        readiness = round(min(100.0, (sup / d * 100.0)), 0) if d else 100.0
        gap = max(0, d - sup)
        total_demand += d
        total_covered += min(sup, d)
        rows.append({"function": fn, "planned_demand": d, "free_supply": sup,
                     "gap": gap, "readiness_pct": readiness})
    rows.sort(key=lambda r: r["readiness_pct"])
    overall = round(total_covered / total_demand * 100.0, 0) if total_demand else 100.0
    return {"overall_readiness_pct": overall, "next_snapshot": nxt.isoformat() if nxt else None,
            "rows": rows}


# ── 3. Single-Point-of-Failure ────────────────────────────────────────────────

def single_point_of_failure(db: Session, skills_map: dict, max_holders: int = 2) -> dict:
    """Skills held by ≤ max_holders distinct people — delivery + retention risk.

    Computed over the Zoho-sourced, name-keyed skills map (not the sparse
    EmployeeSkill table), so it reflects the real roster."""
    holders: dict[str, set[str]] = {}
    display: dict[str, str] = {}
    for name, skills in skills_map.items():
        for sk in skills:
            key = _norm(sk)
            display.setdefault(key, sk)
            holders.setdefault(key, set()).add(name)
    out = []
    for key, people in holders.items():
        n = len(people)
        if 0 < n <= max_holders:
            out.append({"skill": display.get(key, key), "holder_count": n,
                        "holders": [p.title() for p in sorted(people)][:5]})
    out.sort(key=lambda r: r["holder_count"])
    return {"count": len(out), "rows": out}


# ── 4. Bench Cost & Opportunity ───────────────────────────────────────────────

def bench_cost(db: Session, load_map: dict, skills_map: dict) -> dict:
    """Monthly cost of idle bench capacity + the courses that would unlock the most
    billability (most bench people who lack the skill it teaches)."""
    from app.services.analytics_service import get_assumptions
    a = get_assumptions(db)
    hourly = float(a.get("hourly_cost", 0) or 0)
    currency = a.get("currency", "INR")

    bench = [(n, v) for n, v in load_map.items() if v["is_bench"] and v.get("active")]
    # Idle hours/month ≈ free% × 160 billable hours.
    idle_hours = sum((v["free"] / 100.0) * 160.0 for _, v in bench)
    monthly_cost = round(idle_hours * hourly, 0)

    # Opportunity: which TE course would help the most bench people (those lacking its skills).
    course_rows = []
    for t in db.query(TeTraining).all():
        tags = {(s or "").strip().lower() for s in (t.skill_tags or [])}
        if not tags:
            continue
        helps = 0
        for n, _ in bench:
            have = {_norm(s) for s in skills_map.get(n, set())}
            if tags - have:  # course teaches at least one skill they lack
                helps += 1
        if helps:
            course_rows.append({"training": t.title, "would_help": helps,
                                "skills": list(t.skill_tags or [])[:4]})
    course_rows.sort(key=lambda r: r["would_help"], reverse=True)
    return {"currency": currency, "bench_headcount": len(bench),
            "idle_hours_per_month": round(idle_hours, 0), "monthly_bench_cost": monthly_cost,
            "opportunities": course_rows[:5]}


# ── Aggregate overview ────────────────────────────────────────────────────────

def overview(db: Session, today: Optional[datetime.date] = None) -> dict:
    today = today or datetime.date.today()
    load_map = snap.current_load_map(db, as_of=today)
    # One Zoho-sourced skills pull for everyone in the current snapshot.
    skills_map = wd.skills_by_name(db, set(load_map.keys()))
    return {
        "ok": True,
        "generated_on": today.isoformat(),
        "headcount": len(load_map),
        "heatmap": capability_heatmap(db, load_map, skills_map),
        "pipeline_readiness": pipeline_readiness(db, load_map, today),
        "spof": single_point_of_failure(db, skills_map),
        "bench_cost": bench_cost(db, load_map, skills_map),
    }
