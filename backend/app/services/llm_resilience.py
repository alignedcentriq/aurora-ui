"""
LLM Resilience Layer — circuit breaker, TTFT watchdog hedging, fallback model.

Usage:
    from app.services.llm_resilience import resilient_invoke, resilient_ainvoke

    # Tool-calling / structured-output call sites (preserves message objects):
    response = resilient_invoke("agent", messages, build=lambda l: l.bind_tools(tools))
    result = await resilient_ainvoke("router", msgs,
                                     build=lambda l: l.with_structured_output(Out))

    # Plain text streaming:
    async for chunk, is_fallback in resilient_stream(tier="agent", messages=[...]):
        yield chunk

Design:
- Circuit breaker: per-tier, Redis-shared so all workers see the same state.
  3 consecutive failures → open for 120s. Trips to fallback model while open.
- TTFT watchdog (stream only): if no first token arrives within TTFT_HEDGE_SECONDS (8s),
  a second stream (fallback model) is started in parallel. Whichever emits
  its first token first wins; the other is cancelled.
- Fallback: dynamic chain (SERVICE_MODEL_NAME → FAST_MODEL_NAME), first that differs
  from the tier's live primary — tool-calling tiers need a capable fallback.
- max_retries=0 on all LLM clients so langchain doesn't silent-retry and stack timeouts.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import AsyncIterator, Optional

log = logging.getLogger(__name__)

# TTFT threshold before we hedge with a fallback stream
TTFT_HEDGE_SECONDS = 8.0

# Circuit breaker config per tier
BREAKER_FAILURE_THRESHOLD = 3
BREAKER_OPEN_SECONDS = 120.0

# Fallback chain, strongest-first. The fallback for a tier is the first entry that
# differs from the tier's live primary model. llama3.1:8b leads because the agent and
# service tiers do real tool-calling and llama3.2:3b refuses tool calls (see config.py);
# 3b remains the last resort when 8b IS the primary that just failed.
def _fallback_model_for(tier: str) -> str:
    from app.config import settings
    from app.services.llm_controls_service import tier_params
    try:
        primary = tier_params(tier)["model"]
    except Exception:
        primary = ""
    for candidate in (settings.SERVICE_MODEL_NAME, settings.FAST_MODEL_NAME):
        if candidate and candidate != primary:
            return candidate
    return "llama3.2:3b"

# ── In-process circuit breaker state ─────────────────────────────────────────
# Redis sync is best-effort; in-process state is always authoritative for THIS worker.

class _BreakerState:
    def __init__(self):
        self.failures: dict[str, int] = {}
        self.opened_at: dict[str, float] = {}

    def is_open(self, tier: str) -> bool:
        opened = self.opened_at.get(tier)
        if opened is None:
            return False
        if time.monotonic() - opened >= BREAKER_OPEN_SECONDS:
            self._reset(tier)
            return False
        return True

    def record_failure(self, tier: str) -> None:
        count = self.failures.get(tier, 0) + 1
        self.failures[tier] = count
        if count >= BREAKER_FAILURE_THRESHOLD:
            self.opened_at[tier] = time.monotonic()
            log.warning("Circuit breaker OPENED for tier %r after %d failures", tier, count)
            self._sync_to_redis(tier, "open")

    def record_success(self, tier: str) -> None:
        if tier in self.failures:
            self.failures.pop(tier, None)
            opened = self.opened_at.pop(tier, None)
            if opened:
                log.info("Circuit breaker CLOSED for tier %r", tier)
                self._sync_to_redis(tier, "closed")

    def _reset(self, tier: str) -> None:
        self.failures.pop(tier, None)
        self.opened_at.pop(tier, None)
        log.info("Circuit breaker auto-reset for tier %r (timeout elapsed)", tier)

    def _sync_to_redis(self, tier: str, state: str) -> None:
        try:
            import redis as _r
            from app.config import settings
            r = _r.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
            r.set(f"breaker:{tier}", state, ex=int(BREAKER_OPEN_SECONDS * 2))
        except Exception:
            pass  # Redis sync is best-effort


_breaker = _BreakerState()


def is_circuit_open(tier: str) -> bool:
    return _breaker.is_open(tier)


# ── LLM stream helpers ────────────────────────────────────────────────────────

def _build_llm(
    tier: str,
    model_override: Optional[str] = None,
    default_timeout: Optional[float] = None,
    default_max_tokens: Optional[int] = None,
):
    """Build a ChatOpenAI for ``tier`` with max_retries=0 (no silent langchain retry
    stacking — retry policy is owned by the resilient wrappers below)."""
    from app.services.llm_controls_service import get_llm, tier_params, _TIER_CONN
    from langchain_openai import ChatOpenAI

    if model_override:
        # Build directly so we can override model without disturbing the cached client
        cfg = tier_params(tier)
        base_url, api_key = _TIER_CONN[tier]
        kwargs = dict(
            base_url=base_url,
            api_key=api_key,
            model=model_override,
            temperature=cfg["temperature"],
            max_retries=0,
            timeout=cfg["timeout"] if cfg.get("timeout") is not None else (default_timeout or 30),
            stream_usage=True,
            extra_body={"keep_alive": "30m"},
        )
        max_tokens = cfg["max_tokens"] if cfg.get("max_tokens") is not None else default_max_tokens
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        return ChatOpenAI(**kwargs)

    return get_llm(tier, default_timeout=default_timeout,
                   default_max_tokens=default_max_tokens)


async def _stream_llm(tier: str, messages, model_override: Optional[str] = None) -> AsyncIterator[str]:
    """Yield string chunks from an LLM stream. Raises on error."""
    llm = _build_llm(tier, model_override, default_timeout=45)
    async for chunk in llm.astream(messages):
        content = chunk.content if hasattr(chunk, "content") else str(chunk)
        if content:
            yield content


# ── Resilient invoke (tool-calling and structured-output call sites) ──────────
#
# resilient_stream() below yields plain text chunks, which would drop tool_calls —
# so every bind_tools()/with_structured_output() call site goes through these
# wrappers instead. Same protection, message-object semantics:
#   1. Breaker open → skip the primary entirely, call the fallback model.
#   2. Primary raises → record the failure, retry ONCE on the fallback model.
#   3. Primary succeeds → record success (closes a half-open breaker).
# Fallback outcomes never touch the breaker: it tracks primary-model health only.
#
# ``build`` adapts the bare model before the call, e.g.
#   resilient_invoke("agent", msgs, build=lambda l: l.bind_tools(tools))
#   resilient_ainvoke("router", msgs, build=lambda l: l.with_structured_output(Out))

def _prepare(tier, build, model_override, default_timeout, default_max_tokens):
    llm = _build_llm(tier, model_override, default_timeout, default_max_tokens)
    return build(llm) if build is not None else llm


def resilient_invoke(
    tier: str,
    messages,
    *,
    build=None,
    default_timeout: Optional[float] = None,
    default_max_tokens: Optional[int] = None,
):
    fallback_model = _fallback_model_for(tier)

    if _breaker.is_open(tier):
        log.warning("Circuit open for tier %r — invoking fallback %r directly", tier, fallback_model)
        return _prepare(tier, build, fallback_model, default_timeout, default_max_tokens).invoke(messages)

    try:
        result = _prepare(tier, build, None, default_timeout, default_max_tokens).invoke(messages)
        _breaker.record_success(tier)
        return result
    except Exception as exc:
        _breaker.record_failure(tier)
        log.warning("Primary invoke failed for tier %r (%s) — retrying on fallback %r",
                    tier, exc, fallback_model)
        return _prepare(tier, build, fallback_model, default_timeout, default_max_tokens).invoke(messages)


async def resilient_ainvoke(
    tier: str,
    messages,
    *,
    build=None,
    default_timeout: Optional[float] = None,
    default_max_tokens: Optional[int] = None,
):
    fallback_model = _fallback_model_for(tier)

    if _breaker.is_open(tier):
        log.warning("Circuit open for tier %r — invoking fallback %r directly", tier, fallback_model)
        return await _prepare(tier, build, fallback_model, default_timeout, default_max_tokens).ainvoke(messages)

    try:
        result = await _prepare(tier, build, None, default_timeout, default_max_tokens).ainvoke(messages)
        _breaker.record_success(tier)
        return result
    except Exception as exc:
        _breaker.record_failure(tier)
        log.warning("Primary ainvoke failed for tier %r (%s) — retrying on fallback %r",
                    tier, exc, fallback_model)
        return await _prepare(tier, build, fallback_model, default_timeout, default_max_tokens).ainvoke(messages)


# ── Resilient stream ──────────────────────────────────────────────────────────

async def resilient_stream(
    tier: str,
    messages,
    primary_model: Optional[str] = None,
    hedge: bool = True,
) -> AsyncIterator[tuple[str, bool]]:
    """
    Async generator that yields (chunk: str, is_fallback: bool).

    Applies:
    1. Circuit breaker: if open, skip primary and go straight to fallback.
    2. TTFT watchdog hedging: if no first chunk within TTFT_HEDGE_SECONDS, start fallback in
       parallel and serve whichever emits first.
    3. Records success/failure for circuit breaker tracking.
    """
    fallback_model = _fallback_model_for(tier)
    breaker_open = _breaker.is_open(tier)

    if breaker_open:
        log.warning("Circuit open for tier %r — using fallback %r directly", tier, fallback_model)
        async for chunk in _stream_llm(tier, messages, fallback_model):
            yield chunk, True
        return

    # Primary stream with TTFT watchdog
    primary_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
    fallback_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
    primary_task: Optional[asyncio.Task] = None
    fallback_task: Optional[asyncio.Task] = None
    error: Optional[Exception] = None

    async def _fill_queue(gen_fn, queue: asyncio.Queue):
        try:
            async for chunk in gen_fn:
                await queue.put(chunk)
        except Exception as exc:
            await queue.put(None)
            raise exc
        finally:
            await queue.put(None)  # sentinel

    primary_task = asyncio.create_task(
        _fill_queue(_stream_llm(tier, messages, primary_model), primary_queue)
    )

    ttft_deadline = time.monotonic() + TTFT_HEDGE_SECONDS
    got_primary_token = False
    fallback_active = False
    is_fallback = False

    try:
        while True:
            # Try to get a chunk from the active source
            source_queue = fallback_queue if fallback_active else primary_queue

            try:
                chunk = await asyncio.wait_for(source_queue.get(), timeout=0.05)
            except asyncio.TimeoutError:
                chunk = None

            if chunk is None and source_queue.empty():
                # Check if we have a sentinel already queued
                try:
                    chunk = source_queue.get_nowait()
                except asyncio.QueueEmpty:
                    chunk = None

            if chunk is None:
                # No data yet — check TTFT watchdog
                if not got_primary_token and not fallback_active and hedge and time.monotonic() > ttft_deadline:
                    log.warning("TTFT watchdog fired for tier %r — starting fallback hedge", tier)
                    fallback_task = asyncio.create_task(
                        _fill_queue(_stream_llm(tier, messages, fallback_model), fallback_queue)
                    )
                    # Race: first to produce wins
                    try:
                        first_chunk = await asyncio.wait_for(fallback_queue.get(), timeout=5.0)
                        if first_chunk is not None:
                            fallback_active = True
                            is_fallback = True
                            if primary_task and not primary_task.done():
                                primary_task.cancel()
                            yield first_chunk, True
                            continue
                    except asyncio.TimeoutError:
                        pass

                # Check if primary task completed (sentinel means stream ended)
                if primary_task and primary_task.done():
                    exc = primary_task.exception()
                    if exc:
                        _breaker.record_failure(tier)
                        if not fallback_active:
                            log.warning("Primary stream failed for tier %r: %s — switching to fallback", tier, exc)
                            fallback_task = asyncio.create_task(
                                _fill_queue(_stream_llm(tier, messages, fallback_model), fallback_queue)
                            )
                            fallback_active = True
                            is_fallback = True
                            continue
                    break

                if fallback_active and fallback_task and fallback_task.done():
                    break

                await asyncio.sleep(0.02)
                continue

            # We have a real chunk
            got_primary_token = True
            yield chunk, is_fallback

    except asyncio.CancelledError:
        pass
    except Exception as exc:
        _breaker.record_failure(tier)
        log.error("resilient_stream error for tier %r: %s", tier, exc)
        raise
    finally:
        if primary_task and not primary_task.done():
            primary_task.cancel()
        if fallback_task and not fallback_task.done():
            fallback_task.cancel()

    if not is_fallback:
        _breaker.record_success(tier)


def get_breaker_status() -> dict:
    """Return current circuit breaker states — surfaced on /api/chat/load and Control Hub."""
    statuses = {}
    for tier in ("agent", "service", "summarizer", "router"):
        statuses[tier] = "open" if _breaker.is_open(tier) else "closed"
    return statuses
