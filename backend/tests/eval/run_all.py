"""Run all eval tiers and print a combined scorecard.

    cd backend && python -m tests.eval.run_all [--live] [--save]
"""
from __future__ import annotations

import argparse
import sys

from tests.eval.eval_rag_groundedness import run_eval as run_rag, _print_report as print_rag
from tests.eval.eval_action_correctness import run_eval as run_action, _print_report as print_action


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--save", action="store_true")
    args = parser.parse_args()

    rag_report    = run_rag(use_live=args.live)
    action_report = run_action(use_live=args.live)

    print_rag(rag_report)
    print_action(action_report)

    total_passed = rag_report["passed"] + action_report["passed"]
    total_cases  = rag_report["total"]  + action_report["total"]
    total_pct    = round(100 * total_passed / total_cases, 1) if total_cases else 0

    print(f"\n{'='*60}")
    print(f"COMBINED SCORE: {total_passed}/{total_cases}  ({total_pct}%)")
    print(f"  RAG Groundedness  : {rag_report['passed']}/{rag_report['total']}  ({rag_report['score_pct']}%)")
    print(f"  Action Correctness: {action_report['passed']}/{action_report['total']}  ({action_report['score_pct']}%)")
    print(f"{'='*60}\n")

    any_failed = rag_report["failed"] > 0 or action_report["failed"] > 0
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
