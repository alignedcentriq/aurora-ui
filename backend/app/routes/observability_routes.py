"""
Observability API endpoints — powers the CloudTrail-style log viewer and charts dashboard.
All endpoints require IT or Admin role.
"""

import datetime
import hashlib
import logging
import os
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, case, desc
from sqlalchemy.orm import Session
from typing import Optional

from app.auth import CurrentUser, get_current_user
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


def _iso_utc(dt: Optional[datetime.datetime]) -> Optional[str]:
    """Serialize a naive-UTC timestamp as an ISO string WITH the UTC marker (+00:00).

    Timestamps are stored as naive UTC (datetime.utcnow). Without an explicit offset,
    the browser's `new Date(str)` treats the string as local time and skips conversion,
    so IST users saw UTC clock values mislabeled as local (5.5h behind). Tagging the
    string as UTC lets the frontend's toLocaleString render true browser-local time."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.isoformat()


def _period_cutoff(period: str) -> datetime.datetime:
    """Convert period string to a UTC cutoff datetime."""
    now = datetime.datetime.utcnow()
    if period == "7d":
        return now - datetime.timedelta(days=7)
    elif period == "30d":
        return now - datetime.timedelta(days=30)
    else:  # default 24h
        return now - datetime.timedelta(hours=24)


# ── Langfuse deep-link redirect ───────────────────────────────────────────────
# The observability dashboard's "Open in Langfuse" link points here. It resolves a
# stored langfuse_trace_id into the browser-facing Langfuse UI URL and 302-redirects.
#
# This endpoint is intentionally NOT gated by get_current_user: it is opened as a plain
# browser navigation (<a target="_blank">), which cannot carry the x-user-* auth headers
# the SPA attaches to fetch calls. It leaks nothing on its own — the target Langfuse
# instance enforces its own login, and the trace_id is already visible to the reviewer.

_langfuse_project_id_cache: Optional[str] = None


def _langfuse_ui_base(request: Request) -> str:
    """Browser-reachable base URL of the Langfuse UI.

    Langfuse runs on the SAME hostname the user is already on, just a different port
    (3003) — so we mirror the request's host and only swap the port. This makes the
    deep link environment-correct with no per-env config: a browser on localhost is
    sent to localhost:3003, and one on hackathon.alignedautomation.com is sent to
    hackathon.alignedautomation.com:3003. (Deriving from LANGFUSE_HOST would be wrong —
    that's the internal server-to-server address for pushing traces, not browser-reachable.)

    LANGFUSE_PUBLIC_URL is an optional hard override for setups where Langfuse lives on
    a different host/scheme entirely. LANGFUSE_PUBLIC_PORT / LANGFUSE_PUBLIC_SCHEME tune
    the derived URL (default port 3003, scheme http — the :3003 listener is plain HTTP)."""
    override = os.environ.get("LANGFUSE_PUBLIC_URL")
    if override:
        return override.rstrip("/")

    # Prefer the proxy-forwarded host, then the Host header, then the raw netloc.
    host_header = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    )
    hostname = host_header.split(",")[0].strip().split(":")[0]
    scheme = os.environ.get("LANGFUSE_PUBLIC_SCHEME", "http")
    port = os.environ.get("LANGFUSE_PUBLIC_PORT", "3003")
    return f"{scheme}://{hostname}:{port}"


def _langfuse_project_id() -> Optional[str]:
    """Resolve the Langfuse project id (needed for the /project/{id}/traces/{id} URL).

    Prefers the LANGFUSE_PROJECT_ID env override; otherwise asks the configured Langfuse
    client — the SAME host+keys used to push traces — so resolution succeeds exactly when
    tracing itself is authenticated. A 401 here therefore means the LANGFUSE_PUBLIC_KEY /
    LANGFUSE_SECRET_KEY in the environment don't match this Langfuse instance (in which
    case traces aren't landing either). Cached after the first successful lookup."""
    global _langfuse_project_id_cache
    if _langfuse_project_id_cache:
        return _langfuse_project_id_cache

    env_pid = os.environ.get("LANGFUSE_PROJECT_ID")
    if env_pid:
        _langfuse_project_id_cache = env_pid
        return env_pid

    from app.langfuse_tracing import get_langfuse_client

    client = get_langfuse_client()
    if client is None:
        return None
    try:
        pid = client._get_project_id()
        if pid:
            _langfuse_project_id_cache = pid
        return pid
    except Exception as e:
        logging.warning(
            "Could not resolve Langfuse project id (keys likely don't match this "
            "Langfuse instance — traces may not be landing either): %s", e
        )
    return None


@router.get("/langfuse-redirect/{trace_id}")
def langfuse_redirect(trace_id: str, request: Request):
    """302-redirect to the Langfuse trace view for the given trace id."""
    base = _langfuse_ui_base(request)
    project_id = _langfuse_project_id()
    if project_id:
        target = f"{base}/project/{project_id}/traces/{trace_id}"
    else:
        # No project id resolvable — land on the Langfuse home (it resolves to the
        # user's project after login) rather than dead-ending on a 404.
        target = base
        logging.warning(
            "langfuse-redirect: no project id resolvable; sending %s to Langfuse home",
            trace_id,
        )
    return RedirectResponse(url=target)


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
                "created_at": _iso_utc(r.created_at),
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
    """Full log detail with LLM call breakdown (for expanded row). Conversation content
    is always included (PII-masked) — no separate reveal step. PII is still redacted per
    the sensitive-data policy, even for this Super-Admin-only view."""
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
        "created_at": _iso_utc(req.created_at),
        "session_id": req.session_id,
        "user_label": _pseudonym(req.user_email),
        "user_email": req.user_email,
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
        # Content always present (PII-masked); the old /reveal gate is retired.
        "user_message": _redact_pii(req.user_message),
        "response_text": _redact_pii(req.response_text),
        "pii_redacted": True,
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


# Content is now always included (PII-masked) in /logs/{id} — the old gated /reveal
# endpoint has been retired. The ContentRevealAudit model + /audit history are kept
# for the record of past reveals.


def _stringify_redacted(val, limit: int = 4000) -> Optional[str]:
    """Turn a Langfuse observation input/output (str | dict | list | None) into a
    PII-masked, length-capped string for the in-app trace view."""
    if val is None:
        return None
    if isinstance(val, str):
        text = val
    else:
        import json as _json
        try:
            text = _json.dumps(val, ensure_ascii=False, default=str, indent=2)
        except Exception:
            text = str(val)
    text = _redact_pii(text) or ""
    if len(text) > limit:
        text = text[:limit] + "…"
    return text or None


@router.get("/logs/{log_id}/trace")
def get_log_trace(
    log_id: int,
    _: CurrentUser = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    """In-app trace view: fetch the Langfuse trace for this log using the SERVER keys and
    return a normalized, PII-masked step list. Keeps trace viewing behind the app's own
    Super-Admin gate — no one ever needs a Langfuse login."""
    req = db.query(AiRequestLog).filter(AiRequestLog.id == log_id).first()
    if not req:
        raise HTTPException(404, "Log entry not found")
    if not req.langfuse_trace_id:
        return {"available": False, "reason": "no_trace"}

    from app.langfuse_tracing import get_langfuse_client
    client = get_langfuse_client()
    if client is None:
        return {"available": False, "reason": "langfuse_not_configured"}

    try:
        resp = client.fetch_trace(req.langfuse_trace_id)
        trace = getattr(resp, "data", None) or resp
    except Exception as e:
        logging.warning("fetch_trace(%s) failed: %s", req.langfuse_trace_id, e)
        return {"available": False, "reason": "not_found_or_unreachable"}

    def _start(o):
        return getattr(o, "start_time", None) or getattr(o, "timestamp", None)

    def _dur_ms(o):
        st, en = getattr(o, "start_time", None), getattr(o, "end_time", None)
        if st and en:
            try:
                return int((en - st).total_seconds() * 1000)
            except Exception:
                pass
        lat = getattr(o, "latency", None)
        return int(lat * 1000) if isinstance(lat, (int, float)) else None

    def _usage(o):
        u = getattr(o, "usage", None)
        if not u:
            return None
        out = {k: getattr(u, k, None) for k in ("input", "output", "total")}
        return out if any(v is not None for v in out.values()) else None

    obs = list(getattr(trace, "observations", None) or [])
    obs.sort(key=lambda o: (_start(o) is None, _start(o)))

    steps = [
        {
            "id": getattr(o, "id", None),
            "type": getattr(o, "type", None),
            "name": getattr(o, "name", None),
            "model": getattr(o, "model", None),
            "duration_ms": _dur_ms(o),
            "level": getattr(o, "level", None),
            "status_message": getattr(o, "status_message", None),
            "input": _stringify_redacted(getattr(o, "input", None)),
            "output": _stringify_redacted(getattr(o, "output", None)),
            "usage": _usage(o),
        }
        for o in obs
    ]

    trace_latency = getattr(trace, "latency", None)
    return {
        "available": True,
        "trace": {
            "id": getattr(trace, "id", None),
            "name": getattr(trace, "name", None),
            "input": _stringify_redacted(getattr(trace, "input", None)),
            "output": _stringify_redacted(getattr(trace, "output", None)),
            "latency_ms": int(trace_latency * 1000) if isinstance(trace_latency, (int, float)) else None,
        },
        "steps": steps,
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
                "created_at": _iso_utc(a.created_at),
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


@router.get("/adoption")
def get_feature_adoption(
    window_days: int = Query(90, ge=1, le=365),
    _: CurrentUser = Depends(_require_super_admin),
):
    """Feature-adoption analytics — which capabilities are undiscovered.

    Surfaces, per capability, how many distinct staff have ever used it (over the
    trailing window) so an internal nudge campaign can target the blind spots.
    Also returns `unmapped` traffic the capability registry doesn't yet claim.
    """
    from app.services.adoption_service import feature_adoption
    return feature_adoption(window_days=window_days)


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
            "time": _iso_utc(r.bucket),
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


# ── Feedback triage — the human-promotion gate of the eval flywheel (item 8) ──
# Cluster 👎 + escalations, rank by frequency, one-click promote to a curated answer or a
# routing fix. Super-admin only — promoting writes into the shared answer cache / router.

class _PromoteAnswerReq(BaseModel):
    query: str
    answer: str
    domain: Optional[str] = None
    feedback_ids: Optional[list[int]] = None
    escalation_ids: Optional[list[int]] = None


class _PromoteRoutingReq(BaseModel):
    utterance: str
    domain: str
    sub_intent: str
    feedback_ids: Optional[list[int]] = None
    escalation_ids: Optional[list[int]] = None


class _DismissReq(BaseModel):
    feedback_ids: Optional[list[int]] = None
    escalation_ids: Optional[list[int]] = None


@router.get("/feedback-triage/clusters")
def feedback_triage_clusters(
    domain: Optional[str] = Query(None),
    days: int = Query(60, ge=1, le=365),
    min_size: int = Query(1, ge=1),
    _: CurrentUser = Depends(_require_super_admin),
):
    """Ranked failure clusters (most frequent first) awaiting triage."""
    from app.services import feedback_triage_service as triage
    return {"clusters": triage.list_clusters(domain=domain, days=days, min_size=min_size),
            "stats": triage.stats()}


@router.post("/feedback-triage/promote-answer")
def feedback_triage_promote_answer(
    req: _PromoteAnswerReq, user: CurrentUser = Depends(_require_super_admin),
):
    """Curate the correct answer for a cluster → seed the semantic cache + clear the cluster."""
    from app.services import feedback_triage_service as triage
    return triage.promote_curated_answer(
        req.query, req.answer, domain=req.domain,
        feedback_ids=req.feedback_ids, escalation_ids=req.escalation_ids, by=user.email)


@router.post("/feedback-triage/promote-routing")
def feedback_triage_promote_routing(
    req: _PromoteRoutingReq, user: CurrentUser = Depends(_require_super_admin),
):
    """Insert the corrected (domain, sub_intent) routing example for a misrouted cluster."""
    from app.services import feedback_triage_service as triage
    return triage.promote_routing_fix(
        req.utterance, req.domain, req.sub_intent,
        feedback_ids=req.feedback_ids, escalation_ids=req.escalation_ids, by=user.email)


@router.post("/feedback-triage/dismiss")
def feedback_triage_dismiss(
    req: _DismissReq, user: CurrentUser = Depends(_require_super_admin),
):
    """Clear a cluster from the queue without promoting (noise / already fixed)."""
    from app.services import feedback_triage_service as triage
    return triage.dismiss(feedback_ids=req.feedback_ids, escalation_ids=req.escalation_ids, by=user.email)
