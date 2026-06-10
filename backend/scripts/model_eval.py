"""Tool-calling quality eval harness for agent model candidates.

Tests candidate models on representative HR/IT/Admin/PMO tasks and scores:
- Correct tool selected (vs. hallucinated or no tool call)
- Arguments valid against the expected schema
- Multi-turn follow-through (second-turn tool continuation)
- Summary coherence (grounded, not hallucinated)
- Latency (TTFT, tokens/s)

Usage (run from backend/ directory):
    python -m scripts.model_eval                           # eval all candidates
    python -m scripts.model_eval --models llama3.1:8b gpt-oss:latest
    python -m scripts.model_eval --suites hr it           # only these suites
    python -m scripts.model_eval --out eval_results.json

Compares candidates side-by-side and produces a recommendation table.
"""

import argparse
import asyncio
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

import httpx

OLLAMA_BASE = "http://ml01.alignedautomation.com:11434/v1"

CANDIDATES = [
    "gpt-oss:latest",
    "qwen3:30b-a3b",
    "qwen2.5:14b-instruct",
    "llama3.1:8b",
]

# ── Tool schemas (simplified versions of what the agents bind) ──────────────

HR_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_leave_balance",
            "description": "Get the leave balance for an employee",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {"type": "string", "description": "Employee email address"}
                },
                "required": ["email"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_leave",
            "description": "Apply for leave",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {"type": "string"},
                    "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "end_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "leave_type": {"type": "string", "enum": ["casual", "sick", "earned", "emergency"]},
                    "reason": {"type": "string"},
                },
                "required": ["email", "start_date", "end_date", "leave_type", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_hr_policies",
            "description": "Search HR policy documents",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
]

IT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_it_ticket",
            "description": "Create an IT support ticket",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                    "category": {"type": "string", "enum": ["hardware", "software", "network", "access", "other"]},
                },
                "required": ["email", "title", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_software_install",
            "description": "Request a software installation",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {"type": "string"},
                    "software_name": {"type": "string"},
                    "business_justification": {"type": "string"},
                },
                "required": ["email", "software_name"],
            },
        },
    },
]

ADMIN_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "submit_reimbursement",
            "description": "Submit an expense reimbursement request",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {"type": "string"},
                    "amount": {"type": "number"},
                    "category": {"type": "string", "enum": ["travel", "meals", "training", "equipment", "other"]},
                    "description": {"type": "string"},
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                },
                "required": ["email", "amount", "category", "description"],
            },
        },
    },
]

PMO_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_projects",
            "description": "List all active projects",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["active", "completed", "on_hold", "all"]},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_project_status",
            "description": "Get detailed status for a specific project",
            "parameters": {
                "type": "object",
                "properties": {"project_name": {"type": "string"}},
                "required": ["project_name"],
            },
        },
    },
]

# ── Test cases ───────────────────────────────────────────────────────────────
# (suite, system_prompt_hint, user_message, user_email, expected_tool, required_args, tool_result_mock, followup_message)

TEST_CASES = [
    # HR suite
    ("hr", "You are an HR assistant. User email: test@example.com.",
     "What is my leave balance?", "test@example.com",
     "get_leave_balance", ["email"],
     '{"casual": 8, "sick": 5, "earned": 12}',
     "How many sick leaves do I have left?"),

    ("hr", "You are an HR assistant. User email: test@example.com.",
     "I want to take casual leave from July 15 to July 17 for a family event",
     "test@example.com",
     "apply_leave", ["email", "start_date", "end_date", "leave_type", "reason"],
     '{"status": "submitted", "id": "LV-2026-042"}',
     None),

    ("hr", "You are an HR assistant.",
     "What is the work from home policy?", "test@example.com",
     "search_hr_policies", ["query"],
     '{"results": [{"text": "Employees may work from home up to 2 days per week with manager approval."}]}',
     None),

    # IT suite
    ("it", "You are an IT support assistant. User email: test@example.com.",
     "My laptop keeps freezing every hour", "test@example.com",
     "create_it_ticket", ["email", "title", "description"],
     '{"ticket_id": "INC-2026-101", "status": "open"}',
     None),

    ("it", "You are an IT support assistant. User email: test@example.com.",
     "I need Python installed on my machine for a data project", "test@example.com",
     "request_software_install", ["email", "software_name"],
     '{"request_id": "REQ-2026-055", "status": "pending_approval"}',
     None),

    # Admin suite
    ("admin", "You are an Admin assistant. User email: test@example.com.",
     "I spent 2500 rupees on travel for a client meeting last Monday",
     "test@example.com",
     "submit_reimbursement", ["email", "amount", "category"],
     '{"request_id": "RMB-2026-030", "status": "submitted"}',
     None),

    # PMO suite
    ("pmo", "You are a PMO assistant.",
     "Show me all active projects", "test@example.com",
     "list_projects", [],
     '[{"name": "Falcon", "status": "active", "completion": 65}, {"name": "Aurora", "status": "active", "completion": 40}]',
     "Give me more details on the Falcon project"),

    # Edge cases
    ("hr", "You are an HR assistant. User email: test@example.com.",
     "Install Python on my machine", "test@example.com",
     None, [],  # Should NOT call any HR tool (domain mismatch)
     None, None),

    ("it", "You are an IT support assistant.",
     "What is my leave balance?", "test@example.com",
     None, [],  # Should NOT call any IT tool (domain mismatch)
     None, None),
]

TOOL_MAP = {
    "hr": HR_TOOLS,
    "it": IT_TOOLS,
    "admin": ADMIN_TOOLS,
    "pmo": PMO_TOOLS,
}


@dataclass
class CaseResult:
    suite: str
    message: str
    expected_tool: Optional[str]
    actual_tool: Optional[str]
    args_valid: bool
    args_missing: list[str]
    followup_tool: Optional[str]
    ttft_ms: Optional[float]
    total_ms: Optional[float]
    tokens_per_s: Optional[float]
    error: Optional[str]

    @property
    def tool_correct(self) -> bool:
        return self.actual_tool == self.expected_tool

    @property
    def score(self) -> float:
        if self.error:
            return 0.0
        s = 1.0 if self.tool_correct else 0.0
        if self.expected_tool and self.args_valid:
            s += 0.5
        return s


async def call_model_with_tools(
    client: httpx.AsyncClient,
    model: str,
    system: str,
    user_message: str,
    tools: list[dict],
    tool_result: Optional[str] = None,
    followup: Optional[str] = None,
) -> dict:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_message},
    ]

    payload = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "stream": True,
        "temperature": 0,
        "max_tokens": 512,
    }

    start = time.perf_counter()
    first_token_time: Optional[float] = None
    content = ""
    tool_calls_raw = []
    total_tokens = 0

    try:
        async with client.stream(
            "POST", f"{OLLAMA_BASE}/chat/completions",
            json=payload, timeout=60
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                return {"error": f"HTTP {resp.status_code}: {body[:300]}", "tool_calls": [], "content": ""}
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                delta = data.get("choices", [{}])[0].get("delta", {})
                if delta.get("content") and first_token_time is None:
                    first_token_time = time.perf_counter()
                if delta.get("content"):
                    content += delta["content"]
                if delta.get("tool_calls"):
                    if first_token_time is None:
                        first_token_time = time.perf_counter()
                    tool_calls_raw.extend(delta["tool_calls"])
                usage = data.get("usage", {})
                if usage.get("total_tokens"):
                    total_tokens = usage["total_tokens"]
    except Exception as e:
        return {"error": str(e), "tool_calls": [], "content": ""}

    elapsed = time.perf_counter() - start
    ttft = (first_token_time - start) * 1000 if first_token_time else None

    # Assemble tool calls (may be fragmented across chunks)
    tool_calls = _assemble_tool_calls(tool_calls_raw)

    # If there's a tool result and followup, do second turn
    followup_tool = None
    if tool_result and followup and tool_calls:
        first_call = tool_calls[0]
        messages_2 = messages + [
            {"role": "assistant", "content": None, "tool_calls": [first_call]},
            {"role": "tool", "tool_call_id": first_call.get("id", "tc1"), "content": tool_result},
            {"role": "user", "content": followup},
        ]
        followup_resp = await _simple_call(client, model, messages_2, tools)
        followup_tool = followup_resp.get("tool_name")

    tps = total_tokens / elapsed if (total_tokens and elapsed > 0) else None

    return {
        "error": None,
        "tool_calls": tool_calls,
        "tool_name": tool_calls[0]["function"]["name"] if tool_calls else None,
        "tool_args": json.loads(tool_calls[0]["function"].get("arguments", "{}")) if tool_calls else {},
        "content": content,
        "ttft_ms": round(ttft, 1) if ttft else None,
        "total_ms": round(elapsed * 1000, 1),
        "tokens_per_s": round(tps, 1) if tps else None,
        "followup_tool": followup_tool,
    }


def _assemble_tool_calls(raw: list) -> list:
    """Reassemble fragmented streaming tool_calls into complete objects."""
    assembled: dict[int, dict] = {}
    for tc in raw:
        idx = tc.get("index", 0)
        if idx not in assembled:
            assembled[idx] = {"id": tc.get("id", f"tc{idx}"), "type": "function",
                              "function": {"name": "", "arguments": ""}}
        fn = tc.get("function", {})
        if fn.get("name"):
            assembled[idx]["function"]["name"] += fn["name"]
        if fn.get("arguments"):
            assembled[idx]["function"]["arguments"] += fn["arguments"]
    return list(assembled.values())


async def _simple_call(client: httpx.AsyncClient, model: str, messages: list, tools: list) -> dict:
    payload = {"model": model, "messages": messages, "tools": tools, "temperature": 0, "max_tokens": 256}
    try:
        r = await client.post(f"{OLLAMA_BASE}/chat/completions", json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()
        msg = data.get("choices", [{}])[0].get("message", {})
        tool_calls = msg.get("tool_calls", [])
        return {"tool_name": tool_calls[0]["function"]["name"] if tool_calls else None}
    except Exception:
        return {"tool_name": None}


def _validate_args(tool_name: str, args: dict, required_args: list[str]) -> tuple[bool, list[str]]:
    if not required_args:
        return True, []
    missing = [a for a in required_args if a not in args or not args[a]]
    return len(missing) == 0, missing


async def eval_model(
    client: httpx.AsyncClient,
    model: str,
    suite_filter: Optional[list[str]],
) -> list[CaseResult]:
    results = []
    for suite, system, message, email, exp_tool, req_args, tool_mock, followup in TEST_CASES:
        if suite_filter and suite not in suite_filter:
            continue
        tools = TOOL_MAP.get(suite, [])
        resp = await call_model_with_tools(
            client, model, system, message, tools, tool_mock, followup
        )
        if resp.get("error"):
            results.append(CaseResult(
                suite=suite, message=message, expected_tool=exp_tool,
                actual_tool=None, args_valid=False, args_missing=[],
                followup_tool=None, ttft_ms=None, total_ms=None, tokens_per_s=None,
                error=resp["error"],
            ))
            continue

        actual_tool = resp.get("tool_name")
        args_valid, args_missing = _validate_args(actual_tool or "", resp.get("tool_args", {}), req_args)

        results.append(CaseResult(
            suite=suite,
            message=message,
            expected_tool=exp_tool,
            actual_tool=actual_tool,
            args_valid=args_valid if actual_tool == exp_tool else (exp_tool is None),
            args_missing=args_missing,
            followup_tool=resp.get("followup_tool"),
            ttft_ms=resp.get("ttft_ms"),
            total_ms=resp.get("total_ms"),
            tokens_per_s=resp.get("tokens_per_s"),
            error=None,
        ))
    return results


def print_model_report(model: str, results: list[CaseResult]) -> None:
    total = len(results)
    correct_tool = sum(1 for r in results if r.tool_correct and not r.error)
    valid_args = sum(1 for r in results if r.args_valid and r.expected_tool and not r.error)
    arg_cases = sum(1 for r in results if r.expected_tool and not r.error)
    errors = sum(1 for r in results if r.error)
    ttfts = [r.ttft_ms for r in results if r.ttft_ms]
    tpss = [r.tokens_per_s for r in results if r.tokens_per_s]
    avg_ttft = round(sum(ttfts) / len(ttfts), 0) if ttfts else None
    avg_tps = round(sum(tpss) / len(tpss), 1) if tpss else None

    print(f"\n{'='*60}")
    print(f"  Model: {model}")
    print(f"{'='*60}")
    print(f"  Tool selection accuracy: {correct_tool}/{total} = {correct_tool/total:.0%}")
    if arg_cases:
        print(f"  Arg validity (when tool correct): {valid_args}/{arg_cases} = {valid_args/arg_cases:.0%}")
    print(f"  Errors: {errors}")
    print(f"  Avg TTFT: {avg_ttft}ms | Avg TPS: {avg_tps}")

    print("\n  Misses:")
    for r in results:
        if not r.tool_correct or r.args_missing or r.error:
            status = "ERR" if r.error else ("WRONG_TOOL" if not r.tool_correct else "MISSING_ARGS")
            print(f"    [{r.suite}] {status}: expected={r.expected_tool} got={r.actual_tool} "
                  f"missing_args={r.args_missing} | {r.message[:60]}")
            if r.error:
                print(f"      error: {r.error}")


def build_comparison_table(all_results: dict[str, list[CaseResult]]) -> None:
    print(f"\n{'='*70}")
    print("  COMPARISON TABLE")
    print(f"{'='*70}")
    print(f"{'Model':<30} {'Tool%':>6} {'Args%':>6} {'TTFT':>8} {'TPS':>6} {'Score':>7}")
    print(f"{'-'*30} {'-'*6} {'-'*6} {'-'*8} {'-'*6} {'-'*7}")

    scores = {}
    for model, results in all_results.items():
        total = len(results)
        correct = sum(1 for r in results if r.tool_correct and not r.error)
        arg_cases = sum(1 for r in results if r.expected_tool and not r.error)
        valid_args = sum(1 for r in results if r.args_valid and r.expected_tool and not r.error)
        ttfts = [r.ttft_ms for r in results if r.ttft_ms]
        tpss = [r.tokens_per_s for r in results if r.tokens_per_s]
        avg_ttft = round(sum(ttfts) / len(ttfts)) if ttfts else 0
        avg_tps = round(sum(tpss) / len(tpss), 1) if tpss else 0
        tool_pct = correct / total if total else 0
        arg_pct = valid_args / arg_cases if arg_cases else 0
        score = tool_pct * 0.6 + arg_pct * 0.4
        scores[model] = score
        print(f"{model:<30} {tool_pct:>6.0%} {arg_pct:>6.0%} {avg_ttft:>7}ms {avg_tps:>6} {score:>7.2f}")

    best = max(scores, key=scores.get)
    print(f"\n  RECOMMENDATION: {best} (score={scores[best]:.2f})")
    print("  Run 'python -m scripts.ml01_audit' first to check VRAM headroom before switching.")


async def run_eval(
    models: list[str],
    suite_filter: Optional[list[str]],
    output_path: Optional[str],
) -> None:
    # Check which models are pulled
    async with httpx.AsyncClient() as probe:
        try:
            r = await probe.get("http://ml01.alignedautomation.com:11434/api/tags", timeout=5)
            pulled = {m["name"] for m in r.json().get("models", [])}
        except Exception:
            pulled = set()

    all_results: dict[str, list[CaseResult]] = {}
    async with httpx.AsyncClient() as client:
        for model in models:
            if model not in pulled:
                print(f"  {model}: NOT PULLED on ml01 — skipping. Request admin to pull.")
                continue
            print(f"\n[EVAL] {model} ...")
            results = await eval_model(client, model, suite_filter)
            all_results[model] = results
            print_model_report(model, results)

    if len(all_results) > 1:
        build_comparison_table(all_results)

    if output_path and all_results:
        out = {m: [asdict(r) for r in rs] for m, rs in all_results.items()}
        with open(output_path, "w") as f:
            json.dump(out, f, indent=2)
        print(f"\nFull results written to {output_path}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Tool-calling model eval harness")
    ap.add_argument("--models", nargs="+", default=CANDIDATES, help="Models to evaluate")
    ap.add_argument("--suites", nargs="+", choices=["hr", "it", "admin", "pmo"],
                    help="Test suites to run (default: all)")
    ap.add_argument("--out", default="", help="JSON output file")
    args = ap.parse_args()

    asyncio.run(run_eval(
        models=args.models,
        suite_filter=args.suites,
        output_path=args.out or None,
    ))


if __name__ == "__main__":
    main()
