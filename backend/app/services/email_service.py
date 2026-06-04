"""
Email dispatcher for Centriq AI — sends via Microsoft Graph API.

All outbound emails are sent FROM the logged-in user's connected Microsoft 365
mailbox using their delegated OAuth token. The destination is always read from
the NOTIFY_TO_EMAIL environment variable (no hardcoded addresses).

Every email is rendered through one shared "Gradient Hero" template
(`_email_shell`) so the whole product looks consistent: a brand-gradient header
band carrying the Centriq AI buddy mascot + wordmark, a white card body built
from `_detail_rows` / `_button_row` / `_status_pill`, and a branded footer. The
buddy is embedded as an inline CID attachment (`cid:buddy`) so it renders in
Outlook desktop and Gmail alike — no public asset hosting needed.

Used by:
  - IT Agent     → IT ticket notifications
  - Admin Agent  → parking / food complaint / reimbursement notifications
  - HR Agent     → leave approval, queries, grievances, onboarding/offboarding
"""

import asyncio
import base64
import concurrent.futures
import json
import logging
import html
import pathlib
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("aurora-logger")

_GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail"
_TIMEOUT = 15.0


# ── Brand palette (mirrors src/styles.css 4C theme) ───────────────────────────
_C_PRIMARY = "#1B6FC8"   # Clarity blue (gradient start / Outlook fallback)
_C_TEAL    = "#0D9488"
_C_GREEN   = "#16A34A"
_C_INK     = "#0d1b2e"   # near-black navy text
_C_OK      = "#16A34A"   # approved / positive
_C_NO      = "#dc2626"   # rejected / destructive
_C_AMBER   = "#D97706"   # pending / warning
_C_INFO    = "#1B6FC8"   # informational
_C_PURPLE  = "#7c3aed"   # confidential
_GRADIENT  = "linear-gradient(135deg,#1B6FC8 0%,#0D9488 60%,#16A34A 100%)"
_FONT      = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

# Buddy mascot — loaded once and base64-encoded for inline (cid:) embedding.
_ASSETS_DIR = pathlib.Path(__file__).resolve().parent.parent / "assets"
try:
    _BUDDY_B64 = base64.b64encode((_ASSETS_DIR / "buddy.png").read_bytes()).decode()
except Exception as _e:  # pragma: no cover - asset should always be present
    _BUDDY_B64 = ""
    logger.warning("[email] buddy.png asset not found: %s", _e)


def _nl2br(text: str) -> str:
    """Escape HTML and convert newlines to <br> for email clients that ignore CSS."""
    return html.escape(text).replace("\n", "<br>")


# ── Shared "Gradient Hero" template + building blocks ─────────────────────────

def _email_shell(title: str, intro_html: str, body_html: str, *, preheader: str = "") -> str:
    """Wrap email content in the branded Gradient Hero layout.

    `title`       — header band subtitle (line under the Centriq AI wordmark).
    `intro_html`  — greeting / lead paragraphs (trusted HTML).
    `body_html`   — detail tables, buttons, notes (built from the helpers below).
    `preheader`   — short inbox preview text (plain).
    """
    pre = (
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;'
        f'opacity:0;color:transparent;height:0;width:0;">{html.escape(preheader)}</div>'
        if preheader else ""
    )
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4fa;-webkit-text-size-adjust:100%;">
{pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4fa;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <!-- header -->
    <tr><td bgcolor="{_C_PRIMARY}" style="background:{_C_PRIMARY};background:{_GRADIENT};padding:22px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="56" valign="middle" style="padding-right:14px;">
          <img src="cid:buddy" width="48" height="48" alt="Centriq buddy" style="display:block;border:0;outline:none;">
        </td>
        <td valign="middle">
          <div style="font:800 22px {_FONT};color:#ffffff;line-height:1.1;letter-spacing:.2px;">Centriq AI</div>
          <div style="font:600 14px {_FONT};color:#e6f6f1;margin-top:3px;">{title}</div>
        </td>
      </tr></table>
    </td></tr>
    <!-- body -->
    <tr><td style="padding:26px 30px 10px;font:400 15px/1.6 {_FONT};color:#334155;">
      {intro_html}
      {body_html}
    </td></tr>
    <!-- footer -->
    <tr><td style="padding:16px 30px 24px;border-top:1px solid #eef2f8;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="30" valign="middle" style="padding-right:10px;">
          <img src="cid:buddy" width="22" height="22" alt="" style="display:block;border:0;opacity:0.92;">
        </td>
        <td valign="middle" style="font:600 13px {_FONT};color:#0d1b2e;">
          Centriq AI <span style="color:#94a3b8;font-weight:400;">— Aligned Automation</span>
        </td>
      </tr></table>
    </td></tr>
  </table>
</td></tr></table>
</body></html>"""


def _detail_rows(rows: "list[tuple[str, str]]") -> str:
    """Two-column detail table. Labels/values are expected to be already-escaped
    or trusted HTML (callers use html.escape / _nl2br)."""
    trs = "".join(
        f'<tr>'
        f'<td style="padding:11px 16px;background:#eef3fa;font:600 13px {_FONT};color:#475569;'
        f'border-bottom:2px solid #ffffff;width:155px;vertical-align:top;">{label}</td>'
        f'<td style="padding:11px 16px;background:#f8fafc;font:400 14px {_FONT};color:#0d1b2e;'
        f'border-bottom:2px solid #ffffff;vertical-align:top;">{value}</td>'
        f'</tr>'
        for label, value in rows
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;'
        f'margin:18px 0;border:1px solid #e6edf6;">{trs}</table>'
    )


def _button_row(buttons: "list[tuple[str, str, str]]") -> str:
    """Bulletproof rounded action buttons. Each button is (label, url, color).
    Renders as a VML roundrect in Outlook desktop and a CSS pill elsewhere."""
    cells = ""
    for label, url, color in buttons:
        u = html.escape(url)
        cells += f"""
        <td align="center" style="padding:6px 8px;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{u}" style="height:46px;v-text-anchor:middle;width:210px;" arcsize="55%" stroke="f" fillcolor="{color}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:{_FONT};font-size:15px;font-weight:bold;">{label}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="{u}" style="background:{color};color:#ffffff;display:inline-block;font:700 15px {_FONT};line-height:46px;height:46px;width:210px;text-align:center;text-decoration:none;border-radius:25px;box-shadow:0 2px 6px rgba(13,27,46,.18);">{label}</a>
          <!--<![endif]-->
        </td>"""
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" align="center" '
        f'style="margin:20px auto 8px;"><tr>{cells}</tr></table>'
    )


def _status_pill(text: str, color: str) -> str:
    """Small solid status badge (e.g. Pending / Approved / Rejected)."""
    return (
        f'<span style="display:inline-block;background:{color};color:#ffffff;'
        f'font:700 11px {_FONT};padding:5px 13px;border-radius:20px;'
        f'letter-spacing:.5px;text-transform:uppercase;">{html.escape(text)}</span>'
    )


def _section(title: str, color: str, items_html: str) -> str:
    """A titled checklist section used by onboarding / offboarding emails."""
    return (
        f'<div style="margin:20px 0 6px;font:700 14px {_FONT};color:{color};">{title}</div>'
        f'<ul style="margin:0 0 6px;padding-left:20px;font:400 14px/1.75 {_FONT};color:#334155;">{items_html}</ul>'
    )


def _note(text: str) -> str:
    """Muted footnote paragraph (expiry / 'submitted via' lines)."""
    return f'<p style="margin:16px 0 4px;font:400 12px {_FONT};color:#94a3b8;">{text}</p>'


# ── Async / token plumbing (unchanged) ────────────────────────────────────────

def _run_coro(coro):
    """Run an async coroutine to completion from sync code, whether or not an
    event loop is already running in the calling thread.

    `_send` is synchronous but is reached from async agent tools (running loop)
    as well as from background daemon threads (no loop). asyncio.run() works in
    the latter but raises inside a running loop, so fall back to a worker thread.
    """
    import asyncio
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)  # no loop in this thread — safe to run directly
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(asyncio.run, coro).result()


def _get_graph_token(user_email: str) -> str | None:
    """Return a valid Microsoft Graph token for user_email, or None if not connected.

    Resolves the async `get_valid_token` from both sync and async contexts: if an
    event loop is already running, the coroutine is run on a worker thread with
    its own loop; otherwise `asyncio.run` is used directly.
    """
    try:
        from app.services.oauth_service import get_valid_token
        try:
            asyncio.get_running_loop()
            in_loop = True
        except RuntimeError:
            in_loop = False

        if in_loop:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                return ex.submit(
                    asyncio.run, get_valid_token(user_email, "microsoft")
                ).result()
        return asyncio.run(get_valid_token(user_email, "microsoft"))
    except Exception as e:
        logger.warning("[email] Cannot get Graph token for %s: %s", user_email, e)
        return None


def _send(
    user_email: str,
    to: "str | list[str]",
    subject: str,
    html_body: str,
    inline_images: "dict | None" = None,
    files: "dict | None" = None,
) -> bool:
    """
    Send an email via Microsoft Graph API using the logged-in user's delegated token.

    - FROM  : user_email's Microsoft 365 mailbox (via their connected account token)
    - TO    : `to` — must be a value from settings.NOTIFY_TO_EMAIL or a specific person's
              email from the database (manager, employee). Never hardcoded in callers.
    - inline_images : optional { content_id: (filename, base64_str) } embedded inline
              (referenced from the HTML as `cid:<content_id>`).
    - files : optional { filename: (base64_str, content_type) } regular (non-inline)
              file attachments, e.g. an .xlsx report.
    - Returns True on success, False on any failure (non-blocking).
    """
    if not to:
        logger.warning("[email] No recipient provided — email not sent.")
        return False

    token = _get_graph_token(user_email)
    if not token:
        logger.warning("[email] No Graph token for %s — email not sent. Connect MS365 in Settings.", user_email)
        return False

    to_list = [to] if isinstance(to, str) else to
    message = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": html_body},
        "toRecipients": [{"emailAddress": {"address": addr}} for addr in to_list],
    }
    attachments = []
    if inline_images:
        attachments += [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": fname,
                "contentType": "image/png",
                "contentBytes": b64,
                "contentId": cid,
                "isInline": True,
            }
            for cid, (fname, b64) in inline_images.items()
            if b64
        ]
    if files:
        attachments += [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": fname,
                "contentType": ctype or "application/octet-stream",
                "contentBytes": b64,
                "isInline": False,
            }
            for fname, (b64, ctype) in files.items()
            if b64
        ]
    if attachments:
        message["attachments"] = attachments
    payload = {"message": message, "saveToSentItems": True}

    try:
        resp = httpx.post(
            _GRAPH_SEND_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        logger.info("[email] sent from=%s to=%s subject=%s", user_email, to_list, subject)
        return True
    except httpx.HTTPStatusError as e:
        logger.error("[email] Graph send failed from=%s: %s %s", user_email, e.response.status_code, e.response.text[:300])
        return False
    except Exception as e:
        logger.error("[email] Graph send error from=%s: %s", user_email, e)
        return False


def _send_html(
    user_email: str,
    to: "str | list[str]",
    subject: str,
    html_body: str,
    files: "dict | None" = None,
) -> bool:
    """Send a shell-rendered email with the buddy mascot attached inline (cid:buddy),
    plus optional file attachments via `files` ({filename: (base64, content_type)})."""
    return _send(
        user_email, to, subject, html_body,
        inline_images={"buddy": ("buddy.png", _BUDDY_B64)},
        files=files,
    )


# ── Software Install ──────────────────────────────────────────────────────────

def send_software_install_email(
    user_email: str,
    software_name: str,
    subject: str,
    body: str,
) -> bool:
    """Send a confirmed software install request to the helpdesk Teams channel."""
    intro = "<p>A software installation request has been submitted via Centriq AI.</p>"
    body_html = (
        _detail_rows([("Software", html.escape(software_name))])
        + f'<div style="font:400 14px/1.6 {_FONT};color:#334155;">{_nl2br(body)}</div>'
        + _note("Submitted via Centriq AI. Reply to respond directly to the requester.")
    )
    html_body = _email_shell("Software Installation Request", intro, body_html,
                             preheader=f"Install request: {software_name}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


# ── IT Helpdesk ───────────────────────────────────────────────────────────────

def send_it_ticket_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    employee_id: str,
    department: str,
    category: str,
    subject: str,
    description: str,
    priority: str,
    ticket_id: str,
) -> bool:
    """Send IT ticket to the helpdesk Teams channel."""
    email_subject = f"[IT Support] {category} - {subject} | {employee_id}"
    intro = f"<p>A new IT support request was raised by <strong>{html.escape(employee_name)}</strong>.</p>"
    body_html = _detail_rows([
        ("Ticket ID", html.escape(ticket_id)),
        ("Requester", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Employee ID", html.escape(employee_id)),
        ("Department", html.escape(department)),
        ("Category", html.escape(category)),
        ("Priority", html.escape(priority)),
        ("Subject", html.escape(subject)),
        ("Description", _nl2br(description)),
    ]) + _note("Submitted via Centriq AI. Reply to respond directly to the employee.")
    html_body = _email_shell("IT Support Request", intro, body_html,
                             preheader=f"{category} · {priority} · {ticket_id}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, email_subject, html_body)


# ── Admin Notifications ───────────────────────────────────────────────────────

def send_parking_request_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    vehicle_type: str,
    vehicle_number: str,
    vehicle_make: str,
    vehicle_model: str,
    action: str = "request",
) -> bool:
    action_label = "New Parking Request" if action == "request" else "Parking Surrender Request"
    subject = f"[Admin] {action_label} — {vehicle_number}"
    intro = f"<p><strong>{html.escape(employee_name)}</strong> submitted a {action_label.lower()}.</p>"
    body_html = _detail_rows([
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Vehicle Type", html.escape(vehicle_type)),
        ("Vehicle Number", html.escape(vehicle_number)),
        ("Make", html.escape(vehicle_make) or "—"),
        ("Model", html.escape(vehicle_model) or "—"),
        ("Action", action_label),
    ]) + _note("Submitted via Centriq AI. Reply to respond directly to the employee.")
    html_body = _email_shell(action_label, intro, body_html, preheader=vehicle_number)
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_visitor_pass_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    visitor_name: str,
    visit_date: str,
    purpose: str,
    pass_id: str,
    visit_time: str = "",
    visitor_company: str = "",
) -> bool:
    """Notify the admin / reception team of a new visitor pass request."""
    subject = f"[Admin] Visitor Pass Request — {visitor_name} | {pass_id}"
    intro = f"<p><strong>{html.escape(employee_name)}</strong> has requested a visitor pass.</p>"
    body_html = _detail_rows([
        ("Pass ID", html.escape(pass_id)),
        ("Host", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Visitor Name", html.escape(visitor_name)),
        ("Visitor Company", html.escape(visitor_company) or "—"),
        ("Visit Date", html.escape(visit_date)),
        ("Visit Time", html.escape(visit_time) or "—"),
        ("Purpose", _nl2br(purpose)),
    ]) + _note("Submitted via Centriq AI. Reply to respond directly to the host.")
    html_body = _email_shell("Visitor Pass Request", intro, body_html,
                             preheader=f"{visitor_name} · {visit_date}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_food_complaint_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    vendor_name: str,
    complaint_type: str,
    description: str,
    ticket_id: str,
) -> bool:
    subject = f"[Admin] Food Complaint — {vendor_name} | {ticket_id}"
    intro = (f'<p>{_status_pill("Complaint", _C_NO)}</p>'
             f"<p>A food / cafeteria complaint was reported by <strong>{html.escape(employee_name)}</strong>.</p>")
    body_html = _detail_rows([
        ("Ticket ID", html.escape(ticket_id)),
        ("Reported By", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Vendor / Source", html.escape(vendor_name)),
        ("Complaint Type", html.escape(complaint_type)),
        ("Description", _nl2br(description)),
    ]) + _note("Submitted via Centriq AI. Reply to respond directly to the employee.")
    html_body = _email_shell("Food / Cafeteria Complaint", intro, body_html,
                             preheader=f"{vendor_name} · {complaint_type}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_facility_complaint_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ticket_id: str,
    category: str,
    description: str,
    location: str,
    priority: str,
) -> bool:
    subject = f"[Admin] Facility Complaint {ticket_id} — {category} ({priority})"
    intro = (f'<p>{_status_pill("Complaint", _C_AMBER)}</p>'
             f"<p>A facility complaint was reported by <strong>{html.escape(employee_name)}</strong>.</p>")
    body_html = _detail_rows([
        ("Ticket ID", html.escape(ticket_id)),
        ("Reported By", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Category", html.escape(category)),
        ("Location", html.escape(location)),
        ("Priority", html.escape(priority)),
        ("Description", _nl2br(description)),
    ]) + _note("Submitted via Centriq AI. Reply to respond directly to the employee.")
    html_body = _email_shell("Facility Complaint", intro, body_html,
                             preheader=f"{category} · {priority}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_facility_complaint_status_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ticket_id: str,
    category: str,
    new_status: str,
    closure_comment: Optional[str] = None,
) -> bool:
    color = _C_OK if new_status == "Closed" else _C_PURPLE
    subject = f"[Facility Complaint {ticket_id}] Status updated to {new_status}"
    intro = (f"<p>Hi {html.escape(employee_name)},</p>"
             f"<p>Your facility complaint has been updated to {_status_pill(new_status, color)}.</p>")
    rows = [
        ("Ticket ID", html.escape(ticket_id)),
        ("Category", html.escape(category)),
        ("New Status", f'<strong style="color:{color};">{html.escape(new_status)}</strong>'),
    ]
    if closure_comment:
        rows.append(("Closure Comment", _nl2br(closure_comment)))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    html_body = _email_shell("Facility Complaint Update", intro, body_html,
                             preheader=f"{ticket_id} → {new_status}")
    return _send_html(user_email, employee_email, subject, html_body)


def send_food_complaint_status_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ticket_id: str,
    vendor_name: str,
    new_status: str,
    closure_comment: Optional[str] = None,
) -> bool:
    color = _C_OK if new_status == "Closed" else _C_PURPLE
    subject = f"[Food Complaint {ticket_id}] Status updated to {new_status}"
    intro = (f"<p>Hi {html.escape(employee_name)},</p>"
             f"<p>Your food / cafeteria complaint has been updated to {_status_pill(new_status, color)}.</p>")
    rows = [
        ("Ticket ID", html.escape(ticket_id)),
        ("Vendor / Source", html.escape(vendor_name)),
        ("New Status", f'<strong style="color:{color};">{html.escape(new_status)}</strong>'),
    ]
    if closure_comment:
        rows.append(("Closure Comment", _nl2br(closure_comment)))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    html_body = _email_shell("Food Complaint Update", intro, body_html,
                             preheader=f"{ticket_id} → {new_status}")
    return _send_html(user_email, employee_email, subject, html_body)


def send_reimbursement_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    reimbursement_type: str,
    amount: float,
    reason: str,
    reimbursement_id: int,
) -> bool:
    subject = f"[Admin] Reimbursement Request #{reimbursement_id} — {reimbursement_type}"
    intro = f"<p><strong>{html.escape(employee_name)}</strong> submitted a reimbursement request.</p>"
    body_html = _detail_rows([
        ("Request ID", f"#{reimbursement_id}"),
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Type", html.escape(reimbursement_type)),
        ("Amount", f"<strong>INR {amount:,.2f}</strong>"),
        ("Reason / Details", _nl2br(reason)),
    ]) + _note("Submitted via Centriq AI. Reply to respond directly to the employee.")
    html_body = _email_shell("Reimbursement Request", intro, body_html,
                             preheader=f"{reimbursement_type} · INR {amount:,.2f}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


# ── Bookshelf Buddy ───────────────────────────────────────────────────────────

def send_book_request_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    book_title: str,
    book_author: str,
    ticket_id: str,
    notes: str = "",
    approve_url: str = "",
    reject_url: str = "",
) -> bool:
    """Notify the Bookshelf POC about a new book issue request.
    Sends to BOOKSHELF_NOTIFY_EMAIL (not NOTIFY_TO_EMAIL) to keep out of the real admin inbox.
    """
    to = settings.BOOKSHELF_NOTIFY_EMAIL
    if not to:
        logger.warning("[bookshelf email] BOOKSHELF_NOTIFY_EMAIL not set — skipping notification.")
        return False
    subject = f"[Bookshelf] Book Request — {book_title} | {ticket_id}"
    rows = [
        ("Ticket ID", html.escape(ticket_id)),
        ("Requested By", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Book Title", html.escape(book_title)),
        ("Author", html.escape(book_author)),
    ]
    if notes:
        rows.append(("Notes", _nl2br(notes)))
    intro = (f'<p>{_status_pill("Pending", _C_AMBER)}</p>'
             "<p>A new book issue request has been submitted via Centriq AI.</p>")
    body_html = _detail_rows(rows)
    if approve_url and reject_url:
        body_html += "<p>Action this request directly from email:</p>"
        body_html += _button_row([
            ("✓ Approve Request", approve_url, _C_OK),
            ("✗ Reject Request", reject_url, _C_NO),
        ])
        body_html += _note("Links expire in 72 hours. You can also action this from "
                           "<strong>Admin Portal → Bookshelf Buddy</strong>.")
    else:
        body_html += "<p>Please review and approve / reject from the <strong>Admin Portal → Bookshelf Buddy</strong> tab.</p>"
        body_html += _note("Submitted via Centriq AI.")
    html_body = _email_shell("Bookshelf Buddy — Book Issue Request", intro, body_html,
                             preheader=f"{book_title} · {employee_name}")
    return _send_html(user_email, to, subject, html_body)


def send_book_decision_email(
    user_email: str,
    employee_email: str,
    employee_name: str,
    book_title: str,
    ticket_id: str,
    decision: str,
    due_date: str = "",
    admin_remarks: str = "",
) -> bool:
    """Notify the requesting employee that their borrow request was Approved / Rejected."""
    approved = decision == "Approved"
    color = _C_OK if approved else _C_NO
    title = "Book Request Approved" if approved else "Book Request Update"
    intro = (
        f'<p>{_status_pill(decision, color)}</p>'
        + (f"<p>Good news, {html.escape(employee_name) or 'there'} — your borrow request has been "
           f'<strong style="color:{color};">approved</strong>.</p>'
           if approved else
           f"<p>Hi {html.escape(employee_name) or 'there'}, your borrow request was "
           f'<strong style="color:{color};">not approved</strong>.</p>')
    )
    rows = [
        ("Ticket ID", html.escape(ticket_id)),
        ("Book", html.escape(book_title)),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
    ]
    if approved and due_date:
        rows.append(("Return By", f"<strong>{html.escape(due_date)}</strong>"))
    if admin_remarks:
        rows.append(("Admin Note", _nl2br(admin_remarks)))
    body_html = _detail_rows(rows) + _note("View your borrows in Centriq AI → <strong>My Library</strong>.")
    subject = f"[Bookshelf] Book Request {decision} — {book_title} | {ticket_id}"
    html_body = _email_shell(title, intro, body_html, preheader=f"{book_title} · {decision}")
    return _send_html(user_email, employee_email, subject, html_body)


def send_book_return_confirmation(
    user_email: str,
    employee_email: str,
    employee_name: str,
    book_title: str,
    ticket_id: str,
) -> bool:
    subject = f"[Bookshelf] Return Confirmed — {book_title} | {ticket_id}"
    intro = (f'<p>{_status_pill("Returned", _C_OK)}</p>'
             f"<p>Hi {html.escape(employee_name) or 'there'}, we've recorded your return of "
             f"<strong>{html.escape(book_title)}</strong>. Thank you!</p>")
    body_html = _detail_rows([
        ("Ticket ID", html.escape(ticket_id)),
        ("Book", html.escape(book_title)),
    ]) + _note("You can borrow more titles any time from Centriq AI → <strong>Library</strong>.")
    html_body = _email_shell("Book Returned — Thank You!", intro, body_html,
                             preheader=book_title)
    return _send_html(user_email, employee_email, subject, html_body)


def send_extension_request_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    book_title: str,
    ticket_id: str,
    additional_days: int,
    current_due_date: str,
    reason: str = "",
    approve_url: str = "",
    reject_url: str = "",
) -> bool:
    """Notify admin that an employee has requested a borrow extension."""
    to = settings.BOOKSHELF_NOTIFY_EMAIL
    if not to:
        return False
    subject = f"[Bookshelf] Extension Request — {book_title} | {ticket_id}"
    rows = [
        ("Ticket ID", html.escape(ticket_id)),
        ("Book", html.escape(book_title)),
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Current Due Date", html.escape(current_due_date)),
        ("Additional Days", f"<strong>{int(additional_days)}</strong>"),
    ]
    if reason:
        rows.append(("Reason", _nl2br(reason)))
    intro = (f'<p>{_status_pill("Pending", _C_AMBER)}</p>'
             f"<p><strong>{html.escape(employee_name) or html.escape(employee_email)}</strong> "
             "has requested a borrow extension.</p>")
    body_html = _detail_rows(rows)
    if approve_url and reject_url:
        body_html += _button_row([
            ("✓ Approve Extension", approve_url, _C_OK),
            ("✗ Reject Extension", reject_url, _C_NO),
        ])
        body_html += _note("Links expire in 72 hours. Submitted via Centriq AI.")
    else:
        body_html += "<p>Please review from the <strong>Admin Portal → Bookshelf Buddy</strong> tab.</p>"
        body_html += _note("Submitted via Centriq AI.")
    html_body = _email_shell("Bookshelf Buddy — Extension Request", intro, body_html,
                             preheader=f"{book_title} · +{int(additional_days)} days")
    return _send_html(user_email, to, subject, html_body)


def send_extension_decision_email(
    user_email: str,
    employee_email: str,
    employee_name: str,
    book_title: str,
    ticket_id: str,
    decision: str,
    new_due_date: str = "",
    admin_remarks: str = "",
) -> bool:
    approved = decision == "Approved"
    color = _C_OK if approved else _C_NO
    intro = (f'<p>{_status_pill(decision, color)}</p>'
             f"<p>Hi {html.escape(employee_name) or 'there'}, your extension request has been "
             f'<strong style="color:{color};">{html.escape(decision)}</strong>.</p>')
    rows = [
        ("Ticket ID", html.escape(ticket_id)),
        ("Book", html.escape(book_title)),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
    ]
    if approved and new_due_date:
        rows.append(("New Due Date", f"<strong>{html.escape(new_due_date)}</strong>"))
    if admin_remarks:
        rows.append(("Admin Note", _nl2br(admin_remarks)))
    body_html = _detail_rows(rows) + _note("View your borrows in Centriq AI → <strong>My Library</strong>.")
    subject = f"[Bookshelf] Extension {decision} — {book_title} | {ticket_id}"
    html_body = _email_shell(f"Extension {decision}", intro, body_html,
                             preheader=f"{book_title} · {decision}")
    return _send_html(user_email, employee_email, subject, html_body)


# ── Leave Notifications ───────────────────────────────────────────────────────

def send_leave_approval_request(
    user_email: str,
    employee_name: str,
    employee_email: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    reason: str,
    approve_url: str,
    reject_url: str,
    manager_email: str,
    leave_id: int,
) -> bool:
    subject = f"[Leave Approval Required] {employee_name} — {leave_type} | {start_date} to {end_date}"
    intro = (f'<p>{_status_pill("Pending Approval", _C_AMBER)}</p>'
             f"<p>Hi,</p>"
             f"<p><strong>{html.escape(employee_name)}</strong> has applied for leave and needs your approval.</p>")
    body_html = _detail_rows([
        ("Leave ID", f"#{leave_id}"),
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Leave Type", html.escape(leave_type)),
        ("From", html.escape(start_date)),
        ("To", html.escape(end_date)),
        ("Reason", _nl2br(reason)),
    ])
    body_html += _button_row([
        ("✓ Approve Leave", approve_url, _C_OK),
        ("✗ Reject Leave", reject_url, _C_NO),
    ])
    body_html += _note("These links expire in 24 hours. Submitted via Centriq AI. "
                       "Reply to contact the employee directly.")
    html_body = _email_shell("Leave Approval Request", intro, body_html,
                             preheader=f"{employee_name} · {leave_type} · {start_date}–{end_date}")
    return _send_html(user_email, manager_email, subject, html_body)


def send_leave_decision_notification(
    user_email: str,
    employee_email: str,
    employee_name: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    decision: str,
    decided_by: str,
    reason: str = "",
) -> bool:
    color = _C_OK if decision == "Approved" else _C_NO
    subject = f"[Leave {decision}] {leave_type} | {start_date} to {end_date}"
    intro = (f'<p>{_status_pill(decision, color)}</p>'
             f"<p>Hi {html.escape(employee_name)},</p>"
             f'<p>Your leave request has been <strong style="color:{color};">{html.escape(decision)}</strong>.</p>')
    rows = [
        ("Leave Type", html.escape(leave_type)),
        ("From", html.escape(start_date)),
        ("To", html.escape(end_date)),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
        ("Actioned by", html.escape(decided_by)),
    ]
    if reason:
        rows.append(("Reason for Rejection", _nl2br(reason)))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    html_body = _email_shell(f"Leave {decision}", intro, body_html,
                             preheader=f"{leave_type} · {start_date}–{end_date}")
    return _send_html(user_email, employee_email, subject, html_body)


def send_leave_fyi_notification(
    user_email: str,
    employee_name: str,
    employee_email: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    reason: str,
    functional_manager_email: str,
) -> bool:
    """FYI notification to Functional Manager — no approve/reject links."""
    subject = f"[Leave FYI] {employee_name} — {leave_type} | {start_date} to {end_date}"
    intro = (f'<p>{_status_pill("FYI", _C_INFO)}</p>'
             f"<p>This is to inform you that <strong>{html.escape(employee_name)}</strong> has applied "
             "for leave. This is for your information only — the reporting manager will approve or "
             "reject this request.</p>")
    body_html = _detail_rows([
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Leave Type", html.escape(leave_type)),
        ("From", html.escape(start_date)),
        ("To", html.escape(end_date)),
        ("Reason", _nl2br(reason)),
    ]) + _note("This is an automated FYI notification from Centriq AI. No action is required from you.")
    html_body = _email_shell("Leave Notification (FYI)", intro, body_html,
                             preheader=f"{employee_name} · {leave_type}")
    return _send_html(user_email, functional_manager_email, subject, html_body)


# ── HR Notifications ──────────────────────────────────────────────────────────

def send_hr_query_notification(
    user_email: str,
    reference_id: str,
    employee_name: str,
    employee_email: str,
    category: str,
    subject: str,
    description: str,
) -> bool:
    """Notify the Teams channel about a new employee HR query."""
    email_subject = f"[HR Query] {reference_id} — {category} | {employee_name}"
    intro = "<p>A new HR query has been submitted and requires your attention.</p>"
    body_html = _detail_rows([
        ("Reference ID", html.escape(reference_id)),
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Category", html.escape(category)),
        ("Subject", html.escape(subject)),
        ("Description", _nl2br(description)),
    ]) + _note("Please respond through the HR Portal or reply to contact the employee directly. "
               "Submitted via Centriq AI.")
    html_body = _email_shell("New HR Query", intro, body_html,
                             preheader=f"{category} · {reference_id}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, email_subject, html_body)


def send_grievance_notification(
    user_email: str,
    reference_id: str,
    category: str,
    description: str,
    is_anonymous: bool,
    submitted_by: str,
) -> bool:
    submitter_label = "Anonymous" if is_anonymous else html.escape(submitted_by)
    subject = f"[HR Grievance] {reference_id} — {category}"
    intro = (f'<p>{_status_pill("Confidential", _C_PURPLE)}</p>'
             "<p>A new grievance has been submitted and requires your attention.</p>")
    body_html = _detail_rows([
        ("Reference ID", html.escape(reference_id)),
        ("Category", html.escape(category)),
        ("Submitted By", submitter_label),
        ("Description", _nl2br(description)),
    ]) + _note("Please review and respond through the HR Portal within 5 working days. "
               "Submitted via Centriq AI.")
    html_body = _email_shell("HR Grievance Submitted", intro, body_html,
                             preheader=f"{category} · {reference_id}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


# ── Onboarding / Offboarding ──────────────────────────────────────────────────

def send_onboarding_checklist(
    user_email: str,
    employee_name: str,
    employee_email: str,
    joining_date: str,
    department: str,
    designation: str,
) -> bool:
    subject = f"[Onboarding] New Joiner: {employee_name} — {joining_date}"
    intro = (f'<p>{_status_pill("New Joiner", _C_OK)}</p>'
             f"<p>Please complete the relevant tasks below before "
             f"<strong>{html.escape(employee_name)}</strong>'s joining date.</p>")
    checklist_it = "".join(f"<li>{x}</li>" for x in [
        "Create corporate email account", "Set up VPN access",
        "Assign laptop and peripherals", "Configure system with required software",
        "Add to relevant distribution groups / Teams channels",
        "Share IT support contact and ticketing portal link",
    ])
    checklist_admin = "".join(f"<li>{x}</li>" for x in [
        "Issue access card / ID badge", "Set up cafeteria account",
        "Register for parking (if applicable)", "Assign workstation / desk",
        "Share emergency contact and facility maps",
    ])
    checklist_hr = "".join(f"<li>{x}</li>" for x in [
        "Collect signed offer letter and joining documents",
        "Complete HRMS onboarding form", "Schedule induction and buddy assignment",
        "Share employee handbook and key policies",
        "Confirm probation period and review schedule",
        "Send welcome announcement to the team",
    ])
    body_html = (
        _detail_rows([
            ("Employee", html.escape(employee_name)),
            ("Email", html.escape(employee_email)),
            ("Department", html.escape(department)),
            ("Designation", html.escape(designation)),
            ("Joining Date", html.escape(joining_date)),
        ])
        + _section("IT Setup Tasks", _C_PRIMARY, checklist_it)
        + _section("Admin / Facilities Tasks", _C_AMBER, checklist_admin)
        + _section("HR Tasks", _C_PURPLE, checklist_hr)
        + _note("Generated by Centriq AI. Please complete all relevant tasks before the joining date.")
    )
    html_body = _email_shell("New Joiner Onboarding Checklist", intro, body_html,
                             preheader=f"{employee_name} · {joining_date}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_offboarding_checklist(
    user_email: str,
    employee_name: str,
    employee_email: str,
    last_day: str,
    department: str,
    manager_email: str,
) -> bool:
    subject = f"[Offboarding] {employee_name} — Last Day: {last_day}"
    intro = (f'<p>{_status_pill("Offboarding", _C_NO)}</p>'
             f"<p>Please complete all tasks below for <strong>{html.escape(employee_name)}</strong> "
             f"by {html.escape(last_day)}.</p>")
    checklist_manager = "".join(f"<li>{x}</li>" for x in [
        "Ensure knowledge transfer is complete", "Hand over ongoing projects and tasks",
        "Transfer ownership of key documents/repos", "Reassign pending work items",
    ])
    checklist_it = "".join(f"<li>{x}</li>" for x in [
        "Retrieve laptop, monitor, and all peripherals",
        "Deactivate corporate email and SSO accounts", "Revoke VPN and remote access",
        "Remove from all distribution groups and Teams channels",
        "Wipe and re-image returned device",
    ])
    checklist_admin = "".join(f"<li>{x}</li>" for x in [
        "Collect access card / ID badge", "Process parking sticker surrender",
        "Settle any outstanding cafeteria dues", "Confirm final expense claims submitted",
    ])
    checklist_hr = "".join(f"<li>{x}</li>" for x in [
        "Schedule exit interview", "Process full-and-final settlement",
        "Collect signed resignation / relieving letter", "Issue experience certificate",
        "Update HRMS with exit date and reason", "Announce departure to relevant teams",
    ])
    body_html = (
        _detail_rows([
            ("Employee", html.escape(employee_name)),
            ("Email", html.escape(employee_email)),
            ("Department", html.escape(department)),
            ("Last Working Day", html.escape(last_day)),
        ])
        + _section("Manager Handover Tasks", _C_NO, checklist_manager)
        + _section("IT Tasks", _C_PRIMARY, checklist_it)
        + _section("Admin / Facilities Tasks", _C_AMBER, checklist_admin)
        + _section("HR Tasks", _C_PURPLE, checklist_hr)
        + _note(f"Generated by Centriq AI. Please complete all tasks by {html.escape(last_day)}.")
    )
    html_body = _email_shell("Offboarding Checklist", intro, body_html,
                             preheader=f"{employee_name} · last day {last_day}")
    # Send to the Teams channel; manager gets a separate copy
    ok1 = _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)
    ok2 = _send_html(user_email, manager_email, f"[Manager] {subject}", html_body) if manager_email else False
    return ok1 or ok2


# ── Monitoring / PA event ─────────────────────────────────────────────────────

def send_notification_event(user_email: str, event_type: str, subject_suffix: str, data: dict) -> None:
    """Fire-and-forget: send a structured event notification to the Teams channel."""
    if not settings.NOTIFY_TO_EMAIL or not user_email:
        return

    import threading
    import base64 as _b64

    def _do_send():
        subject = f"[AURORA] {event_type} — {subject_suffix}"
        rows = [(html.escape(str(k)), html.escape(str(v))) for k, v in data.items()]
        json_str = json.dumps({"event": event_type, **data}, default=str)
        json_b64 = _b64.b64encode(json_str.encode()).decode()
        intro = f'<p>{_status_pill("Event", _C_INFO)}</p><p>{html.escape(event_type)}</p>'
        body_html = (
            _detail_rows(rows)
            + f'<div id="pa-data" style="display:none;overflow:hidden;line-height:0;max-height:0;">PAJSON:{json_b64}:ENDJSON</div>'
        )
        html_body = _email_shell(f"System Event — {html.escape(event_type)}", intro, body_html,
                                 preheader=subject_suffix)
        _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)

    threading.Thread(target=_do_send, daemon=True).start()


# ── Announcements ─────────────────────────────────────────────────────────────

def send_announcement_email(
    user_email: str,
    recipients: list,
    title: str,
    body: str,
    category: str,
    sent_by: str,
    image_url: str | None = None,
) -> bool:
    """Broadcast an announcement from the HR person's mailbox to a list of recipients."""
    if not recipients:
        return False
    subject = title
    intro = (f'<p>{_status_pill(category or "Announcement", _C_INFO)}</p>'
             f'<h2 style="margin:6px 0 14px;font:800 20px {_FONT};color:#0d1b2e;">{html.escape(title)}</h2>'
             "<p>Dear Team,</p>")
    image_block = (
        f'<img src="{html.escape(image_url)}" alt="" style="max-width:100%;border-radius:10px;margin:8px 0 16px;" />'
        if image_url else ""
    )
    body_html = (
        image_block
        + f'<div style="font:400 15px/1.75 {_FONT};color:#334155;">{_nl2br(body)}</div>'
        + f'<p style="margin-top:18px;font:400 15px {_FONT};color:#334155;">Thanks &amp; Regards,<br>'
        + "<strong>HR Team</strong></p>"
    )
    html_body = _email_shell("Company Announcement", intro, body_html,
                             preheader=title)
    return _send_html(user_email, recipients, subject, html_body)


# ── PMO: Udemy License ────────────────────────────────────────────────────────

def send_udemy_request_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    course_name: str,
    justification: str,
    approve_url: str,
    reject_url: str,
) -> bool:
    """Notify the PMO team of a Udemy license request with approve/decline links."""
    subject = f"[PMO] Udemy License Request — {employee_name}"
    intro = (f'<p>{_status_pill("Pending Approval", _C_AMBER)}</p>'
             f"<p><strong>{html.escape(employee_name)}</strong> has requested a Udemy license. "
             "Approve it if a license is available, or decline.</p>")
    body_html = _detail_rows([
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Course", html.escape(course_name) or "—"),
        ("Justification", _nl2br(justification) or "—"),
    ])
    body_html += _button_row([
        ("✓ Approve", approve_url, _C_OK),
        ("✗ Decline", reject_url, _C_NO),
    ])
    body_html += _note("These links expire in 24 hours. Decline opens a reason form. Submitted via Centriq AI.")
    html_body = _email_shell("Udemy License Request", intro, body_html,
                             preheader=f"{employee_name} · {course_name or 'Udemy license'}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_udemy_decision_email(
    user_email: str,
    employee_email: str,
    employee_name: str,
    course_name: str,
    decision: str,
    reason: str = "",
) -> bool:
    color = _C_OK if decision == "Approved" else _C_NO
    subject = f"[Udemy License {decision}] {course_name or 'Your request'}"
    intro = (f'<p>{_status_pill(decision, color)}</p>'
             f"<p>Hi {html.escape(employee_name)},</p>"
             f'<p>Your Udemy license request has been '
             f'<strong style="color:{color};">{html.escape(decision)}</strong>.</p>')
    rows = [
        ("Course", html.escape(course_name) or "—"),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
    ]
    if reason:
        label = "Reason" if decision == "Rejected" else "Note"
        rows.append((label, _nl2br(reason)))
    body_html = _detail_rows(rows) + _note(
        "Approved licenses are provided by the PMO team subject to availability. "
        "This is an automated notification from Centriq AI.")
    html_body = _email_shell(f"Udemy License {decision}", intro, body_html,
                             preheader=course_name or "Udemy license")
    return _send_html(user_email, employee_email, subject, html_body)


# ── Admin: Desk Keys ──────────────────────────────────────────────────────────

def send_desk_key_request_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    desk_number: str,
    reason: str,
    approve_url: str,
    reject_url: str,
) -> bool:
    """Notify the Admin team of a desk key request with approve/reject links."""
    subject = f"[Admin] Desk Key Request — Desk {desk_number}"
    intro = (f'<p>{_status_pill("Pending Approval", _C_AMBER)}</p>'
             f"<p><strong>{html.escape(employee_name)}</strong> has requested a key for "
             f"<strong>Desk {html.escape(desk_number)}</strong>.</p>")
    body_html = _detail_rows([
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Desk Number", html.escape(desk_number)),
        ("Reason", _nl2br(reason) or "—"),
    ])
    body_html += _button_row([
        ("✓ Approve", approve_url, _C_OK),
        ("✗ Reject", reject_url, _C_NO),
    ])
    body_html += _note("Please confirm the desk is not already assigned before approving. "
                       "These links expire in 24 hours. Submitted via Centriq AI.")
    html_body = _email_shell("Desk Key Request", intro, body_html,
                             preheader=f"{employee_name} · Desk {desk_number}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_desk_key_decision_email(
    user_email: str,
    employee_email: str,
    employee_name: str,
    desk_number: str,
    decision: str,
    reason: str = "",
) -> bool:
    color = _C_OK if decision == "Approved" else _C_NO
    subject = f"[Desk Key {decision}] Desk {desk_number}"
    intro = (f'<p>{_status_pill(decision, color)}</p>'
             f"<p>Hi {html.escape(employee_name)},</p>"
             f'<p>Your desk key request for <strong>Desk {html.escape(desk_number)}</strong> has been '
             f'<strong style="color:{color};">{html.escape(decision)}</strong>.</p>')
    rows = [
        ("Desk Number", html.escape(desk_number)),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
    ]
    if reason:
        rows.append(("Reason", _nl2br(reason)))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    html_body = _email_shell(f"Desk Key {decision}", intro, body_html,
                             preheader=f"Desk {desk_number}")
    return _send_html(user_email, employee_email, subject, html_body)


# ── Admin: Parking Payment Reminder ───────────────────────────────────────────

def send_parking_payment_reminder_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    vehicle_number: str,
    outstanding_total: float,
    months: "list[tuple[str, float]]",
    monthly_cost: float,
) -> bool:
    """Remind an employee of outstanding parking dues. `months` is a list of (month_label, amount)."""
    subject = f"[Parking] Payment Reminder — INR {outstanding_total:,.0f} outstanding"
    intro = (f'<p>{_status_pill("Payment Due", _C_AMBER)}</p>'
             f"<p>Hi {html.escape(employee_name)},</p>"
             f"<p>This is a reminder that your parking dues are pending. Please clear the outstanding "
             f"amount with the Admin team.</p>")
    rows = [
        ("Vehicle", html.escape(vehicle_number) or "—"),
        ("Monthly Charge", f"INR {monthly_cost:,.0f}"),
    ]
    for label, amount in months:
        rows.append((f"Due · {label}", f"INR {amount:,.0f}"))
    rows.append(("Total Outstanding", f'<strong style="color:{_C_NO};">INR {outstanding_total:,.0f}</strong>'))
    body_html = _detail_rows(rows) + _note(
        "Please contact the Admin team to settle these dues. This is an automated reminder from Centriq AI.")
    html_body = _email_shell("Parking Payment Reminder", intro, body_html,
                             preheader=f"INR {outstanding_total:,.0f} outstanding")
    return _send_html(user_email, employee_email, subject, html_body)


# ── Team Attendance Report (manager hierarchy) ────────────────────────────────

def _attendance_roster_table(members: "list[dict]", totals: dict) -> str:
    """Inline roster summary table for the team attendance email (top rows shown; full
    detail is in the attached .xlsx). Members are pre-sorted by the report builder."""
    head_cells = "".join(
        f'<th style="padding:9px 10px;background:{_C_PRIMARY};color:#fff;font:700 12px {_FONT};'
        f'text-align:{"left" if i < 2 else "center"};">{h}</th>'
        for i, h in enumerate(["Employee", "Dept", "Present", "Absent", "WFH", "Late", "Half"])
    )
    body_rows = ""
    for idx, m in enumerate(members):
        bg = "#ffffff" if idx % 2 == 0 else "#f5f8fc"
        cells = (
            f'<td style="padding:8px 10px;background:{bg};font:400 13px {_FONT};color:#0d1b2e;">'
            f'{html.escape(str(m.get("employee", "")))}</td>'
            f'<td style="padding:8px 10px;background:{bg};font:400 12px {_FONT};color:#475569;">'
            f'{html.escape(str(m.get("department", "")))}</td>'
        )
        for key in ("present", "absent", "wfh", "late", "half_day"):
            cells += (
                f'<td style="padding:8px 10px;background:{bg};font:400 13px {_FONT};color:#0d1b2e;'
                f'text-align:center;">{m.get(key, 0)}</td>'
            )
        body_rows += f"<tr>{cells}</tr>"

    total_cells = (
        f'<td style="padding:9px 10px;background:#e2e8f0;font:700 13px {_FONT};color:#0f172a;">TOTAL</td>'
        f'<td style="padding:9px 10px;background:#e2e8f0;"></td>'
    )
    for key in ("present", "absent", "wfh", "late", "half_day"):
        total_cells += (
            f'<td style="padding:9px 10px;background:#e2e8f0;font:700 13px {_FONT};color:#0f172a;'
            f'text-align:center;">{totals.get(key, 0)}</td>'
        )

    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;'
        f'margin:16px 0;border:1px solid #e6edf6;">'
        f'<tr>{head_cells}</tr>{body_rows}<tr>{total_cells}</tr></table>'
    )


def send_team_attendance_report(
    user_email: str,
    recipients: "str | list[str]",
    report: dict,
    xlsx: "tuple[str, str] | None" = None,
    *,
    automated: bool = False,
    max_inline_rows: int = 25,
) -> bool:
    """
    Email a manager their whole-hierarchy attendance report: an inline roster summary
    table + the full per-employee .xlsx attachment.

    - report : a successful attendance_service.team_report(...) payload.
    - xlsx   : (filename, base64) from attendance_report.build_team_xlsx; attached if given.
    - automated : True when sent by the scheduler (adds an "automated report" note).
    """
    if not report.get("success"):
        return False

    members = report["members"]
    inline = members[:max_inline_rows]
    overflow = len(members) - len(inline)

    trigger = "Your scheduled team attendance report is ready." if automated \
        else "Here is your team attendance report."
    intro = (
        f'<p>{trigger} It covers <strong>{report["headcount"]}</strong> '
        f'{"person" if report["headcount"] == 1 else "people"} in your reporting hierarchy '
        f'for <strong>{html.escape(report["period"])}</strong>.</p>'
    )

    body_html = _attendance_roster_table(inline, report["totals"])
    if overflow > 0:
        body_html += _note(f"Showing the first {len(inline)} of {len(members)} people — "
                           f"the attached spreadsheet has all {len(members)}.")
    if xlsx:
        body_html += _note("📎 Full per-employee breakdown attached as an Excel file.")
    if automated:
        body_html += _note("This is an automated report from Centriq AI. "
                           "Manage or pause it from the Manager Portal.")

    html_body = _email_shell(
        f"Team Attendance — {report['period']}",
        intro,
        body_html,
        preheader=f"{report['headcount']} people · {report['period']}",
    )
    subject = f"Team Attendance Report — {report['period']}"
    files = None
    if xlsx:
        fname, b64 = xlsx
        files = {fname: (b64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return _send_html(user_email, recipients, subject, html_body, files=files)
