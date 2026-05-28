"""
Email dispatcher for Centriq AI — sends via Microsoft Graph API.

All outbound emails are sent FROM the logged-in user's connected Microsoft 365
mailbox using their delegated OAuth token. The destination is always read from
the NOTIFY_TO_EMAIL environment variable (no hardcoded addresses).

Used by:
  - IT Agent     → IT ticket notifications
  - Admin Agent  → parking / food complaint / reimbursement notifications
  - HR Agent     → leave approval, queries, grievances, onboarding/offboarding
"""

import json
import logging
import html
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("aurora-logger")

_GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail"
_TIMEOUT = 15.0


def _nl2br(text: str) -> str:
    """Escape HTML and convert newlines to <br> for email clients that ignore CSS."""
    return html.escape(text).replace("\n", "<br>")


def _get_graph_token(user_email: str) -> str | None:
    """Return a valid Microsoft Graph token for user_email, or None if not connected."""
    try:
        from app.services.oauth_service import get_valid_token
        return get_valid_token(user_email, "microsoft")
    except Exception as e:
        logger.warning("[email] Cannot get Graph token for %s: %s", user_email, e)
        return None


def _send(
    user_email: str,
    to: "str | list[str]",
    subject: str,
    html_body: str,
) -> bool:
    """
    Send an email via Microsoft Graph API using the logged-in user's delegated token.

    - FROM  : user_email's Microsoft 365 mailbox (via their connected account token)
    - TO    : `to` — must be a value from settings.NOTIFY_TO_EMAIL or a specific person's
              email from the database (manager, employee). Never hardcoded in callers.
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
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html_body},
            "toRecipients": [{"emailAddress": {"address": addr}} for addr in to_list],
        },
        "saveToSentItems": True,
    }

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


# ── Software Install ──────────────────────────────────────────────────────────

def send_software_install_email(
    user_email: str,
    software_name: str,
    subject: str,
    body: str,
) -> bool:
    """Send a confirmed software install request to the helpdesk Teams channel."""
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#1a73e8;">Software Installation Request</h2>
      <p style="line-height:1.5;">{_nl2br(body)}</p>
      <p style="color:#888;font-size:12px;margin-top:24px;">
        Submitted via Centriq AI. Reply to respond directly to the requester.
      </p>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#1a73e8;">IT Support Request — Centriq AI</h2>
      <table cellpadding="8" style="border-collapse:collapse; width:100%; max-width:600px;">
        <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Ticket ID</td><td>{ticket_id}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Requester</td><td>{employee_name} ({employee_email})</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Employee ID</td><td>{employee_id}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Department</td><td>{department}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Category</td><td>{category}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Priority</td><td>{priority}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Subject</td><td>{subject}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Description</td>
            <td>{_nl2br(description)}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">
        Submitted via Centriq AI. Reply to respond directly to the employee.
      </p>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=email_subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#1a73e8;">{action_label} — Centriq AI</h2>
      <table cellpadding="8" style="border-collapse:collapse; width:100%; max-width:600px;">
        <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Employee</td><td>{employee_name} ({employee_email})</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Vehicle Type</td><td>{vehicle_type}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Vehicle Number</td><td>{vehicle_number}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Make</td><td>{vehicle_make or "—"}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Model</td><td>{vehicle_model or "—"}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Action</td><td>{action_label}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI. Reply to respond directly to the employee.</p>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#e53935;">Food / Cafeteria Complaint — Centriq AI</h2>
      <table cellpadding="8" style="border-collapse:collapse; width:100%; max-width:600px;">
        <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Ticket ID</td><td>{ticket_id}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Reported By</td><td>{employee_name} ({employee_email})</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Vendor / Source</td><td>{vendor_name}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Complaint Type</td><td>{complaint_type}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Description</td>
            <td>{_nl2br(description)}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI. Reply to respond directly to the employee.</p>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#f57c00;">Facility Complaint — Centriq AI</h2>
      <table cellpadding="8" style="border-collapse:collapse; width:100%; max-width:600px;">
        <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Ticket ID</td><td>{ticket_id}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Reported By</td><td>{employee_name} ({employee_email})</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Category</td><td>{category}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Location</td><td>{location}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Priority</td><td>{priority}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Description</td>
            <td>{_nl2br(description)}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI. Reply to respond directly to the employee.</p>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)


def send_facility_complaint_status_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ticket_id: str,
    category: str,
    new_status: str,
    closure_comment: Optional[str] = None,
) -> bool:
    color = "#16a34a" if new_status == "Closed" else "#7c3aed"
    subject = f"[Facility Complaint {ticket_id}] Status updated to {new_status}"
    closure_row = (
        f'<tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Closure Comment</td>'
        f'<td>{_nl2br(html.escape(closure_comment))}</td></tr>'
        if closure_comment else ""
    )
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#f57c00;padding:20px 24px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">Facility Complaint Update — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <p>Hi {html.escape(employee_name)},</p>
        <p>Your facility complaint has been updated.</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Ticket ID</td><td>{html.escape(ticket_id)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Category</td><td>{html.escape(category)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">New Status</td>
              <td style="color:{color};font-weight:bold;">{html.escape(new_status)}</td></tr>
          {closure_row}
        </table>
        <p style="color:#888;font-size:12px;">This is an automated notification from Centriq AI.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=employee_email, subject=subject, html_body=html_body)


def send_food_complaint_status_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    ticket_id: str,
    vendor_name: str,
    new_status: str,
    closure_comment: Optional[str] = None,
) -> bool:
    color = "#16a34a" if new_status == "Closed" else "#7c3aed"
    subject = f"[Food Complaint {ticket_id}] Status updated to {new_status}"
    closure_row = (
        f'<tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Closure Comment</td>'
        f'<td>{_nl2br(html.escape(closure_comment))}</td></tr>'
        if closure_comment else ""
    )
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#e53935;padding:20px 24px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">Food Complaint Update — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <p>Hi {html.escape(employee_name)},</p>
        <p>Your food / cafeteria complaint has been updated.</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Ticket ID</td><td>{html.escape(ticket_id)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Vendor / Source</td><td>{html.escape(vendor_name)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">New Status</td>
              <td style="color:{color};font-weight:bold;">{html.escape(new_status)}</td></tr>
          {closure_row}
        </table>
        <p style="color:#888;font-size:12px;">This is an automated notification from Centriq AI.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=employee_email, subject=subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#1a73e8;">Reimbursement Request — Centriq AI</h2>
      <table cellpadding="8" style="border-collapse:collapse; width:100%; max-width:600px;">
        <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Request ID</td><td>#{reimbursement_id}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Employee</td><td>{employee_name} ({employee_email})</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Type</td><td>{reimbursement_type}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Amount</td><td>INR {amount:,.2f}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Reason / Details</td>
            <td>{_nl2br(reason)}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI. Reply to respond directly to the employee.</p>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)


# ── Bookshelf Buddy ───────────────────────────────────────────────────────────

def send_book_request_email(
    user_email: str,
    employee_name: str,
    employee_email: str,
    book_title: str,
    book_author: str,
    ticket_id: str,
    notes: str = "",
) -> bool:
    """Notify the Bookshelf POC about a new book issue request.
    Sends to BOOKSHELF_NOTIFY_EMAIL (not NOTIFY_TO_EMAIL) to keep out of the real admin inbox.
    """
    to = settings.BOOKSHELF_NOTIFY_EMAIL
    if not to:
        logger.warning("[bookshelf email] BOOKSHELF_NOTIFY_EMAIL not set — skipping notification.")
        return False
    subject = f"[Bookshelf] Book Request — {book_title} | {ticket_id}"
    notes_row = (
        f'<tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Notes</td>'
        f'<td>{_nl2br(html.escape(notes))}</td></tr>'
        if notes else ""
    )
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#0A2540;padding:20px 24px;">
        <h2 style="color:#00D4AA;margin:0;font-size:18px;">Bookshelf Buddy — Book Issue Request</h2>
      </div>
      <div style="padding:24px;">
        <p>A new book issue request has been submitted via Centriq AI.</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Ticket ID</td><td>{html.escape(ticket_id)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Requested By</td><td>{html.escape(employee_name)} ({html.escape(employee_email)})</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Book Title</td><td>{html.escape(book_title)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Author</td><td>{html.escape(book_author)}</td></tr>
          {notes_row}
        </table>
        <p>Please review and approve / reject this request from the <strong>Admin Portal → Bookshelf Buddy</strong> tab.</p>
        <p style="color:#888;font-size:12px;">Submitted via Centriq AI.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=to, subject=subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#0A2540;padding:20px 24px;">
        <h2 style="color:#00D4AA;margin:0;font-size:18px;">Leave Approval Request — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <p>Hi,</p>
        <p><strong>{html.escape(employee_name)}</strong> has applied for leave and requires your approval:</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Leave ID</td><td>#{leave_id}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Employee</td><td>{html.escape(employee_name)} ({html.escape(employee_email)})</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Leave Type</td><td>{html.escape(leave_type)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">From</td><td>{html.escape(start_date)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">To</td><td>{html.escape(end_date)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Reason</td><td>{_nl2br(reason)}</td></tr>
        </table>
        <p>Please click one of the buttons below to action this request:</p>
        <div style="margin:24px 0;">
          <a href="{html.escape(approve_url)}" style="background:#16a34a;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;margin-right:12px;">
            ✓ Approve Leave
          </a>
          <a href="{html.escape(reject_url)}" style="background:#dc2626;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">
            ✗ Reject Leave
          </a>
        </div>
        <p style="color:#888;font-size:12px;">These links expire in 24 hours. Submitted via Centriq AI. Reply to contact the employee directly.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=manager_email, subject=subject, html_body=html_body)


def send_leave_decision_notification(
    user_email: str,
    employee_email: str,
    employee_name: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    decision: str,
    decided_by: str,
) -> bool:
    color = "#16a34a" if decision == "Approved" else "#dc2626"
    subject = f"[Leave {decision}] {leave_type} | {start_date} to {end_date}"
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#0A2540;padding:20px 24px;">
        <h2 style="color:#00D4AA;margin:0;font-size:18px;">Leave {html.escape(decision)} — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <p>Hi {html.escape(employee_name)},</p>
        <p>Your leave request has been <strong style="color:{color};">{html.escape(decision)}</strong>.</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Leave Type</td><td>{html.escape(leave_type)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">From</td><td>{html.escape(start_date)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">To</td><td>{html.escape(end_date)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Decision</td><td style="color:{color};font-weight:bold;">{html.escape(decision)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Actioned by</td><td>{html.escape(decided_by)}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;">This is an automated notification from Centriq AI.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=employee_email, subject=subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#0A2540;padding:20px 24px;">
        <h2 style="color:#00D4AA;margin:0;font-size:18px;">Leave Notification (FYI) — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <p>Hi,</p>
        <p>This is to inform you that <strong>{html.escape(employee_name)}</strong> has applied for leave. This is for your information only — the reporting manager will approve or reject this request.</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Employee</td><td>{html.escape(employee_name)} ({html.escape(employee_email)})</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Leave Type</td><td>{html.escape(leave_type)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">From</td><td>{html.escape(start_date)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">To</td><td>{html.escape(end_date)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Reason</td><td>{_nl2br(reason)}</td></tr>
        </table>
        <p style="color:#888;font-size:12px;">This is an automated FYI notification from Centriq AI. No action is required from you.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=functional_manager_email, subject=subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#0A2540;padding:20px 24px;">
        <h2 style="color:#00D4AA;margin:0;font-size:18px;">New HR Query — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <p>A new HR query has been submitted and requires your attention.</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Reference ID</td><td>{html.escape(reference_id)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Employee</td><td>{html.escape(employee_name)} ({html.escape(employee_email)})</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Category</td><td>{html.escape(category)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Subject</td><td>{html.escape(subject)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Description</td><td>{_nl2br(description)}</td></tr>
        </table>
        <p>Please respond through the HR Portal or reply to contact the employee directly.</p>
        <p style="color:#888;font-size:12px;">Submitted via Centriq AI.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=email_subject, html_body=html_body)


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
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
      <div style="background:#7c3aed;padding:20px 24px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">HR Grievance Submitted — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <p>A new grievance has been submitted and requires your attention.</p>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Reference ID</td><td>{html.escape(reference_id)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Category</td><td>{html.escape(category)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Submitted By</td><td>{submitter_label}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Description</td><td>{_nl2br(description)}</td></tr>
        </table>
        <p>Please review and respond through the HR Portal within 5 working days.</p>
        <p style="color:#888;font-size:12px;">Submitted via Centriq AI.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)


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
    checklist_it = """
      <li>Create corporate email account</li>
      <li>Set up VPN access</li>
      <li>Assign laptop and peripherals</li>
      <li>Configure system with required software</li>
      <li>Add to relevant distribution groups / Teams channels</li>
      <li>Share IT support contact and ticketing portal link</li>
    """
    checklist_admin = """
      <li>Issue access card / ID badge</li>
      <li>Set up cafeteria account</li>
      <li>Register for parking (if applicable)</li>
      <li>Assign workstation / desk</li>
      <li>Share emergency contact and facility maps</li>
    """
    checklist_hr = """
      <li>Collect signed offer letter and joining documents</li>
      <li>Complete HRMS onboarding form</li>
      <li>Schedule induction and buddy assignment</li>
      <li>Share employee handbook and key policies</li>
      <li>Confirm probation period and review schedule</li>
      <li>Send welcome announcement to the team</li>
    """
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;">
      <div style="background:#0A2540;padding:20px 24px;">
        <h2 style="color:#00D4AA;margin:0;font-size:18px;">New Joiner Onboarding Checklist — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin-bottom:20px;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Employee</td><td>{html.escape(employee_name)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Email</td><td>{html.escape(employee_email)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Department</td><td>{html.escape(department)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Designation</td><td>{html.escape(designation)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Joining Date</td><td>{html.escape(joining_date)}</td></tr>
        </table>
        <h3 style="color:#1a73e8;">IT Setup Tasks</h3>
        <ul style="line-height:1.8;">{checklist_it}</ul>
        <h3 style="color:#f57c00;">Admin / Facilities Tasks</h3>
        <ul style="line-height:1.8;">{checklist_admin}</ul>
        <h3 style="color:#7c3aed;">HR Tasks</h3>
        <ul style="line-height:1.8;">{checklist_hr}</ul>
        <p style="color:#888;font-size:12px;">Generated by Centriq AI. Please complete all relevant tasks before the joining date.</p>
      </div>
    </body></html>
    """
    return _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)


def send_offboarding_checklist(
    user_email: str,
    employee_name: str,
    employee_email: str,
    last_day: str,
    department: str,
    manager_email: str,
) -> bool:
    subject = f"[Offboarding] {employee_name} — Last Day: {last_day}"
    checklist_it = """
      <li>Retrieve laptop, monitor, and all peripherals</li>
      <li>Deactivate corporate email and SSO accounts</li>
      <li>Revoke VPN and remote access</li>
      <li>Remove from all distribution groups and Teams channels</li>
      <li>Wipe and re-image returned device</li>
    """
    checklist_admin = """
      <li>Collect access card / ID badge</li>
      <li>Process parking sticker surrender</li>
      <li>Settle any outstanding cafeteria dues</li>
      <li>Confirm final expense claims submitted</li>
    """
    checklist_hr = """
      <li>Schedule exit interview</li>
      <li>Process full-and-final settlement</li>
      <li>Collect signed resignation / relieving letter</li>
      <li>Issue experience certificate</li>
      <li>Update HRMS with exit date and reason</li>
      <li>Announce departure to relevant teams</li>
    """
    checklist_manager = """
      <li>Ensure knowledge transfer is complete</li>
      <li>Hand over ongoing projects and tasks</li>
      <li>Transfer ownership of key documents/repos</li>
      <li>Reassign pending work items</li>
    """
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;">
      <div style="background:#7f1d1d;padding:20px 24px;">
        <h2 style="color:#fca5a5;margin:0;font-size:18px;">Offboarding Checklist — Centriq AI</h2>
      </div>
      <div style="padding:24px;">
        <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin-bottom:20px;">
          <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Employee</td><td>{html.escape(employee_name)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Email</td><td>{html.escape(employee_email)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Department</td><td>{html.escape(department)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Last Working Day</td><td>{html.escape(last_day)}</td></tr>
        </table>
        <h3 style="color:#dc2626;">Manager Handover Tasks</h3>
        <ul style="line-height:1.8;">{checklist_manager}</ul>
        <h3 style="color:#1a73e8;">IT Tasks</h3>
        <ul style="line-height:1.8;">{checklist_it}</ul>
        <h3 style="color:#f57c00;">Admin / Facilities Tasks</h3>
        <ul style="line-height:1.8;">{checklist_admin}</ul>
        <h3 style="color:#7c3aed;">HR Tasks</h3>
        <ul style="line-height:1.8;">{checklist_hr}</ul>
        <p style="color:#888;font-size:12px;">Generated by Centriq AI. Please complete all tasks by {html.escape(last_day)}.</p>
      </div>
    </body></html>
    """
    # Send to the Teams channel; manager gets a separate copy
    ok1 = _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)
    ok2 = _send(user_email=user_email, to=manager_email, subject=f"[Manager] {subject}", html_body=html_body) if manager_email else False
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
        rows = "".join(
            f'<tr><td style="background:#f5f5f5;font-weight:bold;width:160px;padding:8px;">'
            f'{html.escape(str(k))}</td>'
            f'<td style="padding:8px;">{html.escape(str(v))}</td></tr>'
            for k, v in data.items()
        )
        json_str = json.dumps({"event": event_type, **data}, default=str)
        json_b64 = _b64.b64encode(json_str.encode()).decode()
        html_body = f"""
<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
  <div style="background:#0A2540;padding:16px 24px;">
    <h2 style="color:#00D4AA;margin:0;font-size:16px;">[AURORA] {html.escape(event_type)}</h2>
  </div>
  <div style="padding:24px;">
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:550px;">
      {rows}
    </table>
  </div>
  <div id="pa-data" style="display:none;overflow:hidden;line-height:0;max-height:0;">PAJSON:{json_b64}:ENDJSON</div>
</body></html>"""
        _send(user_email=user_email, to=settings.NOTIFY_TO_EMAIL, subject=subject, html_body=html_body)

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
    subject = title
    image_block = (
        f'<img src="{html.escape(image_url)}" alt="" '
        f'style="max-width:100%;margin-bottom:16px;" /><br>'
        if image_url else ""
    )
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #222; font-size:14px; line-height:1.7; max-width:600px; margin:0 auto; padding:24px;">
      <p>Dear Team,</p>
      {image_block}
      <p>{_nl2br(html.escape(body))}</p>
      <p>Thanks &amp; Regards,<br>
      <strong>HR Team</strong></p>
    </body></html>
    """
    if not recipients:
        return False
    return _send(user_email=user_email, to=recipients, subject=subject, html_body=html_body)
