"""
Analytics + ROI service — the shared engine behind the ROI Dashboard, the Analytics
Studio config builder, and the "ask-your-data" NL feature.

Design principle: a whitelisted metric catalog. Every query (Studio dropdowns AND the
NL feature) resolves only against METRIC_CATALOG / DIMENSION_CATALOG below — there is
never user-supplied SQL, and the NL layer can only name catalog entries. Adding a metric
is a one-line catalog entry that instantly appears in the dropdowns, the NL vocabulary,
and (where relevant) ROI.
"""

from __future__ import annotations

import datetime
import json
import logging
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import AiRequestLog, ChatFeedback, ConnectorCallLog, ConnectorOperation, CompanySettings

log = logging.getLogger(__name__)


# ── ROI assumptions (cost model) ────────────────────────────────────────────────
# v1 defaults; overridable per-org via the `roi_assumptions` CompanySettings row.
DEFAULT_ROI_ASSUMPTIONS = {
    "currency": "INR",
    "hourly_cost": 600.0,                # loaded cost of one employee-hour
    # Self-hosted free models → no per-token cost. The real cost is the fixed monthly
    # infrastructure (GPU box, power, upkeep), amortized over the reporting period.
    "monthly_infra_cost": 0.0,
    "token_cost_per_1k_prompt": 0.0,     # kept for hosted-model setups; unused when 0
    "token_cost_per_1k_completion": 0.0,
    # Minutes of manual effort saved each time the assistant resolves a request in a domain.
    "minutes_saved_per_request": {
        "hr": 8.0, "it": 10.0, "it_support": 10.0, "admin": 6.0,
        "pmo": 7.0, "general": 3.0, "_default": 5.0,
    },
}

_ASSUMPTIONS_KEY = "roi_assumptions"


def get_assumptions(db: Session) -> dict:
    """Read the org ROI assumptions, falling back to defaults when unset/partial."""
    row = db.query(CompanySettings).filter(CompanySettings.key == _ASSUMPTIONS_KEY).first()
    merged = dict(DEFAULT_ROI_ASSUMPTIONS)
    if row and row.value:
        try:
            stored = json.loads(row.value)
            if isinstance(stored, dict):
                merged.update({k: v for k, v in stored.items() if v is not None})
                # merge nested minutes map rather than replacing wholesale
                if isinstance(stored.get("minutes_saved_per_request"), dict):
                    m = dict(DEFAULT_ROI_ASSUMPTIONS["minutes_saved_per_request"])
                    m.update(stored["minutes_saved_per_request"])
                    merged["minutes_saved_per_request"] = m
        except Exception:
            log.warning("Bad roi_assumptions JSON in company_settings; using defaults")
    return merged


def set_assumptions(db: Session, payload: dict, updated_by: str) -> dict:
    """Persist ROI assumptions (admin only — enforced at the route)."""
    row = db.query(CompanySettings).filter(CompanySettings.key == _ASSUMPTIONS_KEY).first()
    value = json.dumps(payload)
    if row:
        row.value = value
        row.updated_by = updated_by
    else:
        db.add(CompanySettings(key=_ASSUMPTIONS_KEY, value=value, updated_by=updated_by))
    db.commit()
    return get_assumptions(db)


# ── Period helpers ──────────────────────────────────────────────────────────────

_PERIODS = {
    "24h": datetime.timedelta(hours=24),
    "7d": datetime.timedelta(days=7),
    "30d": datetime.timedelta(days=30),
    "90d": datetime.timedelta(days=90),
    "6m": datetime.timedelta(days=182),
    "12m": datetime.timedelta(days=365),
}


def _period_cutoff(period: str) -> datetime.datetime:
    return datetime.datetime.utcnow() - _PERIODS.get(period, _PERIODS["30d"])


def _period_days(period: str) -> float:
    """Length of the reporting period in days — used to amortize the monthly infra cost."""
    return _PERIODS.get(period, _PERIODS["30d"]).total_seconds() / 86400.0


# ── Role → domain scoping ───────────────────────────────────────────────────────
# Admin / Super Admin / Functional Manager see all domains; specialist roles see theirs.
_ROLE_DOMAINS = {
    "hr": ["hr"],
    "it": ["it", "it_support"],
    "pmo": ["pmo"],
}


def _domain_scope(role: str) -> Optional[list[str]]:
    """Return the list of domain values this role may see, or None for unrestricted."""
    return _ROLE_DOMAINS.get((role or "").lower())


# ── Metric + dimension catalog ──────────────────────────────────────────────────
# Each metric: {label, table, agg (callable -> SQLAlchemy expr), time_col, dims (allowed),
#               domain_col (for role scoping, optional), chart_hint, unit}
_AIRL_DIMS = ["domain", "sub_intent", "served_from", "model_name", "day", "week", "month"]
_FB_DIMS = ["domain", "day", "week", "month"]
_CONN_DIMS = ["status", "day", "week", "month"]

METRIC_CATALOG: dict[str, dict] = {
    "requests": {
        "label": "AI Requests", "table": AiRequestLog,
        "agg": lambda M: func.count(M.id), "time_col": "created_at",
        "dims": _AIRL_DIMS, "domain_col": "domain", "chart_hint": "bar", "unit": "count",
    },
    "avg_latency_ms": {
        "label": "Avg Latency (ms)", "table": AiRequestLog,
        "agg": lambda M: func.avg(M.total_latency_ms), "time_col": "created_at",
        "dims": _AIRL_DIMS, "domain_col": "domain", "chart_hint": "line", "unit": "ms",
    },
    "total_tokens": {
        "label": "Total Tokens", "table": AiRequestLog,
        "agg": lambda M: func.sum(M.total_tokens), "time_col": "created_at",
        "dims": _AIRL_DIMS, "domain_col": "domain", "chart_hint": "bar", "unit": "count",
    },
    "prompt_tokens": {
        "label": "Prompt Tokens", "table": AiRequestLog,
        "agg": lambda M: func.sum(M.total_prompt_tokens), "time_col": "created_at",
        "dims": _AIRL_DIMS, "domain_col": "domain", "chart_hint": "bar", "unit": "count",
    },
    "completion_tokens": {
        "label": "Completion Tokens", "table": AiRequestLog,
        "agg": lambda M: func.sum(M.total_completion_tokens), "time_col": "created_at",
        "dims": _AIRL_DIMS, "domain_col": "domain", "chart_hint": "bar", "unit": "count",
    },
    "errors": {
        "label": "Errors", "table": AiRequestLog,
        "agg": lambda M: func.count(M.id).filter(M.error.isnot(None)), "time_col": "created_at",
        "dims": _AIRL_DIMS, "domain_col": "domain", "chart_hint": "line", "unit": "count",
    },
    "cache_savings": {
        "label": "Cache / Fastpath Hits", "table": AiRequestLog,
        "agg": lambda M: func.count(M.id).filter(M.served_from.in_(["cache", "fastpath", "semantic_router"])),
        "time_col": "created_at",
        "dims": _AIRL_DIMS, "domain_col": "domain", "chart_hint": "bar", "unit": "count",
    },
    "helpful_pct": {
        "label": "Helpful %", "table": ChatFeedback,
        # avg of (rating==1) → fraction; *100 done in post-processing
        "agg": lambda M: func.avg(func.coalesce((M.rating + 1) / 2.0, 0.0)),
        "time_col": "created_at",
        "dims": _FB_DIMS, "domain_col": "domain", "chart_hint": "line", "unit": "pct",
    },
    "feedback_count": {
        "label": "Feedback Responses", "table": ChatFeedback,
        "agg": lambda M: func.count(M.id), "time_col": "created_at",
        "dims": _FB_DIMS, "domain_col": "domain", "chart_hint": "bar", "unit": "count",
    },
    "connector_calls": {
        "label": "Connector Calls", "table": ConnectorCallLog,
        "agg": lambda M: func.count(M.id), "time_col": "created_at",
        "dims": _CONN_DIMS, "domain_col": None, "chart_hint": "bar", "unit": "count",
    },
}

# Dimension → (column-name on the metric's table) OR a date_trunc bucket key.
_TIME_BUCKETS = {"day", "week", "month"}
DIMENSION_CATALOG: dict[str, dict] = {
    "domain": {"label": "Domain"},
    "sub_intent": {"label": "Sub-intent"},
    "served_from": {"label": "Served from"},
    "model_name": {"label": "Model"},
    "status": {"label": "Status"},
    "day": {"label": "Day"},
    "week": {"label": "Week"},
    "month": {"label": "Month"},
}

CHART_TYPES = ["bar", "line", "area", "pie"]


def catalog() -> dict:
    """Public catalog for the Studio dropdowns and the NL prompt."""
    return {
        "metrics": [
            {"id": mid, "label": m["label"], "dims": m["dims"],
             "chart_hint": m["chart_hint"], "unit": m["unit"]}
            for mid, m in METRIC_CATALOG.items()
        ],
        "dimensions": [{"id": did, "label": d["label"]} for did, d in DIMENSION_CATALOG.items()],
        "chart_types": CHART_TYPES,
        "periods": list(_PERIODS.keys()),
    }


def _bucket_expr(model, bucket: str):
    col = getattr(model, "created_at")
    return func.date_trunc(bucket, col)


def run_query(
    db: Session, metric: str, dimension: str, period: str = "30d",
    role: str = "super admin", filters: Optional[dict] = None,
) -> dict:
    """Resolve a single (metric, dimension, period) against the catalog → series.

    Returns {series: [{label, value}], metric, dimension, period, chart_hint, unit}.
    Raises ValueError on any unknown metric/dimension (the NL layer relies on this)."""
    if metric not in METRIC_CATALOG:
        raise ValueError(f"Unknown metric: {metric}")
    spec = METRIC_CATALOG[metric]
    if dimension not in spec["dims"]:
        raise ValueError(f"Dimension '{dimension}' not available for metric '{metric}'")

    M = spec["table"]
    agg = spec["agg"](M).label("value")

    if dimension in _TIME_BUCKETS:
        group_expr = _bucket_expr(M, dimension).label("grp")
    else:
        group_expr = getattr(M, dimension).label("grp")

    q = db.query(group_expr, agg).filter(getattr(M, spec["time_col"]) >= _period_cutoff(period))

    # Role-based domain scoping (only where the table carries a domain column).
    scope = _domain_scope(role)
    if scope and spec.get("domain_col"):
        domain_col = getattr(M, spec["domain_col"])
        q = q.filter(func.lower(domain_col).in_(scope))

    # Optional caller filters, restricted to columns on the metric's table.
    for fk, fv in (filters or {}).items():
        if hasattr(M, fk):
            q = q.filter(getattr(M, fk) == fv)

    q = q.group_by(group_expr).order_by(group_expr)
    rows = q.all()

    is_pct = spec["unit"] == "pct"
    series = []
    for grp, value in rows:
        if grp is None:
            label = "—"
        elif isinstance(grp, (datetime.datetime, datetime.date)):
            label = grp.isoformat()
        else:
            label = str(grp)
        val = float(value or 0)
        if is_pct:
            val = round(val * 100, 1)
        else:
            val = round(val, 2)
        series.append({"label": label, "value": val})

    return {
        "series": series, "metric": metric, "dimension": dimension,
        "period": period, "chart_hint": spec["chart_hint"], "unit": spec["unit"],
        "metric_label": spec["label"],
    }


# ── ROI summary ─────────────────────────────────────────────────────────────────

def roi_summary(db: Session, period: str = "30d", role: str = "super admin") -> dict:
    """Headline ROI KPIs for the period, scoped to the caller's role."""
    a = get_assumptions(db)
    cutoff = _period_cutoff(period)
    scope = _domain_scope(role)

    # Per-domain request counts (drives hours-saved + deflection).
    dq = db.query(AiRequestLog.domain, func.count(AiRequestLog.id)).filter(
        AiRequestLog.created_at >= cutoff, AiRequestLog.error.is_(None)
    )
    if scope:
        dq = dq.filter(func.lower(AiRequestLog.domain).in_(scope))
    dq = dq.group_by(AiRequestLog.domain)

    minutes_map = a["minutes_saved_per_request"]
    total_requests = 0
    minutes_from_requests = 0.0
    for domain, count in dq.all():
        total_requests += count
        per = minutes_map.get((domain or "").lower(), minutes_map.get("_default", 5.0))
        minutes_from_requests += per * count

    # Connector-driven minutes saved (real configured estimates), unscoped.
    conn_minutes = (
        db.query(func.coalesce(func.sum(ConnectorOperation.minutes_saved), 0.0))
        .select_from(ConnectorCallLog)
        .join(ConnectorOperation, ConnectorCallLog.operation_id == ConnectorOperation.id)
        .filter(ConnectorCallLog.created_at >= cutoff, ConnectorCallLog.status == "success")
        .scalar()
    ) or 0.0

    total_minutes = minutes_from_requests + float(conn_minutes)
    hours_saved = round(total_minutes / 60.0, 1)
    value_saved = round(hours_saved * a["hourly_cost"], 0)

    # Tokens processed (volume — shown instead of a fake per-token cost for free models).
    tok = db.query(
        func.coalesce(func.sum(AiRequestLog.total_tokens), 0),
    ).filter(AiRequestLog.created_at >= cutoff)
    if scope:
        tok = tok.filter(func.lower(AiRequestLog.domain).in_(scope))
    tokens_processed = int(tok.scalar() or 0)

    # Cost = fixed monthly infrastructure, amortized across the reporting period.
    infra_cost = round(a.get("monthly_infra_cost", 0.0) * (_period_days(period) / 30.0), 0)
    net_value = round(value_saved - infra_cost, 0)

    # Satisfaction.
    fb = db.query(func.avg(func.coalesce((ChatFeedback.rating + 1) / 2.0, 0.0))).filter(
        ChatFeedback.created_at >= cutoff
    )
    if scope:
        fb = fb.filter(func.lower(ChatFeedback.domain).in_(scope))
    sat = fb.scalar()
    satisfaction_pct = round(float(sat) * 100, 1) if sat is not None else None

    return {
        "period": period,
        "currency": a["currency"],
        "hours_saved": hours_saved,
        "value_saved": value_saved,
        "net_value": net_value,
        "infra_cost": infra_cost,
        "tokens_processed": tokens_processed,
        "requests_handled": total_requests,    # treated as manual touches deflected
        "deflection_count": total_requests,
        "satisfaction_pct": satisfaction_pct,
        "assumptions": a,
    }


# ── Ask-your-data: NL → config ───────────────────────────────────────────────────

def translate_nl(db: Session, question: str, role: str = "super admin") -> dict:
    """Translate a plain-English question into a validated query config + its series.

    Uses the existing resilient LLM stack (router tier, structured output). On any miss
    (model down, or a config that names something outside the catalog) returns
    {ok: False, message}. Never executes free-form SQL."""
    from pydantic import BaseModel, Field

    cat = catalog()
    metric_ids = [m["id"] for m in cat["metrics"]]
    dim_ids = [d["id"] for d in cat["dimensions"]]

    class NLConfig(BaseModel):
        metric: str = Field(description=f"one of: {metric_ids}")
        dimension: str = Field(description=f"one of: {dim_ids}")
        period: str = Field(description=f"one of: {cat['periods']}", default="30d")
        chart_type: str = Field(description=f"one of: {CHART_TYPES}", default="bar")

    metric_lines = "\n".join(f"- {m['id']}: {m['label']} (dims: {', '.join(m['dims'])})"
                             for m in cat["metrics"])
    system = (
        "You translate an analytics question into a chart config. "
        "Only use ids from these catalogs — never invent names.\n\n"
        f"METRICS:\n{metric_lines}\n\n"
        f"DIMENSIONS: {dim_ids}\n"
        f"PERIODS: {cat['periods']} (24h, 7d, 30d, 90d, 6m, 12m)\n"
        f"CHART TYPES: {CHART_TYPES}\n\n"
        "Pick the single best metric, the dimension to group/break-down by (use day/week/month "
        "for 'over time' / 'trend'), the period, and a sensible chart type. "
        "If the question is unclear, choose the closest reasonable interpretation."
    )

    try:
        from app.services.llm_resilience import resilient_invoke
        result = resilient_invoke(
            "router",
            [{"role": "system", "content": system}, {"role": "user", "content": question}],
            build=lambda llm: llm.with_structured_output(NLConfig),
        )
        cfg = result if isinstance(result, NLConfig) else NLConfig(**dict(result))
    except Exception as exc:
        log.warning("NL translate failed: %s", exc)
        return {"ok": False, "message": "Couldn't understand that question — try rephrasing, "
                                        "or use the dropdowns below."}

    # Validate against the catalog and snap chart type.
    if cfg.metric not in METRIC_CATALOG:
        return {"ok": False, "message": f"I don't track a metric matching that. "
                                        f"Available: {', '.join(metric_ids)}."}
    if cfg.dimension not in METRIC_CATALOG[cfg.metric]["dims"]:
        # fall back to the first allowed dim for that metric
        cfg.dimension = METRIC_CATALOG[cfg.metric]["dims"][0]
    if cfg.period not in _PERIODS:
        cfg.period = "30d"
    chart_type = cfg.chart_type if cfg.chart_type in CHART_TYPES else METRIC_CATALOG[cfg.metric]["chart_hint"]

    try:
        data = run_query(db, cfg.metric, cfg.dimension, cfg.period, role=role)
    except ValueError as exc:
        return {"ok": False, "message": str(exc)}

    data["chart_type"] = chart_type
    return {"ok": True, "config": {
        "metric": cfg.metric, "dimension": cfg.dimension,
        "period": cfg.period, "chart_type": chart_type,
    }, **data}


# ── ROI PDF (reportlab) ──────────────────────────────────────────────────────────

def roi_pdf_bytes(summary: dict) -> bytes:
    """Render the ROI summary to a one-page PDF using reportlab (already a dependency)."""
    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, bottomMargin=20 * mm)
    styles = getSampleStyleSheet()
    cur = summary.get("currency", "INR")
    sym = "₹" if cur == "INR" else "$"

    elems = [
        Paragraph("Centriq AI — ROI Summary", styles["Title"]),
        Paragraph(f"Period: {summary.get('period', '30d')} &nbsp;&nbsp; "
                  f"Generated: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
                  styles["Normal"]),
        Spacer(1, 10 * mm),
    ]

    def money(v):
        return f"{sym}{v:,.0f}"

    rows = [
        ["Metric", "Value"],
        ["Hours saved", f"{summary.get('hours_saved', 0):,}"],
        ["Estimated value", money(summary.get("value_saved", 0))],
        ["Infra cost (period)", money(summary.get("infra_cost", 0))],
        ["Net value", money(summary.get("net_value", 0))],
        ["Requests handled (deflected)", f"{summary.get('requests_handled', 0):,}"],
        ["Tokens processed", f"{summary.get('tokens_processed', 0):,}"],
        ["Satisfaction", f"{summary.get('satisfaction_pct')}%"
            if summary.get("satisfaction_pct") is not None else "—"],
    ]
    table = Table(rows, colWidths=[90 * mm, 70 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#00a29a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
    ]))
    elems.append(table)
    elems.append(Spacer(1, 8 * mm))
    a = summary.get("assumptions", {})
    elems.append(Paragraph(
        f"<i>Assumptions: hourly cost {money(a.get('hourly_cost', 0))}, "
        f"monthly infrastructure cost {money(a.get('monthly_infra_cost', 0))} "
        f"(amortized across the period).</i>",
        styles["Normal"]))

    doc.build(elems)
    return buf.getvalue()
