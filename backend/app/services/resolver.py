"""The routing Resolver — one ordered list of named strategies (target-architecture Abstraction B).

The conversational brain historically routed via ~14 inline branches in `intent_router` mixing
three mechanisms (keyword regexes, semantic k-NN, LLM). Each fix added another branch, so the
function grew un-testable and precedence became implicit (whatever happened to be earlier won).

This abstraction makes routing a *registered, ordered list of strategies*. Each strategy is a
small callable `(message, state) -> Decision | None`:
  * returns a Decision when it is confident this message is its case,
  * returns None to defer to the next strategy.
The first strategy to return a Decision wins — so precedence is the explicit registration order,
and every routing rule becomes a named unit with its own test (see docs/architecture-redesign.md
§4.2 / Appendix C). Strangler migration: branches move out of `intent_router` into strategies one
slice at a time, the routing harness proving no drift at each step.

Strategies may be sync or async (semantic/LLM strategies need I/O); the driver awaits as needed.
"""

from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional, Union

log = logging.getLogger("aurora-logger")


@dataclass
class Decision:
    """A routing decision. `as_route()` renders the dict shape `intent_router` returns today."""
    domain: str
    sub_intent: str = "unknown"
    entities: dict = field(default_factory=dict)
    confidence: float = 1.0
    reasoning: str = ""
    strategy: str = ""  # which strategy produced this (filled by the driver; observability)

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
    """Everything a strategy may need, computed once per turn and shared across strategies.

    `message` is the text the strategy should classify on (raw for the pre-rewrite resolver,
    resolved for the post-rewrite one). `state` is the live AgentState. The remaining fields are
    routing signals the caller precomputes once (a keyword-regex hit, the exact-dictionary match,
    the semantic k-NN decision) so strategies reuse them instead of recomputing expensive
    embeddings — they are None for the pre-rewrite resolver, populated for the post-rewrite one.
    """
    message: str
    state: dict
    keyword_result: Optional[dict] = None
    exact: object = None      # SemanticRouterService.exact_match result, or None
    decision: object = None   # SemanticRouterService.classify result, or None


# (ctx) -> Decision | None, possibly async.
Strategy = Callable[["RouteContext"], Union[Optional["Decision"], Awaitable[Optional["Decision"]]]]


class Resolver:
    """Ordered registry of strategies; resolves a message to the first confident Decision."""

    def __init__(self) -> None:
        self._strategies: list[tuple[str, Strategy]] = []

    def register(self, name: str, fn: Strategy) -> Strategy:
        """Append a strategy. Order == precedence. Returns fn so it can be used as a decorator."""
        self._strategies.append((name, fn))
        return fn

    def strategy(self, name: str) -> Callable[[Strategy], Strategy]:
        """Decorator form: @resolver.strategy("clarify_reply")."""
        def _wrap(fn: Strategy) -> Strategy:
            self.register(name, fn)
            return fn
        return _wrap

    @property
    def strategy_names(self) -> list[str]:
        return [n for n, _ in self._strategies]

    async def resolve(self, ctx: "RouteContext") -> Optional[Decision]:
        """Run strategies in order; return the first non-None Decision, else None.

        A strategy that raises is logged and skipped — one buggy strategy must never break
        routing for everyone; the next strategy (ultimately the LLM fallback) still runs.
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
