from sqlalchemy import Column, Integer, String, Date, Float, ForeignKey, Text, DateTime, Boolean, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
import datetime

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
    # MinIO source tracking for incremental sync
    minio_key = Column(String, nullable=True, unique=True)   # e.g. "admin/Leave Policy.pdf"
    minio_etag = Column(String, nullable=True)               # S3 ETag; changes when file changes


class PolicyChunk(Base):
    """Each row is one chunk of a Policy document, optionally with an embedding vector."""
    __tablename__ = "policy_chunks"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(Integer, ForeignKey(f"{SCHEMA}.policies.id", ondelete="CASCADE"), index=True, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    embedding = Column(Vector(768), nullable=True)
    image_urls = Column(JSON, nullable=True)  # list of MinIO object keys for images near this chunk
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
