"""ml01 Ollama server capacity audit.

Probes the shared GPU server to determine:
- What models are pulled and their sizes
- Which models are currently resident in VRAM
- Cold and warm TTFT + decode speed per candidate model
- Sustainable concurrency (via parallel generation stress test)

Usage (run from backend/ directory):
    python -m scripts.ml01_audit              # quick probe
    python -m scripts.ml01_audit --full       # includes cold-reload timing (pulls models if missing)
    python -m scripts.ml01_audit --poll 600   # poll /api/ps every 60s for N seconds (eviction study)
    python -m scripts.ml01_audit --output report.md
"""

import argparse
import asyncio
import json
import struct
import sys
import time
from pathlib import Path

import httpx

OLLAMA_BASE = "http://ml01.alignedautomation.com:11434"
CANDIDATES = [
    "llama3.2:3b",
    "llama3.1:8b",
    "nomic-embed-text",
    "gpt-oss:latest",
    "qwen3:30b-a3b",       # preferred MoE candidate
    "qwen2.5:14b-instruct",
    "qwen2.5:7b-instruct",
]
TOOL_CALLING_PROMPT = (
    "You are a helpful assistant with access to the following tools: "
    "get_leave_balance(email: str), apply_leave(email: str, start_date: str, end_date: str, reason: str). "
    "User: What is my leave balance? My email is test@example.com. "
    "Call the appropriate tool."
)
SUMMARY_PROMPT = (
    "Summarize the following in 2 sentences: "
    "The employee has 12 days of casual leave remaining and 5 days of sick leave. "
    "Last taken leave was in March for 3 days."
)


async def get_tags(client: httpx.AsyncClient) -> dict:
    r = await client.get(f"{OLLAMA_BASE}/api/tags", timeout=10)
    r.raise_for_status()
    return r.json()


async def get_ps(client: httpx.AsyncClient) -> dict:
    r = await client.get(f"{OLLAMA_BASE}/api/ps", timeout=10)
    r.raise_for_status()
    return r.json()


async def get_version(client: httpx.AsyncClient) -> str:
    r = await client.get(f"{OLLAMA_BASE}/api/version", timeout=10)
    r.raise_for_status()
    return r.json().get("version", "unknown")


async def measure_ttft(client: httpx.AsyncClient, model: str, prompt: str, max_tokens: int = 200) -> dict:
    """Measure time-to-first-token and total generation via streaming /api/generate."""
    payload = {"model": model, "prompt": prompt, "stream": True, "options": {"num_predict": max_tokens}}
    start = time.perf_counter()
    first_token_time = None
    total_tokens = 0
    try:
        async with client.stream("POST", f"{OLLAMA_BASE}/api/generate", json=payload, timeout=120) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if first_token_time is None and data.get("response"):
                    first_token_time = time.perf_counter()
                if data.get("done"):
                    total = time.perf_counter() - start
                    ttft = (first_token_time - start) if first_token_time else total
                    eval_count = data.get("eval_count", 0)
                    eval_duration_ns = data.get("eval_duration", 0)
                    tokens_per_s = (eval_count / (eval_duration_ns / 1e9)) if eval_duration_ns else 0
                    return {
                        "ttft_ms": round(ttft * 1000),
                        "total_ms": round(total * 1000),
                        "tokens_per_s": round(tokens_per_s, 1),
                        "tokens_generated": eval_count,
                        "error": None,
                    }
    except Exception as e:
        return {"ttft_ms": None, "total_ms": None, "tokens_per_s": None, "tokens_generated": 0, "error": str(e)}
    return {"ttft_ms": None, "total_ms": None, "tokens_per_s": None, "tokens_generated": 0, "error": "no done event"}


async def measure_embed(client: httpx.AsyncClient, model: str, text: str) -> dict:
    payload = {"model": model, "prompt": text}
    start = time.perf_counter()
    try:
        r = await client.post(f"{OLLAMA_BASE}/api/embeddings", json=payload, timeout=30)
        r.raise_for_status()
        elapsed = time.perf_counter() - start
        data = r.json()
        dim = len(data.get("embedding", []))
        return {"latency_ms": round(elapsed * 1000), "dim": dim, "error": None}
    except Exception as e:
        return {"latency_ms": None, "dim": None, "error": str(e)}


async def concurrency_probe(client: httpx.AsyncClient, model: str, n: int = 4) -> dict:
    """Launch N simultaneous 100-token generations and measure wall clock + per-request times."""
    prompt = "Count from 1 to 100, one number per line."
    start = time.perf_counter()
    results = await asyncio.gather(
        *[measure_ttft(client, model, prompt, max_tokens=100) for _ in range(n)],
        return_exceptions=True,
    )
    wall = time.perf_counter() - start
    ok = [r for r in results if isinstance(r, dict) and r.get("ttft_ms") is not None]
    errors = [str(r) for r in results if not isinstance(r, dict) or r.get("error")]
    ttfts = [r["ttft_ms"] for r in ok]
    tpss = [r["tokens_per_s"] for r in ok if r.get("tokens_per_s")]
    return {
        "n": n,
        "wall_ms": round(wall * 1000),
        "success": len(ok),
        "errors": errors,
        "ttft_p50_ms": sorted(ttfts)[len(ttfts) // 2] if ttfts else None,
        "ttft_max_ms": max(ttfts) if ttfts else None,
        "avg_tps": round(sum(tpss) / len(tpss), 1) if tpss else None,
    }


def _gb(size_bytes: int | None) -> str:
    if size_bytes is None:
        return "?"
    return f"{size_bytes / 1e9:.1f} GB"


async def poll_ps(client: httpx.AsyncClient, duration_s: int) -> None:
    """Poll /api/ps every 60s for duration_s seconds to observe VRAM residency / eviction."""
    print(f"\n[POLL] Watching /api/ps for {duration_s}s (Ctrl-C to stop early)...")
    end = time.time() + duration_s
    try:
        while time.time() < end:
            ps = await get_ps(client)
            ts = time.strftime("%H:%M:%S")
            models = ps.get("models") or []
            if models:
                for m in models:
                    print(f"  {ts} RESIDENT: {m['name']} | size={_gb(m.get('size'))} | "
                          f"vram={_gb(m.get('size_vram'))} | expires={m.get('expires_at', '?')[:19]}")
            else:
                print(f"  {ts} RESIDENT: (none)")
            await asyncio.sleep(60)
    except asyncio.CancelledError:
        pass


async def run_audit(full: bool = False, poll_duration: int = 0) -> dict:
    report: dict = {}
    async with httpx.AsyncClient() as client:
        # ── Server info ──────────────────────────────────────────────────────────
        print("Fetching server info...")
        report["version"] = await get_version(client)
        print(f"  Ollama version: {report['version']}")

        tags_data = await get_tags(client)
        pulled = {m["name"]: m for m in tags_data.get("models", [])}
        report["pulled_models"] = [
            {"name": m["name"], "size": _gb(m.get("size"))} for m in tags_data.get("models", [])
        ]
        print(f"  Pulled models ({len(pulled)}): {', '.join(pulled.keys())}")

        ps_data = await get_ps(client)
        resident = ps_data.get("models") or []
        report["resident_models"] = [
            {
                "name": m["name"],
                "size": _gb(m.get("size")),
                "size_vram": _gb(m.get("size_vram")),
                "expires_at": m.get("expires_at", "")[:19],
            }
            for m in resident
        ]
        if resident:
            print(f"  Resident in VRAM: {', '.join(m['name'] for m in resident)}")
        else:
            print("  Resident in VRAM: (none)")

        # ── Optional poll mode ───────────────────────────────────────────────────
        if poll_duration > 0:
            await poll_ps(client, poll_duration)
            return report

        # ── Per-model timing probes ──────────────────────────────────────────────
        print("\n[TIMING] Probing candidate models...")
        timings = {}
        for model in CANDIDATES:
            if model not in pulled:
                print(f"  {model}: NOT PULLED — skipping")
                timings[model] = {"status": "not_pulled"}
                continue

            print(f"  {model}: ", end="", flush=True)

            if "embed" in model:
                r = await measure_embed(client, model, "What is my leave balance?")
                timings[model] = {"type": "embed", **r}
                print(f"embed latency={r['latency_ms']}ms dim={r['dim']}")
                # 3 more samples for p50
                samples = [r["latency_ms"]]
                for _ in range(3):
                    r2 = await measure_embed(client, model, "Check my IT ticket status")
                    if r2["latency_ms"]:
                        samples.append(r2["latency_ms"])
                timings[model]["warm_p50_ms"] = sorted(samples)[len(samples) // 2]
            else:
                # warm probe (model may already be resident)
                w1 = await measure_ttft(client, model, SUMMARY_PROMPT, max_tokens=60)
                w2 = await measure_ttft(client, model, TOOL_CALLING_PROMPT, max_tokens=80)
                timings[model] = {
                    "type": "generate",
                    "warm_summary": w1,
                    "warm_tool": w2,
                }
                print(
                    f"warm summary ttft={w1['ttft_ms']}ms tps={w1['tokens_per_s']} | "
                    f"tool ttft={w2['ttft_ms']}ms tps={w2['tokens_per_s']}"
                )

        report["timings"] = timings

        # ── Concurrency probe on the primary agent model ─────────────────────────
        agent_model = next((m for m in ["qwen3:30b-a3b", "gpt-oss:latest", "llama3.1:8b"] if m in pulled), None)
        if agent_model:
            print(f"\n[CONCURRENCY] Probing {agent_model} at 1/2/4/8 parallel requests...")
            conc = {}
            for n in (1, 2, 4, 8):
                r = await concurrency_probe(client, agent_model, n)
                conc[f"n{n}"] = r
                print(f"  n={n}: wall={r['wall_ms']}ms p50_ttft={r['ttft_p50_ms']}ms "
                      f"max_ttft={r['ttft_max_ms']}ms avg_tps={r['avg_tps']} "
                      f"success={r['success']}/{n} errors={len(r['errors'])}")
            report["concurrency"] = {"model": agent_model, "results": conc}

        # ── Recommendation ──────────────────────────────────────────────────────
        print("\n[RECOMMENDATION]")
        rec = _build_recommendation(report)
        report["recommendation"] = rec
        for line in rec.get("summary_lines", []):
            print(f"  {line}")

    return report


def _build_recommendation(report: dict) -> dict:
    timings = report.get("timings", {})
    pulled_names = {m["name"] for m in report.get("pulled_models", [])}
    lines = []

    # Check preferred candidate first
    for candidate, label in [
        ("qwen3:30b-a3b", "Qwen3-30B-A3B (preferred MoE)"),
        ("qwen2.5:14b-instruct", "Qwen2.5-14B"),
        ("llama3.1:8b", "llama3.1:8b"),
    ]:
        if candidate not in pulled_names:
            lines.append(f"PULL NEEDED: {candidate} not on ml01 yet — request admin to pull")
            continue
        t = timings.get(candidate, {})
        warm_tool = t.get("warm_tool", {})
        if warm_tool.get("ttft_ms") and warm_tool["ttft_ms"] < 3000:
            lines.append(f"RECOMMEND: {label} — warm TTFT {warm_tool['ttft_ms']}ms, good for agent tier")
            break
        elif warm_tool.get("error"):
            lines.append(f"SKIP: {candidate} — error: {warm_tool['error']}")

    # Concurrency cap guidance
    conc = report.get("concurrency", {}).get("results", {})
    if conc:
        sustainable_n = 1
        for n_key in ("n8", "n4", "n2", "n1"):
            c = conc.get(n_key, {})
            if c.get("success", 0) == c.get("n", 0) and (c.get("ttft_p50_ms") or 99999) < 8000:
                sustainable_n = c["n"]
                break
        lines.append(f"CONCURRENCY: set CHAT_MAX_CONCURRENCY={sustainable_n} based on probe results")

    # Keep-alive guidance
    lines.append("KEEP_ALIVE: request ml01 admin to set OLLAMA_KEEP_ALIVE=30m, OLLAMA_MAX_LOADED_MODELS=3")
    lines.append("FLASH_ATTN: request OLLAMA_FLASH_ATTENTION=1 and OLLAMA_KV_CACHE_TYPE=q8_0 for VRAM savings")

    return {"summary_lines": lines}


def write_report(report: dict, output_path: str) -> None:
    path = Path(output_path)
    lines = [
        "# ml01 Capacity Audit Report\n",
        f"**Ollama version**: {report.get('version')}\n\n",
        "## Pulled Models\n",
        "| Model | Size |\n|-------|------|\n",
    ]
    for m in report.get("pulled_models", []):
        lines.append(f"| {m['name']} | {m['size']} |\n")
    lines.append("\n## Resident in VRAM\n")
    for m in report.get("resident_models", []):
        lines.append(f"- **{m['name']}** size={m['size']} vram={m['size_vram']} expires={m['expires_at']}\n")
    if not report.get("resident_models"):
        lines.append("_(none at audit time)_\n")
    lines.append("\n## Timing Results\n")
    for model, t in report.get("timings", {}).items():
        if t.get("status") == "not_pulled":
            lines.append(f"- **{model}**: not pulled\n")
        elif t.get("type") == "embed":
            lines.append(f"- **{model}** (embed): latency={t.get('latency_ms')}ms warm_p50={t.get('warm_p50_ms')}ms dim={t.get('dim')}\n")
        else:
            wt = t.get("warm_tool", {})
            ws = t.get("warm_summary", {})
            lines.append(f"- **{model}**: tool-call ttft={wt.get('ttft_ms')}ms tps={wt.get('tokens_per_s')} | summary ttft={ws.get('ttft_ms')}ms\n")
    conc = report.get("concurrency", {})
    if conc:
        lines.append(f"\n## Concurrency ({conc['model']})\n")
        lines.append("| n | wall_ms | p50_ttft | max_ttft | avg_tps | success |\n|---|---------|----------|----------|---------|--------|\n")
        for n_key, c in conc.get("results", {}).items():
            lines.append(f"| {c['n']} | {c['wall_ms']} | {c['ttft_p50_ms']} | {c['ttft_max_ms']} | {c['avg_tps']} | {c['success']}/{c['n']} |\n")
    lines.append("\n## Recommendations\n")
    for l in report.get("recommendation", {}).get("summary_lines", []):
        lines.append(f"- {l}\n")
    path.write_text("".join(lines))
    print(f"\nReport written to {path}")
    # Also write JSON for programmatic use
    path.with_suffix(".json").write_text(json.dumps(report, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser(description="Audit ml01 Ollama server capacity")
    ap.add_argument("--full", action="store_true", help="Run extended cold-reload timing probes")
    ap.add_argument("--poll", type=int, default=0, metavar="SECONDS",
                    help="Poll /api/ps every 60s for N seconds (VRAM eviction study)")
    ap.add_argument("--output", default="", help="Write markdown report to this path")
    args = ap.parse_args()

    report = asyncio.run(run_audit(full=args.full, poll_duration=args.poll))

    if args.output:
        write_report(report, args.output)
    else:
        print("\n[JSON SUMMARY]")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
