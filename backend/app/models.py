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
    created_at = Column(DateTime, nullable=True, default=datetime.datetime.utcnow)  # record creation time (null for pre-existing rows)

    # Relationships
    leaves = relationship("Leave", back_populates="employee")
    attendance = relationship("Attendance", back_populates="employee")
    skills = relationship("EmployeeSkill", back_populates="employee", cascade="all, delete-orphan")

class Leave(Base):
    __tablename__ = "leaves"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    leave_type = Column(String)
    start_date = Column(Date)
    end_date = Column(Date)
    days = Column(Float, nullable=True)
    status = Column(String, default="Pending")
    reason = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    zoho_id = Column(String, unique=True, nullable=True)

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
    minute = Column(Integer, default=0)     # minute of hour, 0..59
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


# ── Project IQ (Project DNA) ──────────────────────────────
# Structured, reusable per-project profiles ("Project DNA") extracted by LLM from
# the SharePoint "Project Showcase" corpus (transcripts + project files already
# ingested into Policy/PolicyChunk, keyed sp:PROJECT/{slug}/...). Internal-only:
# powers Find-Similar-Projects, Lessons Learned, Expertise matching, Reusable-Asset
# discovery. Every extracted fact carries confidence (verified|inferred); profiles
# start review_status='draft' until a PMO/admin reviews them.

class ProjectProfile(Base):
    __tablename__ = "project_profiles"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    project_slug = Column(String, unique=True, nullable=False, index=True)  # matches sp:PROJECT/{slug}/
    name = Column(String, nullable=False, index=True)
    client_industry = Column(String, nullable=True)
    status = Column(String, nullable=True)
    business_problem = Column(Text, nullable=True)
    solution_summary = Column(Text, nullable=True)
    business_outcomes = Column(Text, nullable=True)
    technology_stack = Column(JSON, nullable=True)        # list[str]
    architecture_summary = Column(Text, nullable=True)
    complexity_drivers = Column(JSON, nullable=True)      # list[str]
    project_size = Column(String, nullable=True)
    team_size = Column(String, nullable=True)
    delivery_start_date = Column(String, nullable=True)
    delivery_end_date = Column(String, nullable=True)
    dna_summary = Column(Text, nullable=True)             # text fed to the embedder
    lineage_summary = Column(Text, nullable=True)         # contextual origins/roots
    related_projects = Column(JSON, nullable=True)        # list[str] of related project slugs/names
    reference_docs = Column(JSON, nullable=True)          # list[str] of architecture/policy dependencies
    embedding = Column(Vector(768), nullable=True)
    confidence = Column(String, default="inferred")       # verified | inferred (overall)
    review_status = Column(String, default="draft")       # draft | reviewed
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    source_doc_count = Column(Integer, default=0)
    query_count = Column(Integer, default=0)            # times surfaced via search/tools (triage signal)
    last_queried_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    capabilities = relationship("ProjectCapability", back_populates="profile", cascade="all, delete-orphan")
    integrations = relationship("ProjectIntegration", back_populates="profile", cascade="all, delete-orphan")
    lessons = relationship("ProjectLesson", back_populates="profile", cascade="all, delete-orphan")
    reusable_assets = relationship("ProjectReusableAsset", back_populates="profile", cascade="all, delete-orphan")
    expertise = relationship("ProjectExpertise", back_populates="profile", cascade="all, delete-orphan")


class ProjectCapability(Base):
    __tablename__ = "project_capabilities"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey(f"{SCHEMA}.project_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    capability_name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    maturity_level = Column(String, nullable=True)
    confidence = Column(String, default="inferred")
    evidence = Column(Text, nullable=True)
    source_chunk_id = Column(Integer, nullable=True)  # PolicyChunk this fact was matched to (drill-through)
    profile = relationship("ProjectProfile", back_populates="capabilities")


class ProjectIntegration(Base):
    __tablename__ = "project_integrations"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey(f"{SCHEMA}.project_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    system_name = Column(String, nullable=False)
    integration_type = Column(String, nullable=True)
    complexity_level = Column(String, nullable=True)
    lessons_learned = Column(Text, nullable=True)
    confidence = Column(String, default="inferred")
    source_chunk_id = Column(Integer, nullable=True)  # PolicyChunk this fact was matched to (drill-through)
    profile = relationship("ProjectProfile", back_populates="integrations")


class ProjectLesson(Base):
    __tablename__ = "project_lessons"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey(f"{SCHEMA}.project_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    category = Column(String, nullable=True)
    lesson = Column(Text, nullable=False)
    impact_level = Column(String, nullable=True)
    recommendation = Column(Text, nullable=True)
    confidence = Column(String, default="inferred")
    evidence = Column(Text, nullable=True)
    source_chunk_id = Column(Integer, nullable=True)  # PolicyChunk this fact was matched to (drill-through)
    profile = relationship("ProjectProfile", back_populates="lessons")


class ProjectReusableAsset(Base):
    __tablename__ = "project_reusable_assets"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey(f"{SCHEMA}.project_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    asset_name = Column(String, nullable=False)
    asset_type = Column(String, nullable=True)
    repository_url = Column(String, nullable=True)
    owner = Column(String, nullable=True)
    reuse_readiness = Column(String, nullable=True)
    documentation_url = Column(String, nullable=True)
    confidence = Column(String, default="inferred")
    source_chunk_id = Column(Integer, nullable=True)  # PolicyChunk this fact was matched to (drill-through)
    profile = relationship("ProjectProfile", back_populates="reusable_assets")


class ProjectExpertise(Base):
    __tablename__ = "project_expertise"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey(f"{SCHEMA}.project_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), nullable=True)
    person_name = Column(String, nullable=False)
    role_on_project = Column(String, nullable=True)
    capability = Column(String, nullable=True)
    evidence_level = Column(String, default="inferred")  # verified | inferred
    source_chunk_id = Column(Integer, nullable=True)  # PolicyChunk this fact was matched to (drill-through)
    profile = relationship("ProjectProfile", back_populates="expertise")


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


class AssetRequest(Base):
    """Tracks hardware/peripheral requests so duplicate requests can be blocked."""
    __tablename__ = "asset_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), index=True)
    asset_name = Column(String, nullable=False)          # normalised lowercase e.g. "headset"
    status = Column(String, default="Pending", index=True)  # Pending | Fulfilled | Rejected
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


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
    expected_end_date = Column(Date, nullable=True)     # optional end date for the allocation
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
    image_action = Column(JSON, nullable=True)  # {type: "url"|"form"|"app", value: str|int, label: str}
    email_recipients = Column(JSON, nullable=True)  # explicit email addresses for the email blast
    # Engagement mechanics the author enables per-announcement. Read tracking is
    # always on (AnnouncementReceipt); these govern what the reader can DO with it.
    allow_reactions = Column(Boolean, default=False)   # 👍 🎉 ❤️ tap-to-react
    allow_rsvp = Column(Boolean, default=False)        # "Count me in" (events) — author sees the roster
    require_ack = Column(Boolean, default=False)       # "I acknowledge" sign-off (policy / must-know)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)


class AnnouncementReceipt(Base):
    """One row per (announcement, employee) — the read-tracking spine.

    Created/updated when an employee first sees an announcement in the feed, and
    upserted again when they react / RSVP / acknowledge. This is what turns the
    fire-and-forget broadcast into a measurable loop: reach %, reaction counts,
    RSVP roster, and acknowledgment audit all read off this table.
    """
    __tablename__ = "announcement_receipts"
    __table_args__ = (
        UniqueConstraint("announcement_id", "user_email", name="uq_announcement_receipt"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey(f"{SCHEMA}.announcements.id", ondelete="CASCADE"), index=True, nullable=False)
    user_email = Column(String, index=True, nullable=False)
    seen_at = Column(DateTime, default=datetime.datetime.utcnow)
    reaction = Column(String, nullable=True)            # "👍" | "🎉" | "❤️" | None
    rsvp = Column(String, nullable=True)                # "yes" | "no" | "maybe" | None
    acknowledged_at = Column(DateTime, nullable=True)   # set when reader clicks "I acknowledge"
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


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


# ── Travel Management ─────────────────────────────────────────────────────────

class TravelRequest(Base):
    __tablename__ = "travel_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    ref_id = Column(String, unique=True, index=True)          # TRVL-0001
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    business_reason = Column(Text, nullable=False)
    from_location = Column(String, nullable=False)
    to_destination = Column(String, nullable=False)
    travel_date = Column(Date, nullable=False)
    return_date = Column(Date, nullable=True)
    is_international = Column(Boolean, default=False)
    visa_required = Column(Boolean, default=False)
    mode_of_travel = Column(String, nullable=True)             # Flight, Train, Car, Other
    accommodation_required = Column(Boolean, default=False)
    estimated_cost = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    # Status: pending_rm → rm_approved → admin_approved → completed; or rm_rejected / admin_rejected
    status = Column(String, default="pending_rm")
    # RM approval (email token-based, like installation requests)
    rm_approval_token = Column(String, nullable=True, index=True)
    rm_token_expires_at = Column(DateTime, nullable=True)
    rm_decision_by = Column(String, nullable=True)
    rm_decision_at = Column(DateTime, nullable=True)
    rm_rejection_reason = Column(Text, nullable=True)
    # Admin action
    admin_decision_by = Column(String, nullable=True)
    admin_decision_at = Column(DateTime, nullable=True)
    admin_rejection_reason = Column(Text, nullable=True)
    expense_limit = Column(Float, nullable=True)               # per-trip limit set by admin on approval
    expense_limit_currency = Column(String, default="INR")     # currency for the per-trip expense limit
    ticket_details = Column(Text, nullable=True)               # flight/train booking info
    hotel_details = Column(Text, nullable=True)                # hotel / guest-house details
    visa_status = Column(Text, nullable=True)                  # visa processing notes
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class TravelExpenseClaim(Base):
    __tablename__ = "travel_expense_claims"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    ref_id = Column(String, unique=True, index=True)           # TEXPC-0001
    travel_request_id = Column(Integer, ForeignKey(f"{SCHEMA}.travel_requests.id"))
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"))
    amount = Column(Float, nullable=False)
    currency = Column(String, default="INR")                   # currency of the claimed amount
    breakdown = Column(Text, nullable=True)                    # itemised description
    over_limit_reason = Column(Text, nullable=True)            # mandatory when amount > limit
    status = Column(String, default="Pending")                 # Pending, Approved, Rejected
    approved_by = Column(String, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class TravelSettings(Base):
    """Key-value store for travel management configuration (e.g. global expense limit)."""
    __tablename__ = "travel_settings"
    __table_args__ = {"schema": SCHEMA}

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=True)


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
    # Feedback-triage flywheel: set when an admin promotes/dismisses this failure so it
    # drops out of the triage queue. triaged_action ∈ curated_answer | routing_fix | dismissed.
    triaged_at = Column(DateTime, nullable=True, index=True)
    triaged_action = Column(String, nullable=True)
    triaged_by = Column(String, nullable=True)


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
    source = Column(String, default="seed")                  # seed | kw | prompt | feedback | manual | connector
    is_active = Column(Boolean, default=True, index=True)     # soft-disable a bad seed without deleting
    weight = Column(Float, default=1.0)
    connector_operation_id = Column(Integer, ForeignKey(f"{SCHEMA}.connector_operations.id", ondelete="SET NULL"), nullable=True, index=True)
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
    trigger_keywords = Column(Text, nullable=True)           # comma-separated; chat intercept fires when any keyword matches user message
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
    Written by the remember_user_fact tool; retrieved semantically inside context_manager_node
    (agent.py) and injected into feedback_context each turn.
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


class ChatSession(Base):
    """Server-side mirror of a frontend chat thread, keyed by user account rather than
    device/browser — the sync target for the Recent Chats list so it matches across
    devices for the same logged-in user. The frontend still keeps an offline-first copy
    in localStorage (see src/lib/chat-store.ts); this table is what it syncs against.
    Private threads (Thread.isPrivate) are never written here.
    """
    __tablename__ = "chat_sessions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(String, primary_key=True)  # same id as the frontend Thread / LangGraph thread_id
    user_email = Column(String, index=True, nullable=False)
    turns = Column(JSON, nullable=False)  # serialized Turn[] (matches the frontend Thread shape)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, index=True)


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
    # ── Latency SLO fields (Phase 0) ──────────────────────────────────────────
    time_to_first_token_ms = Column(Integer, nullable=True)  # ms from request start to first SSE token
    queue_wait_ms = Column(Integer, nullable=True)           # ms spent waiting for concurrency slot
    gate_result = Column(String, nullable=True)              # direct / queued / busy
    fallback_used = Column(Boolean, default=False)           # True if resilience layer used fallback model
    served_from = Column(String, nullable=True)              # cache / semantic_router / llm_router / fastpath / agent
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
    ttft_ms = Column(Integer, nullable=True)                 # ms to first token for this specific LLM call
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
    source = Column(String, default="sharepoint")           # sharepoint | upload
    created_by = Column(String, nullable=True)
    category = Column(String, nullable=True, index=True)    # optional grouping tag
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class HRLetterType(Base):
    """A row in the "Letters & Certificates" directory (Documents page). Generation itself
    happens in Zoho People — this table only controls what employees see and where the
    "Request" button deep-links to. HR manages this list (add/enable/disable/remove) from
    the Documents page; `zoho_path` is the Zoho People hrservices URL slug and `enabled`
    gates whether the request button is live or shows "Coming soon"."""
    __tablename__ = "hr_letter_types"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)       # stable slug, e.g. "bonafide"
    label = Column(String)
    description = Column(Text, nullable=True)
    icon = Column(String, default="FileText")           # lucide icon name (frontend-side map)
    category = Column(String, default="admin")          # employment | certification | separation | admin
    zoho_path = Column(String, nullable=True)            # Zoho People hrservices slug; null = not set up yet
    fields = Column(JSON, nullable=True)                 # ["Reason for request", ...] — display hint only
    enabled = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_by = Column(String, nullable=True)
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
    trigger_keywords = Column(Text, nullable=True)           # comma-separated; chat intercept opens form inline when any keyword matches
    embedding = Column(Vector(768), nullable=True)           # of name + description + category + field labels
    enabled = Column(Boolean, default=True, index=True)      # disable to pull a form out of chat without deleting
    notify_email = Column(String, nullable=True)             # explicit recipient for new submissions
    notify_domain = Column(String, nullable=True)            # fallback recipient by domain (admin/hr/…)
    is_anonymous = Column(Boolean, default=False)            # when True, submitter identity is NOT stored
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


class Appreciation(Base):
    """Client-side appreciation received by an employee, added by FM or Super Admin."""
    __tablename__ = "appreciations"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_email = Column(String, index=True, nullable=False)
    employee_name = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    client_name = Column(String, nullable=True)
    screenshot_data = Column(LargeBinary, nullable=True)
    screenshot_name = Column(String, nullable=True)
    screenshot_content_type = Column(String, nullable=True)
    added_by_email = Column(String, nullable=False)
    added_by_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


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


# ── Local TechElevate LMS ─────────────────────────────────────────────────────
# An in-house mirror of the external TechElevate training portal. The external API
# is unreachable (no stored Microsoft refresh token), so these tables back the same
# learning experience locally AND close the upskilling flywheel: each training is
# tagged with Alchemy-aligned skills, and completing + passing it writes those back
# as *verified* EmployeeSkill rows that resource-matching and Skill Supply then read.

class TeTraining(Base):
    """A course in the local TechElevate LMS. `skill_tags` are Alchemy-aligned skill
    names; passing this training writes them back as verified EmployeeSkills."""
    __tablename__ = "te_trainings"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)            # Technical | Governance & Compliance | Business
    training_type = Column(String, default="single")    # single | levels
    duration_minutes = Column(Integer, default=0)
    pass_percentage = Column(Float, default=60.0)
    max_attempts = Column(Integer, default=3)
    video_link = Column(String, nullable=True)
    skill_tags = Column(JSON, nullable=True)            # ["Python","Machine Learning"] — Alchemy-aligned
    photo_url = Column(String, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    levels = relationship("TeTrainingLevel", back_populates="training",
                          cascade="all, delete-orphan", order_by="TeTrainingLevel.sort_order")
    questions = relationship("TeMcqQuestion", back_populates="training", cascade="all, delete-orphan")
    assignments = relationship("TeAssignment", back_populates="training", cascade="all, delete-orphan")
    content_items = relationship("TeContentItem", back_populates="training",
                                 cascade="all, delete-orphan", order_by="TeContentItem.sort_order")


class TeContentItem(Base):
    """A learning material attached to a training (single-level → level_id NULL) or to a
    specific level of a multi-level track. Kinds: document (uploaded file), link (web URL),
    udemy (Udemy course/video URL), video (YouTube/other video URL). These are both the
    curriculum a learner studies AND the grounding the AI uses to draft MCQs."""
    __tablename__ = "te_content_items"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey(f"{SCHEMA}.te_trainings.id", ondelete="CASCADE"), index=True)
    level_id = Column(Integer, ForeignKey(f"{SCHEMA}.te_training_levels.id", ondelete="CASCADE"), nullable=True, index=True)
    kind = Column(String, default="link")              # document | link | udemy | video
    title = Column(String, nullable=False)
    url = Column(String, nullable=True)                # external URL, or /uploads/te_local/<file> for documents
    description = Column(Text, nullable=True)
    file_name = Column(String, nullable=True)          # original filename for uploaded documents
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    training = relationship("TeTraining", back_populates="content_items")


class TeTrainingLevel(Base):
    """A level within a multi-level training (Basic / Intermediate / Advanced)."""
    __tablename__ = "te_training_levels"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey(f"{SCHEMA}.te_trainings.id", ondelete="CASCADE"), index=True)
    name = Column(String, nullable=False)               # Basic | Intermediate | Advanced
    sort_order = Column(Integer, default=0)
    duration_minutes = Column(Integer, default=0)
    pass_percentage = Column(Float, default=60.0)
    description = Column(Text, nullable=True)

    training = relationship("TeTraining", back_populates="levels")


class TeMcqQuestion(Base):
    """An MCQ assessment question. Grading these produces the score that drives pass/fail
    (and therefore the verified-skill write-back)."""
    __tablename__ = "te_mcq_questions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey(f"{SCHEMA}.te_trainings.id", ondelete="CASCADE"), index=True)
    level_id = Column(Integer, ForeignKey(f"{SCHEMA}.te_training_levels.id", ondelete="CASCADE"), nullable=True)
    question = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)               # {"A":..,"B":..,"C":..,"D":..}
    correct_answer = Column(String, nullable=True)      # "A".."D"
    marks = Column(Integer, default=1)
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    training = relationship("TeTraining", back_populates="questions")


class TeAssignment(Base):
    """An employee's enrolment in a training. On pass, the training's skill_tags are
    written back once (guarded by `skills_applied`) as verified EmployeeSkills."""
    __tablename__ = "te_assignments"
    __table_args__ = (
        UniqueConstraint("training_id", "employee_id", name="uq_te_assignment_training_emp"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True, index=True)
    training_id = Column(Integer, ForeignKey(f"{SCHEMA}.te_trainings.id", ondelete="CASCADE"), index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id", ondelete="SET NULL"), nullable=True, index=True)
    employee_email = Column(String, index=True)
    employee_name = Column(String, nullable=True)
    department = Column(String, nullable=True)
    status = Column(String, default="Assigned", index=True)   # Assigned | In Progress | Completed | Failed
    score = Column(Float, nullable=True)
    attempts = Column(Integer, default=0)
    start_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    skills_applied = Column(Boolean, default=False)     # guard: verified-skill write-back runs once
    assigned_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    training = relationship("TeTraining", back_populates="assignments")


class TeGroup(Base):
    """A named cohort of employees for bulk training assignment. Members are stored
    inline as JSON [{employee_id, name, email, department}] for simple display."""
    __tablename__ = "te_groups"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    project_name = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    photo_url = Column(String, nullable=True)
    members = Column(JSON, nullable=True)               # [{employee_id, name, email, department}]
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


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
    scopes = Column(JSON, nullable=True)             # Restrictive: if set, user only gets these scopes (subset of role)
    extra_capabilities = Column(JSON, nullable=True) # Additive: caps granted beyond the role (portals, modes, features)
    granted_by = Column(String, nullable=True)       # Super Admin's email
    granted_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class AppRole(Base):
    """Platform roles — system built-ins (is_system=True) + Super Admin custom roles."""
    __tablename__ = "app_roles"
    __table_args__ = {"schema": SCHEMA}

    slug = Column(String, primary_key=True)          # e.g. "hr", "devops_lead"
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    color = Column(String, nullable=True)            # hex color for UI badge, e.g. "#22C55E"
    is_system = Column(Boolean, default=False, nullable=False)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class RoleCapabilityMap(Base):
    """Tracks which capability keys a role includes. Replaces hardcoded ROLE_SCOPES."""
    __tablename__ = "role_capability_maps"
    __table_args__ = (
        UniqueConstraint("role_slug", "capability_key", name="uq_role_capability"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True, index=True)
    role_slug = Column(String, nullable=False, index=True)
    capability_key = Column(String, nullable=False, index=True)


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
    minute = Column(Integer, default=0)                       # minute of hour, 0..59

    # Kind: "email" (default static body) | "roi_digest" (body rendered from live ROI metrics at send).
    # roi_digest rules carry their period in extra_config and attach the ROI PDF when sent.
    automation_kind = Column(String, default="email")
    extra_config = Column(JSON, nullable=True)                 # roi_digest: {"period": "30d"}

    # Email
    email_subject = Column(String, nullable=False)
    email_body = Column(Text, nullable=False)                 # plain text; wrapped in branded shell at send

    # Recipients JSON array: [{type: "individual", email: "x@y.com", name: "..."} |
    #                          {type: "teams_group", id: "...", name: "...", emails: [...]}]
    recipients_json = Column(JSON, default=list)

    # Co-owners: list of email strings; can view but not edit/delete/toggle/send-now
    co_owners_json = Column(JSON, default=list)

    # State
    is_active = Column(Boolean, default=True, index=True)
    next_run = Column(DateTime, nullable=True, index=True)
    last_run = Column(DateTime, nullable=True)
    last_status = Column(String, nullable=True)               # sent | failed:<reason>
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AutomationSendLog(Base):
    """One row per automation email dispatch — full audit history for AutomationRule.

    Written on every scheduled fire (automation_service.run_due) and every manual
    trigger (automation_service.send_now). rule_name/created_by are snapshotted so
    history remains visible even after the rule itself is edited or deleted.
    """
    __tablename__ = "automation_send_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey(f"{SCHEMA}.automation_rules.id", ondelete="SET NULL"), nullable=True, index=True)
    rule_name = Column(String, nullable=False)
    created_by = Column(String, index=True, nullable=False)   # rule owner at send time
    automation_kind = Column(String, nullable=True)
    triggered_by = Column(String, nullable=False, default="scheduled")  # scheduled | manual
    triggered_by_email = Column(String, nullable=True)        # who clicked "Send Now" (manual only)
    recipients_json = Column(JSON, default=list)               # flattened emails actually sent to
    recipient_count = Column(Integer, default=0)
    status = Column(String, nullable=False)                    # sent | failed
    detail = Column(Text, nullable=True)                       # outcome detail / error message
    sent_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class SavedDashboard(Base):
    """A user-built analytics board from the Analytics Studio. Holds one or more chart
    widgets, each naming entries from the server-side metric catalog (never raw SQL).

    Access: the creator always sees their boards; role_visibility (a JSON list of role
    names) optionally shares a board read-only with other non-employee roles."""
    __tablename__ = "saved_dashboards"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    owner_email = Column(String, index=True, nullable=False)
    role_visibility = Column(JSON, nullable=True)             # list[str] of roles | null = owner only
    # widgets: list of {title, metric, dimension, period, chart_type, layout:{x,y,w,h}}
    widgets = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


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
    resources_sent = Column(Text, nullable=True)  # JSON snapshot of resources included at send time
    initiated_by = Column(String, nullable=True)  # HR user (or "system") who triggered onboarding


class OnboardingRequest(Base):
    """Client-side onboarding initiated by a Functional Manager for a team member.

    Covers service-company pre-engagement steps: drug test, background verification,
    and client-side onboarding — not all steps apply to every engagement.
    """
    __tablename__ = "onboarding_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_name = Column(String, nullable=False)
    employee_email = Column(String, nullable=True)
    # JSON: {"drug_test": bool, "background_check": bool, "client_onboarding": bool}
    steps = Column(JSON, default=dict)
    client_name = Column(String, nullable=True)          # required when client_onboarding = True
    notes = Column(Text, nullable=True)
    status = Column(String, default="Pending", index=True)  # Pending | In Progress | Completed
    created_by = Column(String, nullable=False, index=True)  # FM email
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class PMOTeamRequest(Base):
    """Request from a Functional Manager to PMO for VDI provisioning or revocation."""
    __tablename__ = "pmo_team_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    request_type = Column(String, nullable=False, index=True)  # vdi_provision | vdi_revoke
    employee_name = Column(String, nullable=False)
    employee_email = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    status = Column(String, default="Pending", index=True)  # Pending | In Progress | Completed | Rejected
    created_by = Column(String, nullable=False, index=True)  # FM email
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class LibraryDocument(Base):
    """Company document library — PPTs, PDFs, DOCX etc. uploaded by HR/Admin for all staff."""
    __tablename__ = "library_documents"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True, index=True)
    filename = Column(String, nullable=False)
    file_type = Column(String, nullable=False)   # pdf | pptx | docx | xlsx | …
    file_size = Column(Integer, nullable=False)  # bytes
    file_content = Column(LargeBinary, nullable=False)
    uploaded_by = Column(String, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)


# ════════════════════════════════════════════════════════════════════════════════
# PLATFORM TABLES — No-Code Integration Platform (M1+)
# ════════════════════════════════════════════════════════════════════════════════

class Connector(Base):
    """A registered external system (API, portal, service). Source of ConnectorOperations."""
    __tablename__ = "connectors"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, index=True, nullable=False)   # e.g. "zoho_people"
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    source_type = Column(String, nullable=False)                     # openapi | manual | mcp | native
    base_url = Column(String, nullable=True)
    spec_blob = Column(LargeBinary, nullable=True)                   # raw OpenAPI spec bytes
    spec_url = Column(String, nullable=True)
    status = Column(String, default="draft", index=True)             # draft | published | disabled
    version = Column(Integer, default=1)                             # bump on edit → cache invalidation
    seeding_status = Column(String, default="idle")                   # idle | seeding | seeded | failed
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    operations = relationship("ConnectorOperation", back_populates="connector", cascade="all, delete-orphan")
    auth = relationship("ConnectorAuth", back_populates="connector", uselist=False, cascade="all, delete-orphan")
    scopes = relationship("ConnectorScope", back_populates="connector", cascade="all, delete-orphan")


class ConnectorAuth(Base):
    """Auth config for a connector. Secrets stored Fernet-encrypted in config_enc."""
    __tablename__ = "connector_auths"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    connector_id = Column(Integer, ForeignKey(f"{SCHEMA}.connectors.id", ondelete="CASCADE"), unique=True)
    auth_type = Column(String, nullable=False)        # none | api_key | bearer | basic | oauth2 | headless
    auth_mode = Column(String, default="service")     # service | per_user
    config_enc = Column(Text, nullable=True)          # Fernet-encrypted JSON (API key, client secret, etc.)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    connector = relationship("Connector", back_populates="auth")


class ConnectorUserAuth(Base):
    """Per-user credential for a connector whose auth_mode='per_user'.

    Same encrypted-JSON shape as ConnectorAuth.config_enc, but keyed by
    (connector_id, user_email) so each user acts under their own credential
    instead of a shared service account.
    """
    __tablename__ = "connector_user_auths"
    __table_args__ = (
        UniqueConstraint("connector_id", "user_email", name="uq_connector_user_auth"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True, index=True)
    connector_id = Column(Integer, ForeignKey(f"{SCHEMA}.connectors.id", ondelete="CASCADE"), index=True)
    user_email = Column(String, nullable=False, index=True)
    config_enc = Column(Text, nullable=True)          # Fernet-encrypted JSON (this user's key/token)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ConnectorOperation(Base):
    """A single callable operation (tool) exposed by a connector."""
    __tablename__ = "connector_operations"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    connector_id = Column(Integer, ForeignKey(f"{SCHEMA}.connectors.id", ondelete="CASCADE"), index=True)
    name = Column(String, nullable=False)             # snake_case tool name, e.g. "get_leave_balance"
    display_name = Column(String, nullable=True)
    description = Column(Text, nullable=True)         # LLM-enriched at import time
    method = Column(String, nullable=True)            # GET | POST | PUT | DELETE
    path_template = Column(String, nullable=True)     # e.g. "/api/leave/{employee_id}"
    params_schema = Column(JSON, nullable=True)       # flat list of {name, type, location, required, description}
    response_map = Column(JSON, nullable=True)        # dotted-path picks to trim large responses
    requires_confirmation = Column(Boolean, default=False)  # mutating ops need user confirm
    minutes_saved = Column(Float, default=0.0)        # used for ROI metrics
    response_mode = Column(String, default="passthrough")  # passthrough | template | agent
    template = Column(Text, nullable=True)            # Jinja2 template for response_mode=template
    enabled = Column(Boolean, default=True)
    version = Column(Integer, default=1)
    python_ref = Column(String, nullable=True)        # dotted path for source_type=native
    mcp_tool_name = Column(String, nullable=True)     # tool name for source_type=mcp
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    connector = relationship("Connector", back_populates="operations")
    scopes = relationship("ConnectorScope", back_populates="operation", cascade="all, delete-orphan")
    call_logs = relationship("ConnectorCallLog", back_populates="operation")


class ConnectorScope(Base):
    """Controls which personas/roles/departments can see a connector or specific operation."""
    __tablename__ = "connector_scopes"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    connector_id = Column(Integer, ForeignKey(f"{SCHEMA}.connectors.id", ondelete="CASCADE"), index=True)
    operation_id = Column(Integer, ForeignKey(f"{SCHEMA}.connector_operations.id", ondelete="CASCADE"), nullable=True, index=True)
    persona_id = Column(Integer, ForeignKey(f"{SCHEMA}.personas.id", ondelete="CASCADE"), nullable=True)
    role = Column(String, nullable=True)
    department = Column(String, nullable=True)
    user_email = Column(String, nullable=True, index=True)  # grant access to one specific user

    connector = relationship("Connector", back_populates="scopes")
    operation = relationship("ConnectorOperation", back_populates="scopes")


class ConnectorCallLog(Base):
    """One row per connector operation invocation — for usage metrics and ROI calculation."""
    __tablename__ = "connector_call_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    connector_id = Column(Integer, ForeignKey(f"{SCHEMA}.connectors.id", ondelete="SET NULL"), nullable=True, index=True)
    operation_id = Column(Integer, ForeignKey(f"{SCHEMA}.connector_operations.id", ondelete="SET NULL"), nullable=True, index=True)
    user_email = Column(String, nullable=True, index=True)
    request_log_id = Column(Integer, ForeignKey(f"{SCHEMA}.ai_request_logs.id", ondelete="SET NULL"), nullable=True)
    flow_run_id = Column(Integer, nullable=True)             # FK to flow_runs (defined below)
    status = Column(String, default="success")               # success | error | timeout
    latency_ms = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    operation = relationship("ConnectorOperation", back_populates="call_logs")


# ── Flow Engine (M3) ─────────────────────────────────────────────────────────

class Flow(Base):
    """A reusable automation workflow (trigger → steps → approvals → notifications)."""
    __tablename__ = "flows"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    trigger = Column(JSON, nullable=True)             # {type: form_submitted|connector_op|schedule|manual, ref, filter}
    definition = Column(JSON, nullable=True)          # {steps: [{id, type, params, next, on_reject}]}
    is_active = Column(Boolean, default=False)
    version = Column(Integer, default=1)
    minutes_saved = Column(Float, default=0.0)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    runs = relationship("FlowRun", back_populates="flow")


class FlowRun(Base):
    """One execution of a Flow."""
    __tablename__ = "flow_runs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    flow_id = Column(Integer, ForeignKey(f"{SCHEMA}.flows.id", ondelete="CASCADE"), index=True)
    status = Column(String, default="running", index=True)  # running | waiting_approval | completed | failed | rejected
    context = Column(JSON, nullable=True)                   # accumulated step outputs + trigger payload
    current_step = Column(String, nullable=True)
    started_by = Column(String, nullable=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    finished_at = Column(DateTime, nullable=True)

    flow = relationship("Flow", back_populates="runs")
    step_runs = relationship("FlowStepRun", back_populates="flow_run", cascade="all, delete-orphan")


class FlowStepRun(Base):
    """One step execution within a FlowRun."""
    __tablename__ = "flow_step_runs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    flow_run_id = Column(Integer, ForeignKey(f"{SCHEMA}.flow_runs.id", ondelete="CASCADE"), index=True)
    step_id = Column(String, nullable=True)
    step_type = Column(String, nullable=True)   # connector_op | approval | notify_email | condition | llm_transform
    status = Column(String, default="pending")  # pending | running | completed | failed | skipped
    input = Column(JSON, nullable=True)
    output = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    flow_run = relationship("FlowRun", back_populates="step_runs")


# ── Persona Layer (M2) ───────────────────────────────────────────────────────

class Persona(Base):
    """A user persona defined by role + department combination, controls visible features."""
    __tablename__ = "personas"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    match_rules = Column(JSON, nullable=True)   # [{role: "hr", department: "HR"}, ...] — ordered, first match wins
    priority = Column(Integer, default=0)       # lower = checked first
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    assignments = relationship("PersonaAssignment", back_populates="persona")
    features = relationship("PersonaFeature", back_populates="persona", cascade="all, delete-orphan")


class PersonaAssignment(Base):
    """Explicit per-user persona override (overrides match_rules)."""
    __tablename__ = "persona_assignments"
    __table_args__ = (UniqueConstraint("user_email", name="uq_persona_assignment_email"), {"schema": SCHEMA})

    id = Column(Integer, primary_key=True, index=True)
    persona_id = Column(Integer, ForeignKey(f"{SCHEMA}.personas.id", ondelete="CASCADE"))
    user_email = Column(String, unique=True, nullable=False, index=True)
    assigned_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    persona = relationship("Persona", back_populates="assignments")


class PersonaFeature(Base):
    """Maps a persona to the features/connectors/flows/forms it can access."""
    __tablename__ = "persona_features"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    persona_id = Column(Integer, ForeignKey(f"{SCHEMA}.personas.id", ondelete="CASCADE"), index=True)
    feature_type = Column(String, nullable=False)  # connector | operation | flow | form | quick_action | widget
    feature_ref = Column(String, nullable=False)   # slug or ID string
    config = Column(JSON, nullable=True)           # optional per-feature config (e.g. visible fields)
    sort_order = Column(Integer, default=0)

    persona = relationship("Persona", back_populates="features")


# ── Dashboard (M5) ───────────────────────────────────────────────────────────

class DashboardConfig(Base):
    """Per-role or per-persona dashboard widget layout configuration."""
    __tablename__ = "dashboard_configs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    persona_id = Column(Integer, ForeignKey(f"{SCHEMA}.personas.id", ondelete="CASCADE"), nullable=True)
    role = Column(String, nullable=True)        # fallback if no persona_id
    widgets = Column(JSON, nullable=True)       # ordered list of {widget_type, config}
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class PendingAction(Base):
    """Durable store for a state-changing action awaiting user confirmation.

    Replaces the in-memory PENDING_IT_EMAIL_DRAFTS dict so a confirmed/awaiting action
    survives a process restart. One row per pending write, keyed by session + idempotency
    key; the action layer creates it on intent, then executes ONLY on explicit confirm.
    See docs/action-safety-audit.md (Phase 2 of the routing/agent redesign).
    """
    __tablename__ = "pending_actions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(String, index=True)        # _draft_key: session_id or user_email
    user_email = Column(String, index=True)
    action_type = Column(String, index=True)        # e.g. "software_install"
    payload = Column(JSON, nullable=True)           # action args, e.g. {"software_name": "..."}
    idempotency_key = Column(String, index=True, nullable=True)  # dedupe a single logical action
    status = Column(String, default="pending", index=True)       # pending|executed|cancelled|expired
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)


class ActionReceipt(Base):
    """Durable receipt for every executed write action — the trust / compliance ledger.

    One row per executed action recording WHAT was done, in WHICH system, WHEN, the
    downstream CONFIRMATION id, and — where the downstream allows it — a one-click UNDO.
    Emitted by receipt_service.emit() immediately after an action's side effect succeeds,
    then surfaced both as an undo link in the assistant's confirmation and in the in-app
    receipts feed. Idempotency_key dedupes re-emits of one logical action (retries / the
    'you already have a ticket' path) so an action never yields two receipts.
    """
    __tablename__ = "action_receipts"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True)
    action_type = Column(String, index=True)        # it_ticket | hr_query | grievance | software_install | ...
    system = Column(String)                          # human label of the downstream system
    summary = Column(String)                         # the "what", human-readable
    confirmation_id = Column(String, index=True, nullable=True)   # IT-001 / HRQ-001 / RE-7964
    entity_type = Column(String, nullable=True)      # for the undo handler to locate the row
    entity_id = Column(String, nullable=True)
    idempotency_key = Column(String, index=True, nullable=True)   # dedupe re-emits of one logical action
    status = Column(String, default="executed", index=True)       # executed | undone
    undoable = Column(Boolean, default=False)
    undo_token = Column(String, unique=True, index=True, nullable=True)
    undo_deadline = Column(DateTime, nullable=True)  # undo allowed only before this instant
    undone_at = Column(DateTime, nullable=True)
    receipt_metadata = Column("metadata", JSON, nullable=True)    # extra context for the feed / audit
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class ProactiveNudge(Base):
    """A system-initiated, deterministic nudge surfaced in the in-app feed.

    A background scan (nudge_service.run_due, fired by the startup scheduler)
    detects actionable situations with pure DB look-ups — no LLM — and upserts one
    row per (recipient, situation), keyed by ``dedup_key`` so re-scanning never
    creates duplicates and a dismissed nudge stays dismissed for its period.

    The in-app feed (GET /api/nudges) is the source of truth; an optional
    best-effort Teams/email push is gated by settings.NUDGE_PUSH_ENABLED.
    """
    __tablename__ = "proactive_nudges"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)   # recipient (who to nudge)
    nudge_type = Column(String, index=True, nullable=False)   # leave_expiring | approval_stale
    # Stable identity of the situation; unique so the detector can upsert idempotently.
    # Encodes the period so dismissals persist, e.g. "leave_expiring:u@x:2026:CL".
    dedup_key = Column(String, unique=True, index=True, nullable=False)

    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    severity = Column(String, default="action")              # info | action

    # One-click action: apply_leave (returns a deeplink) | nudge_manager (re-sends approval).
    action_type = Column(String, nullable=True)
    action_payload = Column(JSON, nullable=True)             # prefilled args for the action

    # What the nudge is about, for deep-linking from the UI.
    entity_type = Column(String, nullable=True)             # leave | leave_type
    entity_id = Column(String, nullable=True)

    status = Column(String, default="new", index=True)      # new|seen|actioned|dismissed|expired
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    # Last time the action was fired / pushed — drives the manager-nudge cooldown.
    last_actioned_at = Column(DateTime, nullable=True)
    last_delivered_at = Column(DateTime, nullable=True)     # best-effort Teams/email push


class ActivityLogEntry(Base):
    """Org-wide admin/system activity ledger — the source of both the header Activity
    bell (last-30-days, short form) and the Control Hub Audit Trail (unbounded, full
    detail, Super Admin only).

    One row per confirmed state change (role grants/revocations, role/capability
    definitions, automation CRUD + system-triggered fires, settings changes). Never
    covers chat/prompt traffic — that's AI Observability's job. Emitted by
    activity_log_service.emit(), which never raises so a logging failure can never
    break the action it's recording.
    """
    __tablename__ = "activity_log_entries"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)

    actor_email = Column(String, index=True, nullable=False)
    actor_name = Column(String, nullable=True)        # denormalized display name at emit time

    category = Column(String, index=True, nullable=False)     # role_assignment | role_definition | access_grant | automation | settings
    action_type = Column(String, index=True, nullable=False)  # role_assign | role_change | role_revoke | role_def_create | ...
    severity = Column(String, default="normal", index=True)   # high | normal | low

    target_type = Column(String, nullable=True)       # user | role | automation_rule | setting
    target_id = Column(String, nullable=True)          # email / role slug / rule id / setting key
    target_name = Column(String, nullable=True)        # denormalized display label

    summary = Column(String, nullable=False)            # "Shivam Sharma added Suraj Ghuge as admin"
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    entry_metadata = Column("metadata", JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)


class OnboardingJourney(Base):
    """One new hire's onboarding journey — the parent record tracking overall progress.

    Created lazily (onboarding_service.ensure_journey) the first time a new hire opens
    the onboarding page or the assistant asks about it. The ordered steps themselves live
    in OnboardingStepProgress; the canonical step *definitions* are in
    services/onboarding_template.py (code, not DB), so the sequence is versioned with the app.
    """
    __tablename__ = "onboarding_journeys"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey(f"{SCHEMA}.employees.id"), unique=True, index=True, nullable=False)
    status = Column(String, default="active", index=True)    # active | completed
    # IT device the admin assigned to this hire (e.g. "MacBook Pro 16\"", "Dell Latitude 5540").
    # Surfaced in the new hire's IT-setup step; blank until an admin sets it.
    assigned_device = Column(String, nullable=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    employee = relationship("Employee")
    steps = relationship("OnboardingStepProgress", back_populates="journey",
                         cascade="all, delete-orphan")
    documents = relationship("OnboardingDocSubmission", back_populates="journey",
                            cascade="all, delete-orphan")


class OnboardingStepProgress(Base):
    """Per-step status for one journey. One row per template step, seeded on journey creation."""
    __tablename__ = "onboarding_step_progress"
    __table_args__ = (
        UniqueConstraint("journey_id", "step_key", name="uq_onboarding_step"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True, index=True)
    journey_id = Column(Integer, ForeignKey(f"{SCHEMA}.onboarding_journeys.id"), index=True, nullable=False)
    step_key = Column(String, nullable=False)                # matches onboarding_template.STEPS[].key
    status = Column(String, default="pending")               # pending | in_progress | done | skipped
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String, nullable=True)             # email of who marked it (self / HR)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    journey = relationship("OnboardingJourney", back_populates="steps")


class OnboardingDocSubmission(Base):
    """A joining document the hire uploaded — saved to disk and emailed to HR.

    `doc_key` matches onboarding_template.ONBOARDING_DOCS[].doc_key. The
    `onboarding_documents` step auto-completes once every required doc has a row here.
    """
    __tablename__ = "onboarding_doc_submissions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    journey_id = Column(Integer, ForeignKey(f"{SCHEMA}.onboarding_journeys.id"), index=True, nullable=False)
    doc_key = Column(String, nullable=False)
    file_path = Column(String, nullable=False)               # path under uploads/onboarding_docs/<email>/
    original_name = Column(String, nullable=True)
    status = Column(String, default="submitted")             # submitted | emailed | failed
    emailed_to = Column(String, nullable=True)               # HR address the file was sent to
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)
    attempt_count = Column(Integer, default=0)                # how many times an HR email was attempted
    last_attempt_at = Column(DateTime, nullable=True)         # when the most recent attempt happened

    journey = relationship("OnboardingJourney", back_populates="documents")


class InductionVideo(Base):
    """An induction/orientation video shown to new hires in the onboarding journey.

    Admin-managed via the Control Hub (replacing the old env-var-only source). A video
    is either an external URL (SharePoint/Stream/YouTube/MP4) or a file uploaded to
    uploads/induction/ and served via the /uploads static mount. `chapters` is a JSON
    list of {title, start} seek points rendered by the chaptered player.
    """
    __tablename__ = "induction_videos"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    url = Column(String, nullable=False)                     # external URL or /uploads/... path
    uploaded_filename = Column(String, nullable=True)        # original name if uploaded (else None)
    chapters = Column(JSON, nullable=True)                   # [{"title": str, "start": int}]
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class InductionDocument(Base):
    """A reference document (handbook, policy pack, slides) attached to the induction step.

    Admin-managed like InductionVideo. New hires can view/download these alongside the videos.
    `url` is either an external link or an uploaded file under uploads/induction_docs/.
    """
    __tablename__ = "induction_documents"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    url = Column(String, nullable=False)
    uploaded_filename = Column(String, nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class OnboardingQuickLink(Base):
    """A Day-1 quick link (useful app/portal/page) shown to new hires in their journey.

    Admin-managed like InductionDocument, but link-only (no file upload): HR curates the
    handful of destinations a new joiner needs early — HRMS, IT service desk, learning
    portal, org directory, etc. `category` is an optional grouping label ("Tools", "HR",
    "Learning") rendered as a small tag; `is_active` hides a link without deleting it.
    """
    __tablename__ = "onboarding_quick_links"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    url = Column(String, nullable=False)                     # external link
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)                 # optional grouping label
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class OnboardingDocSection(Base):
    """HR-managed onboarding document section — gives HR full control over the joining-document
    checklist beyond the built-in set (services/onboarding_template.py).

    A row is either a brand-new custom document OR an override of a built-in document that shares
    its doc_key (to change its name/description/fields/required, or hide it via is_active=False).
    onboarding_service merges these over the code-defined built-ins.
    """
    __tablename__ = "onboarding_doc_sections"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    doc_key = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    fields = Column(JSON, nullable=True)                     # list[str] of field labels
    required = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=100)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class OnboardingStepOverride(Base):
    """HR-managed onboarding journey step — full control over the step sequence beyond the
    built-in journey (services/onboarding_template.py).

    Like OnboardingDocSection: a row is either a brand-new custom step OR an override of a
    built-in step that shares its step_key (to retitle it, re-order it, change its CTA/category,
    toggle required, or hide it via is_active=False). onboarding_service merges these over the
    code-defined built-ins so the whole app sees one ordered journey.

    Custom (non-built-in) steps are `manual` (a "Mark done" card) or `deeplink` (drops a chat
    prompt / navigates a route via action_payload). They carry no auto_signal — only built-in
    steps auto-complete from real signals (an IT ticket resolved, all docs submitted).
    """
    __tablename__ = "onboarding_step_overrides"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    step_key = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)
    kind = Column(String, nullable=True)                     # manual | deeplink (custom steps)
    cta_label = Column(String, nullable=True)
    action_payload = Column(JSON, nullable=True)             # {"prompt": ...} or {"route": ...}
    required = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=100)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class OffboardedUser(Base):
    """A user whose access has been revoked via one-click offboarding. Reversible: `status`
    flips to 'reinstated' on undo. While status='offboarded' the auth gate denies the account.
    `revoked_summary` records what was cleared (roles, connected accounts) for audit + undo."""
    __tablename__ = "offboarded_users"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, default="offboarded")           # offboarded | reinstated
    offboarded_by = Column(String, nullable=True)
    offboarded_at = Column(DateTime, default=datetime.datetime.utcnow)
    reinstated_by = Column(String, nullable=True)
    reinstated_at = Column(DateTime, nullable=True)
    revoked_summary = Column(JSON, nullable=True)


class ManagerCallInvite(Base):
    """A new hire's intro call with their manager, scheduled by the manager via an
    emailed magic link (no login required — authenticated by the unguessable token).

    Created once per new hire the first time they're added (idempotent on new_hire_email).
    The manager clicks the link, picks a date/time, and the backend books a real Teams
    online-meeting event via Microsoft Graph. Until then the new hire sees "not scheduled yet".
    """
    __tablename__ = "manager_call_invites"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    new_hire_email = Column(String, index=True, nullable=False, unique=True)
    new_hire_name = Column(String, nullable=True)
    manager_email = Column(String, index=True, nullable=True)
    manager_name = Column(String, nullable=True)
    token = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, default="pending")              # pending | scheduled | cancelled
    scheduled_start = Column(DateTime, nullable=True)        # UTC
    scheduled_end = Column(DateTime, nullable=True)          # UTC
    teams_join_url = Column(String, nullable=True)
    graph_event_id = Column(String, nullable=True)
    graph_organizer_email = Column(String, nullable=True)   # mailbox that hosts the event
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    scheduled_at = Column(DateTime, nullable=True)           # when the manager picked the slot


# ── Insight Bus (ARB #48) ──────────────────────────────────────────────────────

class InsightSignalLog(Base):
    """Persistent log of all signals emitted to the InsightBus.

    Enables audit, replay on restart, and cross-worker signal sharing (future).
    """
    __tablename__ = "insight_signal_log"
    __table_args__ = {"schema": SCHEMA}

    id          = Column(Integer, primary_key=True, index=True)
    signal_type = Column(String, nullable=False, index=True)   # delivery_risk | skill_gap | …
    source_domain = Column(String, nullable=True)
    payload     = Column(JSON, nullable=True)                  # full signal as JSON
    emitted_at  = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    processed   = Column(Boolean, default=False)               # True once all reactors ran


class InsightNudgeLog(Base):
    """Audit trail for nudges proposed by InsightBus reactors.

    Separate from the live Nudge table — this is the immutable record of what
    was proposed and when, even if the Nudge was later dismissed.
    """
    __tablename__ = "insight_nudge_log"
    __table_args__ = {"schema": SCHEMA}

    id            = Column(Integer, primary_key=True, index=True)
    signal_log_id = Column(Integer, ForeignKey(f"{SCHEMA}.insight_signal_log.id"),
                           nullable=True, index=True)
    nudge_type    = Column(String, nullable=False)
    target_email  = Column(String, nullable=True, index=True)
    title         = Column(String, nullable=True)
    body          = Column(Text, nullable=True)
    priority      = Column(String, default="medium")
    action_hint   = Column(String, nullable=True)
    action_payload= Column(JSON, nullable=True)
    human_gate    = Column(Boolean, default=True)
    created_at    = Column(DateTime, default=datetime.datetime.utcnow)
