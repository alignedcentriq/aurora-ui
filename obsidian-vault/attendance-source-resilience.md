---
name: attendance-source-resilience
description: Prod "everyone absent" = eSSL unreachable (ODBC driver); errors now degrade not fabricate
metadata:
  type: project
---

Root cause of "everyone Absent for all days" in PRODUCTION (found 2026-07-08): the eSSL
biometric DB was configured (env set) but unreachable from the prod container, because
backend/Dockerfile (python:3.11-slim, Linux) never installed a Microsoft ODBC driver.
`pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server}")` failed, the error was silently
swallowed as [], and weekday-with-no-punch counts as Absent → all-absent. Works on Windows
dev only because Driver 17 is installed there. Distinct from the middle-name bug
([[attendance-name-join]]) — that only affects ~37 people, not everyone.

Fixes shipped:
- backend/Dockerfile now installs **msodbcsql18** + unixodbc-dev (Debian 12 MS repo).
- Connection string auto-picks the newest installed driver (18 then 17) via pyodbc.drivers();
  override with ATTENDANCE_ODBC_DRIVER. ATTENDANCE_ODBC_ENCRYPT defaults "no" (eSSL server
  has no TLS; Driver 18 defaults yes and would otherwise break).
- attendance_db_service raises **AttendanceSourceError** (+ logs) on DB failure instead of
  returning empty; attendance_service degrades all public fns (summary, team_report,
  calendar, team_member_calendar) to `{"success": false, "error":
  "attendance_source_unavailable", "message": ...}` — the UI already renders success:false.

**Why:** empty-on-error is indistinguishable from "no punches" and silently corrupts data.
**How to apply:** if attendance looks all-absent again, check the container has the ODBC
driver and can reach db01.alignedautomation.com:1433 — and look for the logged warning.
Prod still needs the image rebuilt/redeployed for the driver to take effect.
