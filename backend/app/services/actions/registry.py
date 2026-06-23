"""Action Registry — the shared write-side spine (see docs/action-registry-design.md).

The write-side mirror of resolver.py: where the routing Resolver is an ordered registry of
named strategies ("what does the user want"), this is a registry of named, role-gated,
individually-tested actions ("execute this write safely"). Every state-changing action flows
through one pipeline — authorize -> idempotency -> dedupe -> execute -> emit-receipt — so the
safety choreography (idempotency, the durable receipt, the undo wiring) happens once here
instead of being hand-copied into every service.

Two consumers share this spine: cross-domain bundles (compose actions in one interactive turn)
and the no-code Automation Hub (compose the same actions on a trigger). Neither builds its own
action layer.

Intentionally dependency-light: params are plain dataclasses validated in __post_init__, not
pydantic, so the registry has no import-time coupling to FastAPI.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Optional

from app.database import SessionLocal
from app.services import receipt_service

log = logging.getLogger("aurora-logger")


# ── Types ────────────────────────────────────────────────────────────────────

@dataclass
class ActionContext:
    """One invocation of an action."""
    actor_email: str
    actor_role: str = "employee"        # employee | hr | admin | manager | it | pmo
    params: object = None               # an already-validated params dataclass
    session_key: str = ""               # chat thread id; "" for unattended automation
    source: str = "chat"                # "chat" | "bundle" | "automation"
    bundle_id: Optional[str] = None
    idempotency_key: str = ""           # filled by dispatch from spec.idempotency_key
    db: object = None                   # SessionLocal handle, opened by dispatch


@dataclass
class ActionResult:
    success: bool
    confirmation_id: Optional[str] = None
    human_message: str = ""             # the chat reply (carries the inline receipt line)
    summary: Optional[str] = None       # short receipt-feed text; falls back to human_message
    receipt: Optional[dict] = None
    error: Optional[str] = None
    already: bool = False               # a no-op dedupe hit, not a fresh side effect


@dataclass
class ActionSpec:
    """The static catalog entry for one action type. `key` MUST match the action_type strings
    already in use ("it_ticket", "hr_query", "software_install", ...) so receipts, the pending
    gate, and the undo registry all line up."""
    key: str
    label: str                                          # human verb, e.g. "Raise IT ticket"
    system: str                                         # downstream system, for the receipt
    execute: Callable[[ActionContext], ActionResult]    # the ONLY thing a handler implements
    idempotency_key: Callable[[ActionContext], str]     # stable request key (params + actor)
    params_model: Optional[type] = None                 # dataclass that validates the params
    authorize: Callable[[ActionContext], bool] = lambda ctx: True   # per-action role gate
    dedupe: Optional[Callable[[ActionContext], Optional[str]]] = None  # -> existing conf id
    preview: Optional[Callable[[ActionContext], str]] = None        # render-without-doing
    is_write: bool = True                               # writes confirm + emit a receipt
    undo: Optional[Callable[..., dict]] = None          # registered INTO receipt_service
    undo_verb: str = "undo"


# ── Registry ─────────────────────────────────────────────────────────────────

_REGISTRY: dict[str, ActionSpec] = {}


def register(spec: ActionSpec) -> ActionSpec:
    """Register an action. Wires any undo handler into the ONE undo authority
    (receipt_service._UNDO_HANDLERS) so we never grow a second undo path."""
    if spec.key in _REGISTRY:
        log.warning("[actions] re-registering '%s' (overwriting)", spec.key)
    _REGISTRY[spec.key] = spec
    if spec.undo is not None:
        receipt_service._UNDO_HANDLERS[spec.key] = spec.undo
        receipt_service._UNDO_VERB[spec.key] = spec.undo_verb
    return spec


def get(key: str) -> Optional[ActionSpec]:
    return _REGISTRY.get(key)


def all_specs() -> dict[str, ActionSpec]:
    return dict(_REGISTRY)


# ── The pipeline ───────────────────────────────────────────────────────────────

def dispatch(spec: ActionSpec, ctx: ActionContext) -> ActionResult:
    """Run one action through the full safety pipeline. This is the single place authorization,
    idempotency, and receipt emission live — `spec.execute` does ONLY the side effect."""
    # 1. AUTHORIZE — per action, against ctx.actor; NEVER inherited from a bundle/rule.
    try:
        permitted = bool(spec.authorize(ctx))
    except Exception as exc:
        log.warning("[actions] authorize(%s) raised: %s", spec.key, exc)
        permitted = False
    if not permitted:
        return ActionResult(False, error="forbidden",
                            human_message=f"You're not able to {spec.label.lower()}.")

    # 2. IDEMPOTENCY — derive a stable request key before any side effect.
    try:
        ctx.idempotency_key = spec.idempotency_key(ctx) if spec.idempotency_key else ""
    except Exception as exc:
        log.warning("[actions] idempotency_key(%s) raised: %s", spec.key, exc)
        ctx.idempotency_key = ""

    db = SessionLocal()
    try:
        ctx.db = db
        # 3. DEDUPE (optional) — a true re-submit returns the EXISTING confirmation, no 2nd effect.
        if spec.dedupe:
            try:
                existing = spec.dedupe(ctx)
            except Exception as exc:
                log.warning("[actions] dedupe(%s) raised: %s", spec.key, exc)
                existing = None
            if existing:
                return _finish(spec, ctx, ActionResult(
                    True, confirmation_id=existing, already=True,
                    human_message=f"You already have this — {existing}."))

        # 4. EXECUTE — the handler's only job.
        result = spec.execute(ctx)
        if not result.success:
            return result

        # 5/6. RECEIPT — durable + idempotent + undo, appended once, here.
        return _finish(spec, ctx, result)
    finally:
        db.close()


def run(key: str, *, actor_email: str, actor_role: str = "employee", session_key: str = "",
        source: str = "chat", bundle_id: Optional[str] = None, **params) -> ActionResult:
    """Convenience for call sites: look up the action, build + validate its params, dispatch.

    Keeps each caller a one-liner — `run("it_ticket", actor_email=..., category=..., ...)` —
    and returns the ActionResult (use .human_message for the chat reply). Never raises: an
    unknown key or invalid params come back as a failed ActionResult."""
    spec = get(key)
    if spec is None:
        return ActionResult(False, error="unknown_action",
                            human_message=f"Unknown action: {key}")
    try:
        built = spec.params_model(**params) if spec.params_model else None
    except Exception as exc:
        log.warning("[actions] invalid params for %s: %s", key, exc)
        return ActionResult(False, error="invalid_params", human_message=str(exc))
    ctx = ActionContext(actor_email=actor_email, actor_role=actor_role, params=built,
                        session_key=session_key, source=source, bundle_id=bundle_id)
    return dispatch(spec, ctx)


def _finish(spec: ActionSpec, ctx: ActionContext, result: ActionResult) -> ActionResult:
    """Emit the durable receipt (idempotent on idempotency_key) and append the inline line.
    Never raises — receipt bookkeeping must not break a side effect that already happened."""
    if spec.is_write and result.confirmation_id:
        try:
            result.receipt = receipt_service.emit(
                ctx.actor_email, spec.key, spec.system,
                result.summary or result.human_message or spec.label,
                confirmation_id=result.confirmation_id,
                idempotency_key=ctx.idempotency_key or result.confirmation_id,
                meta={"source": ctx.source, "bundle_id": ctx.bundle_id},
            )
            line = receipt_service.format_receipt_line(result.receipt)
            if line:
                result.human_message = f"{result.human_message}\n\n{line}"
        except Exception as exc:
            log.warning("[actions] receipt emit failed for %s: %s", spec.key, exc)
    return result
