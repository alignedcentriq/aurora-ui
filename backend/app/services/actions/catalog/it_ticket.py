"""it_ticket — raise an IT helpdesk ticket.

Wraps ITService._create_ticket_core (the side effect) so the registry owns idempotency +
receipt. Undo (cancel-while-Open) is already registered in receipt_service for action_type
"it_ticket", which is the single undo authority, so this spec does not re-declare it.
See docs/action-registry-design.md.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.services.actions.registry import ActionContext, ActionResult, ActionSpec, register
from app.services.it_service import ITService


@dataclass
class ITTicketParams:
    category: str
    subject: str
    description: str
    priority: str = "Medium"

    def __post_init__(self):
        for field in ("category", "subject", "description"):
            if not (getattr(self, field) or "").strip():
                raise ValueError(f"it_ticket: '{field}' is required")
        self.priority = (self.priority or "Medium").strip()


def _idempotency_key(ctx: ActionContext) -> str:
    """Stable key from the request content — a retry of the SAME request reuses one receipt.
    (Better than the legacy ticket-id key, which is unique per row and so never dedupes.)"""
    p: ITTicketParams = ctx.params
    raw = f"{ctx.actor_email}|{p.category}|{p.subject}|{p.description}".lower()
    return "it_ticket:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _execute(ctx: ActionContext) -> ActionResult:
    p: ITTicketParams = ctx.params
    core = ITService._create_ticket_core(
        ctx.db, ctx.actor_email, p.category, p.subject, p.description, p.priority)
    return ActionResult(success=True, confirmation_id=core["confirmation_id"],
                        human_message=core["message"], summary=f"IT ticket: {p.subject}",
                        already=core["already"])


def _preview(ctx: ActionContext) -> str:
    p: ITTicketParams = ctx.params
    return (f"Raise an IT ticket — **{p.subject}** "
            f"({p.category}, {p.priority} priority) for {ctx.actor_email}.")


register(ActionSpec(
    key="it_ticket",
    label="Raise IT ticket",
    system="IT Helpdesk (ManageEngine)",
    execute=_execute,
    idempotency_key=_idempotency_key,
    params_model=ITTicketParams,
    preview=_preview,
    authorize=lambda ctx: True,   # any user may raise their own ticket
    # dedupe handled inside _create_ticket_core (find_recent_duplicate) — it returns already=True
    # undo: already wired in receipt_service for "it_ticket" (cancel-while-Open)
))
