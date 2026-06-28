"""onboarding_complete_step — mark a step of an employee's onboarding journey done.

Routes manual step completion through the write-side spine so it gets the same durable
receipt + one-click undo as any other action. The side effect is OnboardingService.mark_step;
undo flips the step back to pending (and reopens the journey if it had just completed).

Authorization: a hire completes their OWN steps; HR/Admin may complete anyone's (helping a
joiner along, or correcting state). See docs/action-registry-design.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.actions.registry import ActionContext, ActionResult, ActionSpec, register
from app.services import onboarding_service
from app.services import onboarding_template as tmpl


@dataclass
class OnboardingStepParams:
    step_key: str
    employee_email: str = ""        # defaults to the actor (completing your own step)

    def __post_init__(self):
        self.step_key = (self.step_key or "").strip()
        if not self.step_key:
            raise ValueError("onboarding_complete_step: 'step_key' is required")
        if tmpl.get_step(self.step_key) is None:
            raise ValueError(f"onboarding_complete_step: unknown step '{self.step_key}'")
        self.employee_email = (self.employee_email or "").strip().lower()


def _target_email(ctx: ActionContext) -> str:
    p: OnboardingStepParams = ctx.params
    return p.employee_email or (ctx.actor_email or "").strip().lower()


def _authorize(ctx: ActionContext) -> bool:
    target = _target_email(ctx)
    actor = (ctx.actor_email or "").strip().lower()
    return target == actor or ctx.actor_role in {"hr", "admin", "super admin"}


def _idempotency_key(ctx: ActionContext) -> str:
    p: OnboardingStepParams = ctx.params
    return f"onboarding_step:{_target_email(ctx)}:{p.step_key}"


def _execute(ctx: ActionContext) -> ActionResult:
    p: OnboardingStepParams = ctx.params
    target = _target_email(ctx)
    db, emp, journey = onboarding_service.get_journey_for(target)
    if emp is None:
        return ActionResult(False, error="not_found",
                            human_message=f"No employee found for {target}.")
    try:
        row = onboarding_service.mark_step(db, journey, p.step_key, "done", actor_email=ctx.actor_email)
        step = tmpl.get_step(p.step_key)
        title = step.title if step else p.step_key
        return ActionResult(
            success=True,
            confirmation_id=f"OB-STEP-{row.id}",   # carries the progress-row id for undo
            human_message=f"Marked **{title}** as done. ✓",
            summary=f"Onboarding: {title} completed",
        )
    finally:
        db.close()


def _undo(r) -> dict:
    """Flip the step back to pending. `r` is the ActionReceipt; confirmation_id encodes the
    OnboardingStepProgress row id (OB-STEP-<id>)."""
    from app.database import SessionLocal
    from app.models import OnboardingStepProgress, OnboardingJourney

    raw = (r.confirmation_id or "").replace("OB-STEP-", "").strip()
    if not raw.isdigit():
        return {"success": False, "error": "invalid", "message": "Can't locate that onboarding step."}
    db = SessionLocal()
    try:
        row = db.query(OnboardingStepProgress).filter(OnboardingStepProgress.id == int(raw)).first()
        if not row:
            return {"success": False, "error": "not_found", "message": "That onboarding step no longer exists."}
        if row.status != "done":
            return {"success": True, "already": True, "message": "That step is already not completed."}
        row.status = "pending"
        row.completed_at = None
        row.completed_by = None
        db.commit()
        journey = db.query(OnboardingJourney).filter(OnboardingJourney.id == row.journey_id).first()
        if journey:
            onboarding_service.recompute(db, journey)
        return {"success": True, "message": "Step marked as not done again.",
                "summary": "Onboarding step reopened"}
    finally:
        db.close()


def _preview(ctx: ActionContext) -> str:
    p: OnboardingStepParams = ctx.params
    step = tmpl.get_step(p.step_key)
    return f"Mark onboarding step **{step.title if step else p.step_key}** as done for {_target_email(ctx)}."


register(ActionSpec(
    key="onboarding_complete_step",
    label="Complete onboarding step",
    system="Onboarding",
    execute=_execute,
    idempotency_key=_idempotency_key,
    params_model=OnboardingStepParams,
    authorize=_authorize,
    preview=_preview,
    undo=_undo,
    undo_verb="reopen step",
))
