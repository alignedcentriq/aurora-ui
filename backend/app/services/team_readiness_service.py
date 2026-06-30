"""
Lead Team Readiness + Digest — operational, team-scoped workforce intelligence.

Deterministic SQL only (no LLM). Operates on a manager's resolved team (a list of
Employee rows from manager_routes._get_team), so hierarchy scoping is reused.

  • weekly_digest      — who rolls off soon, who's on bench, whose training is overdue
                         or due this week, and allocation%-vs-training-load conflicts.
  • readiness_for_project — for required skills, label each report match /
                         one-course-away (with the course) / gap, plus availability.

Capacity from allocation_snapshot_service; skills from EmployeeSkill; courses from
techelevate_local_service.
"""

import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Employee, TeAssignment
from app.services import allocation_snapshot_service as snap
from app.services import workforce_directory as wd
from app.services.resource_matching_service import _parse_skills


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def weekly_digest(db: Session, team: list[Employee], today: Optional[datetime.date] = None) -> dict:
    today = today or datetime.date.today()
    names = {e.name for e in team if e.name}
    lm = snap.current_load_map(db, names, today)
    week = today + datetime.timedelta(days=7)
    horizon = today + datetime.timedelta(days=snap.ROLLOFF_HORIZON_DAYS)

    ids = [e.id for e in team]
    assigns = (db.query(TeAssignment)
               .filter(TeAssignment.employee_id.in_(ids), TeAssignment.status != "Completed").all()
               if ids else [])
    by_emp: dict[int, list[TeAssignment]] = {}
    for a in assigns:
        by_emp.setdefault(a.employee_id, []).append(a)

    rolling_off, on_bench, overdue, due_soon, conflicts = [], [], [], [], []
    for e in team:
        v = lm.get(_norm(e.name))
        if v:
            if v["earliest_free"] and v["earliest_free"] <= horizon:
                rolling_off.append({"name": e.name, "date": v["earliest_free"].isoformat(),
                                    "projects": v["projects"]})
            if v["is_bench"] and v.get("active"):
                on_bench.append({"name": e.name, "free": round(v["free"])})

        has_due_soon = False
        for a in by_emp.get(e.id, []):
            title = a.training.title if a.training else "training"
            if a.due_date and a.due_date < today:
                overdue.append({"name": e.name, "training": title, "due": a.due_date.isoformat()})
            elif a.due_date and a.due_date <= week:
                due_soon.append({"name": e.name, "training": title, "due": a.due_date.isoformat()})
                has_due_soon = True
        if v and v["load"] >= 90 and has_due_soon:
            conflicts.append({"name": e.name, "load": round(v["load"])})

    return {
        "ok": True,
        "generated_on": today.isoformat(),
        "team_size": len(team),
        "rolling_off": rolling_off,
        "on_bench": on_bench,
        "training_overdue": overdue,
        "training_due_soon": due_soon,
        "load_training_conflicts": conflicts,
    }


def readiness_for_project(db: Session, team: list[Employee], skills: str,
                          today: Optional[datetime.date] = None) -> dict:
    today = today or datetime.date.today()
    terms = _parse_skills(skills)
    if not terms:
        return {"ok": False, "message": "Specify the required skill(s), e.g. 'React, Node, AWS'."}

    from app.services import techelevate_local_service as te
    names = {e.name for e in team if e.name}
    lm = snap.current_load_map(db, names, today)
    # Skills from the Zoho-sourced directory (name-keyed), not the sparse skills table.
    skills_map = wd.skills_by_name(db, names)

    rows = []
    for e in team:
        have = {_norm(s) for s in skills_map.get(_norm(e.name), set())}
        matched = [t for t in terms if any(t in s for s in have)]
        missing = [t for t in terms if t not in matched]
        free = round(lm.get(_norm(e.name), {}).get("free", 100.0))

        if not missing:
            status = "ready"
            course = None
            course_id = None
        elif len(missing) == 1:
            status = "one_course_away"
            recs = te.recommend_for_skill(db, missing[0], limit=1)
            course = recs[0]["title"] if recs else None
            course_id = recs[0]["id"] if recs else None
        else:
            status = "gap"
            if missing:
                recs = te.recommend_for_skill(db, missing[0], limit=1)
                course = recs[0]["title"] if recs else None
                course_id = recs[0]["id"] if recs else None
            else:
                course = None
                course_id = None

        rows.append({
            "name": e.name,
            "email": e.email,
            "employee_id": e.id,
            "matched_skills": matched,
            "missing_skills": missing,
            "free_pct": free,
            "status": status,
            "suggested_course": course,
            "suggested_course_id": course_id,
        })

    order = {"ready": 0, "one_course_away": 1, "gap": 2}
    rows.sort(key=lambda r: (order.get(r["status"], 3), -r["free_pct"]))
    return {
        "ok": True,
        "required_skills": terms,
        "summary": {
            "ready": sum(1 for r in rows if r["status"] == "ready"),
            "one_course_away": sum(1 for r in rows if r["status"] == "one_course_away"),
            "gap": sum(1 for r in rows if r["status"] == "gap"),
        },
        "rows": rows,
    }
