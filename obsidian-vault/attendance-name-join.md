---
name: attendance-name-join
description: eSSL attendance joins to employees by NAME only (no ID); middle-name mismatch fix
metadata:
  type: project
---

eSSL biometric attendance (attendance_db_service.py) can only join to our Employee records
by NAME — its EMPLOYEEID/CARD_NO columns are device IDs with ZERO overlap with our
AA-###/AASPL codes (verified 2026-07-08). eSSL enrolls people under their full legal name
(often with a middle name, e.g. "Soniya Bhagwat Kekan") while Employee.name is the short
form ("Soniya Kekan"), so the original exact-equality join reported ~37 badging employees
as Absent every day.

Fix (2026-07-08): _resolve_usernames() = exact match, then an UNAMBIGUOUS first+last
fallback accepted only when (a) exactly one eSSL name in-window shares the first+last,
(b) that eSSL name isn't some other employee's exact name (exact owner wins), and (c)
exactly one employee org-wide shares that first+last. The employee-side guards need the
FULL org roster — callers in attendance_service pass _org_roster(db); do NOT drop it or
the single-employee path will mis-fuse distinct people (e.g. "Kumar Subham Singh" would
steal "Kumar Abhishek Singh"'s punches).

**Why:** name is the only usable key; naive first+last fuzzy matching fuses different
people who share first+last. **How to apply:** ~3 genuinely ambiguous employees stay
unresolved (shown Absent) by design — safe over wrong attribution. If they need coverage,
add a manual name-alias override (the option not taken this round).
