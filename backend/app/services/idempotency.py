"""Idempotency guard for write operations (action-safety, audit finding #4).

Many create-* service methods had no dedupe, so a double-submit (LLM retry, double-click,
refresh) created two tickets / reimbursements / complaints. find_recent_duplicate() lets a
service cheaply detect a true re-submit: an existing row matching the SAME exact key fields,
created within a short window. Deliberately conservative — exact-match filters + a short
window — so it catches accidental duplicates without ever blocking a genuinely new request.

Usage:
    dup = find_recent_duplicate(db, ITTicket, window_seconds=120,
                                employee_id=emp.id, description=description, status="Open")
    if dup:
        return f"...already created (#{dup.ticket_id})..."
"""

import datetime


def find_recent_duplicate(db, model, *, window_seconds: int = 120, **filters):
    """Return the most-recent row of `model` matching all `filters` and created within
    `window_seconds`, or None. Requires the model to have a `created_at` column."""
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=window_seconds)
    q = db.query(model)
    for field, value in filters.items():
        q = q.filter(getattr(model, field) == value)
    q = q.filter(model.created_at >= cutoff)
    return q.order_by(model.created_at.desc()).first()
