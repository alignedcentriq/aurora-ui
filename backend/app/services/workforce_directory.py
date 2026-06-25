"""
Workforce directory — one name-keyed view of people, skills, and managers, sourced
from the data that's actually populated, NOT the 4-row `employees` table.

The `employees` directory is sparse in many deployments (it's a thin shell that the
MS365/Zoho syncs hang off). The real roster + skills live in:

  • skills   → EmployeeZohoProfile.skill_set / .expertise (Zoho HRMS) — the system of
               record for self-declared skills — supplemented by EmployeeSkill rows
               (verified/uploaded certs).
  • identity → EmployeeZohoProfile (name, official_email, function, reporting_manager),
               then MS365User (name, email, department, manager), then the allocation
               feed itself (which already carries function + managers).

Everything is keyed by lower-cased employee NAME — the shared identifier across the
allocation feed, Zoho, and MS365 (there is no common numeric id). Pure SQL, no LLM.
"""

import re
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Employee, EmployeeAllocation, EmployeeSkill, EmployeeZohoProfile, MS365User, SCHEMA


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _name_to_codes(db: Session) -> dict[str, set[str]]:
    """name(lower) → {employee_id codes} from the latest allocation snapshot.

    The allocation feed is the bridge between an employee NAME (used by the directory)
    and their AASPL employee code (used by the Alchemy skills cache)."""
    from app.services import allocation_snapshot_service as snap
    latest = snap.latest_snapshot_date(db)
    if latest is None:
        return {}
    out: dict[str, set[str]] = {}
    for nm, code in (db.query(EmployeeAllocation.employee_name, EmployeeAllocation.employee_id)
                     .filter(EmployeeAllocation.allocation_date == latest).all()):
        if nm and code:
            out.setdefault(_norm(nm), set()).add(_norm(code))
    return out


def _alchemy_skills_by_code(db: Session, codes: set[str]) -> dict[str, set[str]]:
    """employee_code(lower) → set of skill names, from the Alchemy skills cache
    (alchemy_profile_cache.skills is a JSON array of {skill, competency, …})."""
    if not codes:
        return {}
    rows = db.execute(
        text(f'SELECT lower(employee_code) AS code, skills '
             f'FROM "{SCHEMA}".alchemy_profile_cache '
             f'WHERE lower(employee_code) = ANY(:codes)'),
        {"codes": list(codes)},
    ).fetchall()
    out: dict[str, set[str]] = {}
    for code, skills in rows:
        items = skills if isinstance(skills, list) else []
        names = {(it.get("skill") or "").strip() for it in items
                 if isinstance(it, dict) and (it.get("skill") or "").strip()}
        if names:
            out[code] = names
    return out


def _full_name(first: Optional[str], last: Optional[str]) -> str:
    return f"{(first or '').strip()} {(last or '').strip()}".strip()


def _split_skills(text: Optional[str]) -> list[str]:
    """Split a 'AWS, Azure, Project Management / React' style blob into clean terms."""
    if not text:
        return []
    parts = re.split(r"[,/;|\n]+|\band\b", text, flags=re.IGNORECASE)
    out = []
    for p in parts:
        p = p.strip()
        if len(p) > 1:
            out.append(p)
    return out


def skills_by_name(db: Session, names: Optional[Iterable[str]] = None) -> dict[str, set[str]]:
    """name(lower) → set of skill strings, merged from all real sources:
      • Alchemy skills cache (authoritative; joined name→code via the allocation feed)
      • Zoho profile skill_set / expertise
      • EmployeeSkill rows (verified / uploaded certs)

    `names` (if given) restricts the result to those people (lower-cased match)."""
    want = {_norm(n) for n in names} if names is not None else None
    out: dict[str, set[str]] = {}

    # Alchemy skills cache — the authoritative source (richest coverage). The cache is
    # keyed by AASPL code, so bridge name→code through the allocation feed.
    name_to_codes = _name_to_codes(db)
    wanted_codes = {c for nm, codes in name_to_codes.items()
                    if (want is None or nm in want) for c in codes}
    alch = _alchemy_skills_by_code(db, wanted_codes)
    if alch:
        for nm, codes in name_to_codes.items():
            if want is not None and nm not in want:
                continue
            for c in codes:
                if c in alch:
                    out.setdefault(nm, set()).update(alch[c])

    # Zoho profiles — full-roster self-declared skills.
    for p in db.query(EmployeeZohoProfile).all():
        nm = _norm(_full_name(p.first_name, p.last_name))
        if not nm or (want is not None and nm not in want):
            continue
        sk = set(_split_skills(p.skill_set)) | set(_split_skills(p.expertise))
        if sk:
            out.setdefault(nm, set()).update(sk)

    # EmployeeSkill rows (verified/uploaded) joined to a directory name.
    for name, skill in (db.query(Employee.name, EmployeeSkill.skill)
                        .join(EmployeeSkill, EmployeeSkill.employee_id == Employee.id).all()):
        nm = _norm(name)
        if not nm or (want is not None and nm not in want):
            continue
        if skill and skill.strip():
            out.setdefault(nm, set()).add(skill.strip())

    return out


def people_by_name(db: Session, names: Optional[Iterable[str]] = None) -> dict[str, dict]:
    """name(lower) → {name, email, function, manager_name, pk}.

    Layered: Employee (for the real PK needed to write a training assignment) →
    Zoho → MS365. `pk` is the Employee.id when a row exists, else None."""
    want = {_norm(n) for n in names} if names is not None else None
    out: dict[str, dict] = {}

    def _slot(nm: str) -> dict:
        return out.setdefault(nm, {"name": None, "email": None, "function": None,
                                   "manager_name": None, "pk": None})

    for e in db.query(Employee).all():
        nm = _norm(e.name)
        if not nm or (want is not None and nm not in want):
            continue
        d = _slot(nm)
        d["pk"] = e.id
        d["name"] = d["name"] or e.name
        d["email"] = d["email"] or e.email

    for p in db.query(EmployeeZohoProfile).all():
        nm = _norm(_full_name(p.first_name, p.last_name))
        if not nm or (want is not None and nm not in want):
            continue
        d = _slot(nm)
        d["name"] = d["name"] or _full_name(p.first_name, p.last_name)
        d["email"] = d["email"] or p.official_email
        d["function"] = d["function"] or p.function
        d["manager_name"] = d["manager_name"] or p.reporting_manager

    for u in db.query(MS365User).all():
        nm = _norm(u.name)
        if not nm or (want is not None and nm not in want):
            continue
        d = _slot(nm)
        d["name"] = d["name"] or u.name
        d["email"] = d["email"] or u.email
        d["function"] = d["function"] or u.department
        d["manager_name"] = d["manager_name"] or u.manager_name

    # Allocation feed — covers the full roster (function + reporting manager for
    # everyone), filling identity for people absent from the MS365/Zoho directory.
    from app.services import allocation_snapshot_service as snap
    latest = snap.latest_snapshot_date(db)
    if latest is not None:
        q = (db.query(EmployeeAllocation.employee_name, EmployeeAllocation.function,
                      EmployeeAllocation.reporting_manager)
             .filter(EmployeeAllocation.allocation_date == latest))
        seen: set[str] = set()
        for nm_raw, fn, mgr in q.all():
            nm = _norm(nm_raw)
            if not nm or nm in seen or (want is not None and nm not in want):
                continue
            seen.add(nm)
            d = _slot(nm)
            d["name"] = d["name"] or (nm_raw or "").strip()
            d["function"] = d["function"] or fn
            d["manager_name"] = d["manager_name"] or mgr

    return out
