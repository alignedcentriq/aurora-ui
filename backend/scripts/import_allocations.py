"""
One-shot script: clear employee_allocations and reload from the Excel file.

Usage (from repo root, with backend venv active):
    python backend/scripts/import_allocations.py
"""
import sys, os, datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import openpyxl
from sqlalchemy import text
from app.database import SessionLocal, engine
from app.models import EmployeeAllocation, SCHEMA


EXCEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..",
    "Admin Allocation Details - 25 June.xlsx",
)


def _parse_date(val):
    if val is None or val == "":
        return None
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.date() if isinstance(val, datetime.datetime) else val
    try:
        return datetime.datetime.strptime(str(val).strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _clean(val):
    """Return None for empty / whitespace-only strings."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _float(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def main():
    excel_path = os.path.abspath(EXCEL_PATH)
    if not os.path.exists(excel_path):
        print(f"ERROR: Excel file not found at {excel_path}")
        sys.exit(1)

    print(f"Loading workbook: {excel_path}")
    wb = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)
    ws = wb.active

    rows_iter = ws.iter_rows(values_only=True)
    headers = [str(h).strip() if h else "" for h in next(rows_iter)]
    print(f"Columns ({len(headers)}): {headers}")

    col = {h: i for i, h in enumerate(headers)}

    db = SessionLocal()
    try:
        # ── 1. Wipe existing data ─────────────────────────────────────────────
        print("Truncating employee_allocations …")
        db.execute(text(f'TRUNCATE TABLE "{SCHEMA}".employee_allocations RESTART IDENTITY'))
        db.commit()

        # ── 2. Stream rows in batches ─────────────────────────────────────────
        BATCH = 500
        batch, total = [], 0

        for raw in rows_iter:
            zoho_id = _clean(raw[col["Zoho Record ID"]]) if "Zoho Record ID" in col else None

            rec = EmployeeAllocation(
                zoho_record_id   = zoho_id,
                employee_id      = _clean(raw[col.get("Employee ID", -1)]) if "Employee ID" in col else None,
                employee_name    = _clean(raw[col.get("Name", -1)]) if "Name" in col else None,
                project_name     = _clean(raw[col.get("Project Name", -1)]) if "Project Name" in col else None,
                sub_project      = _clean(raw[col.get("Sub Project", -1)]) if "Sub Project" in col else None,
                project_lead     = _clean(raw[col.get("Project Lead", -1)]) if "Project Lead" in col else None,
                delivery_manager = _clean(raw[col.get("Delivery Manager", -1)]) if "Delivery Manager" in col else None,
                completion_status= _clean(raw[col.get("Completion Status", -1)]) if "Completion Status" in col else None,
                efforts_percent  = _float(raw[col["Efforts %"]]) if "Efforts %" in col else None,
                billability_percent = _float(raw[col["Billability %"]]) if "Billability %" in col else None,
                allocation_date  = _parse_date(raw[col["Allocation Date"]]) if "Allocation Date" in col else None,
                project_status   = _clean(raw[col.get("Project Status", -1)]) if "Project Status" in col else None,
                client_master    = _clean(raw[col.get("Client Master", -1)]) if "Client Master" in col else None,
                billing          = _clean(raw[col.get("Billing", -1)]) if "Billing" in col else None,
                project_type     = _clean(raw[col.get("Project Type", -1)]) if "Project Type" in col else None,
                reporting_manager= _clean(raw[col.get("Reporting Manager", -1)]) if "Reporting Manager" in col else None,
                functional_manager= _clean(raw[col.get("Functional Manager", -1)]) if "Functional Manager" in col else None,
                function         = _clean(raw[col.get("Function", -1)]) if "Function" in col else None,
                status           = _clean(raw[col.get("Status-Active/Inactive", -1)]) if "Status-Active/Inactive" in col else None,
                expected_end_date= _parse_date(raw[col["LWD"]]) if "LWD" in col else None,
            )
            batch.append(rec)

            if len(batch) >= BATCH:
                db.bulk_save_objects(batch)
                db.commit()
                total += len(batch)
                batch = []
                print(f"  inserted {total} rows …", end="\r")

        if batch:
            db.bulk_save_objects(batch)
            db.commit()
            total += len(batch)

        print(f"\nDone. {total} allocation rows loaded into employee_allocations.")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()
        wb.close()


if __name__ == "__main__":
    main()
