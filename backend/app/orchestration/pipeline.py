"""Shared agent pipeline — Abstraction C of the target architecture (ARB #25).

Every domain agent runs through this pipeline:
  Pre-hooks  → domain agent dispatch → Post-hooks

Pre-hooks run before the agent node receives the state:
  - context_inject  : inject conversation summary + feedback context
  - query_resolve   : resolve follow-up references to standalone queries
  - session_load    : load pending-action state from durable store

Post-hooks run after the agent node produces its response:
  - receipt_emit    : emit ActionReceipt for any completed write action
  - cache_write     : store informational answers in the semantic cache
  - nudge_check     : detect expiry / stale-approval nudges (best-effort)

Usage::

    pipeline = SharedPipeline()
    pipeline.register_pre("my_hook", my_pre_hook_fn)
    pipeline.register_post("my_hook", my_post_hook_fn)

    # In an agent node:
    state = await pipeline.run_pre(state)
    result = await domain_agent(state)
    result = await pipeline.run_post(state, result)

All hooks are async; sync callables are wrapped transparently.
Hooks that raise are logged and skipped — a bad hook must never crash an agent.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger("aurora-logger")

# Type aliases
StateDict = dict[str, Any]
PreHook  = Callable[[StateDict], Awaitable[StateDict] | StateDict]
PostHook = Callable[[StateDict, StateDict], Awaitable[StateDict] | StateDict]


class SharedPipeline:
    """Ordered pre/post hook lists that all domain agents share.

    Pre-hooks   receive ``state``                  → return modified ``state``
    Post-hooks  receive ``state, agent_result``    → return modified ``agent_result``
    """

    def __init__(self) -> None:
        self._pre:  list[tuple[str, PreHook]]  = []
        self._post: list[tuple[str, PostHook]] = []

    # ── Registration ────────────────────────────────────────────────────────

    def register_pre(self, name: str, fn: PreHook) -> PreHook:
        self._pre.append((name, fn))
        return fn

    def register_post(self, name: str, fn: PostHook) -> PostHook:
        self._post.append((name, fn))
        return fn

    @property
    def pre_names(self) -> list[str]:
        return [n for n, _ in self._pre]

    @property
    def post_names(self) -> list[str]:
        return [n for n, _ in self._post]

    # ── Execution ────────────────────────────────────────────────────────────

    async def run_pre(self, state: StateDict) -> StateDict:
        for name, fn in self._pre:
            try:
                res = fn(state)
                if inspect.isawaitable(res):
                    res = await res
                if isinstance(res, dict):
                    state = res
            except Exception:
                log.exception("pipeline pre-hook %r raised; skipping", name)
        return state

    async def run_post(self, state: StateDict, result: StateDict) -> StateDict:
        for name, fn in self._post:
            try:
                res = fn(state, result)
                if inspect.isawaitable(res):
                    res = await res
                if isinstance(res, dict):
                    result = res
            except Exception:
                log.exception("pipeline post-hook %r raised; skipping", name)
        return result


# ── Built-in pre-hooks ───────────────────────────────────────────────────────

async def _pre_context_inject(state: StateDict) -> StateDict:
    """Inject the rolling conversation summary and feedback context into state.

    No-op if already present (idempotent — safe to call on every turn).
    """
    if state.get("conversation_summary") or state.get("feedback_context"):
        return state
    session_id = state.get("session_id")
    user_email  = state.get("user_email")
    if not session_id:
        return state
    try:
        from app.database import SessionLocal
        from app.models import ConversationSummary
        db = SessionLocal()
        try:
            row = (
                db.query(ConversationSummary)
                .filter_by(session_id=session_id)
                .first()
            )
            if row and row.summary:
                state = {**state, "conversation_summary": row.summary}
        finally:
            db.close()
    except Exception:
        log.debug("pipeline: context_inject failed (non-fatal)")
    return state


async def _pre_session_load(state: StateDict) -> StateDict:
    """Attach any durable pending-action metadata to state so agents see it.

    This is informational only — agents read pending_action via PendingActionService
    directly; this hook makes the existence visible in the state dict for routing.
    """
    draft_key = state.get("session_id") or state.get("user_email")
    if not draft_key:
        return state
    try:
        from app.services.pending_action_service import PendingActionService
        pending = PendingActionService.list_pending(draft_key)
        if pending:
            return {**state, "_pending_action_types": [p["action_type"] for p in pending]}
    except Exception:
        log.debug("pipeline: session_load failed (non-fatal)")
    return state


# ── Built-in post-hooks ──────────────────────────────────────────────────────

async def _post_nudge_check(state: StateDict, result: StateDict) -> StateDict:
    """Kick the nudge detector after a successful answer — best-effort, fire-and-forget."""
    try:
        from app.services.nudge_service import NudgeService
        asyncio.create_task(
            asyncio.to_thread(NudgeService.detect_and_queue, state.get("user_email") or "")
        )
    except Exception:
        log.debug("pipeline: nudge_check failed (non-fatal)")
    return result


# ── Default pipeline singleton ────────────────────────────────────────────────
# Wire built-in hooks.  Domain code can add more via SHARED_PIPELINE.register_*

SHARED_PIPELINE = SharedPipeline()
SHARED_PIPELINE.register_pre("context_inject", _pre_context_inject)
SHARED_PIPELINE.register_pre("session_load", _pre_session_load)
SHARED_PIPELINE.register_post("nudge_check", _post_nudge_check)
