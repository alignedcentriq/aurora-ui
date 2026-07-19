"""
Welcome email routes.

Public (no auth):
  GET /api/welcome/confirm/{token}  — HR clicks Yes/No from email

HR-authenticated:
  GET  /api/portal/hr/welcome/logs           — list welcome log entries
  POST /api/portal/hr/welcome/resend/{id}    — HR manually resends welcome
  GET  /api/portal/hr/welcome/config         — list resource items
  POST /api/portal/hr/welcome/config         — add resource
  PUT  /api/portal/hr/welcome/config/{id}    — update resource
  DEL  /api/portal/hr/welcome/config/{id}    — delete resource
"""

import datetime
import html as html_mod
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from app.auth import require_hr, CurrentUser
from app.database import get_db
from app.models import WelcomeLog, WelcomeResource

router = APIRouter(tags=["HR Welcome"])
public_router = APIRouter(tags=["HR Welcome (public)"])


# ── Public: HR confirms from email link ───────────────────────────────────────

@public_router.get("/api/welcome/confirm/{token}", response_class=HTMLResponse)
def confirm_welcome(token: str, db: Session = Depends(get_db)):
    from app.services.welcome_service import process_confirmation
    result = process_confirmation(token, db)

    if not result["ok"]:
        if result.get("already_done"):
            s = result["status"]
            msg = (
                f"Welcome email was already sent to {html_mod.escape(result['employee_name'])}."
                if s == "welcome_sent"
                else f"Welcome email for {html_mod.escape(result['employee_name'])} was already skipped."
            )
            color = "#16A34A" if s == "welcome_sent" else "#6B7280"
        else:
            msg = result.get("error", "Invalid link.")
            color = "#dc2626"
        return HTMLResponse(content=_result_page(msg, color), status_code=200)

    action = result["action"]
    name = result["employee_name"]
    if action == "send":
        msg = f"Welcome email sent to <strong>{html_mod.escape(name)}</strong>!"
        color = "#16A34A"
    else:
        msg = f"Welcome email skipped for {html_mod.escape(name)}."
        color = "#6B7280"

    return HTMLResponse(content=_result_page(msg, color), status_code=200)


def _result_page(message: str, color: str) -> str:
    icon = "✅" if color == "#16A34A" else ("⏭️" if color == "#6B7280" else "❌")
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Welcome Flow</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{margin:0;font-family:'Segoe UI',Roboto,sans-serif;background:#f0f4fa;
       display:flex;align-items:center;justify-content:center;min-height:100vh;}}
  .card{{background:#fff;border-radius:16px;padding:44px 52px;text-align:center;
         box-shadow:0 4px 24px rgba(0,0,0,.09);max-width:440px;width:90%;}}
  .icon{{font-size:52px;line-height:1;margin-bottom:18px;}}
  h2{{color:{color};margin:0 0 12px;font-size:20px;font-weight:700;}}
  p{{color:#64748b;font-size:14px;margin:0;line-height:1.6;}}
</style></head>
<body>
  <div class="card">
    <div class="icon">{icon}</div>
    <h2>Done</h2>
    <p>{message}</p>
  </div>
</body></html>"""


# ── HR: Welcome Logs ──────────────────────────────────────────────────────────

@router.get("/api/portal/hr/welcome/logs")
def list_welcome_logs(
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    rows = db.query(WelcomeLog).order_by(WelcomeLog.created_at.desc()).all()

    def _resources_sent(raw: str | None) -> list:
        if not raw:
            return []
        try:
            return json.loads(raw)
        except Exception:
            return []

    return [
        {
            "id": r.id,
            "employee_name": r.employee_name,
            "employee_email": r.employee_email,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
            "acted_at": r.acted_at.isoformat() if r.acted_at else None,
            "acted_by": r.acted_by,
            "resources_sent": _resources_sent(r.resources_sent),
        }
        for r in rows
    ]


@router.post("/api/portal/hr/welcome/resend/{log_id}")
def resend_welcome(
    log_id: int,
    user: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    log = db.query(WelcomeLog).filter(WelcomeLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found.")
    from app.services.welcome_service import send_welcome_email
    ok = send_welcome_email(log.employee_email, log.employee_name, db)
    if not ok:
        raise HTTPException(
            status_code=500,
            detail="Failed to send email. Check that your MS365 account is connected in Settings.",
        )
    log.status = "welcome_sent"
    log.acted_at = datetime.datetime.utcnow()
    log.acted_by = user.email
    db.commit()
    return {"ok": True, "message": f"Welcome email resent to {log.employee_name}."}


# ── HR: Welcome Resource Config ───────────────────────────────────────────────

class WelcomeResourceBody(BaseModel):
    name: str
    url: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    is_active: Optional[bool] = True
    sort_order: Optional[int] = 0


def _serialize_resource(r: WelcomeResource) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "url": r.url,
        "description": r.description,
        "category": r.category,
        "icon": r.icon,
        "is_active": r.is_active,
        "sort_order": r.sort_order,
        "created_at": r.created_at.isoformat(),
    }


@router.get("/api/portal/hr/welcome/config")
def list_resources(
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(WelcomeResource)
        .order_by(WelcomeResource.sort_order, WelcomeResource.id)
        .all()
    )
    return [_serialize_resource(r) for r in rows]


@router.post("/api/portal/hr/welcome/config")
def add_resource(
    body: WelcomeResourceBody,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    r = WelcomeResource(**body.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return _serialize_resource(r)


@router.put("/api/portal/hr/welcome/config/{resource_id}")
def update_resource(
    resource_id: int,
    body: WelcomeResourceBody,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    r = db.query(WelcomeResource).filter(WelcomeResource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource not found.")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    db.commit()
    return _serialize_resource(r)


@router.delete("/api/portal/hr/welcome/config/{resource_id}")
def delete_resource(
    resource_id: int,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    r = db.query(WelcomeResource).filter(WelcomeResource.id == resource_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Resource not found.")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ── HR: Email delivery health check ───────────────────────────────────────────

@router.get("/api/portal/hr/email-health")
def get_email_health(_: CurrentUser = Depends(require_hr)):
    from app.services.email_service import check_email_health
    return check_email_health()


# ── HR: Welcome Email Mode (auto vs. review) ──────────────────────────────────

_VALID_WELCOME_MODES = {"auto", "review"}


@router.get("/api/portal/hr/welcome/mode")
def get_welcome_mode(_: CurrentUser = Depends(require_hr)):
    from app.services.company_settings_service import CompanySettingsService
    mode = (CompanySettingsService.get("welcome_email_mode") or "auto").strip().lower()
    return {"mode": mode if mode in _VALID_WELCOME_MODES else "auto"}


class WelcomeModeBody(BaseModel):
    mode: str


@router.put("/api/portal/hr/welcome/mode")
def update_welcome_mode(
    body: WelcomeModeBody,
    user: CurrentUser = Depends(require_hr),
):
    from app.services.company_settings_service import CompanySettingsService
    mode = (body.mode or "").strip().lower()
    if mode not in _VALID_WELCOME_MODES:
        raise HTTPException(status_code=400, detail="mode must be 'auto' or 'review'.")
    CompanySettingsService.set("welcome_email_mode", mode, updated_by=user.email)
    return {"ok": True, "mode": mode}


# ── HR: Welcome Message (editable subject + intro) ────────────────────────────

DEFAULT_WELCOME_MESSAGE = (
    "Welcome to the team, {name}! 🎉\n\n"
    "We're thrilled to have you on board as our new {designation} in {department}. "
    "Below are the tools and resources available to you through Centriq AI — your "
    "digital workplace assistant. Just open the app and ask anything!"
)

DEFAULT_WELCOME_SUBJECT = "Welcome to the team, {name}!"


@router.get("/api/portal/hr/welcome/message")
def get_welcome_message(_: CurrentUser = Depends(require_hr)):
    from app.services.company_settings_service import CompanySettingsService
    text = CompanySettingsService.get("welcome_email_intro")
    subject = CompanySettingsService.get("welcome_email_subject")
    return {
        "text": text or DEFAULT_WELCOME_MESSAGE,
        "subject": subject or DEFAULT_WELCOME_SUBJECT,
    }


class WelcomeMessageBody(BaseModel):
    text: str
    subject: Optional[str] = None


@router.put("/api/portal/hr/welcome/message")
def update_welcome_message(
    body: WelcomeMessageBody,
    user: CurrentUser = Depends(require_hr),
):
    from app.services.company_settings_service import CompanySettingsService
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    CompanySettingsService.set("welcome_email_intro", text, updated_by=user.email)

    subject = (body.subject or "").strip()
    if subject:
        CompanySettingsService.set("welcome_email_subject", subject, updated_by=user.email)

    return {"ok": True, "text": text, "subject": subject or DEFAULT_WELCOME_SUBJECT}


# ── HR: Welcome Email Preview (renders, never sends) ──────────────────────────

class WelcomePreviewBody(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    joining_date_label: Optional[str] = None
    manager_name: Optional[str] = None


@router.post("/api/portal/hr/welcome/preview")
def preview_welcome_email(
    body: WelcomePreviewBody,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    from app.services.welcome_service import render_welcome_preview
    return render_welcome_preview(
        db,
        name=(body.name or "").strip(),
        department=(body.department or "").strip(),
        designation=(body.designation or "").strip(),
        joining_date_label=(body.joining_date_label or "").strip(),
        manager_name=(body.manager_name or "").strip(),
    )
