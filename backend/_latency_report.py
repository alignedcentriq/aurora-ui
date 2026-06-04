"""PHASE 2 — latency table from historical logs (TEMP, safe to delete).

Reads ai_llm_call_logs + ai_request_logs (already populated by main.py) and
prints per-node and per-request latency stats. No live LLM calls.
"""
from sqlalchemy import text
from app.database import SessionLocal

PER_NODE = text("""
    SELECT node, model,
           COUNT(*)                                                      AS calls,
           ROUND(AVG(duration_ms))::int                                  AS avg_ms,
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
           MAX(duration_ms)                                              AS max_ms,
           ROUND(AVG(prompt_tokens))                                     AS avg_in_tok,
           ROUND(AVG(completion_tokens))                                 AS avg_out_tok,
           SUM(CASE WHEN is_tool_call THEN 1 ELSE 0 END)                 AS tool_calls
    FROM enterprise_ai.ai_llm_call_logs
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY node, model
    ORDER BY avg_ms DESC
""")

PER_REQUEST = text("""
    SELECT COALESCE(domain, '?')                                            AS domain,
           COUNT(*)                                                         AS requests,
           ROUND(AVG(total_latency_ms))::int                               AS avg_total_ms,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms)::int AS p95_total_ms,
           MAX(total_latency_ms)                                           AS max_total_ms,
           ROUND(AVG(llm_call_count), 1)                                   AS avg_llm_calls
    FROM enterprise_ai.ai_request_logs
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY domain
    ORDER BY avg_total_ms DESC
""")


def dump(title, rows, headers):
    print(f"\n=== {title} ===")
    if not rows:
        print("  (no rows in the last 7 days)")
        return
    widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    print("  " + "  ".join(str(h).ljust(widths[i]) for i, h in enumerate(headers)))
    for r in rows:
        print("  " + "  ".join(str(v).ljust(widths[i]) for i, v in enumerate(r)))


if __name__ == "__main__":
    db = SessionLocal()
    try:
        dump("PER-NODE LLM LATENCY (last 7d)", db.execute(PER_NODE).fetchall(),
             ["node", "model", "calls", "avg_ms", "p50_ms", "p95_ms", "max_ms", "avg_in_tok", "avg_out_tok", "tool_calls"])
        dump("PER-REQUEST END-TO-END (last 7d)", db.execute(PER_REQUEST).fetchall(),
             ["domain", "requests", "avg_total_ms", "p95_total_ms", "max_total_ms", "avg_llm_calls"])
    finally:
        db.close()
