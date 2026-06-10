"""End-to-end latency benchmark for the Centriq AI /api/chat SSE endpoint.

Measures perceived TTFT (time to first token) and total response time across
representative query buckets, at concurrency levels 1, 4, and 8.

Usage (run from backend/ directory):
    python -m scripts.bench_latency                        # default: localhost:8080
    python -m scripts.bench_latency --url http://localhost:8080 --out results.json
    python -m scripts.bench_latency --concurrency 1 4     # only these levels
    python -m scripts.bench_latency --bucket cache fastpath  # only these buckets
    python -m scripts.bench_latency --user your@email.com

Results are written to stdout as a markdown table and optionally to a JSON file.
Run before and after each speed phase to track progress against SLOs:
    - p50 TTFT < 1500ms
    - p90 TTFT < 4000ms
    - Error rate < 1%
"""

import argparse
import asyncio
import json
import statistics
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

import httpx

# ── Query buckets ────────────────────────────────────────────────────────────
# Each bucket exercises a different path through the system.
BUCKETS: dict[str, list[str]] = {
    "cache": [
        "What is my leave balance?",
        "How many leaves do I have?",
        "What are office working hours?",
    ],
    "fastpath_who": [
        "Who is Shivam Sharma?",
        "Tell me about Suraj Ghuge",
    ],
    "fastpath_leave": [
        "Apply leave from July 10 to July 12 for personal reasons",
    ],
    "semantic_route": [
        "Show me my team attendance",
        "What projects are currently active?",
    ],
    "policy_qa": [
        "What is the work from home policy?",
        "What documents are needed for reimbursement?",
        "How do I apply for a parking sticker?",
    ],
    "ambiguous_route": [
        "I need some help with my account",
        "Can you help me with something urgent?",
        "Connect me to someone",
    ],
    "it_ticket": [
        "I need a new laptop",
        "Create an IT ticket for VPN not working",
    ],
    "long_conv_followup": [
        # These simulate a follow-up (context matters); send as second turn
        "Can you give me more details about that?",
        "What about the next steps?",
    ],
    "doc_gen": [
        "Generate an experience certificate for me",
    ],
}


@dataclass
class MeasurementResult:
    bucket: str
    query: str
    ttft_ms: Optional[float]
    total_ms: Optional[float]
    domain: Optional[str]
    served_from: Optional[str]  # cache / semantic_router / llm_router / fastpath
    error: Optional[str]
    status_events: list[str] = field(default_factory=list)


async def call_chat(
    client: httpx.AsyncClient,
    base_url: str,
    message: str,
    user_email: str,
    session_id: str = "bench_session",
) -> MeasurementResult:
    url = f"{base_url}/api/chat"
    payload = {"message": message, "session_id": session_id}
    headers = {
        "X-User-Email": user_email,
        "X-User-Role": "employee",
        "Accept": "text/event-stream",
    }
    start = time.perf_counter()
    first_token_time: Optional[float] = None
    domain: Optional[str] = None
    served_from: Optional[str] = None
    status_events: list[str] = []
    error: Optional[str] = None

    try:
        async with client.stream("POST", url, json=payload, headers=headers, timeout=120) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                return MeasurementResult(
                    bucket="", query=message,
                    ttft_ms=None, total_ms=None,
                    domain=None, served_from=None,
                    error=f"HTTP {resp.status_code}: {body[:200]}"
                )
            async for raw_line in resp.aiter_lines():
                line = raw_line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if not data_str:
                    continue
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                evt_type = data.get("type")
                if evt_type == "token" and first_token_time is None:
                    first_token_time = time.perf_counter()
                elif evt_type == "status":
                    status_events.append(data.get("stage", ""))
                elif evt_type == "done":
                    domain = data.get("domain")
                    served_from = data.get("served_from")
                    break
                elif evt_type == "error":
                    error = data.get("message", "unknown error")
                    break
    except httpx.TimeoutException:
        error = "timeout"
    except Exception as e:
        error = str(e)

    elapsed = time.perf_counter() - start
    ttft = (first_token_time - start) * 1000 if first_token_time else None
    total = elapsed * 1000

    return MeasurementResult(
        bucket="",
        query=message,
        ttft_ms=round(ttft, 1) if ttft else None,
        total_ms=round(total, 1),
        domain=domain,
        served_from=served_from,
        error=error,
        status_events=status_events,
    )


async def run_bucket(
    client: httpx.AsyncClient,
    base_url: str,
    bucket_name: str,
    queries: list[str],
    user_email: str,
    concurrency: int,
) -> list[MeasurementResult]:
    results = []
    # Run all queries at specified concurrency
    semaphore = asyncio.Semaphore(concurrency)

    async def _bounded(query: str) -> MeasurementResult:
        async with semaphore:
            r = await call_chat(client, base_url, query, user_email,
                                session_id=f"bench_{bucket_name}_{hash(query) % 10000}")
            r.bucket = bucket_name
            return r

    tasks = [_bounded(q) for q in queries]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for r in results:
        if isinstance(r, Exception):
            out.append(MeasurementResult(bucket=bucket_name, query="?", ttft_ms=None,
                                         total_ms=None, domain=None, served_from=None,
                                         error=str(r)))
        else:
            out.append(r)
    return out


def compute_percentiles(values: list[float]) -> dict:
    if not values:
        return {"p50": None, "p90": None, "p99": None, "min": None, "max": None}
    s = sorted(values)
    n = len(s)
    return {
        "p50": round(s[int(n * 0.50)], 1),
        "p90": round(s[int(n * 0.90)], 1),
        "p99": round(s[min(int(n * 0.99), n - 1)], 1),
        "min": round(s[0], 1),
        "max": round(s[-1], 1),
    }


def print_report(summary: dict, concurrency: int) -> None:
    print(f"\n{'='*70}")
    print(f"  Centriq AI Latency Benchmark — concurrency={concurrency}")
    print(f"{'='*70}")
    print(f"{'Bucket':<22} {'n':>4} {'err':>4} {'p50 TTFT':>10} {'p90 TTFT':>10} {'p50 total':>10} {'SLO':>6}")
    print(f"{'-'*22} {'-'*4} {'-'*4} {'-'*10} {'-'*10} {'-'*10} {'-'*6}")

    slo_ok = True
    for bucket, stats in summary.items():
        ttft = stats.get("ttft", {})
        total = stats.get("total", {})
        p50 = ttft.get("p50")
        p90 = ttft.get("p90")
        p50t = total.get("p50")
        n = stats.get("n", 0)
        errs = stats.get("errors", 0)
        slo = "✓" if (p50 and p50 < 1500 and p90 and p90 < 4000) else ("?" if p50 is None else "✗")
        if slo == "✗":
            slo_ok = False
        p50_str = f"{p50}ms" if p50 else "N/A"
        p90_str = f"{p90}ms" if p90 else "N/A"
        p50t_str = f"{p50t}ms" if p50t else "N/A"
        print(f"{bucket:<22} {n:>4} {errs:>4} {p50_str:>10} {p90_str:>10} {p50t_str:>10} {slo:>6}")

    print(f"\nSLO targets: p50 TTFT < 1500ms, p90 TTFT < 4000ms")
    print(f"Overall SLO: {'PASS' if slo_ok else 'FAIL'}")


async def run_benchmark(
    base_url: str,
    user_email: str,
    concurrency_levels: list[int],
    bucket_filter: Optional[list[str]],
    output_path: Optional[str],
) -> dict:
    buckets = BUCKETS
    if bucket_filter:
        buckets = {k: v for k, v in BUCKETS.items() if k in bucket_filter}

    all_results: dict[int, dict[str, list[MeasurementResult]]] = {}

    async with httpx.AsyncClient() as client:
        # Warmup ping
        print("Warming up (1 ping)...")
        try:
            await client.get(f"{base_url}/api/warmup", timeout=5)
        except Exception:
            pass

        for conc in concurrency_levels:
            print(f"\n[CONCURRENCY={conc}] Running {len(buckets)} buckets...")
            all_results[conc] = {}
            for bucket_name, queries in buckets.items():
                print(f"  {bucket_name} ({len(queries)} queries)...", end="", flush=True)
                results = await run_bucket(client, base_url, bucket_name, queries, user_email, conc)
                all_results[conc][bucket_name] = results
                ok = sum(1 for r in results if r.error is None)
                print(f" {ok}/{len(results)} ok")

    # Build summary
    full_report = {}
    for conc, bucket_results in all_results.items():
        summary = {}
        for bucket_name, results in bucket_results.items():
            ttfts = [r.ttft_ms for r in results if r.ttft_ms is not None]
            totals = [r.total_ms for r in results if r.total_ms is not None]
            errors = [r.error for r in results if r.error]
            domains = [r.domain for r in results if r.domain]
            served = [r.served_from for r in results if r.served_from]
            summary[bucket_name] = {
                "n": len(results),
                "errors": len(errors),
                "error_rate": round(len(errors) / len(results), 3) if results else 1.0,
                "ttft": compute_percentiles(ttfts),
                "total": compute_percentiles(totals),
                "domains": list(set(domains)),
                "served_from": list(set(served)),
                "error_samples": errors[:3],
            }
        print_report(summary, conc)
        full_report[f"concurrency_{conc}"] = summary

    if output_path:
        with open(output_path, "w") as f:
            json.dump(full_report, f, indent=2)
        print(f"\nFull results written to {output_path}")

    return full_report


def main() -> None:
    ap = argparse.ArgumentParser(description="Centriq AI latency benchmark")
    ap.add_argument("--url", default="http://localhost:8080", help="Backend base URL")
    ap.add_argument("--user", default="shivam.sharma@alignedautomation.com", help="User email header")
    ap.add_argument("--concurrency", nargs="+", type=int, default=[1, 4, 8],
                    help="Concurrency levels to test")
    ap.add_argument("--bucket", nargs="+", choices=list(BUCKETS.keys()),
                    help="Buckets to run (default: all)")
    ap.add_argument("--out", default="", help="JSON output file path")
    args = ap.parse_args()

    asyncio.run(run_benchmark(
        base_url=args.url,
        user_email=args.user,
        concurrency_levels=args.concurrency,
        bucket_filter=args.bucket,
        output_path=args.out or None,
    ))


if __name__ == "__main__":
    main()
