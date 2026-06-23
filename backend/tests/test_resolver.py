"""Unit tests for the routing Resolver abstraction + the migrated deterministic strategies.

Covers the driver mechanics (order = precedence, first-wins, async support, a raising strategy
is skipped not fatal) and the two pure strategies migrated in Phase 3 step 1 (clarify reply,
leave balance). The pending-action strategy needs the DB and is exercised by the live flow /
routing harness, not here.

    python -m tests.test_resolver
"""

import sys
import asyncio

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.services.resolver import Resolver, Decision, RouteContext
from app.agent import (
    _clarify_reply_strategy, _leave_balance_strategy, _leave_params_strategy,
    _exact_dict_strategy, _keyword_high_strategy, _semantic_high_strategy,
    _keyword_fallback_strategy,
    ROUTER_RESOLVER, MAIN_RESOLVER, _CLARIFY_DOMAIN_LABELS,
)


def _ctx(message, **kw):
    return RouteContext(message=message, state=kw.pop("state", {}), **kw)


async def _run_llm_fallback_checks(ok):
    """_llm_fallback_strategy with classify_intent_async / llm_controls / APIConnectionError mocked."""
    import app.agent as agent
    from app.agent import _llm_fallback_strategy, _CLARIFY_DOMAIN_LABELS

    class _Ambig:
        tier = "ambiguous"
        candidate_domains = list(_CLARIFY_DOMAIN_LABELS.keys())[:2]

    orig_classify = agent.classify_intent_async
    orig_controls = agent.llm_controls
    orig_thr = agent.settings.CLARIFY_CONF_THRESHOLD

    class _Controls:
        @staticmethod
        def is_domain_enabled(_d): return True
    agent.llm_controls = _Controls()
    agent.settings.CLARIFY_CONF_THRESHOLD = 0.6
    try:
        # high-confidence -> straight route, carries sub_intent + entities
        async def _hi(msg, candidate_domains=None):
            return {"domain": "pmo", "sub_intent": "list_projects", "confidence": 0.95,
                    "reasoning": "llm", "entities": {"k": "v"}}
        agent.classify_intent_async = _hi
        d = await _llm_fallback_strategy(_ctx("something", decision=_Ambig()))
        ok(d is not None and d.domain == "pmo" and d.entities.get("k") == "v", "confident LLM route passes through")

        # low-confidence non-general -> domain_clarify card with >=2 domains
        async def _lo(msg, candidate_domains=None):
            return {"domain": list(_CLARIFY_DOMAIN_LABELS.keys())[0], "sub_intent": "x",
                    "confidence": 0.3, "reasoning": "unsure", "entities": {}}
        agent.classify_intent_async = _lo
        d = await _llm_fallback_strategy(_ctx("ambiguous thing", decision=_Ambig()))
        ok(d is not None and d.domain == "domain_clarify"
           and len(d.entities.get("clarify_domains", [])) >= 2, "sub-threshold -> domain_clarify card")
        ok(d.entities.get("clarify_question") == "ambiguous thing", "clarify card carries the question")

        # APIConnectionError -> safe general fallback
        async def _boom(msg, candidate_domains=None):
            raise agent.APIConnectionError(request=None)
        agent.classify_intent_async = _boom
        d = await _llm_fallback_strategy(_ctx("x", decision=_Ambig()))
        ok(d is not None and d.domain == "general" and abs(d.confidence - 0.5) < 1e-9,
           "LLM connection error -> general @0.5")
    finally:
        agent.classify_intent_async = orig_classify
        agent.llm_controls = orig_controls
        agent.settings.CLARIFY_CONF_THRESHOLD = orig_thr


def main():
    fails = []

    def ok(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
        if not cond:
            fails.append(msg)

    # ── driver mechanics ────────────────────────────────────────────────────
    print("resolver driver:")

    async def _mechanics():
        r = Resolver()
        r.register("none1", lambda c: None)
        r.register("hit", lambda c: Decision(domain="hr"))
        r.register("never", lambda c: Decision(domain="admin"))
        d = await r.resolve(_ctx("x"))
        ok(d is not None and d.domain == "hr", "first non-None wins (order = precedence)")
        ok(d.strategy == "hit", "driver stamps the winning strategy name")

        r2 = Resolver()
        r2.register("a", lambda c: None)
        ok(await r2.resolve(_ctx("x")) is None, "all defer -> None")

        r3 = Resolver()
        async def _async_hit(c):
            return Decision(domain="pmo")
        r3.register("async", _async_hit)
        d3 = await r3.resolve(_ctx("x"))
        ok(d3 is not None and d3.domain == "pmo", "async strategy awaited")

        r4 = Resolver()
        def _boom(c):
            raise ValueError("boom")
        r4.register("boom", _boom)
        r4.register("recover", lambda c: Decision(domain="general"))
        d4 = await r4.resolve(_ctx("x"))
        ok(d4 is not None and d4.domain == "general", "a raising strategy is skipped, not fatal")

    asyncio.run(_mechanics())

    # ── Decision.as_route shape matches intent_router's contract ─────────────
    print("decision shape:")
    route = Decision(domain="hr", sub_intent="policy_query", confidence=0.9, reasoning="r").as_route()
    ok(route == {"domain": "hr", "route_confidence": 0.9, "route_reasoning": "r",
                 "sub_intent": "policy_query", "entities": {}}, "as_route() renders the route dict")

    # ── migrated pure strategies ─────────────────────────────────────────────
    print("clarify_reply strategy:")
    label = next(iter(_CLARIFY_DOMAIN_LABELS.values()))
    dom = next(iter(_CLARIFY_DOMAIN_LABELS.keys()))
    d = _clarify_reply_strategy(_ctx(f"{label}: my question here"))
    ok(d is not None and d.domain == dom, f"'{label}: ...' -> domain {dom}")
    ok(_clarify_reply_strategy(_ctx("just a normal question")) is None, "non-clarify -> None")

    print("leave_balance strategy:")
    ok(_leave_balance_strategy(_ctx("what is my leave balance")) is not None, "'leave balance' matched")
    d = _leave_balance_strategy(_ctx("how many leaves left"))
    ok(d is not None and d.domain == "deeplink" and d.sub_intent == "leave_balance", "routes to deeplink/leave_balance")
    ok(_leave_balance_strategy(_ctx("apply leave tomorrow")) is None, "'apply leave' is NOT a balance query")

    print("leave_params strategy (post-rewrite):")
    d = _leave_params_strategy(_ctx("apply leave from 2026-07-01 to 2026-07-03"))
    ok(d is not None and d.domain == "deeplink" and d.sub_intent == "zoho_leave_fastpath",
       "extracted leave params -> zoho fast-path")
    ok(d is not None and d.entities, "leave params carried as entities")
    ok(_leave_params_strategy(_ctx("what is the leave policy")) is None, "policy question is not a leave application")

    print("exact_dict strategy (reads ctx.exact):")
    class _FakeExact:
        domain, sub_intent, reasoning = "hr", "policy_query", "exact dictionary hit"
    d = _exact_dict_strategy(_ctx("annual leave policy", exact=_FakeExact()))
    ok(d is not None and d.domain == "hr" and d.sub_intent == "policy_query" and d.confidence == 1.0,
       "ctx.exact present -> exact-dict decision at confidence 1.0")
    ok(_exact_dict_strategy(_ctx("anything", exact=None)) is None, "no exact -> None (defers)")

    print("keyword_high strategy (reads ctx.keyword_result):")
    d = _keyword_high_strategy(_ctx("install slack", keyword_result={
        "domain": "it_support", "sub_intent": "software_install", "confidence": 1.0,
        "reasoning": "kw", "entities": {"software_name": "slack"}}))
    ok(d is not None and d.domain == "it_support" and d.entities.get("software_name") == "slack",
       "confidence==1.0 keyword -> deterministic decision with entities")
    ok(_keyword_high_strategy(_ctx("x", keyword_result={"domain": "hr", "sub_intent": "y",
       "confidence": 0.9, "reasoning": "r"})) is None, "confidence<1.0 keyword -> None (defers)")
    ok(_keyword_high_strategy(_ctx("x", keyword_result=None)) is None, "no keyword -> None")

    print("semantic_high strategy (reads ctx.decision):")
    class _FakeHigh:
        tier, domain, sub_intent, similarity, reasoning = "high", "pmo", "list_projects", 0.91, "knn"
    class _FakeAmbig:
        tier, domain, sub_intent, similarity, reasoning = "ambiguous", "pmo", "x", 0.7, "r"
    d = _semantic_high_strategy(_ctx("list my projects", decision=_FakeHigh()))
    ok(d is not None and d.domain == "pmo" and abs(d.confidence - 0.91) < 1e-9,
       "high-tier semantic -> decision at its similarity")
    ok(_semantic_high_strategy(_ctx("x", decision=_FakeAmbig())) is None, "ambiguous tier -> None (defers)")
    ok(_semantic_high_strategy(_ctx("x", decision=None)) is None, "no decision -> None")

    print("keyword_fallback strategy (any confidence):")
    d = _keyword_fallback_strategy(_ctx("x", keyword_result={"domain": "admin", "sub_intent": "parking",
        "confidence": 0.9, "reasoning": "kw", "entities": {}}))
    ok(d is not None and d.domain == "admin" and abs(d.confidence - 0.9) < 1e-9,
       "any keyword -> decision at its own confidence")
    ok(_keyword_fallback_strategy(_ctx("x", keyword_result=None)) is None, "no keyword -> None")

    print("llm_fallback strategy (terminal; LLM mocked):")
    asyncio.run(_run_llm_fallback_checks(ok))

    print("registered order:")
    ok(ROUTER_RESOLVER.strategy_names == ["clarify_reply", "pending_action", "leave_balance"],
       "raw resolver precedence order intact")
    ok(MAIN_RESOLVER.strategy_names == ["leave_params", "exact_dict", "keyword_high",
                                        "semantic_high", "form_library", "keyword_fallback",
                                        "llm_fallback"],
       "post-rewrite precedence: 7 strategies in order (llm_fallback terminal)")

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
