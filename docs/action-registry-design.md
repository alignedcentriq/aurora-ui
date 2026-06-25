# Action Registry — the shared write-side spine

Status: design / proposal · Author-side companion to `target-architecture.md` (Abstraction B,
the routing Resolver) and `action-safety-audit.md` (the PendingAction confirm gate).

## Why this exists

Today a state-changing action is dispatched by hand at each call site. Look at
`ITService.create_ticket` ([it_service.py:29](../backend/app/services/it_service.py#L29)):
it does an idempotency check, performs the side effect, emits a receipt
(`receipt_service.emit` + `format_receipt_line`), wraps everything in `try/except` so
receipt bookkeeping can't break the action, and returns a human string with the receipt
line appended. `HRService.raise_hr_query` repeats the same shape. The automation hub has a
_third_ copy of "send + record". Every new write re-implements the safety choreography, and
each copy is a place to get it subtly wrong.

This is the same disease the routing Resolver cured for reads: ~14 inline branches, implicit
precedence, untestable. The cure is the same — make each action a **registered, named unit
with its own test**, and make the safety choreography happen _once_, in the dispatcher.

Two features need this and neither should build its own action layer:

- **Cross-domain bundles** compose N typed actions in one interactive turn, one confirm,
  child receipts under a parent.
- **The no-code Automation Hub** composes the _same_ typed actions on a trigger, unattended,
  with a dry-run at authoring time.

The registry is the hinge under both. Build it once.

## The shape

```
ActionSpec   — the static catalog entry: declares an action's params, role gate,
               idempotency, dedupe, side effect, preview, and undo.
ActionContext — one invocation: actor (email + role), validated params, session_key,
               source ("chat" | "bundle" | "automation"), db handle, idempotency_key.
ActionResult — success | confirmation_id | human_message | receipt snapshot | error.
dispatch()   — the single pipeline every write flows through. Owns authorize → validate →
               dedupe → execute → emit-receipt. Handlers implement ONLY the side effect.
```

### ActionSpec (the catalog entry)

```python
# backend/app/services/actions/registry.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

@dataclass
class ActionSpec:
    key: str                      # action_type — MUST match existing strings:
                                  # "it_ticket", "hr_query", "software_install",
                                  # "apply_leave", "nudge_manager", "send_email", ...
    label: str                    # human verb, e.g. "Raise IT ticket"
    system: str                   # downstream system name for the receipt, e.g.
                                  # "IT Helpdesk (ManageEngine)"
    params_model: type            # pydantic model — validates + types the params
    is_write: bool = True         # write actions confirm + emit a receipt; reads don't

    # — authorization: evaluated at dispatch, per action, never assumed —
    authorize: Callable[["ActionContext"], bool] = lambda ctx: True

    # — idempotency: deterministic key so retries / re-fires never double-execute —
    idempotency_key: Callable[["ActionContext"], str] = None      # required for writes
    dedupe: Optional[Callable[["ActionContext"], Optional[str]]] = None  # -> existing conf id

    # — the ONLY thing a handler must implement —
    execute: Callable[["ActionContext"], "ActionResult"] = None

    # — render-without-doing, for bundle confirm + automation dry-run —
    preview: Callable[["ActionContext"], str] = None

    # — undo: registers INTO receipt_service._UNDO_HANDLERS (one undo authority) —
    undo: Optional[Callable[..., dict]] = None
    undo_verb: str = "undo"
```

### ActionContext / ActionResult

```python
@dataclass
class ActionContext:
    actor_email: str
    actor_role: str               # "employee" | "hr" | "admin" | "manager" | "it" | "pmo"
    params: object                # an instance of spec.params_model (already validated)
    session_key: str = ""         # chat thread id; "" for automation
    source: str = "chat"          # "chat" | "bundle" | "automation"
    bundle_id: Optional[str] = None
    idempotency_key: str = ""      # filled by dispatch from spec.idempotency_key(ctx)
    db = None                      # SessionLocal handle, opened by dispatch

@dataclass
class ActionResult:
    success: bool
    confirmation_id: Optional[str] = None
    human_message: str = ""
    receipt: Optional[dict] = None     # snapshot from receipt_service.emit
    error: Optional[str] = None
```

## The pipeline — where the boilerplate goes to die

```python
def dispatch(spec: ActionSpec, ctx: ActionContext) -> ActionResult:
    # 1. AUTHORIZE — per-action role gate. A bundle/rule never grants blanket rights.
    if not spec.authorize(ctx):
        return ActionResult(success=False, error="forbidden",
                            human_message=f"You're not able to {spec.label.lower()}.")

    # 2. VALIDATE — params already coerced to spec.params_model upstream; re-assert.
    #    (pydantic validation error -> ActionResult(error="invalid"))

    # 3. IDEMPOTENCY — derive the key once, stash on ctx.
    ctx.idempotency_key = spec.idempotency_key(ctx) if spec.idempotency_key else ""

    # 4. DEDUPE — true re-submit? return the EXISTING receipt, no second side effect.
    if spec.dedupe:
        existing_conf = spec.dedupe(ctx)
        if existing_conf:
            snap = receipt_service.emit(ctx.actor_email, spec.key, spec.system,
                                        spec.label, confirmation_id=existing_conf,
                                        idempotency_key=ctx.idempotency_key)  # emit is idempotent
            return ActionResult(True, existing_conf,
                                human_message=f"You already have this — {existing_conf}.",
                                receipt=snap)

    # 5. EXECUTE — the handler's ONLY job: do the side effect, return conf id + message.
    result = spec.execute(ctx)
    if not result.success:
        return result

    # 6. RECEIPT — durable, idempotent on idempotency_key, undo wired automatically.
    if spec.is_write:
        result.receipt = receipt_service.emit(
            ctx.actor_email, spec.key, spec.system, result.human_message or spec.label,
            confirmation_id=result.confirmation_id, idempotency_key=ctx.idempotency_key,
            meta={"source": ctx.source, "bundle_id": ctx.bundle_id},
        )
        line = receipt_service.format_receipt_line(result.receipt)
        if line:
            result.human_message = f"{result.human_message}\n\n{line}"
    return result
```

Everything in steps 1–6 is what each service hand-rolls today. After this, an action handler
is just: validate-free side effect → `ActionResult(True, confirmation_id, message)`.

## The confirm model — one substrate, two entry points

The PendingAction gate
([pending_action_service.py](../backend/app/services/pending_action_service.py)) does NOT
move — it stays the durable confirm machine. What changes is _who drives it_. The confirmation
step is conditional on `source`; **authorize + idempotency + receipt are unconditional.**

### Interactive (chat / bundle) — propose, then confirm

```python
def propose(spec, ctx) -> str:               # returns the confirmation prompt
    if not spec.authorize(ctx):
        return f"You're not able to {spec.label.lower()}."
    PendingActionService.create(ctx.session_key, spec.key, _payload(ctx.params),
                                user_email=ctx.actor_email,
                                idempotency_key=spec.idempotency_key(ctx))
    return spec.preview(ctx) + "\n\nConfirm?"

# on the user's "yes":
def confirm(spec, ctx) -> ActionResult:
    snap = PendingActionService.confirm(ctx.session_key, spec.key)   # atomic pending->executed
    if not snap:                                                     # double-click / expired
        return ActionResult(False, error="nothing_to_confirm")
    ctx.params = spec.params_model(**snap["payload"])
    return dispatch(spec, ctx)
```

The atomic `pending -> executed` flip is the idempotency guard that already exists
([pending_action_service.py:146](../backend/app/services/pending_action_service.py#L146)) — a
duplicate confirm finds no pending row and is a no-op.

### Unattended (automation) — confirmation moved to authoring time

A rule has no human turn, so the "are you sure?" moves to **authoring**: dry-run preview +
default-OFF + an owner + a kill switch. At fire time the trigger calls `dispatch()` directly
with `source="automation"`, skipping `propose/confirm` but still passing through
authorize → dedupe → receipt. The **actor is the rule's creator** (`created_by` /
`created_by_role`), so the per-action role gate evaluates against the creator's authority —
which is exactly the automation hub's existing access model
([automation_service.py:77](../backend/app/services/automation_service.py#L77)).

```python
# inside the trigger evaluator, per matching entity:
ctx = ActionContext(actor_email=rule.created_by, actor_role=rule.created_by_role,
                    params=spec.params_model(**render_template(rule.action_params, entity)),
                    source="automation",
                    idempotency_key_seed=f"{rule.id}:{entity.id}:{period}")  # dedup per fire
dispatch(spec, ctx)
```

## Authorization is per-action — this is non-negotiable

A bundle may contain an action the actor _cannot_ run (the travel macro's access-request leg
needs manager approval; OOO is self-service). A rule's creator may not be allowed every action
they can drag onto a canvas (an HR author shouldn't auto-create IT tickets unless granted).
So `authorize` lives on the **ActionSpec**, is evaluated **at dispatch**, against the
**ctx.actor**, and is never inferred from the bundle or rule level. Example:

```python
def _it_ticket_authorize(ctx) -> bool:
    return True   # anyone may raise their own IT ticket

def _post_teams_channel_authorize(ctx) -> bool:
    return ctx.actor_role in ("admin", "hr", "it", "manager")   # not every employee
```

## How the two crown jewels consume it

**Bundles.** A `BundlePlan` is an ordered `[(spec_key, params)]`. For each leg: `authorize`

- `preview`. Render one checklist with per-leg opt-out, one confirm. On confirm: create N
  PendingActions sharing a `bundle_id`, `dispatch` each best-effort, collect child receipts,
  emit a parent bundle receipt linking them. Partial failure is _honest_ — cabin booked, OOO
  failed — because each leg owns its own receipt + undo. No cross-system transaction is needed
  or attempted.

**Automation Hub.** `AutomationRule` grows a `trigger` (whitelisted condition catalog —
entity + field + operator + threshold, the same discipline as the analytics metric whitelist)
and an `action` (`spec_key` + a params template). The trigger evaluator runs on the existing
nudge scan loop (`run_due`), reusing `dedup_key` + cooldown so a rule can't re-fire or spam
([nudge_service.py](../backend/app/services/nudge_service.py)). Dry-run = evaluate the
condition + call `preview()` for each match, _without_ `execute` — "this rule would fire for
47 tickets right now."

## Catalog v1 (map to what already exists)

| key                                         | execute wraps                                    | undo                        | authorize           | status              |
| ------------------------------------------- | ------------------------------------------------ | --------------------------- | ------------------- | ------------------- |
| `it_ticket`                                 | `ITService.create_ticket`                        | `cancel_ticket` (Open only) | self                | exists, wrap it     |
| `hr_query`                                  | `HRService.raise_hr_query`                       | `withdraw_hr_query`         | self                | exists, wrap it     |
| `software_install`                          | existing pending email-draft path                | —                           | self                | exists, wrap it     |
| `nudge_manager`                             | resend approval (has cooldown)                   | —                           | self                | exists, wrap it     |
| `apply_leave`                               | Zoho deep-link (informational, `is_write=False`) | —                           | self                | exists, wrap it     |
| `send_email`                                | `automation_service` email send                  | —                           | author role         | exists, wrap it     |
| `post_teams`                                | `notify_teams` (gated OFF)                       | —                           | admin/hr/it/manager | exists, gated       |
| `set_ooo` / `book_cabin` / `access_request` | —                                                | per-system                  | varies              | new (travel bundle) |

## File layout (mirrors `resolver.py`)

```
backend/app/services/actions/
  registry.py          # ActionSpec, ActionContext, ActionResult, register(), dispatch()
  __init__.py          # imports the catalog so registration happens on import
  catalog/
    it_ticket.py       # one module per action; each calls register(ActionSpec(...))
    hr_query.py
    send_email.py
    ...
```

## Migration — strangler, like the Resolver did to `intent_router`

Do **not** rewrite the services. Register an `ActionSpec` whose `execute` calls the existing
`ITService.create_ticket`, then route the chat path through `dispatch`. Because
`receipt_service.emit` is idempotent on `idempotency_key`, a brief window where both the old
inline emit and the new dispatch emit run produces **one** receipt, not two — so migration is
safe action-by-action. Once a service's only caller is the registry, delete its inline receipt
choreography. Each migrated action gets a test, exactly as each routing strategy has one in
`routing_cases.py`.

## Risks / non-goals

- **Params are never free-form for automation.** Templates substitute only whitelisted entity
  fields; everything is validated against `params_model`. This is the injection boundary.
- **One undo authority.** `ActionSpec.undo` registers into the existing
  `receipt_service._UNDO_HANDLERS` — we do not grow a second undo path.
- **No event bus in v1.** Triggers poll on the nudge scan loop. Event-driven ("the instant
  leave is approved") is a v2 refinement, not a prerequisite.
- **The registry does not decide _whether_ to act** — that's the Resolver (chat), the bundle
  planner, or the trigger evaluator. The registry only executes safely once asked.
