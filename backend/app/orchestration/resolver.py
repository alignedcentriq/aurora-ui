"""Resolver, Decision, RouteContext — Abstraction B of the target architecture.

Canonical home (ARB #23); migrated from app.services.resolver.
app.services.resolver re-exports from here for backward compatibility.

Strategies may be sync or async (semantic/LLM strategies need I/O); the driver
awaits as needed.  Precedence == registration order; one buggy strategy never
breaks routing for everyone — it is logged and skipped.
"""

from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional, Union

log = logging.getLogger("aurora-logger")


@dataclass
class Decision:
    """A routing decision.  ``as_route()`` renders the dict shape intent_router returns."""
    domain: str
    sub_intent: str = "unknown"
    entities: dict = field(default_factory=dict)
    confidence: float = 1.0
    reasoning: str = ""
    strategy: str = ""  # filled by the driver for observability

    def as_route(self) -> dict:
        return {
            "domain": self.domain,
            "route_confidence": self.confidence,
            "route_reasoning": self.reasoning,
            "sub_intent": self.sub_intent,
            "entities": self.entities or {},
        }


@dataclass
class RouteContext:
    """Everything a strategy may need, computed once per turn and shared.

    message        — text to classify (raw for ROUTER_RESOLVER; resolved for MAIN_RESOLVER)
    state          — live AgentState dict
    keyword_result — pre-computed keyword-regex hit, or None
    exact          — SemanticRouterService.exact_match result, or None
    decision       — SemanticRouterService.classify result, or None
    """
    message: str
    state: dict
    keyword_result: Optional[dict] = None
    exact: object = None
    decision: object = None


# (ctx) -> Decision | None, possibly async.
Strategy = Callable[["RouteContext"], Union[Optional["Decision"], Awaitable[Optional["Decision"]]]]


class Resolver:
    """Ordered registry of strategies; resolves a message to the first confident Decision."""

    def __init__(self) -> None:
        self._strategies: list[tuple[str, Strategy]] = []

    def register(self, name: str, fn: Strategy) -> Strategy:
        """Append a strategy (order = precedence).  Returns fn for use as a decorator."""
        self._strategies.append((name, fn))
        return fn

    def strategy(self, name: str) -> Callable[[Strategy], Strategy]:
        """Decorator: @resolver.strategy("name")."""
        def _wrap(fn: Strategy) -> Strategy:
            self.register(name, fn)
            return fn
        return _wrap

    @property
    def strategy_names(self) -> list[str]:
        return [n for n, _ in self._strategies]

    async def resolve(self, ctx: "RouteContext") -> Optional[Decision]:
        """Run strategies in registration order; return the first non-None Decision.

        A strategy that raises is logged and skipped so one bad strategy never kills
        routing for every request — the next strategy (ultimately llm_fallback) runs.
        """
        for name, fn in self._strategies:
            try:
                res = fn(ctx)
                if inspect.isawaitable(res):
                    res = await res
            except Exception:
                log.exception("resolver: strategy %r raised; skipping", name)
                continue
            if res is not None:
                if isinstance(res, Decision) and not res.strategy:
                    res.strategy = name
                return res
        return None
