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


def team_readiness_insights(db: Session, team: list[Employee],
                            today: Optional[datetime.date] = None) -> dict:
    """
    Proactive, team-scoped readiness intelligence for the Lead. Four blocks, all from
    data we already have (allocation snapshot + team skills + training assignments):

      capacity        — utilisation health + a 30/60/90-day availability forecast
      skills          — capability coverage + single-points-of-failure (bus-factor risk)
      attention       — one prioritised action list merging the digest signals
      readiness_score — a composite per-person deployment-readiness leaderboard

    Deterministic SQL only (no LLM).
    """
    today = today or datetime.date.today()
    if not team:
        return {"ok": True, "team_size": 0, "capacity": {}, "skills": {},
                "attention": [], "readiness_score": []}

    names = {e.name for e in team if e.name}
    lm = snap.current_load_map(db, names, today)
    skills_map = wd.skills_by_name(db, names)

    ids = [e.id for e in team]
    assigns = (db.query(TeAssignment)
               .filter(TeAssignment.employee_id.in_(ids), TeAssignment.status != "Completed").all()
               if ids else [])
    by_emp: dict[int, list[TeAssignment]] = {}
    for a in assigns:
        by_emp.setdefault(a.employee_id, []).append(a)

    def _overdue_due_soon(emp: Employee) -> tuple[int, int]:
        week = today + datetime.timedelta(days=7)
        od = ds = 0
        for a in by_emp.get(emp.id, []):
            if a.due_date and a.due_date < today:
                od += 1
            elif a.due_date and a.due_date <= week:
                ds += 1
        return od, ds

    # ── Capacity: utilisation health + availability forecast ─────────────────────
    loads, fully, over, bench, avail = [], 0, 0, 0, 0
    forecast = {"free_now": [], "in_30": [], "in_60": [], "in_90": []}
    for e in team:
        v = lm.get(_norm(e.name))
        if not v:
            continue
        load = round(v["load"])
        loads.append(load)
        if load > 100:
            over += 1
        elif load >= 90:
            fully += 1
        deployable = v["free"] >= snap.DEPLOYABLE_FREE_PCT and v.get("active")
        if v["is_bench"] and v.get("active"):
            bench += 1
        if deployable:
            avail += 1
            forecast["free_now"].append({"name": e.name, "free": round(v["free"])})
        elif v["earliest_free"]:
            days = (v["earliest_free"] - today).days
            item = {"name": e.name, "date": v["earliest_free"].isoformat(),
                    "load": load, "projects": v["projects"]}
            if 0 <= days <= 30:
                forecast["in_30"].append(item)
            elif days <= 60:
                forecast["in_60"].append(item)
            elif days <= 90:
                forecast["in_90"].append(item)

    capacity = {
        "avg_load": round(sum(loads) / len(loads)) if loads else 0,
        "fully_utilized": fully,
        "overloaded": over,
        "on_bench": bench,
        "available": avail,
        "forecast": forecast,
    }

    # ── Skills: coverage + single-points-of-failure ──────────────────────────────
    holders: dict[str, dict] = {}   # skill_lower → {"skill": display, "holders": [names]}
    for e in team:
        for s in skills_map.get(_norm(e.name), set()):
            disp = (s or "").strip()
            if not disp:
                continue
            key = disp.lower()
            entry = holders.setdefault(key, {"skill": disp, "holders": []})
            entry["holders"].append(e.name)

    coverage = sorted(
        ({"skill": v["skill"], "count": len(v["holders"]),
          "holders": sorted(v["holders"])[:6]} for v in holders.values()),
        key=lambda r: (-r["count"], r["skill"].lower()),
    )
    single_points = sorted(
        ({"skill": v["skill"], "holder": v["holders"][0]}
         for v in holders.values() if len(v["holders"]) == 1),
        key=lambda r: r["skill"].lower(),
    )
    skills_block = {
        "total_distinct": len(holders),
        "top": coverage[:12],
        "single_points": single_points[:30],
        "single_points_total": len(single_points),
    }

    # ── Attention: prioritised action roll-up (merges digest signals) ────────────
    digest = weekly_digest(db, team, today)
    attention: list[dict] = []
    for it in digest["training_overdue"]:
        attention.append({"name": it["name"], "severity": 3, "kind": "training_overdue",
                          "issue": f"Training overdue: {it['training']}",
                          "detail": f"was due {it['due']}", "action": "Follow up / reassign"})
    for it in digest["load_training_conflicts"]:
        attention.append({"name": it["name"], "severity": 3, "kind": "load_conflict",
                          "issue": "Training due while overloaded",
                          "detail": f"{it['load']}% allocated", "action": "Rebalance load"})
    for it in digest["rolling_off"]:
        attention.append({"name": it["name"], "severity": 2, "kind": "rolling_off",
                          "issue": "Rolling off — no follow-on yet",
                          "detail": f"frees {it['date']}", "action": "Plan next allocation"})
    for it in digest["on_bench"]:
        attention.append({"name": it["name"], "severity": 2, "kind": "on_bench",
                          "issue": "Idle on bench",
                          "detail": f"{it['free']}% free", "action": "Deploy or upskill"})
    for it in digest["training_due_soon"]:
        attention.append({"name": it["name"], "severity": 1, "kind": "training_due_soon",
                          "issue": f"Training due this week: {it['training']}",
                          "detail": f"due {it['due']}", "action": "Nudge to finish"})
    attention.sort(key=lambda r: (-r["severity"], r["name"].lower()))

    # ── Readiness score: composite per-person leaderboard ────────────────────────
    scored = []
    for e in team:
        v = lm.get(_norm(e.name)) or {}
        free = round(v.get("free", 100.0))
        n_skills = len(skills_map.get(_norm(e.name), set()))
        od, ds = _overdue_due_soon(e)
        skill_score = min(100, n_skills * 12.5)                 # 8+ skills → full marks
        training_currency = max(0, 100 - od * 30 - ds * 10)
        score = round(0.40 * free + 0.35 * skill_score + 0.25 * training_currency)
        band = "high" if score >= 75 else "medium" if score >= 50 else "low"
        scored.append({"name": e.name, "email": e.email, "score": score, "band": band,
                       "free_pct": free, "skills_count": n_skills,
                       "overdue": od, "due_soon": ds})
    scored.sort(key=lambda r: (-r["score"], r["name"].lower()))

    return {
        "ok": True,
        "generated_on": today.isoformat(),
        "team_size": len(team),
        "capacity": capacity,
        "skills": skills_block,
        "attention": attention,
        "readiness_score": scored,
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
