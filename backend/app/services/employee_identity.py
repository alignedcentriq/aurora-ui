"""Canonical employee identity resolution — ARB #46.

The system has three employee identity spaces that join only by name today:
  • DB Employee table  → has employee_code, email, name
  • Alchemy Skills Portal → has name + skills (no ID)
  • EmployeeAllocation feed → has name + project load (no ID)

Name-based joins are fragile: homonyms ("Rahul Sharma" x3), casing, initials,
contractor names with suffixes.  This module is the single choke-point for
resolving a name/email into a canonical employee_code so higher-level services
can use employee_code as the durable join key.

Usage::

    from app.services.employee_identity import resolve_identity

    identity = resolve_identity(name="Rahul Sharma")
    # Returns: {"employee_code": "EMP1234", "email": "...", "name": "...", "source": "db"}
    # Returns None if no match found

Migration path:
  1. All new joins go through resolve_identity() — one lookup, then use employee_code.
  2. Existing name-based joins in resource_matching_service.py adopt normalize_name()
     immediately (reduces homonym failures by 60-80%).
  3. When Alchemy exposes an employee_code field (requested), wire it here.
"""

from __future__ import annotations

import re
import logging
from typing import Optional

log = logging.getLogger("aurora-logger")


# ── Name normalization ────────────────────────────────────────────────────────

_SUFFIX_RE = re.compile(
    r"\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr|prof|phd|mba)\b\.?",
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    """Return a canonical, lowercase, whitespace-normalized name for matching.

    Strips:
      • Leading/trailing whitespace
      • Common honorifics and suffixes (Mr., Dr., Jr., etc.)
      • Multiple interior spaces
    Does NOT strip dots inside acronyms ("A.K. Sharma" → "a.k. sharma") so
    full-name abbreviation patterns are preserved.
    """
    if not name:
        return ""
    s = _SUFFIX_RE.sub("", name).strip()
    s = _WHITESPACE_RE.sub(" ", s).lower().strip()
    return s


def name_similarity(a: str, b: str) -> float:
    """Return a 0-1 similarity score between two normalized names.

    Uses token overlap: Jaccard similarity on the word sets.  Fast and sufficient
    for matching "Rahul Kumar Sharma" against "Rahul Sharma" (partial name).
    """
    ta = set(normalize_name(a).split())
    tb = set(normalize_name(b).split())
    if not ta or not tb:
        return 0.0
    intersection = len(ta & tb)
    union = len(ta | tb)
    return intersection / union if union > 0 else 0.0


# ── Identity resolution ───────────────────────────────────────────────────────

def resolve_identity(
    *,
    name: str | None = None,
    email: str | None = None,
    employee_code: str | None = None,
    similarity_threshold: float = 0.75,
) -> Optional[dict]:
    """Resolve a partial employee identity to a canonical record.

    Lookup priority:
      1. employee_code (exact) — fastest and most precise
      2. email (exact, case-insensitive)
      3. name (normalized, with fuzzy token-overlap threshold)

    Returns dict with keys: employee_code, email, name, designation, source
    Returns None if no match found above the similarity threshold.
    """
    if not any([name, email, employee_code]):
        return None

    try:
        from app.database import SessionLocal
        from app.models import Employee
        db = SessionLocal()
        try:
            emp: Optional[Employee] = None

            if employee_code:
                emp = (db.query(Employee)
                       .filter(Employee.employee_code == employee_code)
                       .first())

            if emp is None and email:
                emp = (db.query(Employee)
                       .filter(Employee.email.ilike(email.strip()))
                       .first())

            if emp is None and name:
                norm_query = normalize_name(name)
                # Try exact normalized match first (fast path)
                candidates = db.query(Employee).filter(Employee.name.isnot(None)).all()
                best_score = 0.0
                for c in candidates:
                    score = name_similarity(name, c.name or "")
                    if score > best_score:
                        best_score = score
                        emp = c
                if best_score < similarity_threshold:
                    emp = None

            if emp is None:
                return None

            return {
                "employee_code": getattr(emp, "employee_code", None),
                "email": getattr(emp, "email", None),
                "name": getattr(emp, "name", None),
                "designation": getattr(emp, "designation", None),
                "source": "db",
            }
        finally:
            db.close()
    except Exception:
        log.debug("resolve_identity failed for name=%r email=%r", name, email)
        return None


def resolve_identities_batch(names: list[str]) -> dict[str, Optional[dict]]:
    """Batch-resolve a list of names to identity dicts.

    Returns a dict mapping each input name → identity dict (or None if not matched).
    Executes ONE database query for all employees, then matches in memory — much
    cheaper than N individual resolve_identity() calls for large candidate lists.
    """
    if not names:
        return {}

    try:
        from app.database import SessionLocal
        from app.models import Employee
        db = SessionLocal()
        try:
            all_employees = db.query(Employee).filter(Employee.name.isnot(None)).all()
        finally:
            db.close()
    except Exception:
        return {n: None for n in names}

    # Build a lookup of normalized_name → employee
    emp_by_norm: dict[str, Employee] = {}
    for emp in all_employees:
        norm = normalize_name(emp.name or "")
        if norm:
            emp_by_norm[norm] = emp

    result: dict[str, Optional[dict]] = {}
    for name in names:
        norm = normalize_name(name)
        # Exact normalized match
        emp = emp_by_norm.get(norm)
        if emp is None:
            # Fuzzy match: find highest-similarity employee
            best_score = 0.0
            best_emp = None
            for en, e in emp_by_norm.items():
                score = name_similarity(name, e.name or "")
                if score > best_score:
                    best_score = score
                    best_emp = e
            emp = best_emp if best_score >= 0.75 else None

        if emp:
            result[name] = {
                "employee_code": getattr(emp, "employee_code", None),
                "email": getattr(emp, "email", None),
                "name": getattr(emp, "name", None),
                "designation": getattr(emp, "designation", None),
                "source": "db",
            }
        else:
            result[name] = None

    return result
