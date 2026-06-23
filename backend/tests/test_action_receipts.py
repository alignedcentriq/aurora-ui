"""Integration test for action receipts + undo (roadmap item 6).

Like test_nudge_service, this NEEDS the database. It seeds a throwaway employee (tagged
with a DELETE-ME marker) and removes everything at the end, so it's safe against the dev DB.

    python -m tests.test_action_receipts

Covers the properties that matter:
  • create_ticket / submit_hr_query emit a receipt and append the inline receipt+undo line
  • emit is idempotent (a re-run / dedupe path never yields a second receipt)
  • undo reverses the real downstream row (ticket/query -> Cancelled), is one-shot + friendly
    on re-click, and REFUSES once the downstream has moved past 'Open'
  • a record-only (undoable=False) receipt carries no undo link
"""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal, engine
from app.models import ActionReceipt, Employee, ITTicket, HRQuery
from app.services.it_service import ITService
from app.hr_service import HRService
from app.services import receipt_service as R

_MARK = "DELETE-ME-receipt-test"
_EMAIL = f"emp.{_MARK}@example.com"


def _ensure_tables():
    ActionReceipt.__table__.create(bind=engine, checkfirst=True)


def _cleanup():
    db = SessionLocal()
    try:
        emp_ids = [e.id for e in db.query(Employee).filter(Employee.email == _EMAIL).all()]
        db.query(ActionReceipt).filter(ActionReceipt.user_email == _EMAIL).delete(synchronize_session=False)
        if emp_ids:
            db.query(ITTicket).filter(ITTicket.employee_id.in_(emp_ids)).delete(synchronize_session=False)
            db.query(HRQuery).filter(HRQuery.employee_id.in_(emp_ids)).delete(synchronize_session=False)
        db.query(Employee).filter(Employee.email == _EMAIL).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _seed():
    db = SessionLocal()
    try:
        db.add(Employee(employee_id=f"E-{_MARK}", name="Receipt Tester", email=_EMAIL, role="Employee"))
        db.commit()
    finally:
        db.close()


def _token_for(confirmation_id: str) -> str:
    db = SessionLocal()
    try:
        r = db.query(ActionReceipt).filter(ActionReceipt.confirmation_id == confirmation_id).first()
        return r.undo_token if r else ""
    finally:
        db.close()


def _ticket_status(ticket_id: str) -> str:
    db = SessionLocal()
    try:
        t = db.query(ITTicket).filter(ITTicket.ticket_id == ticket_id).first()
        return t.status if t else "<gone>"
    finally:
        db.close()


def _set_ticket_status(ticket_id: str, status: str):
    db = SessionLocal()
    try:
        t = db.query(ITTicket).filter(ITTicket.ticket_id == ticket_id).first()
        t.status = status
        db.commit()
    finally:
        db.close()


def main():
    fails = []

    def ok(cond, msg):
        print(f"  [{'PASS' if cond else 'FAIL'}] {msg}")
        if not cond:
            fails.append(msg)

    _ensure_tables()
    _cleanup()
    _seed()
    try:
        print("IT ticket -> receipt + inline undo line:")
        msg = ITService.create_ticket(_EMAIL, "Network", "VPN keeps dropping", "since this morning")
        ok("Ticket ID" in msg and "🧾" in msg and "Undo" in msg.lower() or "cancel ticket" in msg.lower(),
           "create_ticket appends a receipt line with an undo link")
        receipts = R.list_for_user(_EMAIL)
        ok(len(receipts) == 1 and receipts[0]["action_type"] == "it_ticket",
           "exactly one it_ticket receipt recorded")
        ok(receipts[0]["undoable"] and receipts[0]["undo_url"],
           "receipt is undoable with an undo_url")
        ticket_id = receipts[0]["confirmation_id"]

        print("idempotency — a same-window duplicate does not double-log:")
        ITService.create_ticket(_EMAIL, "Network", "VPN keeps dropping", "since this morning")
        ok(len(R.list_for_user(_EMAIL)) == 1, "re-run (dedupe path) still yields one receipt")

        print("peek (the GET confirm page) is read-only — never mutates:")
        tok = _token_for(ticket_id)
        pk = R.peek(tok)
        ok(pk and pk["undoable"] and not pk.get("expired"), "peek reports an undoable receipt")
        R.peek(tok)
        ok(_ticket_status(ticket_id) == "Open", "ticket still Open after peek (no mutation)")
        ok(R.list_for_user(_EMAIL)[0]["status"] == "executed", "receipt still executed after peek")

        print("undo reverses the real downstream row:")
        res = R.undo(tok)
        ok(res.get("success"), "undo succeeds")
        ok(_ticket_status(ticket_id) == "Cancelled", "ticket is now Cancelled downstream")
        after = R.list_for_user(_EMAIL)
        ok(after[0]["status"] == "undone" and not after[0]["undoable"],
           "receipt flips to undone and is no longer undoable")

        print("undo is one-shot + friendly on re-click:")
        res2 = R.undo(tok)
        ok(res2.get("success") and res2.get("already"), "re-undo is a friendly no-op success")

        print("HR query -> receipt -> undo withdraws it:")
        HRService.submit_hr_query(_EMAIL, "General", "PF transfer status", "moved from prev employer")
        hrq = next((r for r in R.list_for_user(_EMAIL) if r["action_type"] == "hr_query"), None)
        ok(hrq is not None and hrq["undoable"], "hr_query receipt recorded + undoable")
        hr_ref = hrq["confirmation_id"]
        ok(R.undo(_token_for(hr_ref)).get("success"), "undo withdraws the HR query")
        db = SessionLocal()
        try:
            q = db.query(HRQuery).filter(HRQuery.reference_id == hr_ref).first()
            ok(q and q.status == "Cancelled", "HR query is Cancelled downstream")
        finally:
            db.close()

        print("undo REFUSES once the downstream has moved past 'Open':")
        msg2 = ITService.create_ticket(_EMAIL, "Access", "need repo access", "for the new service")
        t2 = next(r for r in R.list_for_user(_EMAIL)
                  if r["action_type"] == "it_ticket" and r["confirmation_id"] != ticket_id)["confirmation_id"]
        _set_ticket_status(t2, "In Progress")
        res3 = R.undo(_token_for(t2))
        ok(not res3.get("success") and res3.get("error") == "in_progress",
           "undo refused with in_progress")
        ok(_ticket_status(t2) == "In Progress", "ticket untouched after refused undo")

        print("record-only receipt carries no undo link:")
        snap = R.emit(_EMAIL, "software_install", "IT Helpdesk", "Install Slack",
                      confirmation_id="RE-TEST-9999", undoable=False)
        ok(not snap["undoable"] and not snap["undo_url"], "software_install receipt is not undoable")
        line = R.format_receipt_line(snap)
        ok("RE-TEST-9999" in line and "undo" not in line.lower() and "cancel" not in line.lower(),
           "receipt line shows the ref but no undo link")
    finally:
        _cleanup()

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
