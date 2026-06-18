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

# Brand assets — loaded once and base64-encoded for inline (cid:) embedding.
_ASSETS_DIR = pathlib.Path(__file__).resolve().parent.parent / "assets"
try:
    _LOGO_B64 = base64.b64encode((_ASSETS_DIR / "logo.png").read_bytes()).decode()
except Exception as _e:  # pragma: no cover
    _LOGO_B64 = ""
    logger.warning("[email] logo.png asset not found: %s", _e)
try:
    _BUDDY_B64 = base64.b64encode((_ASSETS_DIR / "buddy.png").read_bytes()).decode()
except Exception:
    _BUDDY_B64 = _LOGO_B64


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
<body style="margin:0;padding:0;background:#eef2f8;-webkit-text-size-adjust:100%;">
{pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dde4f0;box-shadow:0 4px 20px rgba(13,27,46,.08);">
    <!-- header -->
    <tr><td bgcolor="{_C_PRIMARY}" style="background:{_C_PRIMARY};background:{_GRADIENT};padding:24px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="60" valign="middle" style="padding-right:16px;">
          <img src="cid:logo" width="48" height="48" alt="Centriq" style="display:block;border:0;outline:none;border-radius:10px;background:rgba(255,255,255,.12);">
        </td>
        <td valign="middle">
          <div style="font:800 20px/1 {_FONT};color:#ffffff;letter-spacing:.3px;">Centriq AI</div>
          <div style="font:500 13px {_FONT};color:rgba(255,255,255,.80);margin-top:5px;letter-spacing:.1px;">{title}</div>
        </td>
      </tr></table>
    </td></tr>
    <!-- body -->
    <tr><td style="padding:28px 32px 14px;font:400 15px/1.65 {_FONT};color:#374151;">
      {intro_html}
      {body_html}
    </td></tr>
    <!-- footer -->
    <tr><td style="padding:14px 32px 22px;border-top:1px solid #edf2f8;background:#fafbfd;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="28" valign="middle" style="padding-right:10px;">
          <img src="cid:logo" width="20" height="20" alt="" style="display:block;border:0;opacity:0.80;border-radius:4px;">
        </td>
        <td valign="middle" style="font:500 12px {_FONT};color:#374151;">
          Centriq AI <span style="color:#9ca3af;font-weight:400;">· Aligned Automation</span>
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
        f'<td style="padding:10px 16px;background:#f1f5fb;font:700 11px {_FONT};color:#6b7280;'
        f'border-bottom:1px solid #e8eef7;width:148px;vertical-align:top;letter-spacing:.5px;text-transform:uppercase;">{label}</td>'
        f'<td style="padding:10px 16px;background:#f9fafb;font:400 14px {_FONT};color:#111827;'
        f'border-bottom:1px solid #e8eef7;vertical-align:top;">{value}</td>'
        f'</tr>'
        for label, value in rows
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;'
        f'margin:16px 0;border:1px solid #e2e8f4;">{trs}</table>'
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
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{u}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="50%" stroke="f" fillcolor="{color}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:{_FONT};font-size:14px;font-weight:bold;">{label}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="{u}" style="background:{color};color:#ffffff;display:inline-block;font:600 14px {_FONT};line-height:44px;height:44px;width:200px;text-align:center;text-decoration:none;border-radius:22px;box-shadow:0 2px 8px rgba(13,27,46,.20);">{label}</a>
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
        f'font:700 11px {_FONT};padding:4px 12px;border-radius:20px;'
        f'letter-spacing:.6px;text-transform:uppercase;">{html.escape(text)}</span>'
    )


def _section(title: str, color: str, items_html: str) -> str:
    """A titled checklist section used by onboarding / offboarding emails."""
    return (
        f'<div style="margin:20px 0 6px;font:700 14px {_FONT};color:{color};">{title}</div>'
        f'<ul style="margin:0 0 6px;padding-left:20px;font:400 14px/1.75 {_FONT};color:#334155;">{items_html}</ul>'
    )


def _note(text: str) -> str:
    """Muted footnote paragraph (expiry / 'submitted via' lines)."""
    return f'<p style="margin:14px 0 4px;font:400 12px/1.55 {_FONT};color:#9ca3af;">{text}</p>'


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
    """Send a shell-rendered email with the Centriq logo attached inline (cid:logo),
    plus optional file attachments via `files` ({filename: (base64, content_type)})."""
    return _send(
        user_email, to, subject, html_body,
        inline_images={"logo": ("logo.png", _LOGO_B64)},
        files=files,
    )


# ── Teams Chat Notifications ──────────────────────────────────────────────────

_GRAPH_ME_URL   = "https://graph.microsoft.com/v1.0/me"
_GRAPH_CHATS_URL = "https://graph.microsoft.com/v1.0/chats"


def _send_teams_message(
    sender_email: str,
    recipient_email: str,
    title: str,
    body_html: str,
) -> bool:
    """Post a 1:1 Teams chat message via Microsoft Graph API using the sender's
    own delegated token only — never another user's credentials.

    For self-send (sender == recipient), looks for an existing self-chat via
    GET /me/chats rather than creating a new oneOnOne (Graph rejects that with 400).
    Falls back gracefully — any failure is logged and returns False without raising.
    """
    token = _get_graph_token(sender_email)
    if not token:
        logger.warning("[teams] No Graph token for %s — Teams notification skipped.", sender_email)
        return False

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        r = httpx.get(_GRAPH_ME_URL, headers=headers, timeout=_TIMEOUT)
        r.raise_for_status()
        sender_id = r.json()["id"]
    except Exception as exc:
        logger.warning("[teams] Cannot resolve sender id: %s", exc)
        return False

    try:
        r = httpx.get(
            f"https://graph.microsoft.com/v1.0/users/{recipient_email}",
            headers=headers, timeout=_TIMEOUT,
        )
        r.raise_for_status()
        recipient_id = r.json()["id"]
    except Exception as exc:
        logger.warning("[teams] Cannot resolve recipient %s: %s", recipient_email, exc)
        return False

    # Graph rejects POST /chats with identical sender/recipient IDs (self-chat).
    # Instead, look for an existing self-chat in the user's chat list.
    if sender_id == recipient_id:
        chat_id = None
        try:
            r = httpx.get(
                f"{_GRAPH_CHATS_URL}?$filter=chatType eq 'oneOnOne'&$expand=members",
                headers=headers, timeout=_TIMEOUT,
            )
            r.raise_for_status()
            for chat in r.json().get("value", []):
                member_ids = {m.get("userId") for m in chat.get("members", [])}
                if member_ids == {sender_id}:
                    chat_id = chat["id"]
                    break
        except Exception as exc:
            logger.warning("[teams] Could not enumerate self-chats: %s", exc)
        if not chat_id:
            logger.warning("[teams] No self-chat found for %s — Teams self-notification skipped.", sender_email)
            return False
    else:
        members = [
            {
                "@odata.type": "#microsoft.graph.aadUserConversationMember",
                "roles": ["owner"],
                "user@odata.bind": f"https://graph.microsoft.com/v1.0/users('{sender_id}')",
            },
            {
                "@odata.type": "#microsoft.graph.aadUserConversationMember",
                "roles": ["owner"],
                "user@odata.bind": f"https://graph.microsoft.com/v1.0/users('{recipient_id}')",
            },
        ]
        try:
            r = httpx.post(
                _GRAPH_CHATS_URL,
                headers=headers,
                json={"chatType": "oneOnOne", "members": members},
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            chat_id = r.json()["id"]
        except Exception as exc:
            logger.warning("[teams] Cannot create/retrieve chat for %s -> %s: %s", sender_email, recipient_email, exc)
            return False

    content = f"<b>{html.escape(title)}</b><br>{body_html}"
    try:
        r = httpx.post(
            f"{_GRAPH_CHATS_URL}/{chat_id}/messages",
            headers=headers,
            json={"body": {"contentType": "html", "content": content}},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        logger.info("[teams] sent from=%s to=%s title=%s", sender_email, recipient_email, title)
        return True
    except httpx.HTTPStatusError as exc:
        logger.error("[teams] send failed: %s %s", exc.response.status_code, exc.response.text[:300])
        return False
    except Exception as exc:
        logger.error("[teams] send error: %s", exc)
        return False


def notify_teams(
    sender_email: str,
    recipient_email: str,
    title: str,
    body_html: str,
) -> None:
    """Fire-and-forget Teams chat notification — runs in a daemon thread."""
    import threading
    threading.Thread(
        target=_send_teams_message,
        args=(sender_email, recipient_email, title, body_html),
        daemon=True,
    ).start()


# ── Teams Activity-feed notifications ─────────────────────────────────────────

import re as _re


def _html_to_preview(title: str, body_html: str, limit: int = 150) -> str:
    """Flatten a notification title + HTML body into short plain text for the
    Activity-feed previewText (Graph truncates ~150 chars; we strip tags & collapse)."""
    text = f"{title} — {body_html}" if body_html else title
    text = text.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    text = _re.sub(r"<[^>]+>", "", text)          # drop remaining tags
    text = html.unescape(_re.sub(r"\s+", " ", text)).strip()
    return text[:limit]


def _send_activity_notification(
    sender_email: str,
    recipient_email: str,
    preview_text: str,
    topic_value: str = "Centriq AI",
    web_url: str | None = None,
) -> bool:
    """Ping a recipient's Teams Activity feed (the bell) via Graph
    sendActivityNotification, sent with the sender's own delegated token.

    No-op (returns False) unless TEAMS_ACTIVITY_NOTIFICATIONS_ENABLED is set — the API
    requires the Centriq Teams app installed for the recipient, the TeamsActivity.Send
    scope, admin consent, and the activityType declared in the app manifest. Any failure
    is logged and swallowed so it never blocks the (already-sent) email.
    """
    if not settings.TEAMS_ACTIVITY_NOTIFICATIONS_ENABLED:
        return False
    token = _get_graph_token(sender_email)
    if not token:
        logger.warning("[teams-activity] No Graph token for %s — activity ping skipped.", sender_email)
        return False

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        r = httpx.get(
            f"https://graph.microsoft.com/v1.0/users/{recipient_email}",
            headers=headers, timeout=_TIMEOUT,
        )
        r.raise_for_status()
        recipient_id = r.json()["id"]
    except Exception as exc:
        logger.warning("[teams-activity] Cannot resolve recipient %s: %s", recipient_email, exc)
        return False

    body = {
        "topic": {
            "source": "text",
            "value": topic_value,
            "webUrl": web_url or settings.APP_BASE_URL,
        },
        "activityType": settings.TEAMS_ACTIVITY_TYPE,
        "previewText": {"content": (preview_text or "")[:150]},
        "recipient": {
            "@odata.type": "microsoft.graph.aadUserNotificationRecipient",
            "userId": recipient_id,
        },
    }
    try:
        r = httpx.post(
            f"https://graph.microsoft.com/v1.0/users/{recipient_id}/teamwork/sendActivityNotification",
            headers=headers, json=body, timeout=_TIMEOUT,
        )
        r.raise_for_status()
        logger.info("[teams-activity] sent from=%s to=%s", sender_email, recipient_email)
        return True
    except httpx.HTTPStatusError as exc:
        logger.error("[teams-activity] send failed: %s %s", exc.response.status_code, exc.response.text[:300])
        return False
    except Exception as exc:
        logger.error("[teams-activity] send error: %s", exc)
        return False


def notify_teams_activity(
    sender_email: str,
    recipient_email: str,
    title: str,
    body_html: str = "",
    web_url: str | None = None,
) -> None:
    """Fire-and-forget Teams Activity-feed ping — runs in a daemon thread.

    Mirrors notify_teams' signature so emailed notices (decisions, reminders, info)
    can surface in the recipient's Teams Activity feed. The email remains the record;
    this just rings the bell. The HTML body is flattened to a short preview.
    """
    import threading
    preview = _html_to_preview(title, body_html)
    threading.Thread(
        target=_send_activity_notification,
        args=(sender_email, recipient_email, preview),
        kwargs={"web_url": web_url},
        daemon=True,
    ).start()


def _send_approval_via_teams_or_email(
    sender_email: str,
    recipient_email: str,
    teams_title: str,
    teams_body_html: str,
    subject: str,
    email_html_body: str,
    files: "dict | None" = None,
) -> bool:
    """Approval requests (approve/reject) go to Teams chat; email is sent ONLY as a
    fallback when the chat can't be delivered (e.g. the approver has no connected
    MS365/Teams token) — so approvals never silently vanish.

    Returns True if the chat was delivered, else the result of the email fallback.
    """
    if recipient_email and _send_teams_message(sender_email, recipient_email, teams_title, teams_body_html):
        return True
    logger.info("[approval] Teams chat undelivered for %s — falling back to email.", recipient_email)
    return _send_html(sender_email, recipient_email, subject, email_html_body, files=files)


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
    email_subject = f"[IT Support] {category}: {subject} — {employee_id}"
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
    subject = f"[Admin] Visitor Pass — {visitor_name} · {pass_id}"
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


def send_form_submission_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    form_name: str,
    reference_id: str,
    rows: "list[tuple[str, str]]",
    to: "str | None" = None,
) -> bool:
    """Generic notification for any Form Library submission. `rows` are the [(label, value)]
    pairs of the filled fields. `to` overrides the recipient (per-form notify_email); falls
    back to NOTIFY_TO_EMAIL."""
    subject = f"[Form] {form_name} — {reference_id}"
    intro = (f"<p><strong>{html.escape(employee_name)}</strong> submitted the "
             f"<strong>{html.escape(form_name)}</strong> form.</p>")
    detail = [("Reference", html.escape(reference_id)),
              ("Submitted by", f"{html.escape(employee_name)} ({html.escape(employee_email)})")]
    detail += [(html.escape(str(lbl)), _nl2br(str(val)) if val else "—") for lbl, val in rows]
    body_html = _detail_rows(detail) + _note("Submitted via Centriq AI. Review it in the Form Library.")
    html_body = _email_shell(f"{form_name} Submission", intro, body_html,
                             preheader=f"{form_name} · {reference_id}")
    return _send_html(user_email, to or settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_food_complaint_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    vendor_name: str,
    complaint_type: str,
    description: str,
    ticket_id: str,
) -> bool:
    subject = f"[Admin] Food Complaint — {vendor_name} · {ticket_id}"
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
    subject = f"[Admin] Facility Complaint — {category} ({priority}) · {ticket_id}"
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
    subject = f"[Facility Complaint] Status: {new_status} — {ticket_id}"
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
    subject = f"[Food Complaint] Status: {new_status} — {ticket_id}"
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
    subject = f"[Admin] Reimbursement Request — {reimbursement_type} · #{reimbursement_id}"
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
    result = _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)
    if settings.NOTIFY_TO_EMAIL:
        teams_body = (
            f"<b>Employee:</b> {html.escape(employee_name)} ({html.escape(employee_email)})<br>"
            f"<b>Type:</b> {html.escape(reimbursement_type)}<br>"
            f"<b>Amount:</b> INR {amount:,.2f}<br>"
            f"<b>Request:</b> #{reimbursement_id}<br>"
            f"<b>Reason:</b> {html.escape(reason)}"
        )
        notify_teams_activity(user_email, settings.NOTIFY_TO_EMAIL,
                     "💰 Reimbursement Request — Pending Approval", teams_body)
    return result


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
    subject = f"[Bookshelf] Book Request — {book_title} · {ticket_id}"
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
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)} ({html.escape(employee_email)})<br>"
        f"<b>Book:</b> {html.escape(book_title)} — {html.escape(book_author)}<br>"
        f"<b>Ticket:</b> {html.escape(ticket_id)}"
        + (f"<br><br><a href='{html.escape(approve_url)}'>✓ Approve</a> &nbsp; <a href='{html.escape(reject_url)}'>✗ Reject</a>" if approve_url and reject_url else "")
    )
    return _send_approval_via_teams_or_email(
        user_email, to, "📚 Bookshelf Request — Pending Approval", teams_body, subject, html_body)


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
    subject = f"[Bookshelf] Book Request {decision} — {book_title} · {ticket_id}"
    html_body = _email_shell(title, intro, body_html, preheader=f"{book_title} · {decision}")
    result = _send_html(user_email, employee_email, subject, html_body)
    teams_body = (
        f"<b>Book:</b> {html.escape(book_title)}<br>"
        f"<b>Ticket:</b> {html.escape(ticket_id)}<br>"
        f"<b>Decision:</b> {html.escape(decision)}"
        + (f"<br><b>Return By:</b> {html.escape(due_date)}" if decision == "Approved" and due_date else "")
        + (f"<br><b>Note:</b> {html.escape(admin_remarks)}" if admin_remarks else "")
    )
    notify_teams_activity(user_email, employee_email, f"📚 Book Request {decision}", teams_body)
    return result


def send_book_return_confirmation(
    user_email: str,
    employee_email: str,
    employee_name: str,
    book_title: str,
    ticket_id: str,
) -> bool:
    subject = f"[Bookshelf] Book Returned — {book_title} · {ticket_id}"
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
    subject = f"[Bookshelf] Extension Request — {book_title} · {ticket_id}"
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
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)}<br>"
        f"<b>Book:</b> {html.escape(book_title)} ({html.escape(ticket_id)})<br>"
        f"<b>Current Due:</b> {html.escape(current_due_date)} · <b>Extra Days:</b> {additional_days}"
        + (f"<br><br><a href='{html.escape(approve_url)}'>✓ Approve</a> &nbsp; <a href='{html.escape(reject_url)}'>✗ Reject</a>" if approve_url and reject_url else "")
    )
    return _send_approval_via_teams_or_email(
        user_email, to, "📚 Bookshelf Extension — Pending Approval", teams_body, subject, html_body)


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
    subject = f"[Bookshelf] Extension {decision} — {book_title} · {ticket_id}"
    html_body = _email_shell(f"Extension {decision}", intro, body_html,
                             preheader=f"{book_title} · {decision}")
    result = _send_html(user_email, employee_email, subject, html_body)
    teams_body = (
        f"<b>Book:</b> {html.escape(book_title)} ({html.escape(ticket_id)})<br>"
        f"<b>Decision:</b> {html.escape(decision)}"
        + (f"<br><b>New Due Date:</b> {html.escape(new_due_date)}" if decision == "Approved" and new_due_date else "")
        + (f"<br><b>Note:</b> {html.escape(admin_remarks)}" if admin_remarks else "")
    )
    notify_teams_activity(user_email, employee_email, f"📚 Extension {decision}", teams_body)
    return result


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
    subject = f"[Leave Approval] {employee_name} — {leave_type} · {start_date} to {end_date}"
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
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)}<br>"
        f"<b>Leave Type:</b> {html.escape(leave_type)}<br>"
        f"<b>Period:</b> {html.escape(start_date)} → {html.escape(end_date)}<br>"
        f"<b>Reason:</b> {html.escape(reason)}<br><br>"
        f"<a href='{html.escape(approve_url)}'>✓ Approve Leave</a> &nbsp; <a href='{html.escape(reject_url)}'>✗ Reject Leave</a>"
    )
    return _send_approval_via_teams_or_email(
        user_email, manager_email, "🏖️ Leave Approval Request", teams_body, subject, html_body)


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
    subject = f"[Leave {decision}] {leave_type} — {start_date} to {end_date}"
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
    result = _send_html(user_email, employee_email, subject, html_body)
    teams_body = (
        f"<b>Leave Type:</b> {html.escape(leave_type)}<br>"
        f"<b>Period:</b> {html.escape(start_date)} → {html.escape(end_date)}<br>"
        f"<b>Decision:</b> {html.escape(decision)}<br>"
        f"<b>Actioned by:</b> {html.escape(decided_by)}"
        + (f"<br><b>Reason:</b> {html.escape(reason)}" if reason else "")
    )
    notify_teams_activity(user_email, employee_email, f"🏖️ Leave {decision}", teams_body)
    return result


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
    subject = f"[Leave Notice] {employee_name} — {leave_type} · {start_date} to {end_date}"
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
    result = _send_html(user_email, functional_manager_email, subject, html_body)
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)}<br>"
        f"<b>Leave Type:</b> {html.escape(leave_type)}<br>"
        f"<b>Period:</b> {html.escape(start_date)} → {html.escape(end_date)}<br>"
        f"<i>For your information — the reporting manager will approve or reject this.</i>"
    )
    notify_teams_activity(user_email, functional_manager_email, "🏖️ Leave Notice (FYI)", teams_body)
    return result


def send_leave_cancellation_notification(
    user_email: str,
    employee_name: str,
    employee_email: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    was_approved: bool,
    manager_email: str,
) -> bool:
    """Notify the reporting manager that the employee cancelled their leave."""
    status_label = "Approved Leave Cancelled" if was_approved else "Pending Leave Withdrawn"
    color = _C_AMBER
    subject = f"[Leave Cancelled] {employee_name} — {leave_type} · {start_date} to {end_date}"
    intro = (
        f'<p>{_status_pill("Cancelled", color)}</p>'
        f"<p>Hi,</p>"
        f"<p><strong>{html.escape(employee_name)}</strong> has cancelled their leave request.</p>"
    )
    rows = [
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Leave Type", html.escape(leave_type)),
        ("From", html.escape(start_date)),
        ("To", html.escape(end_date)),
        ("Status", html.escape(status_label)),
    ]
    if was_approved:
        rows.append(("Balance", "Leave balance has been restored."))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    html_body = _email_shell("Leave Cancelled", intro, body_html,
                             preheader=f"{leave_type} · {start_date}–{end_date} cancelled")
    result = _send_html(user_email, manager_email, subject, html_body)
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)}<br>"
        f"<b>Leave Type:</b> {html.escape(leave_type)}<br>"
        f"<b>Period:</b> {html.escape(start_date)} → {html.escape(end_date)}<br>"
        f"<b>Status:</b> {html.escape(status_label)}"
        + ("<br><i>Leave balance restored.</i>" if was_approved else "")
    )
    notify_teams_activity(user_email, manager_email, "🚫 Leave Cancelled", teams_body)
    return result


def send_document_decision_email(
    user_email: str,
    employee_email: str,
    employee_name: str,
    document_label: str,
    decided_by: str,
    decision: str,
    reason: str = "",
) -> bool:
    """Notify the requester/subject that their document request was Approved or Rejected."""
    approved = decision == "Approved"
    color = _C_OK if approved else _C_NO
    title = f"Document {decision}"
    intro = (
        f'<p>{_status_pill(decision, color)}</p>'
        + (f"<p>Hi {html.escape(employee_name) or 'there'}, your document request has been "
           f'<strong style="color:{color};">approved and released</strong>. '
           f"You can now download it from Centriq AI → <strong>My Requests</strong>.</p>"
           if approved else
           f"<p>Hi {html.escape(employee_name) or 'there'}, your document request was "
           f'<strong style="color:{color};">not approved</strong>.</p>')
    )
    rows = [
        ("Document", html.escape(document_label)),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
        ("Actioned by", html.escape(decided_by)),
    ]
    if reason:
        rows.append(("Reason", _nl2br(reason)))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    subject = f"[Document {decision}] {document_label}"
    html_body = _email_shell(title, intro, body_html, preheader=f"{document_label} · {decision}")
    result = _send_html(user_email, employee_email, subject, html_body)
    teams_body = (
        f"<b>Document:</b> {html.escape(document_label)}<br>"
        f"<b>Decision:</b> {html.escape(decision)}<br>"
        f"<b>Actioned by:</b> {html.escape(decided_by)}"
        + (f"<br><b>Reason:</b> {html.escape(reason)}" if reason else "")
    )
    notify_teams_activity(user_email, employee_email, f"📄 Document {decision}", teams_body)
    return result


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
    email_subject = f"[HR Query] {category} — {employee_name} · {reference_id}"
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
    subject = f"[HR Grievance] {category} — {reference_id}"
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
    subject = f"[Onboarding] New Joiner — {employee_name} · {joining_date}"
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


def send_joining_kit_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
) -> bool:
    """Notify the admin that a new employee has joined and a joining kit needs to be prepared."""
    import datetime
    subject = f"[Admin] Joining Kit — New Employee Joined: {employee_name}"
    intro = (f'<p>{_status_pill("Joining Kit", _C_OK)}</p>'
             f"<p>A new employee has been welcomed to the organization. "
             f"Please prepare and dispatch the joining kit for <strong>{html.escape(employee_name)}</strong>.</p>")
    body_html = (
        _detail_rows([
            ("Employee Name", html.escape(employee_name)),
            ("Employee Email", html.escape(employee_email)),
            ("Date Joined", datetime.date.today().strftime("%d %B %Y")),
        ])
        + _note("This is an automated notification to coordinate onboarding logistics. Submitted via Centriq AI.")
    )
    html_body = _email_shell("Joining Kit Dispatch Request", intro, body_html,
                             preheader=f"Joining Kit for {employee_name}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_offboarding_checklist(
    user_email: str,
    employee_name: str,
    employee_email: str,
    last_day: str,
    department: str,
    manager_email: str,
) -> bool:
    subject = f"[Offboarding] {employee_name} — Last Day {last_day}"
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
        subject = f"[Centriq] {event_type} — {subject_suffix}"
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


def send_announcement_recall_email(
    user_email: str,
    recipients: list,
    title: str,
    category: str,
    recalled_by: str,
) -> bool:
    """Send a recall notice for a previously sent announcement."""
    if not recipients:
        return False
    subject = f"Recall: {title}"
    intro = (
        f'<p>{_status_pill("Announcement Recalled", _C_NO)}</p>'
        f'<h2 style="margin:6px 0 14px;font:800 20px {_FONT};color:#0d1b2e;">Recall Notice</h2>'
        "<p>Dear Team,</p>"
    )
    body_html = (
        f'<div style="font:400 15px/1.75 {_FONT};color:#334155;">'
        f'Please disregard the announcement titled <strong>{html.escape(title)}</strong> '
        f'({html.escape(category or "General")}) sent earlier. It has been recalled and is no longer active.'
        f'</div>'
        f'<p style="margin-top:18px;font:400 15px {_FONT};color:#334155;">Apologies for any confusion.<br>'
        f'<strong>HR Team</strong></p>'
    )
    html_body = _email_shell("Announcement Recall", intro, body_html, preheader=subject)
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
    platform: str = "Udemy",
) -> bool:
    """Notify the PMO team of a training-license request with approve/decline links."""
    subject = f"[PMO] {platform} License Request — {employee_name}"
    intro = (f'<p>{_status_pill("Pending Approval", _C_AMBER)}</p>'
             f"<p><strong>{html.escape(employee_name)}</strong> has requested a {html.escape(platform)} license. "
             "Approve it if a license is available, or decline.</p>")
    body_html = _detail_rows([
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Platform", html.escape(platform)),
        ("Course", html.escape(course_name) or "—"),
        ("Justification", _nl2br(justification) or "—"),
    ])
    body_html += _button_row([
        ("✓ Approve", approve_url, _C_OK),
        ("✗ Decline", reject_url, _C_NO),
    ])
    body_html += _note("These links expire in 24 hours. Decline opens a reason form. Submitted via Centriq AI.")
    html_body = _email_shell(f"{platform} License Request", intro, body_html,
                             preheader=f"{employee_name} · {course_name or f'{platform} license'}")
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)}<br>"
        f"<b>Platform:</b> {html.escape(platform)}<br>"
        f"<b>Course:</b> {html.escape(course_name) or '—'}<br>"
        f"<b>Justification:</b> {html.escape(justification) or '—'}<br><br>"
        f"<a href='{html.escape(approve_url)}'>✓ Approve</a> &nbsp; <a href='{html.escape(reject_url)}'>✗ Decline</a>"
    )
    return _send_approval_via_teams_or_email(
        user_email, settings.NOTIFY_TO_EMAIL, f"🎓 {platform} License Request — Pending",
        teams_body, subject, html_body)


def send_udemy_decision_email(
    user_email: str,
    employee_email: str,
    employee_name: str,
    course_name: str,
    decision: str,
    reason: str = "",
    platform: str = "Udemy",
) -> bool:
    color = _C_OK if decision == "Approved" else _C_NO
    subject = f"[{platform} License {decision}] {course_name or 'Your request'}"
    intro = (f'<p>{_status_pill(decision, color)}</p>'
             f"<p>Hi {html.escape(employee_name)},</p>"
             f'<p>Your {html.escape(platform)} license request has been '
             f'<strong style="color:{color};">{html.escape(decision)}</strong>.</p>')
    rows = [
        ("Platform", html.escape(platform)),
        ("Course", html.escape(course_name) or "—"),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
    ]
    if reason:
        label = "Reason" if decision == "Rejected" else "Note"
        rows.append((label, _nl2br(reason)))
    body_html = _detail_rows(rows) + _note(
        "Approved licenses are provided by the PMO team subject to availability. "
        "This is an automated notification from Centriq AI.")
    html_body = _email_shell(f"{platform} License {decision}", intro, body_html,
                             preheader=course_name or f"{platform} license")
    result = _send_html(user_email, employee_email, subject, html_body)
    teams_body = (
        f"<b>Platform:</b> {html.escape(platform)}<br>"
        f"<b>Course:</b> {html.escape(course_name) or '—'}<br>"
        f"<b>Decision:</b> {html.escape(decision)}"
        + (f"<br><b>{'Reason' if decision == 'Rejected' else 'Note'}:</b> {html.escape(reason)}" if reason else "")
    )
    notify_teams_activity(user_email, employee_email, f"🎓 {platform} License {decision}", teams_body)
    return result


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
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)}<br>"
        f"<b>Desk:</b> {html.escape(desk_number)}<br>"
        f"<b>Reason:</b> {html.escape(reason) or '—'}<br><br>"
        f"<a href='{html.escape(approve_url)}'>✓ Approve</a> &nbsp; <a href='{html.escape(reject_url)}'>✗ Reject</a>"
    )
    return _send_approval_via_teams_or_email(
        user_email, settings.NOTIFY_TO_EMAIL, "🔑 Desk Key Request — Pending Approval",
        teams_body, subject, html_body)


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
    result = _send_html(user_email, employee_email, subject, html_body)
    teams_body = (
        f"<b>Desk:</b> {html.escape(desk_number)}<br>"
        f"<b>Decision:</b> {html.escape(decision)}"
        + (f"<br><b>Reason:</b> {html.escape(reason)}" if reason else "")
    )
    notify_teams_activity(user_email, employee_email, f"🔑 Desk Key {decision}", teams_body)
    return result


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
    subject = f"[Parking] Payment Reminder — INR {outstanding_total:,.0f} Due"
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
    subject = f"[Attendance] Team Report — {report['period']}"
    files = None
    if xlsx:
        fname, b64 = xlsx
        files = {fname: (b64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    result = _send_html(user_email, recipients, subject, html_body, files=files)
    # Teams can't carry the .xlsx — send a text summary + pointer to the emailed report.
    t = report["totals"]
    teams_body = (
        f"<b>Period:</b> {html.escape(report['period'])}<br>"
        f"<b>Headcount:</b> {report['headcount']}<br>"
        f"<b>Present:</b> {t.get('present', 0)} · <b>Absent:</b> {t.get('absent', 0)} · "
        f"<b>WFH:</b> {t.get('wfh', 0)} · <b>Late:</b> {t.get('late', 0)} · "
        f"<b>Half-day:</b> {t.get('half_day', 0)}<br>"
        "📎 Full per-employee breakdown is in the emailed Excel report."
    )
    title = "📊 Team Attendance Report"
    for rcpt in ([recipients] if isinstance(recipients, str) else recipients):
        if rcpt:
            notify_teams_activity(user_email, rcpt, title, teams_body)
    return result


# ── Travel Management Emails ───────────────────────────────────────────────────

def send_travel_rm_approval_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ref_id: str,
    from_location: str,
    to_destination: str,
    travel_date: str,
    return_date: str,
    business_reason: str,
    estimated_cost: float,
    is_international: bool,
    mode: str,
    accommodation_required: bool,
    notes: str,
    approve_url: str,
    reject_url: str,
    manager_email: str,
    travel_id: int,
) -> bool:
    subject = f"[Travel Approval] {employee_name} — {from_location} → {to_destination} · {travel_date}"
    intro = (
        f'<p>{_status_pill("Pending Your Approval", _C_AMBER)}</p>'
        f"<p>Hi,</p>"
        f"<p><strong>{html.escape(employee_name)}</strong> has submitted a business travel request "
        f"and needs your approval.</p>"
    )
    rows = [
        ("Reference", html.escape(ref_id)),
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("From", html.escape(from_location)),
        ("To", html.escape(to_destination)),
        ("Travel Date", html.escape(travel_date)),
        ("Return Date", html.escape(return_date) if return_date else "—"),
        ("Mode", html.escape(mode)),
        ("International", "Yes — Visa may be required" if is_international else "No"),
        ("Accommodation", "Required" if accommodation_required else "Not required"),
        ("Estimated Cost", f"INR {estimated_cost:,.0f}" if estimated_cost else "—"),
        ("Business Reason", _nl2br(business_reason)),
    ]
    if notes:
        rows.append(("Notes", _nl2br(notes)))
    body_html = _detail_rows(rows)
    body_html += _button_row([
        ("✓ Approve Travel", approve_url, _C_OK),
        ("✗ Reject Travel", reject_url, _C_NO),
    ])
    body_html += _note("These links expire in 48 hours. Submitted via Centriq AI. "
                       "Reply to contact the employee directly.")
    html_body = _email_shell("Travel Approval Request", intro, body_html,
                             preheader=f"{employee_name} · {from_location}→{to_destination}")
    teams_body = (
        f"<b>Employee:</b> {html.escape(employee_name)}<br>"
        f"<b>Route:</b> {html.escape(from_location)} → {html.escape(to_destination)}<br>"
        f"<b>Date:</b> {html.escape(travel_date)}<br>"
        f"<b>Reason:</b> {html.escape(business_reason)}<br><br>"
        f"<a href='{html.escape(approve_url)}'>✓ Approve</a> &nbsp; "
        f"<a href='{html.escape(reject_url)}'>✗ Reject</a>"
    )
    return _send_approval_via_teams_or_email(
        user_email, manager_email, "✈️ Travel Approval Request", teams_body, subject, html_body)


def send_travel_decision_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ref_id: str,
    from_loc: str,
    to_loc: str,
    travel_date: str,
    stage: str,
    decision: str,
    reason: str = "",
) -> bool:
    color = _C_OK if decision == "Approved" else _C_NO
    subject = f"[Travel {decision}] {ref_id} — {from_loc} → {to_loc}"
    intro = (
        f'<p>{_status_pill(f"{stage} {decision}", color)}</p>'
        f"<p>Hi {html.escape(employee_name)},</p>"
        f'<p>Your travel request has been <strong style="color:{color};">{html.escape(decision)}</strong> '
        f"by your {html.escape(stage)}.</p>"
    )
    rows = [
        ("Reference", html.escape(ref_id)),
        ("Route", f"{html.escape(from_loc)} → {html.escape(to_loc)}"),
        ("Travel Date", html.escape(travel_date)),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
        ("Actioned by", html.escape(stage)),
    ]
    if reason:
        rows.append(("Reason", _nl2br(reason)))
    if decision == "Approved" and stage == "RM":
        rows.append(("Next Step", "Admin will now review and arrange tickets / accommodation."))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    html_body = _email_shell(f"Travel Request {decision}", intro, body_html,
                             preheader=f"{ref_id} · {decision}")
    return _send_html(user_email, employee_email, subject, html_body)


def send_travel_admin_pending_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ref_id: str,
    from_location: str,
    to_destination: str,
    travel_date: str,
    return_date: str,
    business_reason: str,
    estimated_cost: float,
    is_international: bool,
    mode: str,
    accommodation_required: bool,
    notes: str,
    travel_id: int,
) -> bool:
    """Notify admin that RM has approved the travel request — action needed."""
    subject = f"[Travel] RM Approved — Action Required: {ref_id} · {employee_name}"
    intro = (
        f'<p>{_status_pill("RM Approved — Your Action Required", _C_INFO)}</p>'
        f"<p><strong>{html.escape(employee_name)}</strong>'s travel request has been approved by "
        f"the reporting manager. Please review and arrange tickets"
        + (" / visa" if is_international else "")
        + (" / accommodation" if accommodation_required else "")
        + ".</p>"
    )
    rows = [
        ("Reference", html.escape(ref_id)),
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("From", html.escape(from_location)),
        ("To", html.escape(to_destination)),
        ("Travel Date", html.escape(travel_date)),
        ("Return Date", html.escape(return_date) if return_date else "—"),
        ("Mode", html.escape(mode)),
        ("International", "Yes — Visa required" if is_international else "No"),
        ("Accommodation", "Required" if accommodation_required else "Not required"),
        ("Estimated Cost", f"INR {estimated_cost:,.0f}" if estimated_cost else "—"),
        ("Business Reason", _nl2br(business_reason)),
    ]
    if notes:
        rows.append(("Notes", _nl2br(notes)))
    rows.append(("Action", "Log in to the Admin Portal → Travel Requests to approve and add trip details."))
    body_html = _detail_rows(rows) + _note("Submitted via Centriq AI. Log in to the Admin Portal to take action.")
    html_body = _email_shell("Travel Request — Action Required", intro, body_html,
                             preheader=f"{employee_name} · {from_location}→{to_destination}")
    result = _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)
    notify_teams_activity(user_email, settings.NOTIFY_TO_EMAIL, "✈️ Travel: Admin Action Needed",
                 f"<b>{html.escape(employee_name)}</b> travel request {html.escape(ref_id)} needs admin action (RM approved).")
    return result


def send_travel_admin_approved_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ref_id: str,
    from_location: str,
    to_destination: str,
    travel_date: str,
    return_date: str,
    ticket_details: str,
    hotel_details: str,
    visa_status: str,
    expense_limit: "float | None",
    decided_by: str,
) -> bool:
    """Email employee with trip details after admin approval."""
    subject = f"[Travel Approved] {ref_id} — {from_location} → {to_destination} · {travel_date}"
    intro = (
        f'<p>{_status_pill("Approved", _C_OK)}</p>'
        f"<p>Hi {html.escape(employee_name)},</p>"
        f"<p>Your travel request has been <strong style='color:{_C_OK};'>approved</strong> by Admin. "
        f"Your trip details are below.</p>"
    )
    rows = [
        ("Reference", html.escape(ref_id)),
        ("Route", f"{html.escape(from_location)} → {html.escape(to_destination)}"),
        ("Travel Date", html.escape(travel_date)),
        ("Return Date", html.escape(return_date) if return_date else "—"),
        ("Approved by", html.escape(decided_by)),
    ]
    if ticket_details:
        rows.append(("Ticket Details", _nl2br(ticket_details)))
    if hotel_details:
        rows.append(("Hotel / Accommodation", _nl2br(hotel_details)))
    if visa_status:
        rows.append(("Visa Status", _nl2br(visa_status)))
    if expense_limit:
        rows.append(("Expense Limit", f"INR {expense_limit:,.0f} — file your claim after the trip"))
    body_html = _detail_rows(rows)
    body_html += _note(
        "Please keep all receipts for your expense claim. "
        "Submit your post-trip expense via Centriq AI after returning."
    )
    html_body = _email_shell("Travel Approved — Trip Details", intro, body_html,
                             preheader=f"{ref_id} · Approved · {from_location}→{to_destination}")
    return _send_html(user_email, employee_email, subject, html_body)


def send_travel_expense_submitted_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    expense_ref: str,
    travel_ref: str,
    from_location: str,
    to_destination: str,
    amount: float,
    breakdown: str,
    over_limit_reason: str,
    limit: "float | None",
    claim_id: int,
) -> bool:
    over_limit = limit and amount > limit
    subject = f"[Travel Expense] {expense_ref} — {employee_name} · INR {amount:,.0f}"
    intro = (
        f'<p>{_status_pill("Over Limit" if over_limit else "Expense Claim", _C_AMBER if over_limit else _C_INFO)}</p>'
        f"<p><strong>{html.escape(employee_name)}</strong> has submitted a post-trip expense claim.</p>"
    )
    rows = [
        ("Expense Ref", html.escape(expense_ref)),
        ("Travel Ref", html.escape(travel_ref)),
        ("Employee", f"{html.escape(employee_name)} ({html.escape(employee_email)})"),
        ("Route", f"{html.escape(from_location)} → {html.escape(to_destination)}"),
        ("Claimed Amount", f"<strong>INR {amount:,.0f}</strong>"),
    ]
    if limit:
        rows.append(("Approved Limit", f"INR {limit:,.0f}"))
    if over_limit:
        rows.append(("Excess", f'<strong style="color:{_C_NO};">INR {amount - limit:,.0f} over limit</strong>'))
    if breakdown:
        rows.append(("Breakdown", _nl2br(breakdown)))
    if over_limit_reason:
        rows.append(("Reason for Excess", _nl2br(over_limit_reason)))
    body_html = _detail_rows(rows) + _note("Review in the Admin Portal → Travel → Expense Claims.")
    html_body = _email_shell("Travel Expense Claim", intro, body_html,
                             preheader=f"{employee_name} · INR {amount:,.0f}")
    return _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)


def send_travel_expense_decision_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    expense_ref: str,
    travel_ref: str,
    amount: float,
    decision: str,
    decided_by: str,
    reason: str = "",
) -> bool:
    color = _C_OK if decision == "Approved" else _C_NO
    subject = f"[Travel Expense {decision}] {expense_ref} — INR {amount:,.0f}"
    intro = (
        f'<p>{_status_pill(decision, color)}</p>'
        f"<p>Hi {html.escape(employee_name)},</p>"
        f'<p>Your travel expense claim has been <strong style="color:{color};">{html.escape(decision)}</strong>.</p>'
    )
    rows = [
        ("Expense Ref", html.escape(expense_ref)),
        ("Travel Ref", html.escape(travel_ref)),
        ("Claimed Amount", f"INR {amount:,.0f}"),
        ("Decision", f'<strong style="color:{color};">{html.escape(decision)}</strong>'),
        ("Actioned by", html.escape(decided_by)),
    ]
    if reason:
        rows.append(("Reason", _nl2br(reason)))
    body_html = _detail_rows(rows) + _note("This is an automated notification from Centriq AI.")
    html_body = _email_shell(f"Travel Expense {decision}", intro, body_html,
                             preheader=f"{expense_ref} · {decision}")
    return _send_html(user_email, employee_email, subject, html_body)


# ── Manager → PMO: Client Onboarding Request ───────────────────────────────────

def send_onboarding_request_email(
    user_email: str,
    manager_name: str,
    employee_name: str,
    employee_email: str,
    steps: dict,
    client_name: str,
    notes: str,
    ref_id: str,
) -> bool:
    subject = f"[Onboarding Request] {employee_name} — {ref_id}"
    step_labels = {
        "drug_test": "Drug Test",
        "background_check": "Background Verification",
        "client_onboarding": "Client-Side Onboarding",
    }
    selected = [step_labels[k] for k, v in steps.items() if v and k in step_labels]
    intro = (
        f'<p>{_status_pill("Onboarding Request", _C_INFO)}</p>'
        f"<p>A new client onboarding has been initiated by <strong>{html.escape(manager_name)}</strong>.</p>"
    )
    rows = [
        ("Reference", html.escape(ref_id)),
        ("Employee", html.escape(employee_name)),
        ("Employee Email", html.escape(employee_email or "—")),
        ("Steps Required", ", ".join(selected) or "None selected"),
    ]
    if client_name:
        rows.append(("Client", html.escape(client_name)))
    if notes:
        rows.append(("Notes", _nl2br(notes)))
    rows.append(("Initiated By", html.escape(manager_name)))
    body_html = _detail_rows(rows) + _note("Please coordinate with the employee and client to complete the onboarding steps.")
    html_body = _email_shell("Client Onboarding Request", intro, body_html, preheader=f"{ref_id} · {employee_name}")
    result = _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)
    if settings.NOTIFY_TO_EMAIL:
        teams_body = (
            f"<b>Reference:</b> {html.escape(ref_id)}<br>"
            f"<b>Employee:</b> {html.escape(employee_name)} ({html.escape(employee_email or '—')})<br>"
            f"<b>Steps:</b> {', '.join(selected) or 'None selected'}<br>"
            f"<b>Initiated By:</b> {html.escape(manager_name)}"
            + (f"<br><b>Client:</b> {html.escape(client_name)}" if client_name else "")
        )
        notify_teams_activity(user_email, settings.NOTIFY_TO_EMAIL,
                     "🧭 Client Onboarding Request — Action Needed", teams_body)
    return result


# ── Manager → PMO: VDI / Revoke Request ────────────────────────────────────────

def send_pmo_team_request_email(
    user_email: str,
    manager_name: str,
    employee_name: str,
    employee_email: str,
    request_type: str,
    details: str,
    ref_id: str,
) -> bool:
    type_labels = {"vdi_provision": "VDI Provision", "vdi_revoke": "VDI Revoke / Access Revocation"}
    type_label = type_labels.get(request_type, request_type.replace("_", " ").title())
    subject = f"[PMO Request] {type_label} — {employee_name} — {ref_id}"
    intro = (
        f'<p>{_status_pill(type_label, _C_AMBER)}</p>'
        f"<p>A new PMO request has been submitted by <strong>{html.escape(manager_name)}</strong>.</p>"
    )
    rows = [
        ("Reference", html.escape(ref_id)),
        ("Request Type", html.escape(type_label)),
        ("Employee", html.escape(employee_name)),
        ("Employee Email", html.escape(employee_email or "—")),
        ("Requested By", html.escape(manager_name)),
    ]
    if details:
        rows.append(("Details", _nl2br(details)))
    body_html = _detail_rows(rows) + _note("Please action this request and update the status in the PMO portal.")
    html_body = _email_shell(f"PMO Request: {type_label}", intro, body_html, preheader=f"{ref_id} · {employee_name}")
    result = _send_html(user_email, settings.NOTIFY_TO_EMAIL, subject, html_body)
    if settings.NOTIFY_TO_EMAIL:
        teams_body = (
            f"<b>Reference:</b> {html.escape(ref_id)}<br>"
            f"<b>Request Type:</b> {html.escape(type_label)}<br>"
            f"<b>Employee:</b> {html.escape(employee_name)} ({html.escape(employee_email or '—')})<br>"
            f"<b>Requested By:</b> {html.escape(manager_name)}"
            + (f"<br><b>Details:</b> {html.escape(details)}" if details else "")
        )
        notify_teams_activity(user_email, settings.NOTIFY_TO_EMAIL,
                     f"🖥️ PMO Request: {html.escape(type_label)} — Action Needed", teams_body)
    return result
