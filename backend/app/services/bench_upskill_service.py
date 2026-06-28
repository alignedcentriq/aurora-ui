"""
Bench-to-Upskill engine — the closed loop the brainstorm called the core value.

    bench / rolling-off  →  skills they lack that keep others BILLABLE
                         →  an internal TechElevate course that teaches it
                         →  (manager approves)  →  assign  →  verified skill
                         →  staffable again

Everything here is deterministic SQL/Python — NO LLM. The "in-demand" signal is
computed entirely in-house: a skill's demand = how many people currently on a
BILLABLE project hold it (skills that keep people billable are the ones worth
putting bench time into). The allocation feed carries no skill column, so this
in-house proxy replaces any external market-demand call.

Reads:
  • capacity / bench   → allocation_snapshot_service (latest snapshot per person)
  • skills             → EmployeeSkill (verified-aware), joined by employee NAME
  • courses            → techelevate_local_service catalog (skill_tags)
Writes (only on explicit manager approval, via the route):
  • TeAssignment       → techelevate_local_service.assign_training
"""

import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Employee, EmployeeSkill, TeTraining
from app.services import allocation_snapshot_service as snap


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _billable_skill_demand(db: Session) -> dict[str, int]:
    """skill(lower) → # of people on a BILLABLE project (latest snapshot) who hold it.

    The deterministic, in-house 'what's worth learning' signal. Skills come from the
    Zoho-sourced workforce directory (not the sparse EmployeeSkill table)."""
    latest = snap.latest_snapshot_date(db)
    if latest is None:
        return {}
    from app.models import EmployeeAllocation
    billable_names = {
        _norm(r[0]) for r in db.query(EmployeeAllocation.employee_name)
        .filter(EmployeeAllocation.allocation_date == latest)
        .filter(func.lower(func.coalesce(EmployeeAllocation.billing, "")) == "billable")
        .all() if r[0]
    }
    if not billable_names:
        return {}
    from app.services import workforce_directory as wd
    skills_map = wd.skills_by_name(db, billable_names)
    demand: dict[str, int] = {}
    for skills in skills_map.values():
        for sk in skills:
            demand[_norm(sk)] = demand.get(_norm(sk), 0) + 1
    return demand


def _due_date(free_pct: float, today: datetime.date) -> datetime.date:
    """Time-aware deadline — more free capacity ⇒ a tighter, achievable deadline."""
    if free_pct >= 80:
        days = 21
    elif free_pct >= 40:
        days = 45
    else:
        days = 60
    return today + datetime.timedelta(days=days)


def suggestions(db: Session, limit: int = 25, today: Optional[datetime.date] = None) -> dict:
    """Ranked bench-to-upskill suggestions. Pure read; commits nothing.

    Returns {ok, generated_on, count, rows:[{employee, course, ...}], summary}."""
    today = today or datetime.date.today()
    load_map = snap.current_load_map(db, as_of=today)

    # Candidates: on the bench now, OR rolling off soon (capacity arriving).
    horizon = today + datetime.timedelta(days=snap.ROLLOFF_HORIZON_DAYS)
    candidates = []
    for name, v in load_map.items():
        rolling_off = bool(v["earliest_free"] and v["earliest_free"] <= horizon)
        if (v["is_bench"] and v["active"]) or rolling_off:
            candidates.append((name, v, rolling_off))
    if not candidates:
        return {"ok": True, "generated_on": today.isoformat(), "count": 0, "rows": [],
                "summary": {"bench": 0, "rolling_off": 0}}

    demand = _billable_skill_demand(db)
    trainings = db.query(TeTraining).all()

    # Workforce directory (Zoho-sourced skills + layered identity), name-keyed —
    # independent of the sparse employees table.
    from app.services import workforce_directory as wd
    cand_names = {name for name, _, _ in candidates}
    skills_map = wd.skills_by_name(db, cand_names)
    people = wd.people_by_name(db, cand_names)

    rows = []
    for name, v, rolling_off in candidates:
        person = people.get(name) or {}
        have = {_norm(s) for s in skills_map.get(name, set())}

        best = None
        for t in trainings:
            new_skills = [s for s in (t.skill_tags or []) if _norm(s) not in have]
            if not new_skills:
                continue
            score = max((demand.get(_norm(s), 0) for s in new_skills), default=0)
            if best is None or score > best["score"]:
                best = {"training": t, "new_skills": new_skills, "score": score}
        if not best:
            continue

        t = best["training"]
        rows.append({
            "employee_id": person.get("pk"),
            "employee_name": person.get("name") or name.title(),
            "employee_email": person.get("email"),
            "department": person.get("function") or v.get("function"),
            "free_pct": round(v["free"], 0),
            "reason": ("Rolling off soon" if rolling_off and not v["is_bench"] else "On bench"),
            "rolloff_date": v["earliest_free"].isoformat() if v["earliest_free"] else None,
            "current_projects": v["projects"],
            "recommended_training_id": t.id,
            "recommended_training": t.title,
            "teaches_skills": best["new_skills"],
            "demand_score": best["score"],
            "suggested_due_date": _due_date(v["free"], today).isoformat(),
        })

    # Highest in-demand skill gaps first; bench before rolling-off as a tiebreak.
    rows.sort(key=lambda r: (r["demand_score"], r["reason"] == "On bench"), reverse=True)
    rows = rows[:max(1, min(limit, 100))]

    return {
        "ok": True,
        "generated_on": today.isoformat(),
        "count": len(rows),
        "rows": rows,
        "summary": {
            "bench": sum(1 for r in rows if r["reason"] == "On bench"),
            "rolling_off": sum(1 for r in rows if r["reason"] == "Rolling off soon"),
        },
    }


def approve_and_assign(db: Session, *, employee_id: Optional[int] = None,
                       email: Optional[str] = None, training_id: int = 0,
                       due_date: Optional[str] = None, assigned_by: Optional[str] = None) -> dict:
    """Manager-approved enrollment. Reuses the TechElevate assign API; on completion
    that service writes the training's skills back as verified EmployeeSkills.

    Resolves the employee by PK first, then email (so it works when the suggestion
    came from the Zoho/MS365 directory and there's no local Employee PK)."""
    from app.services import techelevate_local_service as te
    emp = te._resolve_employee(db, employee_id=employee_id, email=email)
    if not emp:
        return {"ok": False, "error": "No employee record to enroll — sync the directory first."}
    due = None
    if due_date:
        try:
            due = datetime.date.fromisoformat(due_date)
        except ValueError:
            due = None
    a = te.assign_training(db, training_id=training_id, employee=emp,
                           start_date=datetime.date.today(), due_date=due,
                           status="Assigned", assigned_by=assigned_by)
    if a is None:
        return {"ok": False, "error": "Could not assign — training or employee missing."}
    db.commit()
    return {"ok": True, "assignment_id": a.id,
            "message": f"Assigned '{a.training.title if a.training else 'training'}' to {emp.name}."}
