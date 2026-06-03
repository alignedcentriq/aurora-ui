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
    name = Column(String)
    email = Column(String, unique=True, index=True)
    department = Column(String)
    designation = Column(String)
    manager_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=True)
    joining_date = Column(Date)
    employment_type = Column(String) # Full-time, Contract
    pf_number = Column(String)
    insurance_plan = Column(String)
    tax_regime = Column(String) # Old, New
    shift_type = Column(String) # Day, Night
    
    # Relationships
    leaves = relationship("Leave", back_populates="employee")
    attendance = relationship("Attendance", back_populates="employee")

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


