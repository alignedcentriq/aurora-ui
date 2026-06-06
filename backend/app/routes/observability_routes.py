"""
Observability API endpoints — powers the CloudTrail-style log viewer and charts dashboard.
All endpoints require IT or Admin role.
"""

import datetime
import hashlib
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, case, desc
from sqlalchemy.orm import Session
from typing import Optional

from app.auth import CurrentUser, get_current_user
from app.azure_auth import RevealUser, get_reveal_user
from app.database import get_db
from app.models import AiRequestLog, AiLlmCallLog, ChatFeedback, ContentRevealAudit

router = APIRouter(prefix="/api/observability", tags=["Observability"])


def _require_super_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role != "super admin":
        raise HTTPException(status_code=403, detail="Super Admin access required.")
    return user


def _pseudonym(email: Optional[str]) -> str:
    """Stable, non-reversible display label for a user — same email always maps to the
    same 'Employee #NNNN' so sessions can be correlated without exposing identity."""
    if not email:
        return "Employee #0000"
    n = int(hashlib.sha256(email.strip().lower().encode()).hexdigest()[:4], 16)
    return f"Employee #{n:04d}"


# PII / financial-identifier patterns scrubbed from revealed conversation content — even
# authorized reviewers see masked tokens, never raw IDs or money values. Best-effort:
# order matters (more specific patterns run before broad digit-run catch-alls). Tuned for
# the Indian context (Aadhaar / PAN / IFSC / ₹) plus generic email, phone, and card/account.
_PII_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]\b"), "[GSTIN]"),      # before PAN (contains a PAN)
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"), "[PAN]"),                       # PAN: ABCDE1234F
    (re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b"), "[IFSC]"),                    # IFSC: SBIN0001234
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[card/acct]"),                 # card / long acct (before aadhaar)
    (re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"), "[aadhaar]"),                # 12-digit, often 4-4-4
    (re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)"), "[phone]"),    # Indian mobile (10-digit)
    (re.compile(r"(?:₹|Rs\.?|INR|\$|USD)\s?[\d,]+(?:\.\d+)?", re.I), "[amount]"),
    (re.compile(r"\b\d{9,18}\b"), "[acct/id]"),                             # bare account / id run
]


def _redact_pii(text: Optional[str]) -> Optional[str]:
    """Mask emails, phone numbers, government IDs, card/account numbers, and money amounts
    in free text. Applied to revealed conversation content for compliance — best-effort,
    not a guarantee; reveal access is still domain-scoped and audited as the primary control."""
    if not text:
        return text
    for pattern, repl in _PII_PATTERNS:
        text = pattern.sub(repl, text)
    return text


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
    domain: Optional[str] = Query(None),
    status: Optional[str] = Query(None),       # "success" or "error"
    from_date: Optional[str] = Query(None),     # ISO date string
    to_date: Optional[str] = Query(None),
    _: CurrentUser = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    """Paginated activity log list — operational metadata only. User identity is
    pseudonymized and message/response content is never returned here; reading actual
    content requires the audited, domain-scoped /logs/{id}/reveal endpoint."""
    q = db.query(AiRequestLog)

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
                "user_label": _pseudonym(r.user_email),
                "domain": r.domain,
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
    _: CurrentUser = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    """Full log detail with LLM call breakdown (for expanded row). Operational only —
    content reveal is gated separately via /reveal-scope + /reveal."""
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
        "user_label": _pseudonym(req.user_email),
        "domain": req.domain,
        "sub_intent": req.sub_intent,
        "route_method": req.route_method,
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


# ── Content Reveal — Azure AD group-gated, validated server-side, audited ──────

class RevealRequest(BaseModel):
    reason: str


@router.get("/reveal-scope")
def get_reveal_scope(user: RevealUser = Depends(get_reveal_user)):
    """Domains the caller is permitted to reveal, derived from their (validated) Azure AD
    group membership. Lets the UI show the reveal affordance only on permitted rows."""
    return {"domains": sorted(user.allowed_domains)}


@router.post("/logs/{log_id}/reveal")
def reveal_log_content(
    log_id: int,
    body: RevealRequest,
    user: RevealUser = Depends(get_reveal_user),
    db: Session = Depends(get_db),
):
    """Reveal a single conversation's content. Gated by Azure AD group membership (a group
    maps to a domain); requires a reason; writes a ContentRevealAudit row. Content PII is
    masked even for the authorized viewer."""
    req = db.query(AiRequestLog).filter(AiRequestLog.id == log_id).first()
    if not req:
        raise HTTPException(404, "Log entry not found")

    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(422, "A reason is required to reveal conversation content.")

    if req.domain not in user.allowed_domains:
        raise HTTPException(
            403,
            f"Your group membership does not permit revealing '{req.domain}' conversation content.",
        )

    db.add(ContentRevealAudit(
        request_log_id=req.id,
        viewer_email=user.email,
        viewer_oid=user.oid,
        domain=req.domain,
        reason=reason,
    ))
    db.commit()

    return {
        "id": req.id,
        "user_email": req.user_email,
        "user_message": _redact_pii(req.user_message),
        "response_text": _redact_pii(req.response_text),
        "pii_redacted": True,
    }


@router.get("/audit")
def list_reveal_audit(
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Full reveal audit trail (who viewed whose conversation, for which domain, why). Admin only."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")

    q = db.query(ContentRevealAudit).order_by(desc(ContentRevealAudit.created_at))
    total = q.count()
    rows = q.offset((page - 1) * limit).limit(limit).all()
    return {
        "data": [
            {
                "id": a.id,
                "request_log_id": a.request_log_id,
                "viewer_email": a.viewer_email,
                "viewer_oid": a.viewer_oid,
                "domain": a.domain,
                "reason": a.reason,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in rows
        ],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if limit else 1,
    }


# ── Charts Endpoints ─────────────────────────────────────────────────────────

@router.get("/summary")
def get_summary(
    period: str = Query("24h"),
    _: CurrentUser = Depends(_require_super_admin),
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
    _: CurrentUser = Depends(_require_super_admin),
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
    _: CurrentUser = Depends(_require_super_admin),
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
    _: CurrentUser = Depends(_require_super_admin),
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
    _: CurrentUser = Depends(_require_super_admin),
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
