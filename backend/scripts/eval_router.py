"""Offline accuracy harness for the intent router.

Runs the held-out EVAL_SET through both routing paths on the SAME fixed queries and reports
per-domain accuracy, a confusion matrix, sub_intent accuracy, and how many LLM calls the
semantic high-tier saved. Use it to calibrate thresholds before going live and to confirm the
new router matches/beats the old one.

Requires the embedding model (ml01) and the DB to be reachable, and the router_examples table
to be seeded (it runs the seeder first). Run from the backend/ directory:

    python -m scripts.eval_router            # semantic-only report + threshold sweep
    python -m scripts.eval_router --with-llm # also run the full new path (semantic→LLM) — slow

The --with-llm pass issues real LLM calls for ambiguous/low queries, so it is opt-in.
"""

import argparse
import asyncio
from collections import defaultdict

from app.router_eval_set import EVAL_SET
from app.services.semantic_router_service import SemanticRouterService


def _seed():
    print("Seeding router examples (idempotent)...")
    print(SemanticRouterService.seed_from_catalog())


def semantic_report():
    """Domain accuracy of the semantic layer alone, plus tier distribution."""
    tiers = defaultdict(int)
    correct_high = total_high = 0
    domain_correct = total = 0
    sub_correct = sub_total = 0
    confusion = defaultdict(lambda: defaultdict(int))
    misses = []

    for utt, exp_domain, exp_sub in EVAL_SET:
        d = SemanticRouterService.classify(utt)
        tiers[d.tier] += 1
        total += 1
        predicted = d.domain or "(none)"
        confusion[exp_domain][predicted] += 1
        if d.domain == exp_domain:
            domain_correct += 1
        else:
            misses.append((utt, exp_domain, predicted, d.tier, d.similarity))
        if d.tier == "high":
            total_high += 1
            if d.domain == exp_domain:
                correct_high += 1
        if exp_sub is not None:
            sub_total += 1
            if d.sub_intent == exp_sub:
                sub_correct += 1

    print("\n=== SEMANTIC ROUTER REPORT ===")
    print(f"Top-1 domain accuracy (any tier): {domain_correct}/{total} = {domain_correct/total:.1%}")
    if total_high:
        print(f"High-tier precision (0-LLM routes): {correct_high}/{total_high} = {correct_high/total_high:.1%}")
    print(f"High-tier coverage (LLM calls saved): {total_high}/{total} = {total_high/total:.1%}")
    if sub_total:
        print(f"Sub-intent accuracy: {sub_correct}/{sub_total} = {sub_correct/sub_total:.1%}")
    print(f"Tier distribution: {dict(tiers)}")

    print("\n--- Misroutes ---")
    for utt, exp, got, tier, sim in misses:
        print(f"  [{tier:>11} sim={sim:.2f}] {exp:>18} -> {got:<18} | {utt}")

    print("\n--- Confusion (expected -> predicted counts) ---")
    for exp in sorted(confusion):
        row = ", ".join(f"{p}:{c}" for p, c in sorted(confusion[exp].items()))
        print(f"  {exp:>18}: {row}")


def threshold_sweep():
    """Sweep high_thresh to show the accuracy/coverage trade-off. Re-implements the tiering
    locally on cached k-NN so each query is embedded only once per run."""
    print("\n=== THRESHOLD SWEEP (high_thresh) ===")
    neighbours = []
    for utt, exp_domain, _ in EVAL_SET:
        ns = SemanticRouterService.knn(utt)
        neighbours.append((utt, exp_domain, ns))

    for high in (0.72, 0.75, 0.78, 0.80, 0.83, 0.85):
        agree_frac = 0.6
        cov = correct = total = 0
        for utt, exp_domain, ns in neighbours:
            total += 1
            if not ns:
                continue
            top = ns[0]
            agree = sum(1 for n in ns if n.domain == top.domain) / len(ns)
            if top.similarity >= high and agree >= agree_frac:
                cov += 1
                if top.domain == exp_domain:
                    correct += 1
        prec = (correct / cov) if cov else 0.0
        print(f"  high={high:.2f}: coverage={cov/total:.0%} ({cov}/{total}), "
              f"high-tier precision={prec:.0%}")


async def full_new_path():
    """The actual production path: semantic high → direct; ambiguous → hinted LLM; else plain LLM."""
    from app.router import classify_intent_async
    correct = total = llm_calls = 0
    for utt, exp_domain, _ in EVAL_SET:
        total += 1
        d = SemanticRouterService.classify(utt)
        if d.tier == "high":
            got = d.domain
        else:
            cands = d.candidate_domains if d.tier == "ambiguous" else None
            res = await classify_intent_async(utt, candidate_domains=cands)
            got = res["domain"]
            llm_calls += 1
        if got == exp_domain:
            correct += 1
    print("\n=== FULL NEW PATH (semantic + LLM fallback) ===")
    print(f"Domain accuracy: {correct}/{total} = {correct/total:.1%}")
    print(f"LLM calls used: {llm_calls}/{total} = {llm_calls/total:.1%} (rest served by semantic high tier)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-llm", action="store_true", help="also run the full semantic→LLM path (real LLM calls)")
    ap.add_argument("--no-seed", action="store_true", help="skip the idempotent seeding pass")
    args = ap.parse_args()

    if not args.no_seed:
        _seed()
    semantic_report()
    threshold_sweep()
    if args.with_llm:
        asyncio.run(full_new_path())


if __name__ == "__main__":
    main()
