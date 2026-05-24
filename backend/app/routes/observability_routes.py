"""
Observability API endpoints — powers the CloudTrail-style log viewer and charts dashboard.
All endpoints require IT or Admin role.
"""

import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, case, desc
from sqlalchemy.orm import Session
from typing import Optional

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import AiRequestLog, AiLlmCallLog, ChatFeedback

router = APIRouter(prefix="/api/observability", tags=["Observability"])


def _require_it_or_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role not in ("it", "admin"):
        raise HTTPException(status_code=403, detail="IT or Admin access required.")
    return user


def _period_cutoff(period: str) -> datetime.datetime:
    """Convert period string to a UTC cutoff datetime."""
    now = datetime.datetime.utcnow()
    if period == "7d":
        return now - datetime.timedelta(days=7)
    elif period == "30d":
        return now - datetime.timedelta(days=30)
    else:  # default 24h
        return now - datetime.timedelta(hours=24)


# ── Logs Endpoints (CloudTrail viewer) ────────────────────────────────────────

@router.get("/logs")
def get_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    domain: Optional[str] = Query(None),
    status: Optional[str] = Query(None),       # "success" or "error"
    from_date: Optional[str] = Query(None),     # ISO date string
    to_date: Optional[str] = Query(None),
    _: CurrentUser = Depends(_require_it_or_admin),
    db: Session = Depends(get_db),
):
    """Paginated activity log list for CloudTrail viewer."""
    q = db.query(AiRequestLog)

    if search:
        q = q.filter(AiRequestLog.user_message.ilike(f"%{search}%"))
    if domain and domain != "All":
        q = q.filter(AiRequestLog.domain == domain)
    if status == "error":
        q = q.filter(AiRequestLog.error.isnot(None))
    elif status == "success":
        q = q.filter(AiRequestLog.error.is_(None))
    if from_date:
        try:
            q = q.filter(AiRequestLog.created_at >= datetime.datetime.fromisoformat(from_date))
        except ValueError:
            pass
    if to_date:
        try:
            q = q.filter(AiRequestLog.created_at <= datetime.datetime.fromisoformat(to_date))
        except ValueError:
            pass

    total = q.count()
    rows = q.order_by(desc(AiRequestLog.created_at)).offset((page - 1) * limit).limit(limit).all()

    return {
        "data": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "session_id": r.session_id,
                "user_email": r.user_email,
                "domain": r.domain,
                "user_message": (r.user_message or "")[:80],
                "total_latency_ms": r.total_latency_ms,
                "total_tokens": r.total_tokens,
                "llm_call_count": r.llm_call_count,
                "error": r.error,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if limit else 1,
    }


@router.get("/logs/{log_id}")
def get_log_detail(
    log_id: int,
    _: CurrentUser = Depends(_require_it_or_admin),
    db: Session = Depends(get_db),
):
    """Full log detail with LLM call breakdown (for expanded row)."""
    req = db.query(AiRequestLog).filter(AiRequestLog.id == log_id).first()
    if not req:
        raise HTTPException(404, "Log entry not found")

    calls = (
        db.query(AiLlmCallLog)
        .filter(AiLlmCallLog.request_id == log_id)
        .order_by(AiLlmCallLog.created_at)
        .all()
    )

    return {
        "id": req.id,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "session_id": req.session_id,
        "user_email": req.user_email,
        "user_message": req.user_message,
        "domain": req.domain,
        "sub_intent": req.sub_intent,
        "route_method": req.route_method,
        "response_text": req.response_text,
        "response_length": req.response_length,
        "total_latency_ms": req.total_latency_ms,
        "total_prompt_tokens": req.total_prompt_tokens,
        "total_completion_tokens": req.total_completion_tokens,
        "total_tokens": req.total_tokens,
        "model_name": req.model_name,
        "error": req.error,
        "langfuse_trace_id": req.langfuse_trace_id,
        "llm_calls": [
            {
                "id": c.id,
                "node": c.node,
                "model": c.model,
                "duration_ms": c.duration_ms,
                "prompt_tokens": c.prompt_tokens,
                "completion_tokens": c.completion_tokens,
                "total_tokens": c.total_tokens,
                "is_tool_call": c.is_tool_call,
                "tool_names": c.tool_names,
                "error": c.error,
            }
            for c in calls
        ],
    }


# ── Charts Endpoints ─────────────────────────────────────────────────────────

@router.get("/summary")
def get_summary(
    period: str = Query("24h"),
    _: CurrentUser = Depends(_require_it_or_admin),
    db: Session = Depends(get_db),
):
    """KPI summary for dashboard cards."""
    cutoff = _period_cutoff(period)

    # Current period stats
    q = db.query(AiRequestLog).filter(AiRequestLog.created_at >= cutoff)
    total = q.count()
    unique_sessions = db.query(func.count(func.distinct(AiRequestLog.session_id))).filter(
        AiRequestLog.created_at >= cutoff
    ).scalar() or 0

    avg_latency = db.query(func.avg(AiRequestLog.total_latency_ms)).filter(
        AiRequestLog.created_at >= cutoff
    ).scalar()

    # p95 latency via percentile_cont
    try:
        p95 = db.query(
            func.percentile_cont(0.95).within_group(AiRequestLog.total_latency_ms)
        ).filter(AiRequestLog.created_at >= cutoff).scalar()
    except Exception:
        p95 = None

    total_tokens = db.query(func.sum(AiRequestLog.total_tokens)).filter(
        AiRequestLog.created_at >= cutoff
    ).scalar() or 0

    error_count = db.query(func.count(AiRequestLog.id)).filter(
        AiRequestLog.created_at >= cutoff,
        AiRequestLog.error.isnot(None),
    ).scalar() or 0

    # Previous period for trend comparison
    period_delta = datetime.datetime.utcnow() - cutoff
    prev_cutoff = cutoff - period_delta
    prev_total = db.query(func.count(AiRequestLog.id)).filter(
        AiRequestLog.created_at >= prev_cutoff,
        AiRequestLog.created_at < cutoff,
    ).scalar() or 0

    # Feedback score from ChatFeedback
    fb_total = db.query(func.count(ChatFeedback.id)).filter(
        ChatFeedback.created_at >= cutoff
    ).scalar() or 0
    fb_helpful = db.query(func.count(ChatFeedback.id)).filter(
        ChatFeedback.created_at >= cutoff,
        ChatFeedback.rating == 1,
    ).scalar() or 0

    return {
        "total_requests": total,
        "unique_sessions": unique_sessions,
        "avg_latency_ms": round(avg_latency) if avg_latency else 0,
        "p95_latency_ms": round(p95) if p95 else 0,
        "total_tokens": total_tokens,
        "error_count": error_count,
        "error_rate_pct": round((error_count / total * 100), 1) if total else 0,
        "feedback_score_pct": round((fb_helpful / fb_total * 100), 1) if fb_total else 0,
        "feedback_total": fb_total,
        "prev_total_requests": prev_total,
        "trend_pct": round(((total - prev_total) / prev_total * 100), 1) if prev_total else 0,
    }


@router.get("/charts/volume")
def get_volume_chart(
    period: str = Query("24h"),
    _: CurrentUser = Depends(_require_it_or_admin),
    db: Session = Depends(get_db),
):
    """Request volume + avg latency over time (for time series chart)."""
    cutoff = _period_cutoff(period)
    granularity = "hour" if period == "24h" else "day"

    rows = (
        db.query(
            func.date_trunc(granularity, AiRequestLog.created_at).label("bucket"),
            func.count().label("requests"),
            func.avg(AiRequestLog.total_latency_ms).label("avg_latency"),
        )
        .filter(AiRequestLog.created_at >= cutoff)
        .group_by("bucket")
        .order_by("bucket")
        .all()
    )

    return [
        {
            "time": r.bucket.isoformat() if r.bucket else None,
            "requests": r.requests,
            "avg_latency": round(r.avg_latency) if r.avg_latency else 0,
        }
        for r in rows
    ]


@router.get("/charts/domains")
def get_domain_distribution(
    period: str = Query("24h"),
    _: CurrentUser = Depends(_require_it_or_admin),
    db: Session = Depends(get_db),
):
    """Request count + avg latency by domain (for pie + bar chart)."""
    cutoff = _period_cutoff(period)

    rows = (
        db.query(
            AiRequestLog.domain,
            func.count().label("count"),
            func.avg(AiRequestLog.total_latency_ms).label("avg_latency"),
        )
        .filter(AiRequestLog.created_at >= cutoff)
        .group_by(AiRequestLog.domain)
        .order_by(desc("count"))
        .all()
    )

    return [
        {
            "domain": r.domain or "unknown",
            "count": r.count,
            "avg_latency": round(r.avg_latency) if r.avg_latency else 0,
        }
        for r in rows
    ]


@router.get("/charts/models")
def get_model_usage(
    period: str = Query("24h"),
    _: CurrentUser = Depends(_require_it_or_admin),
    db: Session = Depends(get_db),
):
    """Token usage by model (for stacked bar chart)."""
    cutoff = _period_cutoff(period)

    rows = (
        db.query(
            AiLlmCallLog.model,
            func.count().label("calls"),
            func.sum(AiLlmCallLog.prompt_tokens).label("prompt_tokens"),
            func.sum(AiLlmCallLog.completion_tokens).label("completion_tokens"),
            func.sum(AiLlmCallLog.total_tokens).label("total_tokens"),
        )
        .filter(AiLlmCallLog.created_at >= cutoff)
        .group_by(AiLlmCallLog.model)
        .order_by(desc("total_tokens"))
        .all()
    )

    return [
        {
            "model": r.model or "unknown",
            "calls": r.calls,
            "prompt_tokens": r.prompt_tokens or 0,
            "completion_tokens": r.completion_tokens or 0,
            "total_tokens": r.total_tokens or 0,
        }
        for r in rows
    ]


@router.get("/charts/nodes")
def get_node_performance(
    period: str = Query("24h"),
    _: CurrentUser = Depends(_require_it_or_admin),
    db: Session = Depends(get_db),
):
    """Per-node LLM performance (for performance table)."""
    cutoff = _period_cutoff(period)

    rows = (
        db.query(
            AiLlmCallLog.node,
            func.count().label("calls"),
            func.avg(AiLlmCallLog.duration_ms).label("avg_ms"),
            func.avg(AiLlmCallLog.total_tokens).label("avg_tokens"),
            func.sum(case((AiLlmCallLog.error.isnot(None), 1), else_=0)).label("errors"),
        )
        .filter(AiLlmCallLog.created_at >= cutoff)
        .group_by(AiLlmCallLog.node)
        .order_by(desc("calls"))
        .all()
    )

    # p95 per node — fetch separately to avoid complex subquery
    result = []
    for r in rows:
        try:
            p95 = db.query(
                func.percentile_cont(0.95).within_group(AiLlmCallLog.duration_ms)
            ).filter(
                AiLlmCallLog.created_at >= cutoff,
                AiLlmCallLog.node == r.node,
            ).scalar()
        except Exception:
            p95 = None

        result.append({
            "node": r.node or "unknown",
            "calls": r.calls,
            "avg_ms": round(r.avg_ms) if r.avg_ms else 0,
            "p95_ms": round(p95) if p95 else 0,
            "avg_tokens": round(r.avg_tokens) if r.avg_tokens else 0,
            "errors": r.errors or 0,
        })

    return result
