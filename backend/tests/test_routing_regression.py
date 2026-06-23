"""Routing regression harness — Phase 0 of the architecture redesign.

Pins the *current intended* behavior of the deterministic routing layer so the
planned consolidation (docs/architecture-redesign.md) can proceed without
silently reintroducing already-fixed bugs. Cases live in tests/routing_cases.py;
each carries its provenance (often a bug-fix comment in app/agent.py).

Pure logic where it counts: the keyword router, continuation detection, anaphora
detection, and leave-param extraction are all synchronous and need NO database,
embedding model, or LLM. (The semantic/LLM tiers are covered separately by
tests/test_semantic_router.py and are intentionally out of scope here — this
harness must stay deterministic and CI-runnable offline.)

Run with pytest, or directly:

    python -m tests.test_routing_regression
"""

import sys

# The direct runner prints case sources that may contain non-ASCII punctuation; force
# UTF-8 so it never dies on a Windows cp1252 console. (No-op under pytest capture.)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.agent import (
    _try_keyword_route,
    _is_continuation,
    _needs_followup_resolution,
    _try_extract_leave_params,
    _extract_focus,
    _resolve_anaphora_locally,
)
from tests.routing_cases import (
    KEYWORD_CASES,
    REAL_CURATED_CASES,
    KNOWN_GAP_CASES,
    CONTINUATION_CASES,
    ANAPHORA_CASES,
    LEAVE_PARAM_CASES,
    FOCUS_CASES,
    LOCAL_RESOLVE_CASES,
)


# ── per-group checkers: return list of human-readable failure strings ───────────

def _check_keyword(c) -> list[str]:
    route = _try_keyword_route(c["message"])
    fails = []
    got_domain = route["domain"] if route else None
    got_sub = route.get("sub_intent") if route else None

    exp = c["expect_domain"]
    if exp is None:
        if route is not None:
            fails.append(f"expected FALLTHROUGH (no keyword match) but got domain={got_domain!r} sub={got_sub!r}")
    else:
        # A case may accept a SET of domains — routing is classification, and some inputs
        # are legitimately ambiguous (e.g. business-travel expense = admin or hr).
        allowed = list(exp) if isinstance(exp, (list, tuple, set)) else [exp]
        if route is None:
            fails.append(f"expected domain in {allowed!r} but got FALLTHROUGH (no match)")
        else:
            if got_domain not in allowed:
                fails.append(f"domain: expected one of {allowed!r} got {got_domain!r}")
            if c["expect_sub_intent"] is not None and got_sub != c["expect_sub_intent"]:
                fails.append(f"sub_intent: expected {c['expect_sub_intent']!r} got {got_sub!r}")

    if c.get("forbid_sub_intent") is not None and got_sub == c["forbid_sub_intent"]:
        fails.append(f"sub_intent must NOT be {c['forbid_sub_intent']!r} (regression of a fixed misroute)")
    return fails


def _check_bool(c, fn) -> list[str]:
    got = fn(c["message"], c["last_ai"])
    if got != c["expect"]:
        return [f"expected {c['expect']} got {got}"]
    return []


def _check_focus(c) -> list[str]:
    got = _extract_focus(c["last_ai"], "hr", turn=1)
    if c["expect_kind"] is None:
        return [] if got is None else [f"expected None got {got!r}"]
    if got is None:
        return [f"expected kind={c['expect_kind']!r} got None"]
    fails = []
    if got.get("kind") != c["expect_kind"]:
        fails.append(f"kind: expected {c['expect_kind']!r} got {got.get('kind')!r}")
    if c["expect_entities"] is not None and got.get("entities") != c["expect_entities"]:
        fails.append(f"entities: expected {c['expect_entities']!r} got {got.get('entities')!r}")
    return fails


def _check_local_resolve(c) -> list[str]:
    got = _resolve_anaphora_locally(c["message"], c["focus"], c["turn"])
    resolved = got is not None
    if resolved != c["expect_resolved"]:
        return [f"expected resolved={c['expect_resolved']} got {resolved} (value={got!r})"]
    return []


def _check_leave(c) -> list[str]:
    got = _try_extract_leave_params(c["message"])
    if c["expect_none"]:
        return [] if got is None else [f"expected None got {got!r}"]
    if got is None:
        return [f"expected a params dict got None"]
    fails = []
    for k, v in (c["expect"] or {}).items():
        if got.get(k) != v:
            fails.append(f"{k}: expected {v!r} got {got.get(k)!r}")
    return fails


# ── group runner with a readable report ─────────────────────────────────────────

def _run_group(title, cases, checker):
    failures = []
    for c in cases:
        errs = checker(c)
        status = "ok  " if not errs else "FAIL"
        print(f"  {status} [{c['id']}] {c.get('source','')}")
        for e in errs:
            print(f"         - {e}")
            failures.append((c["id"], e))
    return failures


# ── pytest entry points (one per group; each asserts zero failures) ─────────────

def test_keyword_routing():
    fails = _run_group("keyword routing", KEYWORD_CASES, _check_keyword)
    assert not fails, f"{len(fails)} keyword-routing regression(s): {fails}"


def test_real_curated_routing():
    fails = _run_group("real curated", REAL_CURATED_CASES, _check_keyword)
    assert not fails, f"{len(fails)} real-curated regression(s): {fails}"


def _run_known_gaps():
    """Known-gap cases assert the CORRECT answer for inputs the system gets wrong today.
    A still-failing gap is expected (OK). A gap that now PASSES is fixed and must be
    promoted to the curated set — we surface those so they can't be silently forgotten."""
    xpassed = []
    for c in KNOWN_GAP_CASES:
        errs = _check_keyword(c)  # checks against the CORRECT (human) expectation
        if errs:
            print(f"  gap  [{c['id']}] still failing (expected) — {c['source']}")
        else:
            print(f"  XPASS[{c['id']}] now routes correctly — PROMOTE to curated & remove from KNOWN_GAP_CASES")
            xpassed.append(c["id"])
    return xpassed


def test_known_gaps():
    xpassed = _run_known_gaps()
    assert not xpassed, (
        f"known-gap case(s) now route correctly — promote to curated and remove from "
        f"KNOWN_GAP_CASES: {xpassed}"
    )


def test_continuation_detection():
    fails = _run_group("continuation", CONTINUATION_CASES,
                       lambda c: _check_bool(c, _is_continuation))
    assert not fails, f"{len(fails)} continuation regression(s): {fails}"


def test_anaphora_resolution():
    fails = _run_group("anaphora", ANAPHORA_CASES,
                       lambda c: _check_bool(c, _needs_followup_resolution))
    assert not fails, f"{len(fails)} anaphora regression(s): {fails}"


def test_focus_extraction():
    fails = _run_group("focus extraction", FOCUS_CASES, _check_focus)
    assert not fails, f"{len(fails)} focus-extraction regression(s): {fails}"


def test_local_anaphora_resolution():
    fails = _run_group("local resolve", LOCAL_RESOLVE_CASES, _check_local_resolve)
    assert not fails, f"{len(fails)} local-resolve regression(s): {fails}"


def test_leave_param_fastpath():
    fails = _run_group("leave params", LEAVE_PARAM_CASES, _check_leave)
    assert not fails, f"{len(fails)} leave-param regression(s): {fails}"


# ── direct runner (no pytest needed) ────────────────────────────────────────────

def main():
    groups = [
        ("KEYWORD ROUTING", KEYWORD_CASES, _check_keyword),
        ("REAL CURATED (from traffic, human-confirmed)", REAL_CURATED_CASES, _check_keyword),
        ("CONTINUATION", CONTINUATION_CASES, lambda c: _check_bool(c, _is_continuation)),
        ("ANAPHORA RESOLUTION", ANAPHORA_CASES, lambda c: _check_bool(c, _needs_followup_resolution)),
        ("FOCUS EXTRACTION", FOCUS_CASES, _check_focus),
        ("LOCAL ANAPHORA RESOLVE", LOCAL_RESOLVE_CASES, _check_local_resolve),
        ("LEAVE PARAMS", LEAVE_PARAM_CASES, _check_leave),
    ]
    total_fail = 0
    total = 0
    for title, cases, checker in groups:
        print(f"\n{title}:")
        fails = _run_group(title, cases, checker)
        total += len(cases)
        total_fail += len(fails)

    # Known gaps: inverted semantics — still-failing is OK, fixed-but-unpromoted alarms.
    print(f"\nKNOWN GAPS (assert correct answer; system fails today):")
    xpassed = _run_known_gaps()
    total += len(KNOWN_GAP_CASES)
    total_fail += len(xpassed)

    print(f"\n{'=' * 50}")
    if total_fail:
        print(f"FAILED: {total_fail} of {total} cases regressed.")
        raise SystemExit(1)
    print(f"ALL PASSED: {total} cases.")


if __name__ == "__main__":
    main()
