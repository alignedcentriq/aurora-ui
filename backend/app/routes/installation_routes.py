"""
Installation Request Routes
-----------------------------
Full lifecycle for employee software install requests:
  - Employee requests via chatbot or directly
  - IT notified by email with one-click approve/reject links
  - On approval: Endpoint Central deployment triggered
  - Background status polling updates request to deployed/failed
  - Employee notified at each stage
"""

import asyncio
import datetime
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_it
from app.config import settings
from app.database import get_db, SessionLocal
from app.models import Employee, InstallationRequest, SoftwareCatalog
from app.services.manage_engine_service import ManageEngineError, get_manage_engine_service

logger = logging.getLogger("aurora-logger")

router = APIRouter(prefix="/api/installation-requests", tags=["Software Installation"])

_IT_APPROVER_EMAIL = settings.HELPDESK_EMAIL  # IT team inbox


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class InstallationRequestCreate(BaseModel):
    software_id: str
    machine_hostname: Optional[str] = None
    reason: Optional[str] = None


class RejectBody(BaseModel):
    rejection_reason: Optional[str] = None


# ── Serializer ────────────────────────────────────────────────────────────────

def _row_to_dict(row: InstallationRequest) -> dict:
    return {
        "id": str(row.id),
        "employee_id": row.employee_id,
        "employee_name": row.employee.name if row.employee else None,
        "employee_email": row.employee.email if row.employee else None,
        "software_id": str(row.software_id),
        "software_name": row.software.name if row.software else None,
        "software_package_id": row.software.endpoint_central_package_id if row.software else None,
        "machine_hostname": row.machine_hostname,
        "reason": row.reason,
        "status": row.status,
        "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        "reviewed_by": row.reviewed_by,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "rejection_reason": row.rejection_reason,
        "deployment_job_id": row.deployment_job_id,
        "deployed_at": row.deployed_at.isoformat() if row.deployed_at else None,
        "deployment_log": row.deployment_log,
        "approval_expires_at": row.approval_expires_at.isoformat() if row.approval_expires_at else None,
    }


# ── Email helpers ─────────────────────────────────────────────────────────────

def _send_approval_request_email(req: InstallationRequest) -> None:
    """Email IT approver with one-click approve/reject links."""
    from app.services.email_service import _send
    base = settings.APP_BASE_URL
    approve_url = f"{base}/api/installation-requests/approve/{req.approval_token}"
    reject_url = f"{base}/api/installation-requests/reject/{req.approval_token}"
    emp_name = req.employee.name if req.employee else "Unknown"
    emp_email = req.employee.email if req.employee else ""
    software = req.software.name if req.software else "Unknown"
    reason = req.reason or "No reason provided"
    hostname = req.machine_hostname or "Unknown"

    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:auto;">
      <h2 style="color:#1a73e8;">Software Installation Request</h2>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:6px;font-weight:bold;">Employee</td><td style="padding:6px;">{emp_name} ({emp_email})</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Software</td><td style="padding:6px;">{software}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Machine</td><td style="padding:6px;">{hostname}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Reason</td><td style="padding:6px;">{reason}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Requested</td><td style="padding:6px;">{req.requested_at.strftime('%Y-%m-%d %H:%M UTC') if req.requested_at else ''}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;">Expires</td><td style="padding:6px;">{req.approval_expires_at.strftime('%Y-%m-%d %H:%M UTC') if req.approval_expires_at else ''}</td></tr>
      </table>
      <br>
      <a href="{approve_url}" style="background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;margin-right:12px;">Approve</a>
      <a href="{reject_url}" style="background:#d93025;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">Reject</a>
      <p style="color:#888;font-size:12px;margin-top:24px;">
        These links expire in 24 hours. Request ID: {req.id}
      </p>
    </body></html>
    """
    _send(
        to=_IT_APPROVER_EMAIL,
        subject=f"[Install Request] {software} — {emp_name}",
        html_body=html_body,
        reply_to=emp_email or None,
    )


def _send_employee_notification(emp_email: str, subject: str, message: str) -> None:
    from app.services.email_service import _send
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:auto;">
      <h2 style="color:#1a73e8;">Software Installation Update</h2>
      <p style="line-height:1.6;">{message}</p>
      <p style="color:#888;font-size:12px;margin-top:24px;">Centriq AI — IT Support</p>
    </body></html>
    """
    _send(to=emp_email, subject=subject, html_body=html_body)


# ── Deployment background task ────────────────────────────────────────────────

async def _trigger_deployment(request_id: str) -> None:
    """
    Background task: calls ManageEngine to deploy the package,
    then polls until Completed or Failed, then updates the DB record.
    """
    db = SessionLocal()
    try:
        req = db.query(InstallationRequest).filter(InstallationRequest.id == request_id).first()
        if not req:
            return

        me = get_manage_engine_service()
        hostname = req.machine_hostname or ""
        package_id = req.software.endpoint_central_package_id if req.software else None

        if not package_id:
            req.status = "failed"
            req.deployment_log = "Software has no Endpoint Central package ID configured."
            db.commit()
            _notify_failed(req, req.deployment_log)
            return

        # Look up device
        try:
            device = await me.get_device_by_hostname(hostname)
        except ManageEngineError as e:
            req.status = "failed"
            req.deployment_log = f"Device lookup failed: {e}"
            db.commit()
            _notify_failed(req, req.deployment_log)
            return

        if not device:
            req.status = "failed"
            req.deployment_log = f"Device '{hostname}' not found in Endpoint Central."
            db.commit()
            _notify_failed(req, req.deployment_log)
            return

        device_id = device.get("resource_id", "")

        # Trigger deployment
        try:
            job_id = await me.deploy_package(package_id, device_id)
        except ManageEngineError as e:
            req.status = "failed"
            req.deployment_log = f"Deployment trigger failed: {e}"
            db.commit()
            _notify_failed(req, req.deployment_log)
            return

        req.deployment_job_id = job_id
        req.status = "deploying"
        db.commit()

        # Poll for completion (max 5 minutes, every 10 seconds)
        max_polls = 30
        for _ in range(max_polls):
            await asyncio.sleep(10)
            try:
                job = await me.get_deployment_status(job_id)
            except ManageEngineError:
                continue  # transient error, keep polling

            job_status = job.get("status", "")
            if job_status == "Completed":
                req.status = "deployed"
                req.deployed_at = datetime.datetime.utcnow()
                req.deployment_log = job.get("status_detail", "Deployed successfully")
                db.commit()
                _notify_deployed(req)
                return
            elif job_status in ("Failed", "Error"):
                req.status = "failed"
                req.deployment_log = job.get("error") or job.get("status_detail", "Deployment failed")
                db.commit()
                _notify_failed(req, req.deployment_log)
                return

        # Timed out
        req.status = "failed"
        req.deployment_log = "Deployment timed out after 5 minutes."
        db.commit()
        _notify_failed(req, req.deployment_log)

    finally:
        db.close()


def _notify_deployed(req: InstallationRequest) -> None:
    emp_email = req.employee.email if req.employee else None
    if not emp_email:
        return
    software = req.software.name if req.software else "the software"
    _send_employee_notification(
        emp_email,
        f"Installation Complete — {software}",
        f"Good news! <b>{software}</b> has been successfully installed on your machine <b>{req.machine_hostname}</b>.<br><br>"
        f"You can now launch it from your applications.",
    )


def _notify_failed(req: InstallationRequest, error: str) -> None:
    emp_email = req.employee.email if req.employee else None
    if not emp_email:
        return
    software = req.software.name if req.software else "the software"
    _send_employee_notification(
        emp_email,
        f"Installation Failed — {software}",
        f"Unfortunately, the installation of <b>{software}</b> on <b>{req.machine_hostname}</b> failed.<br><br>"
        f"Error: {error}<br><br>Please contact IT support for assistance.",
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_request(
    body: InstallationRequestCreate,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit a software installation request."""
    # Resolve employee
    employee = db.query(Employee).filter(Employee.email == user.email).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee record not found.")

    # Resolve software
    software = db.query(SoftwareCatalog).filter(
        SoftwareCatalog.id == body.software_id,
        SoftwareCatalog.is_active == True,
    ).first()
    if not software:
        raise HTTPException(status_code=404, detail="Software not found in catalog.")

    # Create request record
    token = str(uuid.uuid4())
    req = InstallationRequest(
        employee_id=employee.id,
        software_id=software.id,
        machine_hostname=body.machine_hostname,
        reason=body.reason,
        status="pending",
        approval_token=token,
        approval_expires_at=datetime.datetime.utcnow() + datetime.timedelta(hours=24),
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    if software.auto_approve:
        # Skip approval — deploy immediately
        req.status = "approved"
        req.reviewed_at = datetime.datetime.utcnow()
        db.commit()
        background_tasks.add_task(_trigger_deployment, str(req.id))
    else:
        # Notify IT approver
        try:
            _send_approval_request_email(req)
        except Exception as e:
            logger.error(f"Failed to send approval email: {e}")

    return _row_to_dict(req)


@router.get("")
def list_requests(
    status: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List installation requests.
    Employees see only their own. IT/admins see all.
    """
    query = db.query(InstallationRequest)

    if user.role not in ("admin", "it_admin", "it"):
        employee = db.query(Employee).filter(Employee.email == user.email).first()
        if employee:
            query = query.filter(InstallationRequest.employee_id == employee.id)
        else:
            return []

    if status:
        query = query.filter(InstallationRequest.status == status)

    rows = query.order_by(InstallationRequest.requested_at.desc()).all()
    return [_row_to_dict(r) for r in rows]


@router.get("/approve/{token}", response_class=HTMLResponse)
async def one_click_approve(
    token: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """One-click approve link sent in email to IT approver."""
    req = db.query(InstallationRequest).filter(InstallationRequest.approval_token == token).first()
    if not req:
        return HTMLResponse("<h2>Invalid or already-used approval link.</h2>", status_code=400)

    if req.approval_expires_at and datetime.datetime.utcnow() > req.approval_expires_at:
        return HTMLResponse("<h2>This approval link has expired.</h2>", status_code=410)

    if req.status != "pending":
        return HTMLResponse(f"<h2>Request already in status: {req.status}</h2>")

    req.status = "approved"
    req.reviewed_at = datetime.datetime.utcnow()
    req.approval_token = None  # one-time use
    db.commit()

    software = req.software.name if req.software else "the software"
    emp_name = req.employee.name if req.employee else "The employee"
    emp_email = req.employee.email if req.employee else None

    if emp_email:
        _send_employee_notification(
            emp_email,
            f"Installation Approved — {software}",
            f"Your request for <b>{software}</b> has been approved. Installation is starting on <b>{req.machine_hostname}</b>.",
        )

    background_tasks.add_task(_trigger_deployment, str(req.id))

    return HTMLResponse(f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:auto;padding:40px;">
      <h2 style="color:#1a73e8;">Request Approved</h2>
      <p><b>{emp_name}</b>'s request for <b>{software}</b> has been approved.</p>
      <p>Deployment is starting on <b>{req.machine_hostname}</b>. The employee will be notified when complete.</p>
    </body></html>
    """)


@router.get("/reject/{token}", response_class=HTMLResponse)
async def one_click_reject(
    token: str,
    db: Session = Depends(get_db),
):
    """One-click reject link sent in email to IT approver."""
    req = db.query(InstallationRequest).filter(InstallationRequest.approval_token == token).first()
    if not req:
        return HTMLResponse("<h2>Invalid or already-used rejection link.</h2>", status_code=400)

    if req.approval_expires_at and datetime.datetime.utcnow() > req.approval_expires_at:
        return HTMLResponse("<h2>This rejection link has expired.</h2>", status_code=410)

    if req.status != "pending":
        return HTMLResponse(f"<h2>Request already in status: {req.status}</h2>")

    req.status = "rejected"
    req.reviewed_at = datetime.datetime.utcnow()
    req.approval_token = None
    db.commit()

    software = req.software.name if req.software else "the software"
    emp_email = req.employee.email if req.employee else None

    if emp_email:
        _send_employee_notification(
            emp_email,
            f"Installation Request Not Approved — {software}",
            f"Your request for <b>{software}</b> was not approved by IT.<br><br>"
            f"If you have questions, please contact the IT helpdesk.",
        )

    return HTMLResponse(f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:auto;padding:40px;">
      <h2 style="color:#d93025;">Request Rejected</h2>
      <p>The request for <b>{software}</b> has been rejected. The employee has been notified.</p>
    </body></html>
    """)


@router.get("/{request_id}")
def get_request(
    request_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get details of a specific installation request."""
    req = db.query(InstallationRequest).filter(InstallationRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found.")

    # Employees can only see their own
    if user.role not in ("admin", "it_admin", "it"):
        employee = db.query(Employee).filter(Employee.email == user.email).first()
        if not employee or req.employee_id != employee.id:
            raise HTTPException(status_code=403, detail="Access denied.")

    return _row_to_dict(req)


@router.patch("/{request_id}/approve")
async def approve_request(
    request_id: str,
    background_tasks: BackgroundTasks,
    reviewer: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    """Approve a pending installation request (IT admin only). Triggers deployment."""
    req = db.query(InstallationRequest).filter(InstallationRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found.")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request is already in status: {req.status}")

    reviewer_emp = db.query(Employee).filter(Employee.email == reviewer.email).first()
    req.status = "approved"
    req.reviewed_by = reviewer_emp.id if reviewer_emp else None
    req.reviewed_at = datetime.datetime.utcnow()
    req.approval_token = None
    db.commit()

    software = req.software.name if req.software else "the software"
    emp_email = req.employee.email if req.employee else None
    if emp_email:
        _send_employee_notification(
            emp_email,
            f"Installation Approved — {software}",
            f"Your request for <b>{software}</b> has been approved. Installation is starting.",
        )

    background_tasks.add_task(_trigger_deployment, str(req.id))
    return _row_to_dict(req)


@router.patch("/{request_id}/reject")
def reject_request(
    request_id: str,
    body: RejectBody,
    reviewer: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    """Reject a pending installation request (IT admin only)."""
    req = db.query(InstallationRequest).filter(InstallationRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found.")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request is already in status: {req.status}")

    reviewer_emp = db.query(Employee).filter(Employee.email == reviewer.email).first()
    req.status = "rejected"
    req.reviewed_by = reviewer_emp.id if reviewer_emp else None
    req.reviewed_at = datetime.datetime.utcnow()
    req.rejection_reason = body.rejection_reason
    req.approval_token = None
    db.commit()

    software = req.software.name if req.software else "the software"
    emp_email = req.employee.email if req.employee else None
    if emp_email:
        reason_text = f"Reason: {body.rejection_reason}<br><br>" if body.rejection_reason else ""
        _send_employee_notification(
            emp_email,
            f"Installation Request Not Approved — {software}",
            f"Your request for <b>{software}</b> was not approved by IT.<br><br>"
            f"{reason_text}Contact the IT helpdesk if you have questions.",
        )

    return _row_to_dict(req)
