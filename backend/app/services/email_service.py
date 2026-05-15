"""
Email dispatcher for Centriq AI.

Used by:
  - IT Agent  → sends ticket email to helpdesk (ManageEngine auto-creates ticket)
  - Admin Agent → sends parking / food complaint / reimbursement notifications
  - HR Agent  → sends announcement broadcast emails
"""

import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.config import settings

logger = logging.getLogger("aurora-logger")


def _send(to: str, subject: str, html_body: str, cc: Optional[str] = None) -> bool:
    """Send an email. Returns True on success, False on failure."""
    if not settings.SMTP_USER or not settings.SMTP_PASS:
        logger.warning("SMTP credentials not configured — email not sent.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
        msg["To"] = to
        msg["Subject"] = subject
        if cc:
            msg["Cc"] = cc
        msg.attach(MIMEText(html_body, "html"))

        recipients = [to] + ([cc] if cc else [])
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASS)
            server.sendmail(settings.SMTP_USER, recipients, msg.as_string())

        logger.info("email_sent", extra={"to": to, "subject": subject})
        return True

    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False


# ── IT Helpdesk (ManageEngine) ────────────────────────────────────────────────

def send_it_ticket_email(
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
    """
    Send IT ticket to helpdesk email so ManageEngine auto-creates a ticket.
    Subject format is parsed by ManageEngine to extract category and requester.
    """
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
            <td style="white-space:pre-wrap;">{description}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">
        This request was submitted via Centriq AI Assistant. Please do not reply directly to this email.
      </p>
    </body></html>
    """
    return _send(
        to=settings.HELPDESK_EMAIL,
        subject=email_subject,
        html_body=html_body,
        cc=employee_email,
    )


# ── Admin Notifications ───────────────────────────────────────────────────────

def send_parking_request_email(
    employee_name: str,
    employee_email: str,
    vehicle_type: str,
    vehicle_number: str,
    vehicle_make: str,
    vehicle_model: str,
    action: str = "request",  # "request" or "surrender"
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
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI.</p>
    </body></html>
    """
    return _send(to=settings.ADMIN_EMAIL, subject=subject, html_body=html_body, cc=employee_email)


def send_food_complaint_email(
    employee_name: str,
    employee_email: str,
    vendor_name: str,
    complaint_type: str,
    description: str,
    complaint_id: int,
) -> bool:
    subject = f"[Admin] Food Complaint — {vendor_name} | #{complaint_id}"

    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#e53935;">Food / Cafeteria Complaint — Centriq AI</h2>
      <table cellpadding="8" style="border-collapse:collapse; width:100%; max-width:600px;">
        <tr><td style="background:#f5f5f5;font-weight:bold;width:160px;">Complaint ID</td><td>#{complaint_id}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Reported By</td><td>{employee_name} ({employee_email})</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Vendor</td><td>{vendor_name}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;">Complaint Type</td><td>{complaint_type}</td></tr>
        <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Description</td>
            <td style="white-space:pre-wrap;">{description}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI.</p>
    </body></html>
    """
    return _send(to=settings.ADMIN_EMAIL, subject=subject, html_body=html_body)


def send_facility_complaint_email(
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
            <td style="white-space:pre-wrap;">{description}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI.</p>
    </body></html>
    """
    return _send(to=settings.ADMIN_EMAIL, subject=subject, html_body=html_body, cc=employee_email)


def send_reimbursement_email(
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
            <td style="white-space:pre-wrap;">{reason}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI. Please process in the reimbursement portal.</p>
    </body></html>
    """
    return _send(to=settings.ADMIN_EMAIL, subject=subject, html_body=html_body, cc=employee_email)


def send_announcement_email(
    recipients: list,
    title: str,
    body: str,
    category: str,
    sent_by: str,
) -> bool:
    """Broadcast an announcement to a list of email addresses."""
    subject = f"[Centriq Announcement] {title}"
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <div style="background:#1a73e8;padding:16px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;">{title}</h2>
        <span style="color:#c8e0ff;font-size:13px;">Category: {category} | From: {sent_by}</span>
      </div>
      <div style="padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
        <p style="white-space:pre-wrap;line-height:1.6;">{body}</p>
      </div>
      <p style="color:#888;font-size:12px;margin-top:16px;">Sent via Centriq AI. Do not reply to this email.</p>
    </body></html>
    """
    if not recipients:
        return False
    to = recipients[0]
    cc = ", ".join(recipients[1:]) if len(recipients) > 1 else None
    return _send(to=to, subject=subject, html_body=html_body, cc=cc)
