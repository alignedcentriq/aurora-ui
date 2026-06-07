from sqlalchemy import Column, Integer, String, Date, Float, ForeignKey, Text, DateTime, Boolean, JSON, LargeBinary, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
import datetime
import uuid

Base = declarative_base()

# Schema for Postgres
SCHEMA = "enterprise_ai"

class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(String, unique=True, index=True)
    # Stable mapping to the Alchemy Skills Portal ID (numeric part of AASPL-####).
    # Decoupled from employee_id, which gets overwritten by Zoho CSV re-imports.
    alchemy_employee_id = Column(String, nullable=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    department = Column(String)
    designation = Column(String)
    location = Column(String)  # Pune, Indore, Dubai, US
    manager_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=True)
    joining_date = Column(Date)
    employment_type = Column(String) # Full-time, Contract
    pf_number = Column(String)
    insurance_plan = Column(String)
    tax_regime = Column(String) # Old, New
    shift_type = Column(String) # Day, Night
    role = Column(String, nullable=True) # Employee, HR, IT, PMO, Admin, Functional Manager, Super Admin

    # Relationships
    leaves = relationship("Leave", back_populates="employee")
    attendance = relationship("Attendance", back_populates="employee")
    skills = relationship("EmployeeSkill", back_populates="employee", cascade="all, delete-orphan")

class Leave(Base):
    __tablename__ = "leaves"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    leave_type = Column(String) # Casual, Sick, Earned, Optional
    start_date = Column(Date)
    end_date = Column(Date)
    status = Column(String, default="Pending") # Pending, Approved, Rejected, Cancelled
    reason = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    employee = relationship("Employee", back_populates="leaves")

class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    date = Column(Date)
    check_in = Column(DateTime, nullable=True)
    check_out = Column(DateTime, nullable=True)
    status = Column(String) # Present, Absent, WFH, Half-day
    
    employee = relationship("Employee", back_populates="attendance")

class AttendanceSchedule(Base):
    """
    A manager's automation to receive a whole-hierarchy attendance report by email on a
    recurring schedule. Persisted so it survives backend restarts; the startup scheduler
    loop runs any rows whose next_run <= now (see attendance_schedule_service).
    """
    __tablename__ = "attendance_schedules"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    manager_email = Column(String, index=True)
    manager_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=True)
    frequency = Column(String)              # daily | weekly | monthly | custom
    day_of_week = Column(Integer, nullable=True)   # 0=Mon .. 6=Sun (weekly / custom)
    day_of_month = Column(Integer, nullable=True)  # 1..28 (monthly / custom)
    hour = Column(Integer, default=8)       # local hour of day, 0..23
    recipients = Column(Text)               # comma-separated; empty => manager_email
    period_mode = Column(String, default="prev_period")  # prev_period | current
    active = Column(Boolean, default=True)
    next_run = Column(DateTime, nullable=True)
    last_run = Column(DateTime, nullable=True)
    last_status = Column(String, nullable=True)  # sent | failed:<reason>
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Policy(Base):
    __tablename__ = "policies"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    category = Column(String) # Leave, WFH, etc.
    content = Column(Text)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow)
    # Source tracking for incremental sync (SharePoint)
    source_key = Column(String, nullable=True, unique=True)   # e.g. "sp:HR/Leave Policy.pdf"
    source_etag = Column(String, nullable=True)               # cTag/ETag; changes when file changes


class PolicyChunk(Base):
    """Each row is one chunk of a Policy document, optionally with an embedding vector."""
    __tablename__ = "policy_chunks"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(Integer, ForeignKey(f"{SCHEMA}.policies.id", ondelete="CASCADE"), index=True, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    embedding = Column(Vector(768), nullable=True)
    image_urls = Column(JSON, nullable=True)  # list of PolicyImage IDs for images near this chunk
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class PolicyImage(Base):
    """Stores images extracted from policy PDFs/DOCXs directly in PostgreSQL."""
    __tablename__ = "policy_images"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(Integer, ForeignKey(f"{SCHEMA}.policies.id", ondelete="CASCADE"), index=True, nullable=False)
    content_type = Column(String, nullable=False, default="image/png")
    image_data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class CompanySettings(Base):
    __tablename__ = "company_settings"
    __table_args__ = {"schema": SCHEMA}

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    updated_by = Column(String, nullable=True)


# New SharePoint Integration Tables (Aligned with enterprise_ai schema)
class GraphSubscription(Base):
    __tablename__ = "graph_subscriptions"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    subscription_id = Column(String(255), unique=True, index=True, nullable=False)
    site_id = Column(String(255))
    drive_id = Column(String(255))
    expiration_time = Column(DateTime(timezone=True))
    status = Column(String(50)) # Active, Expired, Failed
    webhook_endpoint = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class SharePointDeltaToken(Base):
    __tablename__ = "sharepoint_delta_tokens"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    drive_id = Column(String(255), unique=True, index=True, nullable=False)
    delta_url = Column(Text)
    last_sync = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class SharePointFile(Base):
    __tablename__ = "sharepoint_files"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    file_id = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(500))
    path = Column(Text)
    web_url = Column(Text)
    last_modified = Column(DateTime(timezone=True))
    is_deleted = Column(Boolean, default=False)
    drive_id = Column(String(255))
    
    # Sync metadata
    processing_status = Column(String(50), default="Pending") # Pending, Processed, Failed
    last_processed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class SyncFailureLog(Base):
    __tablename__ = "sync_failure_logs"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    resource_id = Column(String(255), index=True, nullable=False) # drive_id or file_id
    error_type = Column(String(100))
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved = Column(Boolean, default=False)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    status = Column(String, default="In Progress")
    completion_pct = Column(Float, default=0.0)
    sprint_name = Column(String)
    next_milestone = Column(String)
    next_milestone_date = Column(String)
    owner = Column(String)
    achievements = Column(Text)




# ── Admin Domain ──────────────────────────
class Reimbursement(Base):
    __tablename__ = "reimbursements"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    type = Column(String)  # Travel, Medical, Certification, Equipment
    amount = Column(Float)
    receipt_url = Column(String, nullable=True)
    status = Column(String, default="Pending")  # Pending, Approved, Rejected
    approved_by = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class ParkingSticker(Base):
    __tablename__ = "parking_stickers"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    vehicle_type = Column(String)  # 2-wheeler, 4-wheeler
    vehicle_number = Column(String)
    vehicle_make = Column(String, nullable=True)   # e.g. Honda, Maruti
    vehicle_model = Column(String, nullable=True)  # e.g. Activa, Swift
    sticker_number = Column(String, nullable=True)
    valid_from = Column(Date)
    valid_until = Column(Date)
    status = Column(String, default="Pending")  # Active, Expired, Pending, Surrendered

class Accommodation(Base):
    __tablename__ = "accommodations"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    type = Column(String)  # Guest House, Hotel
    check_in = Column(Date)
    check_out = Column(Date)
    location = Column(String)
    status = Column(String, default="Pending")
    approved_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class VisitorPass(Base):
    __tablename__ = "visitor_passes"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    pass_id = Column(String, unique=True, index=True)  # VP-001
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))  # host
    visitor_name = Column(String)
    visitor_company = Column(String, nullable=True)
    visit_date = Column(Date)
    visit_time = Column(String, nullable=True)  # free-text, e.g. "2:00 PM" or "afternoon"
    purpose = Column(Text)
    status = Column(String, default="Pending")  # Pending, Approved, Rejected, Completed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class FacilityComplaint(Base):
    __tablename__ = "facility_complaints"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(String, unique=True, index=True)  # FC-001
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    category = Column(String)  # Housekeeping, Electrical, Plumbing, AC, Cafeteria, Other
    description = Column(Text)
    location = Column(String)
    priority = Column(String, default="Medium")  # Low, Medium, High, Critical
    status = Column(String, default="Open")  # Open, In Progress, Resolved, Closed
    assigned_to = Column(String, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

class FoodVendorFeedback(Base):
    __tablename__ = "food_vendor_feedback"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    vendor_name = Column(String)
    rating = Column(Integer)  # 1-5
    food_quality = Column(Integer)  # 1-5
    hygiene = Column(Integer)  # 1-5
    service = Column(Integer)  # 1-5
    comments = Column(Text, nullable=True)
    date = Column(Date, default=datetime.date.today)

# ── IT Support Domain ─────────────────────
class ITTicket(Base):
    __tablename__ = "it_tickets"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(String, unique=True, index=True)  # IT-001
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    category = Column(String)  # Software Install, Hardware, Network, Access, Security
    subject = Column(String)
    description = Column(Text)
    priority = Column(String, default="Medium")
    status = Column(String, default="Open")  # Open, Awaiting Approval, In Progress, Resolved, Closed
    assigned_to = Column(String, nullable=True)
    requires_admin_password = Column(Boolean, default=False)
    admin_password_provided = Column(Boolean, default=False)
    resolution_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

class SoftwareRequest(Base):
    __tablename__ = "software_requests"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    it_ticket_id = Column(Integer, ForeignKey(f"{SCHEMA}.it_tickets.id"))
    software_name = Column(String)
    version = Column(String, nullable=True)
    justification = Column(Text)
    requires_admin = Column(Boolean, default=True)
    status = Column(String, default="Pending")  # Pending, Approved, Installed, Rejected
    approved_by = Column(String, nullable=True)
    installed_at = Column(DateTime, nullable=True)

class AssetAssignment(Base):
    __tablename__ = "asset_assignments"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    asset_type = Column(String)  # Laptop, Monitor, Keyboard, Mouse, Headset
    asset_tag = Column(String, unique=True)
    brand = Column(String)
    model = Column(String)
    serial_number = Column(String)
    assigned_date = Column(Date)
    returned_date = Column(Date, nullable=True)
    status = Column(String, default="Assigned")  # Assigned, Returned


# ── Software Catalog (ManageEngine Endpoint Central packages) ─────────────────
class SoftwareCatalog(Base):
    __tablename__ = "software_catalog"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False, index=True)
    version = Column(String, nullable=True)
    category = Column(String, nullable=True)          # productivity, development, communication…
    endpoint_central_package_id = Column(String, nullable=True)  # ME package ID
    installer_hash = Column(String, nullable=True)    # SHA-256 for verification
    auto_approve = Column(Boolean, default=False)     # skip IT approval for low-risk apps
    requires_license = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    requests = relationship("InstallationRequest", back_populates="software")


# ── Installation Requests ─────────────────────────────────────────────────────
class InstallationRequest(Base):
    __tablename__ = "installation_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=False)
    software_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.software_catalog.id"), nullable=False)
    machine_hostname = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    # pending / approved / rejected / deploying / deployed / failed
    status = Column(String, default="pending", nullable=False)
    requested_at = Column(DateTime, default=datetime.datetime.utcnow)
    reviewed_by = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    deployment_job_id = Column(String, nullable=True)   # ME job ID
    deployed_at = Column(DateTime, nullable=True)
    deployment_log = Column(Text, nullable=True)
    approval_token = Column(String, unique=True, nullable=True, index=True)
    approval_expires_at = Column(DateTime, nullable=True)

    employee = relationship("Employee", foreign_keys=[employee_id])
    reviewer = relationship("Employee", foreign_keys=[reviewed_by])
    software = relationship("SoftwareCatalog", back_populates="requests")


# ── Prompt Config (Role-Based) ────────────
class PromptConfig(Base):
    __tablename__ = "prompt_configs"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    agent_domain = Column(String)  # hr, admin, it_support, pmo, functional_manager
    prompt_key = Column(String)  # system_prompt, tool_instruction, guardrail
    prompt_value = Column(Text)
    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    allowed_roles = Column(String)  # comma separated: admin,hr_manager,it_admin
    created_by = Column(String)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

# ── Employee Allocation (from Allocation Data.xlsx) ───────────────────────────
class EmployeeAllocation(Base):
    __tablename__ = "employee_allocations"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    zoho_record_id = Column(String, unique=True, nullable=True, index=True)
    employee_id = Column(String, index=True)            # e.g. "AA-001"
    employee_name = Column(String, index=True)
    project_name = Column(String, index=True)
    sub_project = Column(String, nullable=True)
    project_lead = Column(String, nullable=True)
    delivery_manager = Column(String, nullable=True)
    completion_status = Column(String, nullable=True)   # Active / Completed
    efforts_percent = Column(Float, nullable=True)
    billability_percent = Column(Float, nullable=True)
    allocation_date = Column(Date, nullable=True)
    project_status = Column(String, nullable=True)
    client_master = Column(String, nullable=True)
    billing = Column(String, nullable=True)
    project_type = Column(String, nullable=True)
    reporting_manager = Column(String, nullable=True)
    functional_manager = Column(String, nullable=True)
    function = Column(String, nullable=True)
    status = Column(String, nullable=True)              # Active / Inactive
    expected_end_date = Column(Date, nullable=True)     # set by approved biweekly project-update drafts
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


# ── Biweekly Project-Update Submission (audited draft → main allocation) ──────
class ProjectUpdateSubmission(Base):
    """An employee's biweekly self-report of what they're working on.

    This is an AUDITED DRAFT — it never writes to employee_allocations directly.
    It becomes real allocation data only after the Reporting Manager approves it
    (see app.main._finalize_decision, entity_type="project_update").
    """
    __tablename__ = "project_update_submissions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, index=True)           # employees.id
    employee_email = Column(String, index=True)
    employee_name = Column(String)
    period_start = Column(Date, nullable=True)          # the fortnight covered
    period_end = Column(Date, nullable=True)
    activity_type = Column(String)                      # Project | Learning | PoC (PMO-configurable)
    project_name = Column(String, nullable=True)        # required when activity_type == "Project"
    expected_end_date = Column(Date, nullable=True)     # parsed "how long" answer
    duration_text = Column(String, nullable=True)       # free-text "how long" answer
    details = Column(Text, nullable=True)
    # audit: who filled
    filled_by_email = Column(String)
    filled_at = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String, default="submitted")        # submitted | approved | rejected
    # audit: who approved
    approved_by_email = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    decision_reason = Column(Text, nullable=True)
    allocation_id = Column(Integer, nullable=True)      # employee_allocations row written on approval
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


# ── Prompt Drafts (pending approval workflow) ─────────────────────────────────
class PromptDraft(Base):
    __tablename__ = "prompt_drafts"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    agent_domain = Column(String)           # hr, admin, it_support, pmo
    prompt_key = Column(String)             # system_prompt, guardrail
    draft_value = Column(Text)
    submitted_by = Column(String)           # submitter email
    status = Column(String, default="pending")  # pending, approved, rejected
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ── HITL Tracking ─────────────────────────
class HITLRequest(Base):
    __tablename__ = "hitl_requests"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(String)
    ticket_id = Column(String)  # Reference to it_tickets.ticket_id
    request_type = Column(String)  # software_approval, escalation
    status = Column(String, default="Pending")  # Pending, Completed, Expired
    requested_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String, nullable=True)


# ── Extended ZOHO Employee Profile (non-sensitive fields only) ────────────────
class EmployeeZohoProfile(Base):
    """Safe ZOHO fields synced from HRMS — no salary, bank, or ID document data."""
    __tablename__ = "employee_zoho_profiles"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), unique=True)
    zoho_link_id = Column(String, unique=True, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    official_email = Column(String, nullable=True, index=True)
    function = Column(String, nullable=True)
    designation = Column(String, nullable=True)
    zoho_role = Column(String, nullable=True)
    employment_type = Column(String, nullable=True)
    employee_status = Column(String, nullable=True)
    source_of_hire = Column(String, nullable=True)
    date_of_joining = Column(Date, nullable=True)
    date_of_confirmation = Column(Date, nullable=True)
    tenure_in_aa = Column(String, nullable=True)
    total_experience = Column(String, nullable=True)
    reporting_manager = Column(String, nullable=True)
    age = Column(Integer, nullable=True)
    gender = Column(String, nullable=True)
    about_me = Column(Text, nullable=True)
    blood_group = Column(String, nullable=True)
    expertise = Column(Text, nullable=True)          # "Ask me about / Expertise"
    work_phone = Column(String, nullable=True)
    extension = Column(String, nullable=True)
    sub_location = Column(String, nullable=True)
    tags = Column(String, nullable=True)
    onboarding_status = Column(String, nullable=True)
    organization_structure = Column(String, nullable=True)
    level = Column(String, nullable=True)
    grade = Column(String, nullable=True)
    skill_set = Column(Text, nullable=True)
    functional_manager = Column(String, nullable=True)
    language_known = Column(String, nullable=True)
    resource_management_function = Column(String, nullable=True)
    project_manager = Column(String, nullable=True)
    project_manager_2 = Column(String, nullable=True)
    role = Column(String, nullable=True)
    date_for_360_feedback = Column(Date, nullable=True)
    nationality = Column(String, nullable=True)
    active_details = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


# ── Announcements (HR / Admin / IT / Manager) ─────────────────────────────────
class Announcement(Base):
    __tablename__ = "announcements"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    category = Column(String, default="General")  # Policy Update, Holiday, Events, Hiring, Training, General, IT Alert
    created_by = Column(String)                   # creator email
    created_by_domain = Column(String)            # hr, admin, it_support, functional_manager
    target_audience = Column(String, default="all")
    is_active = Column(Boolean, default=True)
    image_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)


# ── Food / Cafeteria Complaints (distinct from star-rating feedback) ──────────
class FoodComplaint(Base):
    __tablename__ = "food_complaints"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(String, unique=True, index=True, nullable=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    vendor_name = Column(String)
    complaint_type = Column(String)  # Quality, Hygiene, Pricing, Variety, Service, Foreign Object, Other
    description = Column(Text)
    status = Column(String, default="Open")  # Open, Acknowledged, Resolved, Closed
    closure_comment = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)



class ApprovalToken(Base):
    """One-time click-to-approve/reject token emailed to managers."""
    __tablename__ = "approval_tokens"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    entity_type = Column(String(20))   # leave | reimbursement
    entity_id = Column(Integer)
    action = Column(String(10))        # approve | reject
    approver_email = Column(String)
    employee_email = Column(String)
    used = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Grievance(Base):
    """HR grievance / complaint submitted by employees."""
    __tablename__ = "grievances"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(String, unique=True, index=True)      # GRV-001
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=True)
    category = Column(String)   # Harassment, Discrimination, Safety, Manager Conduct, Compensation, Workplace Culture, Other
    description = Column(Text)
    is_anonymous = Column(Boolean, default=False)
    status = Column(String, default="Open")   # Open, Under Review, Resolved, Closed
    resolved_by = Column(String, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)


class ChatFeedback(Base):
    __tablename__ = "chat_feedback"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, nullable=True, index=True)
    domain = Column(String, nullable=True)          # hr, admin, it_support, pmo, functional_manager, general
    user_message = Column(Text, nullable=True)
    ai_response = Column(Text, nullable=True)
    rating = Column(Integer, nullable=True)          # 1 = thumbs up / helpful, -1 = thumbs down / unhelpful
    feedback_text = Column(String, nullable=True)   # optional free-text comment
    user_message_embedding = Column(Vector(768), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class CachedAnswer(Base):
    """Semantic answer cache: a previously-answered informational question + its final answer.
    Looked up by embedding similarity so near-identical repeat questions return instantly with
    zero LLM calls. Only informational answers are ever stored (never actions/widgets/drafts) —
    that store-side filter is what makes lookups inherently safe. Policy-derived rows carry
    source_keys so they can be invalidated the moment the underlying SharePoint doc changes.
    """
    __tablename__ = "cached_answers"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    query_text = Column(Text, nullable=False)
    query_embedding = Column(Vector(768), nullable=True)
    answer_text = Column(Text, nullable=False)
    domain = Column(String, nullable=True, index=True)       # hr, admin, it_support, pmo, general
    sub_intent = Column(String, nullable=True)
    source_keys = Column(JSON, nullable=True)                # list of Policy.source_key used to build answer
    is_seed = Column(Boolean, default=False)                 # True for curated warm-FAQ entries
    hit_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.datetime.utcnow)


class RouterExample(Base):
    """Labeled seed utterance for the embedding-based semantic intent router.

    Each row is one example phrasing mapped to a (domain, sub_intent). At route time the
    incoming message is embedded and matched against these by pgvector cosine similarity —
    the nearest neighbours decide the domain. Because the output space is the closed set of
    stored labels, the router structurally cannot hallucinate a domain the way the generative
    LLM router can. New phrasings are added as rows (data), not regexes (code), and a confirmed
    misroute can be corrected by inserting the corrected example — reusing ChatFeedback's
    already-stored message embedding for zero re-embed.

    NOTE: this stores example *phrasings* only, never *answers*. It changes which agent runs,
    not how that agent answers — live Zoho/API calls, announcements, and prompt configs are
    all downstream of routing and unaffected.
    """
    __tablename__ = "router_examples"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    utterance = Column(Text, nullable=False)
    # Normalised (lowercased/whitespace-collapsed) form — idempotency key for upserts.
    utterance_norm = Column(String, unique=True, index=True, nullable=False)
    embedding = Column(Vector(768), nullable=True)
    domain = Column(String, nullable=False, index=True)      # hr, admin, it_support, pmo, functional_manager, ms365, deeplink, general
    sub_intent = Column(String, nullable=False)
    entities = Column(JSON, nullable=True)                    # template entities for this intent (usually empty)
    source = Column(String, default="seed")                  # seed | kw | prompt | feedback | manual
    is_active = Column(Boolean, default=True, index=True)     # soft-disable a bad seed without deleting
    weight = Column(Float, default=1.0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AppLink(Base):
    """Admin-curated external app / website / portal that Centriq can point users to.

    Each row is a tool the company offers (travel desk, expense portal, a newly-launched
    internal app, etc.) with its purpose + capabilities. The combined text is embedded once,
    and at chat time a user's query is matched by pgvector cosine similarity — so a brand-new
    app becomes discoverable the moment an admin adds a row, with no code change. The link is
    surfaced two ways: the general agent's find_apps tool (explicit asks) and a proactive
    nudge injected into feedback_context for any agent (mid-conversation mentions).
    """
    __tablename__ = "app_links"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    url = Column(String, nullable=False)
    purpose = Column(Text, nullable=False)                   # what it's for
    capabilities = Column(Text, nullable=True)               # what it can do (free text)
    embedding = Column(Vector(768), nullable=True)           # of name + purpose + capabilities
    is_active = Column(Boolean, default=True, index=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class LeaveBalanceCache(Base):
    """Stores the most recent leave balance scraped from Zoho People for each user.
    Refreshed in the background every LEAVE_BALANCE_SYNC_INTERVAL_SECONDS (default 30 min).
    """
    __tablename__ = "leave_balance_cache"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    # Full balance list: [{"type": "Casual Leave", "total": 12, "used": 3, "balance": 9}, ...]
    balances_json = Column(JSON, nullable=True)
    # Raw page text — fallback when structured scrape fails, LLM can parse it
    raw_text = Column(Text, nullable=True)
    # "ok" | "session_expired" | "error"
    sync_status = Column(String, default="ok")
    sync_error = Column(Text, nullable=True)
    last_synced_at = Column(DateTime, default=datetime.datetime.utcnow)


class ConversationSummary(Base):
    """Medium-term memory: persisted summary of older conversation turns.
    Created by context_manager_node when the message window exceeds ~6000 tokens.
    Keyed by LangGraph thread_id so it survives Redis restarts.
    """
    __tablename__ = "conversation_summaries"
    __table_args__ = {"schema": SCHEMA}

    thread_id = Column(String, primary_key=True)
    summary = Column(Text, nullable=False)
    domain = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class UserMemory(Base):
    """Long-term memory: persistent facts about individual users.
    Written by remember_user_fact tool; retrieved semantically by memory_retriever_node.
    E.g. "user's laptop is Dell XPS 15", "user prefers WFH on Fridays".
    """
    __tablename__ = "user_memories"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True)
    user_email = Column(String, index=True, nullable=False)
    fact = Column(Text, nullable=False)
    embedding = Column(Vector(768), nullable=True)
    domain = Column(String, nullable=True)  # "it_support", "hr", etc.
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_accessed_at = Column(DateTime, default=datetime.datetime.utcnow)


class ToolSession(Base):
    """Tracks per-user connection status for external tool integrations.
    Playwright tools (Zoho, PowerApps) need a browser session; Graph API tools are always ready.
    """
    __tablename__ = "tool_sessions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True)
    user_email = Column(String, index=True, nullable=False)
    tool_name = Column(String, nullable=False)      # "zoho", "powerapps", "room_booking"
    session_path = Column(String, nullable=True)    # filesystem path for playwright sessions
    # not_connected | connecting | active | expired
    status = Column(String, default="not_connected")
    connected_at = Column(DateTime, nullable=True)
    last_used_at = Column(DateTime, nullable=True)


# ── Observability / Activity Logs ────────────────────────────────────────────

class ConnectedAccount(Base):
    """OAuth2 tokens for user-connected external services (Microsoft, Zoho).
    Tokens are Fernet-encrypted at rest. The backend refreshes them transparently.
    """
    __tablename__ = "connected_accounts"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    provider = Column(String, nullable=False)              # "microsoft" | "zoho"
    access_token_enc = Column(Text, nullable=True)         # Fernet-encrypted
    refresh_token_enc = Column(Text, nullable=True)        # Fernet-encrypted
    token_expires_at = Column(DateTime, nullable=True)
    scopes = Column(Text, nullable=True)                   # space-separated scopes granted
    provider_user_id = Column(String, nullable=True)       # e.g. Microsoft OID
    provider_email = Column(String, nullable=True)         # email from the provider
    status = Column(String, default="active")              # active | expired | revoked
    connected_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


# ── Internal Leave Management ────────────────────────────────────────────────

class LeaveType(Base):
    """Configurable leave types with annual entitlements."""
    __tablename__ = "leave_types"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)         # "Casual Leave"
    code = Column(String, unique=True, nullable=False)         # "CL"
    annual_entitlement = Column(Float, nullable=True)          # 12 (None = unlimited for LWP)
    is_earned = Column(Boolean, default=False)                 # True for Comp Off
    is_active = Column(Boolean, default=True)
    carry_forward = Column(Boolean, default=False)
    max_consecutive_days = Column(Integer, nullable=True)


class LeaveBalance(Base):
    """Per-employee, per-leave-type, per-year balance tracking."""
    __tablename__ = "leave_balances"
    __table_args__ = (
        UniqueConstraint("employee_id", "leave_type_id", "year", name="uq_emp_lt_year"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=False, index=True)
    leave_type_id = Column(Integer, ForeignKey(f"{SCHEMA}.leave_types.id"), nullable=False)
    year = Column(Integer, nullable=False)
    entitled = Column(Float, default=0)                        # Annual allocation
    used = Column(Float, default=0)                            # Approved leaves consumed
    balance = Column(Float, default=0)                         # entitled - used
    earned = Column(Float, default=0)                          # For Comp Off — earned credits


# ── HR Query System (replaces Zoho Cases) ────────────────────────────────────

class HRQuery(Base):
    """Employee HR queries — replaces Zoho People's case/query module."""
    __tablename__ = "hr_queries"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(String, unique=True, index=True, nullable=False)   # "HRQ-001"
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=False)
    category = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String, default="Open")                    # Open, In Progress, Resolved, Closed
    priority = Column(String, default="Normal")                # Low, Normal, High
    response = Column(Text, nullable=True)
    responded_by = Column(String, nullable=True)
    responded_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ── Bookshelf Buddy ──────────────────────────────────────────────────────────

class Book(Base):
    __tablename__ = "books"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False, index=True)
    author = Column(String, nullable=True)
    category = Column(String, nullable=True)          # Technology, Management, Fiction, etc.
    description = Column(Text, nullable=True)
    total_copies = Column(Integer, default=1)
    available_copies = Column(Integer, default=1)
    status = Column(String, default="Active")         # Active, Inactive
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    requests = relationship("BookRequest", back_populates="book")


class BookRequest(Base):
    __tablename__ = "book_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(String, unique=True, index=True, nullable=False)  # BK-MMDDHHmmss
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=False)
    book_id = Column(Integer, ForeignKey(f"{SCHEMA}.books.id"), nullable=False)
    request_type = Column(String, default="Issue")     # Issue, Return
    status = Column(String, default="Pending")         # Pending, Approved, Rejected, Returned, Cancelled
    notes = Column(Text, nullable=True)
    admin_remarks = Column(Text, nullable=True)
    requested_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    due_date = Column(Date, nullable=True)             # Expected return date when issued

    employee = relationship("Employee")
    book = relationship("Book", back_populates="requests")


# ── Observability / Activity Logs ────────────────────────────────────────────

class AiRequestLog(Base):
    """One row per /api/chat request — powers the CloudTrail-style log viewer."""
    __tablename__ = "ai_request_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, index=True)
    user_email = Column(String, index=True)
    user_message = Column(Text)
    domain = Column(String, index=True)                     # HR, IT, Admin, PMO, General
    sub_intent = Column(String, nullable=True)
    route_method = Column(String, nullable=True)            # keyword / llm / sticky / fast_path
    response_text = Column(Text, nullable=True)             # truncated to 2000 chars
    response_length = Column(Integer, default=0)
    total_latency_ms = Column(Integer, default=0)
    llm_call_count = Column(Integer, default=0)
    total_prompt_tokens = Column(Integer, default=0)
    total_completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    model_name = Column(String, nullable=True)              # primary model used
    error = Column(Text, nullable=True)
    langfuse_trace_id = Column(String, nullable=True)       # link to Langfuse trace
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    llm_calls = relationship("AiLlmCallLog", back_populates="request", cascade="all, delete-orphan")


class AiLlmCallLog(Base):
    """One row per LLM invocation within a chat request."""
    __tablename__ = "ai_llm_call_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey(f"{SCHEMA}.ai_request_logs.id", ondelete="CASCADE"), index=True)
    node = Column(String, index=True)                       # LangGraph node name
    model = Column(String)
    duration_ms = Column(Integer, default=0)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    is_tool_call = Column(Boolean, default=False)
    tool_names = Column(String, nullable=True)              # comma-separated
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    request = relationship("AiRequestLog", back_populates="llm_calls")


class GeneratedDocument(Base):
    """One row per generated letter/document (NOC, experience cert, project proposal, etc.).

    Stores the finalised letter text so the PDF can be rebuilt on download, and records
    who it was generated for (subject) vs who generated it (actor) for audit. Non-HR
    self-serve docs are marked is_official=False and carry a draft watermark on download."""
    __tablename__ = "generated_documents"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    doc_type = Column(String, index=True)              # no_objection_certificate, experience_certificate, ...
    title = Column(String)
    subject_email = Column(String, index=True)         # employee the document is about
    subject_name = Column(String)
    generated_by_email = Column(String, index=True)    # who clicked generate
    is_official = Column(Boolean, default=False)        # mirror of status == "verified" (kept for back-compat)
    status = Column(String, default="draft", index=True)  # draft | verified
    verify_token = Column(String, unique=True, index=True)  # unguessable token for the public verify page
    verified_by_email = Column(String, nullable=True)  # HR/Admin who approved & released
    verified_at = Column(DateTime, nullable=True)
    purpose = Column(Text, nullable=True)
    additional_info = Column(Text, nullable=True)
    content = Column(Text, nullable=True)              # rendered preview HTML (source for /verify page + on-screen preview)
    field_values = Column(JSON, nullable=True)         # filled placeholder values {field: value} for audit/re-render
    rendered_docx = Column(LargeBinary, nullable=True) # the filled .docx (immutable issued artifact; Word→PDF on download)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class DocumentTemplate(Base):
    """A document template synced from a SharePoint folder of plain PDF/DOCX files.

    Each source file becomes one generatable document type. The file is converted to
    HTML once at sync time and an LLM tags the fill-in spots as ``{{field}}`` tokens
    (HR reviews/edits the detected fields). At generation time the app does a
    deterministic placeholder merge — no LLM — auto-filling employee-known fields and
    prompting the user for the rest. HR controls the catalogue (enable/disable, label,
    whether the type needs approval) via the fields below; these survive re-sync."""
    __tablename__ = "document_templates"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    doc_type = Column(String, index=True)              # slug derived from the filename stem
    label = Column(String)                             # HR-editable display label
    source_key = Column(String, unique=True, index=True)   # sp:<TemplatesFolder>/<relative_path>
    source_etag = Column(String, nullable=True)        # Graph cTag for change detection
    filename = Column(String)
    source_format = Column(String, nullable=True)      # docx (Word source authored by HR)
    html_template = Column(Text, nullable=True)        # mammoth preview HTML of the blank template (for the admin panel)
    template_blob = Column(LargeBinary, nullable=True) # raw .docx bytes — the source rendered by docxtpl at generation
    fields = Column(JSON, nullable=True)               # [{name,label,type,required,source,options?}]
    enabled = Column(Boolean, default=False, index=True)   # SharePoint-synced templates are enabled on sync
    requires_approval = Column(Boolean, default=True)  # approval-gated vs auto-release
    setup_status = Column(String, default="needs_review")  # needs_review | ready
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class FormTemplate(Base):
    """An admin-defined fillable form (visitor pass, parking request, desk booking, …).

    The whole point: admins create a new form — name, description, and an arbitrary list of
    fields — from the Form Library page, with ZERO code change. The name + description + field
    labels are embedded once; at chat time a user's message is matched against those embeddings
    by pgvector cosine similarity, and a confident match short-circuits the router to render the
    form inline in chat. The user fills it and submits → a FormSubmission row.

    Mirrors AppLink's embed-once / cosine-k-NN discovery and DocumentTemplate's JSON field shape.
    """
    __tablename__ = "form_templates"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=False)               # what it's for — also matched against queries
    category = Column(String, nullable=True)                 # free-text grouping (HR, Admin, Facilities…)
    fields = Column(JSON, nullable=True)                     # [{name,label,type,required,options?,placeholder?}]
    embedding = Column(Vector(768), nullable=True)           # of name + description + category + field labels
    enabled = Column(Boolean, default=True, index=True)      # disable to pull a form out of chat without deleting
    notify_email = Column(String, nullable=True)             # explicit recipient for new submissions
    notify_domain = Column(String, nullable=True)            # fallback recipient by domain (admin/hr/…)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    submissions = relationship("FormSubmission", back_populates="template", cascade="all, delete-orphan")


class FormSubmission(Base):
    """A user's filled-in submission of a FormTemplate.

    Generic capture: the field values are stored as JSON (keyed by field name) rather than
    mapped to bespoke columns, so any form — current or future — persists the same way. Admins
    review submissions in the Form Library Submissions tab (Approve/Reject)."""
    __tablename__ = "form_submissions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(String, unique=True, index=True)   # FRM-<MMDDHHMMSS>
    form_template_id = Column(Integer, ForeignKey(f"{SCHEMA}.form_templates.id"), index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=True)
    employee_email = Column(String, index=True)
    field_values = Column(JSON, nullable=True)               # {field_name: submitted_value}
    status = Column(String, default="Pending", index=True)   # Pending | Approved | Rejected
    admin_remarks = Column(Text, nullable=True)
    reviewed_by = Column(String, nullable=True)
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    template = relationship("FormTemplate", back_populates="submissions")


class ContentRevealAudit(Base):
    """Audit trail for revealing conversation content. One row per actual view. Access is
    gated by Azure AD group membership (validated server-side); this records who saw whose
    conversation, for which domain, and why."""
    __tablename__ = "content_reveal_audits"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    request_log_id = Column(Integer, ForeignKey(f"{SCHEMA}.ai_request_logs.id", ondelete="CASCADE"), index=True)
    viewer_email = Column(String, index=True)
    viewer_oid = Column(String, nullable=True)               # Azure AD object id (when JWT-validated)
    domain = Column(String)                                  # domain of the revealed log
    reason = Column(Text)                                    # required justification
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class MS365User(Base):
    """Azure AD / Microsoft 365 user directory synced via Graph API."""
    __tablename__ = "ms365_users"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    azure_id = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    job_title = Column(String, nullable=True)
    department = Column(String, nullable=True)
    office_location = Column(String, nullable=True)
    # Richer profile fields (require User.Read.All)
    employee_id = Column(String, nullable=True)
    employee_type = Column(String, nullable=True)
    company_name = Column(String, nullable=True)
    mobile_phone = Column(String, nullable=True)
    business_phone = Column(String, nullable=True)
    city = Column(String, nullable=True)
    state = Column(String, nullable=True)
    country = Column(String, nullable=True)
    account_enabled = Column(Boolean, nullable=True)
    hire_date = Column(DateTime, nullable=True)
    # Reporting hierarchy from Azure AD (manager relationship)
    manager_email = Column(String, nullable=True)
    manager_name = Column(String, nullable=True)
    synced_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class EmployeeSkill(Base):
    """A skill held by an employee, paired with its certification. Child of Employee."""
    __tablename__ = "employee_skills"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id", ondelete="CASCADE"), index=True, nullable=False)
    skill = Column(String, nullable=False)
    certification = Column(String, nullable=True)        # certification title/name (text)
    is_primary = Column(Boolean, default=False)          # the employee's primary skill (at most one)
    years_experience = Column(Float, nullable=True)      # years of experience in this skill
    last_used = Column(Date, nullable=True)              # when the skill was last used
    cert_file_data = Column(LargeBinary, nullable=True)  # uploaded certification image/PDF
    cert_file_name = Column(String, nullable=True)
    cert_content_type = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    employee = relationship("Employee", back_populates="skills")


class UdemyLicenseRequest(Base):
    """Employee request for a training-platform license (Udemy, Coursera, …),
    managed by the PMO team (granted subject to availability)."""
    __tablename__ = "udemy_license_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), index=True)
    platform = Column(String, default="Udemy")        # Udemy, Coursera, …
    course_name = Column(String, nullable=True)
    justification = Column(Text, nullable=True)
    status = Column(String, default="Pending")       # Pending, Approved, Rejected
    decided_by = Column(String, nullable=True)
    decision_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)


class DeskKeyRequest(Base):
    """Employee request for a desk key. Auto-rejected if the desk is already assigned."""
    __tablename__ = "desk_key_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), index=True)
    desk_number = Column(String, index=True)
    status = Column(String, default="Pending")       # Pending, Approved, Rejected, Auto-Rejected, Released
    reason = Column(Text, nullable=True)
    decided_by = Column(String, nullable=True)
    decision_reason = Column(Text, nullable=True)
    assigned_at = Column(DateTime, nullable=True)
    released_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class ParkingPayment(Base):
    """Monthly parking-due ledger: one row per sticker holder per calendar month."""
    __tablename__ = "parking_payments"
    __table_args__ = (
        UniqueConstraint("employee_id", "period_month", name="uq_parking_payment_emp_month"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), index=True)
    parking_sticker_id = Column(Integer, ForeignKey(f"{SCHEMA}.parking_stickers.id"), nullable=True)
    period_month = Column(Date, index=True)          # first day of the month the charge is for
    vehicle_type = Column(String)                    # 2-wheeler, 4-wheeler
    amount_due = Column(Float, default=0.0)
    amount_paid = Column(Float, default=0.0)
    status = Column(String, default="Due")           # Due, Paid, Closed
    paid_at = Column(DateTime, nullable=True)
    closed_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class UserRoleOverride(Base):
    """Super Admin-managed role assignments that override Azure AD token claims.
    One row per user — upserted via the Access Management page."""
    __tablename__ = "user_role_overrides"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    role = Column(String, nullable=False)            # e.g. "admin", "hr", "it", "pmo", "functional manager"
    scopes = Column(JSON, nullable=True)             # Optional feature-level scopes; None/[] = full role access
    granted_by = Column(String, nullable=True)       # Super Admin's email
    granted_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


# ── Automation Hub ─────────────────────────────────────────────────────────────

class Escalation(Base):
    """User-raised escalation when the assistant couldn't resolve their query.

    Created when a user clicks "Escalate" after an error or thumbs-down feedback.
    The backend notifies the responsible department by email and records the ticket
    here for admin review.
    """
    __tablename__ = "escalations"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(String, unique=True, index=True, nullable=False)  # ESC-001
    user_email = Column(String, index=True, nullable=False)
    user_name = Column(String, nullable=True)
    domain = Column(String, nullable=True, index=True)         # hr, admin, it_support, pmo, general
    original_query = Column(Text, nullable=True)               # the message that failed
    error_type = Column(String, nullable=True)                 # "error" | "no_response" | "unsatisfied"
    description = Column(Text, nullable=True)                  # user-provided extra context
    priority = Column(String, default="Medium")                # Low, Medium, High
    status = Column(String, default="Open", index=True)        # Open, Acknowledged, Resolved
    session_id = Column(String, nullable=True, index=True)
    notified_to = Column(String, nullable=True)                # email address that was notified
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class AutomationRule(Base):
    """A recurring email automation created by HR/Admin/PMO/IT/FM/SuperAdmin.

    The startup scheduler fires any active rule whose next_run <= now (see
    automation_service.run_due). The email is sent from the creator's mailbox
    using their stored Microsoft OAuth delegated token.
    """
    __tablename__ = "automation_rules"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_by = Column(String, index=True, nullable=False)   # creator email (also the sender)
    created_by_role = Column(String, nullable=False)          # role at creation time

    # Schedule
    frequency = Column(String, nullable=False)                # daily | weekly | monthly | custom
    day_of_week = Column(Integer, nullable=True)              # 0=Mon .. 6=Sun (weekly / custom)
    day_of_month = Column(Integer, nullable=True)             # 1..28 (monthly / custom)
    hour = Column(Integer, default=9)                         # local hour of day, 0..23

    # Email
    email_subject = Column(String, nullable=False)
    email_body = Column(Text, nullable=False)                 # plain text; wrapped in branded shell at send

    # Recipients JSON array: [{type: "individual", email: "x@y.com", name: "..."} |
    #                          {type: "teams_group", id: "...", name: "...", emails: [...]}]
    recipients_json = Column(JSON, default=list)

    # State
    is_active = Column(Boolean, default=True, index=True)
    next_run = Column(DateTime, nullable=True, index=True)
    last_run = Column(DateTime, nullable=True)
    last_status = Column(String, nullable=True)               # sent | failed:<reason>
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class WelcomeResource(Base):
    """HR-editable list of resources sent in the new-employee welcome email."""
    __tablename__ = "welcome_resources"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    url = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)  # App Guide | HR | Policy | IT | Admin | Facilities
    icon = Column(String, nullable=True)      # emoji
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class WelcomeLog(Base):
    """Tracks HR confirmation emails sent for new employees."""
    __tablename__ = "welcome_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_email = Column(String, nullable=False, index=True)
    employee_name = Column(String, nullable=False)
    send_token = Column(String(64), unique=True, index=True, nullable=False)
    skip_token = Column(String(64), unique=True, index=True, nullable=False)
    status = Column(String, default="pending_hr")  # pending_hr | welcome_sent | skipped
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    acted_at = Column(DateTime, nullable=True)
    acted_by = Column(String, nullable=True)


