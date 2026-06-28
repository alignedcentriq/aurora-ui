"""Characterization SCAFFOLD for the Phase-2 routing refactor — NOT a source of truth.

IMPORTANT: this is a *behavior-preservation* snapshot, not a correctness test. Each
expected value is "whatever the keyword layer did when the snapshot was taken" — bugs
included. It exists for ONE job: during the Phase-2 extraction of the routing layer into
ordered strategies, prove the refactor changed nothing (regenerate on known-good code →
refactor → expect zero drift). After Phase 2 it should be RETIRED. Correctness lives in
the curated cases (test_routing_regression.py), which is the authority.

Do not treat a passing golden as "routing is correct" — it only means "routing is
unchanged." Conversely, drift here is a prompt to review, not necessarily a bug.

Loads tests/routing_golden.json (produced by tests/gen_routing_golden.py from real
ai_request_logs messages). Runs fully offline — no DB, embeddings, or LLM.

    python -m tests.test_routing_golden
"""

import json
import os

from app.agent import _try_keyword_route

_GOLDEN_PATH = os.path.join(os.path.dirname(__file__), "routing_golden.json")


def _load():
    with open(_GOLDEN_PATH, encoding="utf-8") as f:
        return json.load(f)["entries"]


def _check(entry) -> list[str]:
    route = _try_keyword_route(entry["message"])
    got_domain = route["domain"] if route else None
    got_sub = route.get("sub_intent") if route else None
    fails = []
    if got_domain != entry["domain"]:
        fails.append(f"domain: golden {entry['domain']!r} -> now {got_domain!r}")
    if got_sub != entry["sub_intent"]:
        fails.append(f"sub_intent: golden {entry['sub_intent']!r} -> now {got_sub!r}")
    return fails


def test_routing_golden():
    entries = _load()
    failures = []
    for e in entries:
        for msg in _check(e):
            failures.append((e["message"], msg))
    if failures:
        report = "\n".join(f"  - {m!r}: {d}" for m, d in failures[:40])
        raise AssertionError(
            f"{len(failures)} golden routing drift(s) over {len(entries)} real messages:\n{report}"
        )


def main():
    entries = _load()
    drift = 0
    for e in entries:
        errs = _check(e)
        if errs:
            drift += 1
            print(f"  DRIFT {e['message']!r}")
            for x in errs:
                print(f"         - {x}")
    print(f"\n{'=' * 50}")
    if drift:
        print(f"FAILED: {drift} of {len(entries)} real messages drifted.")
        raise SystemExit(1)
    print(f"GOLDEN STABLE: {len(entries)} real messages route unchanged.")


if __name__ == "__main__":
    main()
