"""
Resource-matching service — staffing a new project from real employee data.

Given a free-text requirement (skills, minimum experience, needed-by date, how
many people), rank employees who could fit by three signals:

  • skill match   — does the person have the required skill(s)?
  • experience    — years of experience / competency on the matched skill(s)
  • availability  — free capacity = 100 − Σ(active efforts_percent), and/or
                    whether their current project rolls off before needed-by.

SOURCES (per the user's setup):
  • skills      → the Alchemy Skills Portal (authoritative system of record) when
                  ALCHEMY_SKILL_SEARCH_ENABLED is on and the user has a token;
                  falls back to the internal DB (EmployeeSkill + Zoho profile text).
  • availability→ always the DB allocation feed (EmployeeAllocation), linked to the
                  candidate by employee name (the two systems share names, not IDs).
"""

import datetime
import re
from typing import Optional

from sqlalchemy import or_, func

from app.config import settings
from app.database import SessionLocal
from app.models import Employee, EmployeeSkill, EmployeeAllocation, EmployeeZohoProfile

import logging
log = logging.getLogger("aurora-logger")


# Alchemy competency → a 0..1 experience floor (used when years aren't quantified).
_COMPETENCY_WEIGHT = {
    "beginner": 0.2, "intermediate": 0.45, "advanced": 0.7, "expert": 1.0,
}


def _is_current(alloc: EmployeeAllocation) -> bool:
    """An allocation counts toward current load unless the project is completed or the
    employee is inactive in that snapshot.

    NOTE: completion is read from `project_status` ("Ongoing"/"Completed"), NOT
    `completion_status` (a "Done"/"Not Done" record flag). Kept for backward imports;
    capacity math now lives in allocation_snapshot_service.
    """
    from app.services.allocation_snapshot_service import _counts_as_load
    return _counts_as_load(alloc)


def _parse_skills(skills: str) -> list[str]:
    """Split a 'react, node, aws' style string into clean lowercased terms."""
    parts = re.split(r"[,/;]| and |\band\b", skills or "", flags=re.IGNORECASE)
    return [p.strip().lower() for p in parts if p.strip()]


def _parse_date(text: str) -> Optional[datetime.date]:
    """Best-effort parse of a needed-by date. Accepts YYYY-MM-DD or DD-MM-YYYY."""
    if not text:
        return None
    text = text.strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _to_years(val) -> float:
    """Coerce an Alchemy 'experience' value ('3.00', 3, None) to a float year count."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _alchemy_token(user_email: str) -> Optional[str]:
    """Exchange the user's Microsoft token for an Alchemy token (None if unavailable)."""
    if not user_email:
        return None
    try:
        from app.services.email_service import _run_coro
        from app.services.oauth_service import get_alchemy_token
        return _run_coro(get_alchemy_token(user_email))
    except Exception as exc:  # not connected / transient — fall back to DB
        log.warning("[resource_match] no Alchemy token for %s: %s", user_email, exc)
        return None


class ResourceMatchingService:

    # tuning weights for the composite score
    _W_SKILL = 0.50
    _W_AVAIL = 0.30
    _W_EXP = 0.20
    _EXP_CAP = 10.0  # years of experience that scores a full 1.0

    @classmethod
    def match(
        cls,
        skills: str,
        min_years: Optional[float] = None,
        available_by: str = "",
        count: int = 5,
        user_email: Optional[str] = None,
    ) -> str:
        """Return a ranked, display-ready list of employees who fit the requirement.

        skills: required skill(s), comma-separated (e.g. "React, Node, AWS").
        min_years: minimum years of experience on a matched skill (optional).
        available_by: date the resource is needed by, e.g. "2026-07-15" (optional).
        count: how many candidates to return (default 5).
        user_email: the requester — used to obtain an Alchemy token for skill lookup.
        """
        terms = _parse_skills(skills)
        if not terms:
            return "Please tell me which skill(s) the project needs (e.g. 'React, Node, AWS')."

        needed_by = _parse_date(available_by)
        count = max(1, min(int(count or 5), 25))

        db = SessionLocal()
        try:
            # ── candidate pool keyed by lowercased name ──────────────────────
            # Try Alchemy first (authoritative skills); fall back to the DB.
            candidates: dict[str, dict] = {}
            source = "DB"
            if settings.ALCHEMY_SKILL_SEARCH_ENABLED:
                token = _alchemy_token(user_email)
                if token:
                    candidates = cls._gather_alchemy(token, terms)
                    source = "Alchemy"
            if not candidates:
                candidates = cls._gather_db(db, terms)
                source = "DB"

            if not candidates:
                return (
                    f"No employees found with {' / '.join(terms)} in "
                    f"{'the Alchemy Skills Portal' if source == 'Alchemy' else 'the skills directory'}. "
                    "Try a broader or alternative skill term."
                )

            # ── experience floor FIRST, so the (DB) availability work below only runs
            # for candidates we'll actually consider ────────────────────────────────
            # Experience floor: when the user asks for "N+ years" we only keep people we
            # can CONFIRM meet it. A candidate whose matched-skill experience is below the
            # floor — or unknown (max_years == 0, e.g. no years recorded on that skill) —
            # is dropped. (The old `and c["max_years"]` guard let unknown-experience
            # people slip past a "5+ years" ask.)
            kept = [c for c in candidates.values()
                    if not (min_years and c["max_years"] < float(min_years))]

            # ── batch-enrich: ONE directory query + ONE availability map for the whole
            # shortlist, instead of 2-3 DB round-trips per candidate (the old N+1). The
            # allocation feed is linked to candidates by name via canonical normalization
            # (ARB #46: normalize_name() reduces homonym/casing failures). ──
            from app.services.allocation_snapshot_service import current_load_map
            from app.services.employee_identity import normalize_name
            names = [c["name"] for c in kept if c.get("name")]
            directory = cls._directory_map(db, names)
            load_map = current_load_map(db, names) if names else {}

            scored = []
            for c in kept:
                key = normalize_name(c["name"] or "")

                # Alchemy gives names but not email/designation — fill from the directory.
                emp = directory.get(key)
                if emp:
                    c["email"] = c.get("email") or emp[0]
                    c["designation"] = c.get("designation") or emp[1]

                a = load_map.get(key)
                if a:
                    free, earliest_free, current = a["free"], a["earliest_free"], a["rows"]
                    load = a["load"]
                else:
                    load, free, earliest_free, current = 0.0, 100.0, None, []

                skill_score = len(c["matched"]) / len(terms)
                # experience: quantified years, else competency floor
                exp_from_years = min(c["max_years"] / cls._EXP_CAP, 1.0)
                exp_score = max(exp_from_years, c.get("competency_score", 0.0))
                avail_score = free / 100.0
                if needed_by and free < 25 and earliest_free and earliest_free <= needed_by:
                    avail_score = 1.0  # rolls off before we need them

                total = (cls._W_SKILL * skill_score
                         + cls._W_AVAIL * avail_score
                         + cls._W_EXP * exp_score)

                scored.append({**c, "load": load, "free": free,
                               "earliest_free": earliest_free, "current": current,
                               "score": total})

            if not scored:
                floor = f" with {min_years:g}+ years" if min_years else ""
                return f"Found people with {' / '.join(terms)}, but none{floor} matched the experience requirement."

            scored.sort(key=lambda x: x["score"], reverse=True)
            return cls._render(scored[:count], terms, min_years, needed_by,
                               total_pool=len(scored), source=source)
        finally:
            db.close()

    # ── candidate gatherers ─────────────────────────────────────────────────

    @classmethod
    def _gather_alchemy(cls, token: str, terms: list[str]) -> dict:
        """Build candidates from the Alchemy Skills Portal, keyed by lowercased name."""
        from app.services import alchemy_service
        out: dict[str, dict] = {}
        for term in terms:
            try:
                skill_id, canonical = alchemy_service.resolve_skill_id(token, term)
                if not skill_id:
                    continue
                data = alchemy_service.get_skill_details(token, skill_id)
            except PermissionError:
                log.warning("[resource_match] Alchemy permission denied for %r", term)
                return {}  # token bad — signal caller to fall back to DB
            except Exception as exc:
                log.warning("[resource_match] Alchemy lookup failed for %r: %s", term, exc)
                continue

            label = (canonical or term).strip()
            seen = set()
            # experts/certified first so the richest record wins on dedupe
            for bucket in (data.get("experts") or [], data.get("certified") or [],
                           data.get("employees") or []):
                for e in bucket:
                    name = (e.get("name") or "").strip()
                    if not name:
                        continue
                    key = name.lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    yrs = _to_years(e.get("experience"))
                    comp = (e.get("competency") or "").strip().lower()
                    comp_w = _COMPETENCY_WEIGHT.get(comp, 0.0)

                    c = out.setdefault(key, {
                        "name": name, "email": None, "designation": None,
                        "matched": {}, "max_years": 0.0, "competency_score": 0.0,
                        "competency_by_skill": {},
                    })
                    if label not in c["matched"] or yrs > c["matched"][label]:
                        c["matched"][label] = yrs
                    if comp:
                        c["competency_by_skill"][label] = e.get("competency")
                    c["max_years"] = max(c["max_years"], yrs)
                    c["competency_score"] = max(c["competency_score"], comp_w)
        return out

    @classmethod
    def _gather_db(cls, db, terms: list[str]) -> dict:
        """Fallback: build candidates from the internal DB (EmployeeSkill + Zoho text)."""
        out: dict[str, dict] = {}

        skill_filter = or_(*[EmployeeSkill.skill.ilike(f"%{t}%") for t in terms])
        for sk, emp in (db.query(EmployeeSkill, Employee)
                        .join(Employee, EmployeeSkill.employee_id == Employee.id)
                        .filter(skill_filter).all()):
            key = (emp.name or "").strip().lower()
            if not key:
                continue
            c = out.setdefault(key, {
                "name": emp.name, "email": emp.email, "designation": emp.designation,
                "matched": {}, "max_years": 0.0, "competency_score": 0.0,
                "competency_by_skill": {},
            })
            label = next((t for t in terms if t in (sk.skill or "").lower()), sk.skill)
            yrs = float(sk.years_experience or 0)
            if label not in c["matched"] or yrs > c["matched"][label]:
                c["matched"][label] = yrs
            c["max_years"] = max(c["max_years"], yrs)

        zoho_filter = or_(*[
            or_(EmployeeZohoProfile.skill_set.ilike(f"%{t}%"),
                EmployeeZohoProfile.expertise.ilike(f"%{t}%")) for t in terms
        ])
        for zp, emp in (db.query(EmployeeZohoProfile, Employee)
                        .join(Employee, EmployeeZohoProfile.employee_id == Employee.id)
                        .filter(zoho_filter)
                        .filter(EmployeeZohoProfile.employee_status != "Inactive").all()):
            key = (emp.name or "").strip().lower()
            if not key:
                continue
            c = out.setdefault(key, {
                "name": emp.name, "email": emp.email, "designation": emp.designation,
                "matched": {}, "max_years": 0.0, "competency_score": 0.0,
                "competency_by_skill": {},
            })
            blob = f"{zp.skill_set or ''} {zp.expertise or ''}".lower()
            for t in terms:
                if t in blob and t not in c["matched"]:
                    c["matched"][t] = 0.0
        return out

    # ── directory enrichment (batched) ──────────────────────────────────────

    @classmethod
    def _directory_map(cls, db, names: list[str]) -> dict[str, tuple]:
        """Batch name → (email, designation) from the employee directory in ONE query.

        Keyed by normalize_name() (ARB #46) so matching is robust to casing and
        honorifics.  Falls back to lowercased simple match for entries that don't
        appear in the normalized map.
        """
        from app.services.employee_identity import normalize_name
        normed = [normalize_name(n) for n in (names or []) if n and n.strip()]
        lowered = [n.strip().lower() for n in (names or []) if n and n.strip()]
        all_terms = list(set(normed + lowered))
        if not all_terms:
            return {}
        rows = (db.query(Employee)
                .filter(func.lower(Employee.name).in_(all_terms)).all())
        result = {}
        for e in rows:
            for key in (normalize_name(e.name or ""), (e.name or "").strip().lower()):
                if key and key not in result:
                    result[key] = (e.email, e.designation)
        return result

    # ── rendering ───────────────────────────────────────────────────────────

    @classmethod
    def _render(cls, rows, terms, min_years, needed_by, total_pool, source) -> str:
        head = f"**Top {len(rows)} candidate(s) for {', '.join(t.title() for t in terms)}**"
        criteria = []
        if min_years:
            criteria.append(f"{min_years:g}+ yrs")
        if needed_by:
            criteria.append(f"needed by {needed_by.isoformat()}")
        if criteria:
            head += f" ({'; '.join(criteria)})"
        head += f" — {total_pool} matched the skill in total. Skills from {source}; availability from allocation data.\n"

        lines = [head]
        for i, r in enumerate(rows, 1):
            name = r["name"] or "Unknown"
            desg = r.get("designation") or "—"

            if r["free"] >= 99:
                avail = "fully available (no active allocation)"
            elif r["free"] >= 25:
                avail = f"~{r['free']:g}% free capacity"
            elif r["earliest_free"] and (not needed_by or r["earliest_free"] <= needed_by):
                avail = f"fully booked now, rolls off {r['earliest_free'].isoformat()}"
            else:
                avail = f"fully booked ({r['load']:g}% allocated)"

            skill_bits = []
            for sk, yrs in sorted(r["matched"].items(), key=lambda kv: -kv[1]):
                comp = (r.get("competency_by_skill") or {}).get(sk)
                tag = f"{sk.title()}"
                if yrs:
                    tag += f" ({yrs:g} yr"
                    tag += f", {comp})" if comp else ")"
                elif comp:
                    tag += f" ({comp})"
                skill_bits.append(tag)
            skills_txt = ", ".join(skill_bits)

            proj = ""
            if r["current"]:
                names = sorted({a.project_name for a in r["current"] if a.project_name})
                if names:
                    proj = f" Currently on: {', '.join(names)}."

            contact = f"\n   Contact: {r['email']}" if r.get("email") else ""
            lines.append(
                f"{i}. {name} — {desg}\n"
                f"   Skills: {skills_txt}\n"
                f"   Availability: {avail}.{proj}{contact}"
            )
        lines.append("\nRanked by skill coverage, availability, and experience. "
                     "Confirm current allocations with the delivery manager before committing.")
        return "\n".join(lines)
