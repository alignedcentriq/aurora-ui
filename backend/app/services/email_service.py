"""
Email dispatcher for Centriq AI.

Used by:
  - IT Agent  → sends ticket email to helpdesk (ManageEngine auto-creates ticket)
  - Admin Agent → sends parking / food complaint / reimbursement notifications
  - HR Agent  → sends announcement broadcast emails
"""

import smtplib
import logging
import html
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional


def _nl2br(text: str) -> str:
    """Escape HTML and convert newlines to <br> for email clients that ignore CSS."""
    return html.escape(text).replace("\n", "<br>")

from app.config import settings

logger = logging.getLogger("aurora-logger")


def _send(
    to: str,
    subject: str,
    html_body: str,
    cc: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> bool:
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
        if reply_to:
            msg["Reply-To"] = reply_to
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


def send_software_install_email(
    requester_email: str,
    software_name: str,
    subject: str,
    body: str,
) -> bool:
    """Send a confirmed software install request to IT support."""
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color:#1a73e8;">Software Installation Request</h2>
      <p style="line-height:1.5;">{_nl2br(body)}</p>
      <p style="color:#888;font-size:12px;margin-top:24px;">
        Submitted via Centriq AI after user confirmation. Reply-To is set to the requester.
      </p>
    </body></html>
    """
    return _send(
        to=settings.HELPDESK_EMAIL,
        subject=subject,
        html_body=html_body,
        cc=requester_email,
        reply_to=requester_email,
    )


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
            <td>{_nl2br(description)}</td></tr>
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
            <td>{_nl2br(description)}</td></tr>
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
            <td>{_nl2br(description)}</td></tr>
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
            <td>{_nl2br(reason)}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">Submitted via Centriq AI. Please process in the reimbursement portal.</p>
    </body></html>
    """
    return _send(to=settings.ADMIN_EMAIL, subject=subject, html_body=html_body, cc=employee_email)


def send_leave_approval_request(
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
        <p style="color:#888;font-size:12px;">These links expire in 24 hours. Submitted via Centriq AI.</p>
      </div>
    </body></html>
    """
    return _send(to=manager_email, subject=subject, html_body=html_body)


def send_leave_decision_notification(
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
    return _send(to=employee_email, subject=subject, html_body=html_body)


def send_grievance_notification(
    reference_id: str,
    category: str,
    description: str,
    is_anonymous: bool,
    submitted_by: str,
    hr_email: str,
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
    return _send(to=hr_email, subject=subject, html_body=html_body)


def send_onboarding_checklist(
    employee_name: str,
    employee_email: str,
    joining_date: str,
    department: str,
    designation: str,
    it_email: str,
    admin_email: str,
    hr_email: str,
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
    ok1 = _send(to=it_email, subject=f"[IT] {subject}", html_body=html_body)
    ok2 = _send(to=admin_email, subject=f"[Admin] {subject}", html_body=html_body)
    ok3 = _send(to=hr_email, subject=f"[HR] {subject}", html_body=html_body)
    return ok1 or ok2 or ok3


def send_offboarding_checklist(
    employee_name: str,
    employee_email: str,
    last_day: str,
    department: str,
    manager_email: str,
    it_email: str,
    admin_email: str,
    hr_email: str,
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
    ok1 = _send(to=manager_email, subject=f"[Manager] {subject}", html_body=html_body)
    ok2 = _send(to=it_email, subject=f"[IT] {subject}", html_body=html_body)
    ok3 = _send(to=admin_email, subject=f"[Admin] {subject}", html_body=html_body)
    ok4 = _send(to=hr_email, subject=f"[HR] {subject}", html_body=html_body)
    return ok1 or ok2 or ok3 or ok4


def send_announcement_email(
    recipients: list,
    title: str,
    body: str,
    category: str,
    sent_by: str,
    image_url: str | None = None,
) -> bool:
    """Broadcast an announcement to a list of email addresses."""
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
    to = recipients[0]
    cc = ", ".join(recipients[1:]) if len(recipients) > 1 else None
    return _send(to=to, subject=subject, html_body=html_body, cc=cc)
