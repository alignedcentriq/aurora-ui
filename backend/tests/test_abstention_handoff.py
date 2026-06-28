"""Unit tests for the abstention → action handoff (item 3).

Pure / no DB: exercises the deterministic router overrides and the quick-choice card
builder. The load-bearing property is the ROUND-TRIP — the value a handoff card emits
must route straight back to a ticket-creating sub_intent, never to the policy search that
just abstained (which would loop).

    python -m tests.test_abstention_handoff
"""

import sys
import json

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from langchain_core.messages import HumanMessage, ToolMessage

from app.agent import (
    _try_keyword_route,
    _abstention_handoff_card,
    _ABSTENTION_HANDOFF,
    QUICK_CHOICE_START,
    QUICK_CHOICE_END,
)
from app.services.policy_service import RETRIEVAL_VETO_SENTINEL


def _veto_msg() -> ToolMessage:
    # Mirrors what policy search returns on the semantic veto.
    return ToolMessage(
        content=f"No policies found — {RETRIEVAL_VETO_SENTINEL} are relevant to this question.",
        tool_call_id="t1",
    )


def _state(question: str) -> dict:
    return {"messages": [HumanMessage(content=question)]}


def _card_value(card_msg) -> str:
    """Pull the 'Yes, raise it' option value out of a quick-choice card."""
    raw = card_msg.content
    body = raw.split(QUICK_CHOICE_START, 1)[1].split(QUICK_CHOICE_END, 1)[0]
    payload = json.loads(body)
    return payload["options"][0]["value"]


def main():
    fails = []

    def ok(cond, msg):
        mark = "PASS" if cond else "FAIL"
        print(f"  [{mark}] {msg}")
        if not cond:
            fails.append(msg)

    print("router overrides — handoff phrases route to actions, not search:")
    r = _try_keyword_route("Raise an IT ticket about this — my VPN won't connect")
    ok(r and r["domain"] == "it_support" and r["sub_intent"] == "it_ticket_handoff",
       "IT handoff phrase -> it_support / it_ticket_handoff")
    ok(r and r["entities"].get("handoff_topic") == "my VPN won't connect",
       "IT handoff topic captured (and 'VPN' inside it did NOT steal the route)")

    r = _try_keyword_route("Raise an HR query about this — what is the sabbatical policy")
    ok(r and r["domain"] == "hr" and r["sub_intent"] == "hr_query_handoff",
       "HR handoff phrase -> hr / hr_query_handoff")
    ok(r and r["entities"].get("handoff_topic") == "what is the sabbatical policy",
       "HR handoff topic captured (and 'policy' inside it did NOT route to policy_query)")

    # A handoff topic that contains 'leave' must not be hijacked by the leave routes.
    r = _try_keyword_route("Raise an HR query about this — my leave encashment was wrong")
    ok(r and r["sub_intent"] == "hr_query_handoff",
       "HR handoff with 'leave' in topic still routes to hr_query_handoff")

    print("router — ordinary queries are untouched:")
    r = _try_keyword_route("what is the maternity leave policy")
    ok(not (r and r.get("sub_intent") in ("hr_query_handoff", "it_ticket_handoff")),
       "normal policy question is NOT treated as a handoff")

    print("card builder — fires only on genuine veto + actionable domain:")
    for dom in ("hr", "it_support", "admin"):
        card = _abstention_handoff_card(_state("how do I claim X"), [_veto_msg()], dom)
        ok(card is not None and QUICK_CHOICE_START in card.content,
           f"{dom}: veto + question -> quick-choice handoff card")

    ok(_abstention_handoff_card(_state("q"), [_veto_msg()], "pmo") is None,
       "pmo (no action target) -> None")
    ok(_abstention_handoff_card(_state("q"), [ToolMessage(content="here is the answer", tool_call_id="t")], "hr") is None,
       "no veto (real answer) -> None")
    ok(_abstention_handoff_card({"messages": []}, [_veto_msg()], "hr") is None,
       "no user question -> None")

    print("ROUND-TRIP — card output routes back to an action (no search loop):")
    for dom, expect_intent in (("hr", "hr_query_handoff"),
                               ("admin", "hr_query_handoff"),
                               ("it_support", "it_ticket_handoff")):
        card = _abstention_handoff_card(_state("how do I do X"), [_veto_msg()], dom)
        value = _card_value(card)
        routed = _try_keyword_route(value)
        ok(routed and routed["sub_intent"] == expect_intent,
           f"{dom}: card value {value!r} -> {expect_intent}")

    print("config sanity:")
    ok(set(_ABSTENTION_HANDOFF) == {"hr", "it_support", "admin"},
       "handoff map covers exactly hr/it_support/admin")

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
