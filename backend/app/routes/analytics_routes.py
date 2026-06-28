"""
Analytics + ROI API — powers the ROI Dashboard, the Analytics Studio config builder,
and the "ask-your-data" NL feature. All endpoints require a non-employee role; writes to
the ROI cost model are further restricted to Admin / Super Admin.

The query surface is whitelisted in analytics_service (metric/dimension catalog) — these
routes never accept raw SQL.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.auth import CurrentUser, require_non_employee, require_admin, get_current_user
from app.database import get_db
from app.models import SavedDashboard
from app.services import analytics_service as svc
from app.services import automation_service as autosvc
from app.services import analytics_builder_service as builder_svc
from app.services import analytics_export_service as export_svc

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


# ── Catalog + query ──────────────────────────────────────────────────────────────

@router.get("/catalog")
def get_catalog(_: CurrentUser = Depends(require_non_employee)):
    """Metric + dimension + chart-type lists for the Studio dropdowns and NL prompt."""
    return svc.catalog()


class QueryBody(BaseModel):
    metric: str
    dimension: str
    period: str = "30d"
    filters: Optional[dict] = None


@router.post("/query")
def run_query(body: QueryBody, user: CurrentUser = Depends(require_non_employee),
              db: Session = Depends(get_db)):
    """Resolve one (metric, dimension, period) against the catalog → series data."""
    try:
        return svc.run_query(db, body.metric, body.dimension, body.period,
                             role=user.role, filters=body.filters)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Chart export (ARB #42) ─────────────────────────────────────────────────────
# Accept a ChartSpec (the same payload the Studio / Builder render) and stream
# back a downloadable file. Whitelisted to non-employee analytics users.

def _export_filename(spec: dict, ext: str) -> str:
    raw = (spec.get("title") or "analytics_chart").strip() or "analytics_chart"
    safe = "".join(c if c.isalnum() or c in (" ", "-", "_") else "" for c in raw)
    return f"{safe.strip().replace(' ', '_') or 'analytics_chart'}.{ext}"


@router.post("/export/pdf")
def export_pdf(spec: dict, _: CurrentUser = Depends(require_non_employee)):
    """Render a chart spec to a PDF (vector chart + data table)."""
    try:
        pdf = export_svc.chart_to_pdf(spec)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not render PDF: {e}")
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_export_filename(spec, "pdf")}"'},
    )


@router.post("/export/pptx")
def export_pptx(spec: dict, _: CurrentUser = Depends(require_non_employee)):
    """Render a chart spec to a PowerPoint deck with a native, editable chart."""
    try:
        pptx = export_svc.chart_to_pptx(spec)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not render PPTX: {e}")
    return Response(
        content=pptx,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{_export_filename(spec, "pptx")}"'},
    )


# ── Personal + team analytics (item 9) ────────────────────────────────────────────
# Available to EVERY authenticated user (employees included) but strictly self-scoped:
# "me" resolves to the caller's own employee id, "my-team" to their direct reports — both
# derived server-side from the caller, never from client input. Only personal-category
# metrics (leaves, …) are queryable here; org AI-ops metrics stay on the gated routes above.

@router.get("/me/catalog")
def my_catalog(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Personal/team metric catalog + the scopes available to this caller."""
    return svc.personal_catalog(db, user.email)


class MyQueryBody(BaseModel):
    metric: str
    dimension: str
    period: str = "30d"
    scope: str = "me"                    # me | my-team
    filters: Optional[dict] = None


@router.post("/me/query")
def my_query(body: MyQueryBody, user: CurrentUser = Depends(get_current_user),
             db: Session = Depends(get_db)):
    """Resolve one personal/team metric for the caller. Scope is clamped to me/my-team so
    this endpoint can never expose org-wide data to an employee."""
    if body.metric not in svc.METRIC_CATALOG or \
            svc.METRIC_CATALOG[body.metric].get("category") != "personal":
        raise HTTPException(status_code=400, detail="Not a personal metric.")
    scope = body.scope if body.scope in ("me", "my-team") else "me"
    try:
        return svc.run_query(db, body.metric, body.dimension, body.period,
                             role=user.role, filters=body.filters,
                             person_scope=scope, user_email=user.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class NLBody(BaseModel):
    question: str


@router.post("/nl-query")
def nl_query(body: NLBody, user: CurrentUser = Depends(require_non_employee),
             db: Session = Depends(get_db)):
    """Ask-your-data: plain English → validated config + series (or a helpful miss message)."""
    q = (body.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Empty question.")
    return svc.translate_nl(db, q, role=user.role)


# ── ROI ──────────────────────────────────────────────────────────────────────────

@router.get("/roi/summary")
def roi_summary(period: str = Query("30d"), user: CurrentUser = Depends(require_non_employee),
                db: Session = Depends(get_db)):
    return svc.roi_summary(db, period=period, role=user.role)


@router.get("/roi/export.pdf")
def roi_export_pdf(period: str = Query("30d"), user: CurrentUser = Depends(require_admin),
                   db: Session = Depends(get_db)):
    """Server-rendered ROI PDF (reportlab). Admin / Super Admin only."""
    summary = svc.roi_summary(db, period=period, role=user.role)
    pdf = svc.roi_pdf_bytes(summary)
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="roi-summary-{period}.pdf"'},
    )


# ── Scheduled ROI digest (user-toggled email; off by default) ─────────────────────

class DigestBody(BaseModel):
    period: str = "30d"
    frequency: str = "monthly"           # daily | weekly | monthly
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = 1
    hour: int = 9
    minute: int = 0
    recipients: list = []                # [{type, email, name} | {type:"teams_group", ...}]
    subject: Optional[str] = None


@router.get("/roi/digest")
def list_digests(user: CurrentUser = Depends(require_non_employee)):
    """The caller's ROI digest schedules (subset of automation rules)."""
    rules = autosvc.list_rules(user.email, user.role)
    return [r for r in rules if r.get("automation_kind") == "roi_digest"]


@router.post("/roi/digest")
def create_digest(body: DigestBody, user: CurrentUser = Depends(require_non_employee)):
    """Create a ROI digest schedule. Ships DISABLED — the user enables it explicitly."""
    if not body.recipients:
        raise HTTPException(status_code=400, detail="At least one recipient is required.")
    payload = {
        "name": f"ROI Digest ({body.period})",
        "description": "Auto-generated ROI summary email.",
        "frequency": body.frequency,
        "day_of_week": body.day_of_week,
        "day_of_month": body.day_of_month,
        "hour": body.hour,
        "minute": body.minute,
        "automation_kind": "roi_digest",
        "extra_config": {"period": body.period},
        "email_subject": body.subject or "Centriq AI — ROI Summary",
        "email_body": "Here is the latest ROI summary for the assistant:",
        "recipients_json": body.recipients,
        "is_active": False,   # off until the user turns it on
    }
    return autosvc.create(user.email, user.role, payload)


@router.post("/roi/digest/{rule_id}/toggle")
def toggle_digest(rule_id: int, enabled: bool = Query(...),
                  user: CurrentUser = Depends(require_non_employee)):
    """Enable/disable a ROI digest. Only the creator (or Super Admin) may toggle."""
    res = autosvc.update(user.email, user.role, rule_id, {"is_active": enabled})
    if not res.get("success"):
        code = 403 if res.get("error") == "forbidden" else 404
        raise HTTPException(status_code=code, detail=res.get("error", "error"))
    return res


@router.delete("/roi/digest/{rule_id}")
def delete_digest(rule_id: int, user: CurrentUser = Depends(require_non_employee)):
    res = autosvc.delete(user.email, user.role, rule_id)
    if not res.get("success"):
        code = 403 if res.get("error") == "forbidden" else 404
        raise HTTPException(status_code=code, detail=res.get("error", "error"))
    return res


# ── ROI assumptions (cost model) ──────────────────────────────────────────────────

@router.get("/assumptions")
def get_assumptions(_: CurrentUser = Depends(require_non_employee), db: Session = Depends(get_db)):
    return svc.get_assumptions(db)


@router.put("/assumptions")
def put_assumptions(payload: dict, user: CurrentUser = Depends(require_admin),
                    db: Session = Depends(get_db)):
    """Update the org ROI cost model. Admin / Super Admin only."""
    return svc.set_assumptions(db, payload, updated_by=user.email)


# ── Saved dashboards (Analytics Studio boards) ────────────────────────────────────

def _board_dict(d: SavedDashboard, user_email: str) -> dict:
    return {
        "id": d.id, "name": d.name, "owner_email": d.owner_email,
        "role_visibility": d.role_visibility or [],
        "widgets": d.widgets or [],
        "is_owner": d.owner_email == user_email,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def _visible_to(d: SavedDashboard, user: CurrentUser) -> bool:
    if d.owner_email == user.email or user.role == "super admin":
        return True
    roles = [r.lower() for r in (d.role_visibility or [])]
    return user.role.lower() in roles


class BoardBody(BaseModel):
    name: str
    widgets: list = []
    role_visibility: Optional[list] = None


@router.get("/dashboards")
def list_dashboards(user: CurrentUser = Depends(require_non_employee), db: Session = Depends(get_db)):
    rows = db.query(SavedDashboard).order_by(SavedDashboard.updated_at.desc()).all()
    return [_board_dict(d, user.email) for d in rows if _visible_to(d, user)]


@router.get("/dashboards/{board_id}")
def get_dashboard(board_id: int, user: CurrentUser = Depends(require_non_employee),
                  db: Session = Depends(get_db)):
    d = db.query(SavedDashboard).filter(SavedDashboard.id == board_id).first()
    if not d or not _visible_to(d, user):
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    return _board_dict(d, user.email)


@router.post("/dashboards")
def create_dashboard(body: BoardBody, user: CurrentUser = Depends(require_non_employee),
                     db: Session = Depends(get_db)):
    d = SavedDashboard(
        name=body.name.strip() or "Untitled", owner_email=user.email,
        widgets=body.widgets or [], role_visibility=body.role_visibility,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return _board_dict(d, user.email)


@router.put("/dashboards/{board_id}")
def update_dashboard(board_id: int, body: BoardBody,
                     user: CurrentUser = Depends(require_non_employee), db: Session = Depends(get_db)):
    d = db.query(SavedDashboard).filter(SavedDashboard.id == board_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    if d.owner_email != user.email and user.role != "super admin":
        raise HTTPException(status_code=403, detail="Only the owner can edit this dashboard.")
    d.name = body.name.strip() or d.name
    d.widgets = body.widgets or []
    if body.role_visibility is not None:
        d.role_visibility = body.role_visibility
    db.commit()
    db.refresh(d)
    return _board_dict(d, user.email)


# ── Analytics Builder (conversational chart agent) ────────────────────────────

class BuilderChatBody(BaseModel):
    message: str
    history: list = []           # [{role, content}] — last few turns for context


@router.post("/builder/chat")
def builder_chat(body: BuilderChatBody, user: CurrentUser = Depends(require_non_employee),
                 db: Session = Depends(get_db)):
    """Conversational chart-building agent. Returns ChartSpec + explanation."""
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Empty message.")
    return builder_svc.builder_chat(db, msg, body.history or [], role=user.role,
                                    user_email=user.email)


@router.delete("/dashboards/{board_id}")
def delete_dashboard(board_id: int, user: CurrentUser = Depends(require_non_employee),
                     db: Session = Depends(get_db)):
    d = db.query(SavedDashboard).filter(SavedDashboard.id == board_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    if d.owner_email != user.email and user.role != "super admin":
        raise HTTPException(status_code=403, detail="Only the owner can delete this dashboard.")
    db.delete(d)
    db.commit()
    return {"success": True}
