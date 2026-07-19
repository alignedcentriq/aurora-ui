"""Manager intro-call scheduling — public magic-link page.

Public (no auth — authenticated by the unguessable token in the URL):
  GET  /api/manager-call/schedule/{token}   — renders the date/time picker
  POST /api/manager-call/schedule/{token}   — books the Teams meeting

Mirrors welcome_routes' public backend-rendered pattern so the manager needs no login and
the frontend SPA isn't involved. The new hire's own status is read via the authenticated
/api/onboard/me/manager-call endpoint (see onboarding_routes).
"""

from __future__ import annotations

import html as html_mod
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import require_hr, CurrentUser
from app.database import get_db
from app.services import manager_call_service as mc

public_router = APIRouter(tags=["Manager Call (public)"])
router = APIRouter(prefix="/api/manager-call", tags=["Manager Call (HR admin)"])


# ── HR admin: settings + manual overrides ─────────────────────────────────────

class ManagerCallSettingsBody(BaseModel):
    sender_email: Optional[str] = None
    subject: Optional[str] = None
    intro: Optional[str] = None
    reminder_days: Optional[int] = None


@router.get("/settings")
def get_manager_call_settings(_: CurrentUser = Depends(require_hr)):
    return mc.get_settings()


@router.put("/settings")
def update_manager_call_settings(
    body: ManagerCallSettingsBody,
    user: CurrentUser = Depends(require_hr),
):
    return mc.set_settings(body.model_dump(exclude_unset=True), actor_email=user.email)


@router.post("/invites/{invite_id}/resend")
def resend_manager_invite(
    invite_id: int,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    result = mc.resend_invite(invite_id, db)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Resend failed."))
    return result


class UpdateInviteManagerBody(BaseModel):
    manager_email: Optional[str] = None
    manager_name: Optional[str] = None


@router.put("/invites/{invite_id}")
def update_invite_manager(
    invite_id: int,
    body: UpdateInviteManagerBody,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    result = mc.update_invite_manager(invite_id, body.manager_email or "", body.manager_name or "", db)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "Invite not found."))
    return result


def _page(title: str, inner_html: str, accent: str = "#1B6FC8") -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{html_mod.escape(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{margin:0;font-family:'Segoe UI',Roboto,sans-serif;background:#f0f4fa;
       display:flex;align-items:center;justify-content:center;min-height:100vh;}}
  .card{{background:#fff;border-radius:16px;padding:40px 44px;
         box-shadow:0 4px 24px rgba(0,0,0,.09);max-width:480px;width:90%;}}
  h2{{color:{accent};margin:0 0 6px;font-size:21px;font-weight:800;}}
  p{{color:#475569;font-size:14px;margin:0 0 16px;line-height:1.6;}}
  label{{display:block;font-size:12px;font-weight:700;color:#334155;margin:14px 0 6px;
         text-transform:uppercase;letter-spacing:.04em;}}
  input,select{{width:100%;box-sizing:border-box;padding:11px 12px;font-size:15px;
         border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0f172a;}}
  button{{margin-top:22px;width:100%;padding:13px;font-size:15px;font-weight:700;color:#fff;
          background:{accent};border:none;border-radius:10px;cursor:pointer;}}
  button:hover{{opacity:.92;}}
  .icon{{font-size:46px;line-height:1;margin-bottom:14px;text-align:center;}}
  .muted{{color:#94a3b8;font-size:12px;margin-top:16px;}}
  a.join{{display:inline-block;margin-top:8px;color:#4b53bc;font-weight:700;text-decoration:none;}}
</style></head>
<body><div class="card">{inner_html}</div></body></html>"""


def _result(icon: str, heading: str, message_html: str, accent: str) -> str:
    return _page(heading, f'<div class="icon">{icon}</div><h2 style="text-align:center">{heading}</h2>'
                          f'<p style="text-align:center">{message_html}</p>', accent)


@public_router.get("/api/manager-call/schedule/{token}", response_class=HTMLResponse)
def schedule_page(token: str):
    inv = mc.get_by_token(token)
    if not inv:
        return HTMLResponse(_result("❌", "Link not found",
                                    "This scheduling link is invalid or has expired.", "#dc2626"))

    new_hire = html_mod.escape(inv["new_hire_name"] or inv["new_hire_email"])

    if inv["status"] == "scheduled":
        join = ""
        if inv.get("teams_join_url"):
            join = (f'<p style="text-align:center"><a class="join" href="{html_mod.escape(inv["teams_join_url"])}">'
                    f'Join Microsoft Teams meeting →</a></p>')
        return HTMLResponse(_result(
            "✅", "Already scheduled",
            f'Your intro call with <strong>{new_hire}</strong> is set for '
            f'<strong>{html_mod.escape(inv["scheduled_label"])}</strong>.{join}',
            "#16A34A"))

    # Sensible default: tomorrow 4:00 PM, min = now.
    import datetime as _dt
    default = (_dt.datetime.now() + _dt.timedelta(days=1)).replace(
        hour=16, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M")
    now_min = _dt.datetime.now().strftime("%Y-%m-%dT%H:%M")

    inner = (
        f'<h2>Schedule your intro call</h2>'
        f'<p>Pick a date and time to welcome <strong>{new_hire}</strong>. '
        f'A Microsoft Teams meeting will be created and sent to you both. Times are in IST.</p>'
        f'<form method="post" action="/api/manager-call/schedule/{html_mod.escape(token)}">'
        f'<label for="start">Date &amp; time</label>'
        f'<input type="datetime-local" id="start" name="start_local" value="{default}" min="{now_min}" required>'
        f'<label for="duration">Duration</label>'
        f'<select id="duration" name="duration_minutes">'
        f'<option value="15">15 minutes</option>'
        f'<option value="30" selected>30 minutes</option>'
        f'<option value="45">45 minutes</option>'
        f'<option value="60">60 minutes</option>'
        f'</select>'
        f'<button type="submit">Schedule Teams meeting</button>'
        f'<p class="muted">The new joiner sees "not scheduled yet" until you confirm here.</p>'
        f'</form>'
    )
    return HTMLResponse(_page("Schedule intro call", inner))


@public_router.post("/api/manager-call/schedule/{token}", response_class=HTMLResponse)
def do_schedule(token: str, start_local: str = Form(...), duration_minutes: int = Form(30)):
    result = mc.schedule(token, start_local, duration_minutes)
    if not result.get("ok"):
        return HTMLResponse(_result("⚠️", "Couldn't schedule",
                                    html_mod.escape(result.get("error", "Something went wrong.")),
                                    "#D97706"))
    join = ""
    if result.get("teams_join_url"):
        join = (f'<p style="text-align:center"><a class="join" href="{html_mod.escape(result["teams_join_url"])}">'
                f'Join Microsoft Teams meeting →</a></p>')
    return HTMLResponse(_result(
        "✅", "Intro call scheduled",
        f'Your intro call with <strong>{html_mod.escape(result.get("new_hire_name",""))}</strong> is set for '
        f'<strong>{html_mod.escape(result.get("scheduled_label",""))}</strong>. '
        f'A calendar invite is on its way to you both.{join}',
        "#16A34A"))
