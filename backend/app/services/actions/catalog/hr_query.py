"""hr_query — raise an HR query.

Wraps HRService._submit_hr_query_core (the side effect). The bare service has NO content
dedupe, so this spec adds one via the registry's dedupe step — a demonstration that the spine
can *add* idempotency a service lacks. Undo (withdraw-while-Open) is already registered in
receipt_service for action_type "hr_query". See docs/action-registry-design.md.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Optional

from app.services.actions.registry import ActionContext, ActionResult, ActionSpec, register
from app.hr_service import HRService


@dataclass
class HRQueryParams:
    category: str
    subject: str
    description: str

    def __post_init__(self):
        for field in ("category", "subject", "description"):
            if not (getattr(self, field) or "").strip():
                raise ValueError(f"hr_query: '{field}' is required")


def _idempotency_key(ctx: ActionContext) -> str:
    p: HRQueryParams = ctx.params
    raw = f"{ctx.actor_email}|{p.category}|{p.subject}|{p.description}".lower()
    return "hr_query:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _dedupe(ctx: ActionContext) -> Optional[str]:
    """Recent identical query by the same employee → return its reference id (no 2nd row)."""
    from app.models import HRQuery
    from app.services.idempotency import find_recent_duplicate
    emp = HRService.get_employee_by_email(ctx.db, ctx.actor_email)
    if not emp:
        return None
    p: HRQueryParams = ctx.params
    dup = find_recent_duplicate(
        ctx.db, HRQuery, window_seconds=120,
        employee_id=emp.id, subject=p.subject, description=p.description)
    return dup.reference_id if dup else None


def _execute(ctx: ActionContext) -> ActionResult:
    p: HRQueryParams = ctx.params
    core = HRService._submit_hr_query_core(
        ctx.db, ctx.actor_email, p.category, p.subject, p.description)
    return ActionResult(success=True, confirmation_id=core["confirmation_id"],
                        human_message=core["message"], summary=f"HR query: {p.subject}",
                        already=core["already"])


def _preview(ctx: ActionContext) -> str:
    p: HRQueryParams = ctx.params
    return f"Raise an HR query — **{p.subject}** ({p.category}) for {ctx.actor_email}."


register(ActionSpec(
    key="hr_query",
    label="Raise HR query",
    system="HR",
    execute=_execute,
    idempotency_key=_idempotency_key,
    params_model=HRQueryParams,
    dedupe=_dedupe,
    preview=_preview,
    authorize=lambda ctx: True,   # any user may raise their own HR query
    # undo: already wired in receipt_service for "hr_query" (withdraw-while-Open)
))
