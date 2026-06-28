"""Integration test for the action registry spine (docs/action-registry-design.md).

Like test_action_receipts, this NEEDS the database. It seeds a throwaway employee (tagged with
a DELETE-ME marker) and removes everything at the end, so it's safe against the dev DB.

    python -m tests.test_action_registry

Covers the properties that matter:
  • dispatch(it_ticket) does the side effect, emits a durable+undoable receipt, appends the line
  • the param-stable idempotency key + the service's own dedupe => a re-dispatch yields ONE
    ticket and ONE receipt (no double side effect)
  • the per-action authorize gate denies BEFORE any side effect (no row, no receipt)
  • dispatch(hr_query) creates the query + receipt; the registry's dedupe step short-circuits a
    re-submit even though the bare service has no dedupe (the spine adds the idempotency)
  • undo still reverses a registry-emitted receipt (shared action_type => shared undo authority)
"""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal, engine
from app.models import ActionReceipt, Employee, HRQuery, ITTicket
from app.services import actions
from app.services import receipt_service as R
from app.services.actions import ActionContext, ActionResult, ActionSpec, dispatch, get
from app.services.actions.catalog.hr_query import HRQueryParams
from app.services.actions.catalog.it_ticket import ITTicketParams

_MARK = "DELETE-ME-registry-test"
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
        db.add(Employee(employee_id=f"E-{_MARK}", name="Registry Tester", email=_EMAIL, role="Employee"))
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


def _count(model) -> int:
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == _EMAIL).first()
        if not emp:
            return 0
        return db.query(model).filter(model.employee_id == emp.id).count()
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
        print("dispatch(it_ticket) -> side effect + receipt + inline line:")
        spec = get("it_ticket")
        ok(spec is not None, "it_ticket is registered in the catalog")
        ctx = ActionContext(actor_email=_EMAIL, actor_role="employee",
                            params=ITTicketParams("Network", "VPN keeps dropping", "since this morning"))
        res = dispatch(spec, ctx)
        ok(res.success and res.confirmation_id, "dispatch succeeds with a confirmation id")
        ok("🧾" in res.human_message and ("undo" in res.human_message.lower()
                                          or "cancel" in res.human_message.lower()),
           "human_message carries the inline receipt+undo line")
        receipts = R.list_for_user(_EMAIL)
        ok(len(receipts) == 1 and receipts[0]["action_type"] == "it_ticket",
           "exactly one it_ticket receipt recorded")
        ok(receipts[0]["undoable"] and receipts[0]["undo_url"], "registry receipt is undoable")
        ticket_id = res.confirmation_id

        print("idempotency — re-dispatch of the same request does not double-execute:")
        res2 = dispatch(spec, ActionContext(
            actor_email=_EMAIL, actor_role="employee",
            params=ITTicketParams("Network", "VPN keeps dropping", "since this morning")))
        ok(res2.confirmation_id == ticket_id and res2.already,
           "re-dispatch dedupes to the same ticket id")
        ok(len(R.list_for_user(_EMAIL)) == 1, "still exactly one receipt after re-dispatch")
        ok(_count(ITTicket) == 1, "exactly one ticket row despite two dispatches")

        print("authorize gate denies before any side effect:")
        gated = ActionSpec(
            key="_gated_probe", label="Gated probe", system="X",
            execute=lambda c: ActionResult(True, "SHOULD-NOT-RUN", "ran"),
            idempotency_key=lambda c: "probe",
            authorize=lambda c: c.actor_role == "admin")
        before = len(R.list_for_user(_EMAIL))
        gres = dispatch(gated, ActionContext(actor_email=_EMAIL, actor_role="employee"))
        ok(not gres.success and gres.error == "forbidden", "non-admin is denied")
        ok(len(R.list_for_user(_EMAIL)) == before, "denied action emits no receipt (no side effect)")

        print("dispatch(hr_query) -> the spine ADDS dedupe the bare service lacks:")
        hspec = get("hr_query")
        hres = dispatch(hspec, ActionContext(
            actor_email=_EMAIL, actor_role="employee",
            params=HRQueryParams("General", "PF transfer status", "moved from prev employer")))
        ok(hres.success and hres.confirmation_id, "dispatch(hr_query) succeeds")
        hrq = next((r for r in R.list_for_user(_EMAIL) if r["action_type"] == "hr_query"), None)
        ok(hrq is not None and hrq["undoable"], "hr_query receipt recorded + undoable")
        hres2 = dispatch(hspec, ActionContext(
            actor_email=_EMAIL, actor_role="employee",
            params=HRQueryParams("General", "PF transfer status", "moved from prev employer")))
        ok(hres2.already and hres2.confirmation_id == hres.confirmation_id,
           "re-submit dedupes to the same HR query (registry dedupe step)")
        ok(_count(HRQuery) == 1, "exactly one HR query row despite two dispatches")

        print("run() — the convenience entry the chat tools now call:")
        ir = actions.run("it_ticket", actor_email=_EMAIL, actor_role="employee",
                         category="Hardware", subject="Laptop won't boot",
                         description="black screen on power", priority="High")
        ok(ir.success and ir.confirmation_id and "🧾" in ir.human_message,
           "run('it_ticket') creates a ticket and returns the receipt line")
        feed = R.list_for_user(_EMAIL)
        rec = next((r for r in feed if r["confirmation_id"] == ir.confirmation_id), None)
        ok(rec is not None and rec["summary"] == "IT ticket: Laptop won't boot",
           "receipt-feed summary stays the short form (behaviour preserved, not the verbose msg)")
        ir2 = actions.run("it_ticket", actor_email=_EMAIL, category="Hardware",
                          subject="Laptop won't boot", description="black screen on power",
                          priority="High")
        ok(ir2.already and ir2.confirmation_id == ir.confirmation_id, "run() re-issue dedupes")

        n_before = _count(ITTicket)
        bad = actions.run("it_ticket", actor_email=_EMAIL, category="Hardware",
                          subject="", description="x")
        ok(not bad.success and bad.error == "invalid_params",
           "run() rejects empty required params")
        ok(_count(ITTicket) == n_before, "rejected params create no ticket (no side effect)")

        unknown = actions.run("nope", actor_email=_EMAIL)
        ok(not unknown.success and unknown.error == "unknown_action", "run() flags an unknown key")

        print("undo reverses a registry-emitted receipt:")
        ures = R.undo(_token_for(ticket_id))
        ok(ures.get("success"), "undo succeeds on the registry-emitted IT ticket receipt")
        db = SessionLocal()
        try:
            t = db.query(ITTicket).filter(ITTicket.ticket_id == ticket_id).first()
            ok(t and t.status == "Cancelled", "ticket is Cancelled downstream")
        finally:
            db.close()
    finally:
        _cleanup()

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
