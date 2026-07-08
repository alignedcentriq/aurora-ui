"""Shared helper: record a non-/api/chat AI interaction in Observability + Langfuse.

Surfaces that call the LLM outside the main /api/chat pipeline — Project IQ search,
Analytics Builder chat, ask-your-data NL, the directory NL filter, … — use this so
they appear in the AI Observability dashboard AND get an "Open in Langfuse" trace,
exactly like the main chat path. Best-effort: never raises, so a logging failure can
never break the actual feature response.
"""

import time
from typing import Optional

from app.database import SessionLocal
from app.models import AiRequestLog


def log_ai_interaction(
    *,
    session_id: str,
    user_email: str,
    user_message: str,
    domain: str,
    route_method: str,
    response_text: Optional[str] = None,
    response_length: int = 0,
    start: Optional[float] = None,
    latency_ms: Optional[int] = None,
    sub_intent: Optional[str] = None,
    error: Optional[str] = None,
    llm_call_count: int = 1,
    tags: Optional[list] = None,
) -> Optional[str]:
    """Open a Langfuse trace for one interaction and write its AiRequestLog row.

    Pass either `start` (a time.time() taken before the work) or an explicit
    `latency_ms`. Returns the Langfuse trace id (or None if Langfuse is unconfigured).
    """
    if latency_ms is None:
        latency_ms = int((time.time() - start) * 1000) if start is not None else 0

    trace_id = None
    try:
        from app.langfuse_tracing import TracingContext
        tracing = TracingContext(
            session_id=session_id,
            user_id=user_email,
            input=user_message,
            metadata={"message": user_message},
            tags=tags or [domain],
        )
        tracing.finalize(output=response_text, domain=domain, latency_ms=latency_ms)
        trace_id = tracing.trace_id
    except Exception:
        trace_id = None

    db = SessionLocal()
    try:
        db.add(AiRequestLog(
            session_id=session_id,
            user_email=user_email,
            user_message=user_message,
            domain=domain,
            sub_intent=sub_intent,
            route_method=route_method,
            response_text=(response_text or "")[:2000] or None,
            response_length=response_length,
            total_latency_ms=latency_ms,
            llm_call_count=llm_call_count,
            error=error,
            langfuse_trace_id=trace_id,
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        try:
            db.close()
        except Exception:
            pass

    return trace_id
