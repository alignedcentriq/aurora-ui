"""Unit tests for the "did you mean X?" clarification card.

Pure / no DB: exercises _expand_query's broadened vocabulary and the quick-choice
card builder. Mirrors the style of test_abstention_handoff.py.

    python -m tests.test_did_you_mean_card
"""

import sys
import json

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from langchain_core.messages import HumanMessage, ToolMessage

from app.agent import _did_you_mean_card, QUICK_CHOICE_START, QUICK_CHOICE_END
from app.services.policy_service import _expand_query, DID_YOU_MEAN_SENTINEL
from app.services.fuzzy_match import best_fuzzy_match


def _sentinel_msg(suggestion: str) -> ToolMessage:
    # Mirrors what _hybrid_search returns when _expand_query flags a likely typo.
    return ToolMessage(
        content=(f"{DID_YOU_MEAN_SENTINEL}{suggestion}\n"
                  f"I couldn't find a policy matching your query. Did you mean "
                  f"**{suggestion}**? Please try again with the correct term."),
        tool_call_id="t1",
    )


def _state(question: str) -> dict:
    return {"messages": [HumanMessage(content=question)]}


def _card_options(card_msg) -> list:
    raw = card_msg.content
    body = raw.split(QUICK_CHOICE_START, 1)[1].split(QUICK_CHOICE_END, 1)[0]
    return json.loads(body)["options"]


def main():
    fails = []

    def ok(cond, msg):
        mark = "PASS" if cond else "FAIL"
        print(f"  [{mark}] {msg}")
        if not cond:
            fails.append(msg)

    print("_expand_query — real-word confusable is caught (not a character-level typo):")
    _, suggestion = _expand_query("what is left policy")
    ok(suggestion == "leave", f"'left' -> 'leave' (got {suggestion!r})")

    print("_expand_query — genuine typos against the broadened domain vocabulary:")
    _, s2 = _expand_query("materinty leave policy")
    ok(s2 == "maternity", f"'materinty' -> 'maternity' (got {s2!r})")

    print("_expand_query — acronym expansion still works (existing behavior untouched):")
    _, s3 = _expand_query("posh policy")
    ok(s3 is None, "exact acronym hit -> no fuzzy suggestion needed")
    expanded, _ = _expand_query("posh policy")
    ok("sexual harassment" in expanded, "'posh' expands to its full form")

    print("_expand_query — common words are never mis-suggested:")
    _, s4 = _expand_query("what is the leave policy")
    ok(s4 is None, "correctly-spelled query produces no suggestion")

    print("best_fuzzy_match — shared helper for fixed-vocabulary lookups:")
    ok(best_fuzzy_match("Slaween", ["Salween", "Irrawaddy"]) == "Salween",
       "nearest room/project/book name found above cutoff")
    ok(best_fuzzy_match("xyz", ["Salween", "Irrawaddy"]) is None,
       "no suggestion when nothing clears the cutoff")

    print("card builder — fires only on a genuine DID_YOU_MEAN_SENTINEL hit:")
    card = _did_you_mean_card(_state("what is left policy"), [_sentinel_msg("leave")], "hr")
    ok(card is not None and QUICK_CHOICE_START in card.content,
       "sentinel hit -> quick-choice card")
    ok(_did_you_mean_card(_state("q"), [ToolMessage(content="here is the answer", tool_call_id="t")], "hr") is None,
       "no sentinel (real answer) -> None")
    ok(_did_you_mean_card({"messages": []}, [_sentinel_msg("leave")], "hr") is None,
       "no user question -> None")

    print("card builder — 'yes' option round-trips into the corrected query:")
    options = _card_options(card)
    ok(options[0]["value"] == "leave", f"first option value is the correction (got {options[0]['value']!r})")
    ok(len(options) == 2, "exactly two options: accept correction, or rephrase")

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
