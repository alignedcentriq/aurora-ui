"""
Live sync: mirrors the Zoho reporting Postgres server's `vb_allocation_details`
view (ZOHO_ALLOCATION_VIEW) into the local `employee_allocations` table.

WHY a mirror instead of querying the view live on every request: every allocation
feature — allocation_snapshot_service, manager team-allocation route, the ROI/
Analytics-Studio metric engine, PMO's bench/utilization report generators — reads
`employee_allocations` with real SQL (GROUP BY, COUNT DISTINCT, date filters). That
logic is already correct and battle-tested; syncing keeps it untouched instead of
reimplementing every aggregation in Python against a remote view. This replaces the
one-off Excel loader (scripts/import_allocations.py, deleted) as the table's data
source — "current" now means "synced from Zoho this cycle", not a stale export.

Column mapping notes (view → local table):
  - `vb_allocation_details` already resolves employee/project/client names and splits
    multi-value fields (unlike the raw `vt_allocation_details` pass-through), so it
    maps closely onto the old Excel shape.
  - Five Excel-only columns have no equivalent in the view and are left NULL going
    forward: sub_project, completion_status, project_type, expected_end_date,
    zoho_record_id. Nothing reads completion_status for logic (see
    allocation_snapshot_service's module docstring); the others degrade to a blank
    field in the manager-portal allocation table and PMO report emails.
  - The view carries no employee active/inactive flag. `status` is derived by name
    lookup against the live employee directory view (services/zoho_directory_service),
    same "Active" definition used there. A name absent from that directory (e.g. a
    contractor code like "AA-C-045") defaults to Active rather than being silently
    excluded from capacity math.
"""

import logging

from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.models import EmployeeAllocation, SCHEMA
from app.services.zoho_directory_service import _get_engine, _is_active, fetch_raw_rows

log = logging.getLogger(__name__)


def _fetch_view_rows() -> list[dict]:
    engine = _get_engine()
    if engine is None:
        return []
    view = (settings.ZOHO_ALLOCATION_VIEW or "analytics.vb_allocation_details").strip()
    try:
        with engine.connect() as conn:
            result = conn.execute(text(f"SELECT * FROM {view}"))
            return [{str(k).lower(): v for k, v in m.items()} for m in result.mappings().all()]
    except Exception as e:  # noqa: BLE001
        log.warning("[zoho_allocation_sync] fetch failed: %s", e)
        return []


def _active_name_set() -> set[str]:
    """Lower-cased full names of currently-active staff, per the live employee directory."""
    out = set()
    for row in fetch_raw_rows():
        first = str(row.get("firstname") or "").strip()
        last = str(row.get("lastname") or "").strip()
        name = f"{first} {last}".strip()
        if name and _is_active(row):
            out.add(name.lower())
    return out


def sync_now() -> int:
    """Replace `employee_allocations` with the current `vb_allocation_details` contents.

    Fail-soft: if the view can't be reached (or returns nothing), the existing table
    is left untouched — a transient outage on the reporting server must never wipe
    good data. Returns the number of rows synced (0 on failure/no-op)."""
    rows = _fetch_view_rows()
    if not rows:
        log.warning("[zoho_allocation_sync] no rows from %s — leaving local table as-is",
                    settings.ZOHO_ALLOCATION_VIEW)
        return 0

    active_names = _active_name_set()

    db = SessionLocal()
    try:
        db.execute(text(f'TRUNCATE TABLE "{SCHEMA}".employee_allocations RESTART IDENTITY'))

        batch = []
        for row in rows:
            name = str(row.get("name") or "").strip()
            rec = EmployeeAllocation(
                employee_id=str(row.get("employee id") or "").strip() or None,
                employee_name=name or None,
                project_name=str(row.get("project name") or "").strip() or None,
                project_lead=str(row.get("project lead") or "").strip() or None,
                delivery_manager=str(row.get("delivery manager") or "").strip() or None,
                efforts_percent=float(row["efforts"]) if row.get("efforts") is not None else None,
                billability_percent=float(row["billability"]) if row.get("billability") is not None else None,
                allocation_date=row.get("allocation date"),
                project_status=str(row.get("project status") or "").strip() or None,
                client_master=str(row.get("customer name") or "").strip() or None,
                billing=str(row.get("billing") or "").strip() or None,
                reporting_manager=str(row.get("reporting manager") or "").strip() or None,
                functional_manager=str(row.get("functional manager") or "").strip() or None,
                function=str(row.get("function") or "").strip() or None,
                status="Active" if (not name or name.lower() in active_names) else "Inactive",
            )
            batch.append(rec)
            if len(batch) >= 500:
                db.bulk_save_objects(batch)
                db.commit()
                batch = []
        if batch:
            db.bulk_save_objects(batch)
            db.commit()

        # Re-apply manual overrides to ensure they persist over truncation
        reapply_manual_allocations(db)

        log.info("[zoho_allocation_sync] synced %d rows from %s", len(rows), settings.ZOHO_ALLOCATION_VIEW)
        return len(rows)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.warning("[zoho_allocation_sync] sync failed, rolled back: %s", e)
        return 0
    finally:
        db.close()


def reapply_manual_allocations(db) -> None:
    """Read all rows from manual_employee_allocations and apply them to employee_allocations."""
    from app.models import EmployeeAllocation, ManualEmployeeAllocation

    # Fetch all manual allocations
    manuals = db.query(ManualEmployeeAllocation).all()
    if not manuals:
        return

    for m in manuals:
        # Check if we have an existing row in employee_allocations
        query = db.query(EmployeeAllocation).filter(
            EmployeeAllocation.project_name == m.project_name,
            EmployeeAllocation.allocation_date == m.allocation_date
        )
        if m.employee_id:
            query = query.filter(EmployeeAllocation.employee_id == m.employee_id)
        else:
            query = query.filter(EmployeeAllocation.employee_name == m.employee_name)
        
        existing = query.first()

        if m.is_deleted:
            # Delete if exists
            if existing:
                db.delete(existing)
        else:
            # Upsert
            if not existing:
                existing = EmployeeAllocation(
                    employee_id=m.employee_id,
                    employee_name=m.employee_name,
                    project_name=m.project_name,
                    allocation_date=m.allocation_date,
                )
                db.add(existing)
            
            # Update fields
            existing.project_lead = m.project_lead
            existing.delivery_manager = m.delivery_manager
            existing.efforts_percent = m.efforts_percent
            existing.billability_percent = m.billability_percent
            existing.project_status = m.project_status
            existing.client_master = m.client_master
            existing.billing = m.billing
            existing.status = m.status
    
    db.commit()


__all__ = ["sync_now", "reapply_manual_allocations"]
