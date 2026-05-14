from sqlalchemy import Column, Integer, String, Date, Float, ForeignKey, Text, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func
import datetime

Base = declarative_base()

# Schema for Postgres
SCHEMA = "enterprise_ai"

class Employee(Base):
    __tablename__ = "employees"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(String, unique=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    department = Column(String)
    designation = Column(String)
    manager_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    joining_date = Column(Date)
    employment_type = Column(String) # Full-time, Contract
    location = Column(String)
    pf_number = Column(String)
    insurance_plan = Column(String)
    tax_regime = Column(String) # Old, New
    shift_type = Column(String) # Day, Night
    
    # Relationships
    leaves = relationship("Leave", back_populates="employee")
    payroll = relationship("Payroll", back_populates="employee")
    attendance = relationship("Attendance", back_populates="employee")

class Leave(Base):
    __tablename__ = "leaves"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
    leave_type = Column(String) # Casual, Sick, Earned, Optional
    start_date = Column(Date)
    end_date = Column(Date)
    status = Column(String, default="Pending") # Pending, Approved, Rejected, Cancelled
    reason = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    employee = relationship("Employee", back_populates="leaves")

class Payroll(Base):
    __tablename__ = "payroll"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
    month = Column(Integer)
    year = Column(Integer)
    base_salary = Column(Float)
    bonus = Column(Float, default=0.0)
    deductions = Column(Float, default=0.0)
    net_salary = Column(Float)
    tax_paid = Column(Float)
    status = Column(String, default="Paid")
    
    employee = relationship("Employee", back_populates="payroll")

class Attendance(Base):
    __tablename__ = "attendance"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
    date = Column(Date)
    check_in = Column(DateTime, nullable=True)
    check_out = Column(DateTime, nullable=True)
    status = Column(String) # Present, Absent, WFH, Half-day
    
    employee = relationship("Employee", back_populates="attendance")

class Policy(Base):
    __tablename__ = "policies"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    category = Column(String) # Leave, WFH, etc.
    content = Column(Text)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow)

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



class Sprint(Base):
    __tablename__ = "sprints"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    team = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    start_date = Column(String)
    end_date = Column(String)
    velocity = Column(Integer, default=0)
    committed = Column(Integer, default=0)
    completed = Column(Integer, default=0)
    blockers_count = Column(Integer, default=0)


class TeamCapacity(Base):
    __tablename__ = "team_capacity"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    team = Column(String, unique=True, nullable=False, index=True)
    total_members = Column(Integer, default=0)
    available = Column(Integer, default=0)
    on_leave = Column(Integer, default=0)
    capacity_pct = Column(Float, default=100.0)


class Milestone(Base):
    __tablename__ = "milestones"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    project_name = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    due_date = Column(String)
    status = Column(String, default="UPCOMING")

# ── Admin Domain ──────────────────────────
class Reimbursement(Base):
    __tablename__ = "reimbursements"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
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
    employee_id = Column(Integer, ForeignKey("employees.id"))
    vehicle_type = Column(String)  # 2-wheeler, 4-wheeler
    vehicle_number = Column(String)
    sticker_number = Column(String, nullable=True)
    valid_from = Column(Date)
    valid_until = Column(Date)
    status = Column(String, default="Active")  # Active, Expired, Pending

class Accommodation(Base):
    __tablename__ = "accommodations"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
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
    employee_id = Column(Integer, ForeignKey("employees.id"))
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
    employee_id = Column(Integer, ForeignKey("employees.id"))
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
    employee_id = Column(Integer, ForeignKey("employees.id"))
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
    employee_id = Column(Integer, ForeignKey("employees.id"))
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
    employee_id = Column(Integer, ForeignKey("employees.id"))
    asset_type = Column(String)  # Laptop, Monitor, Keyboard, Mouse, Headset
    asset_tag = Column(String, unique=True)
    brand = Column(String)
    model = Column(String)
    serial_number = Column(String)
    assigned_date = Column(Date)
    returned_date = Column(Date, nullable=True)
    status = Column(String, default="Assigned")  # Assigned, Returned

# ── Manager Domain ────────────────────────
class TrainingAssignment(Base):
    __tablename__ = "training_assignments"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
    assigned_by = Column(Integer, ForeignKey("employees.id"))
    course_name = Column(String)
    platform = Column(String)  # Udemy, Coursera, LinkedIn Learning, Internal
    due_date = Column(Date)
    status = Column(String, default="Assigned")  # Assigned, In Progress, Completed, Overdue
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class EmployeeSkillMap(Base):
    __tablename__ = "employee_skills"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
    skill_name = Column(String)
    proficiency = Column(String)  # Beginner, Intermediate, Expert
    last_assessed = Column(Date)
    certified = Column(Boolean, default=False)

class ProjectAssignment(Base):
    __tablename__ = "project_assignments"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"))
    project_name = Column(String)
    role = Column(String)
    start_date = Column(Date)
    end_date = Column(Date, nullable=True)
    allocation_pct = Column(Float, default=100.0)
    status = Column(String, default="Active")  # Active, Completed, On Hold

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

# ── HITL Tracking ─────────────────────────
class HITLRequest(Base):
    __tablename__ = "hitl_requests"
    __table_args__ = {"schema": SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(String)
    ticket_id = Column(String)  # Reference to it_tickets.ticket_id
    request_type = Column(String)  # admin_password, approval, escalation
    status = Column(String, default="Pending")  # Pending, Completed, Expired
    requested_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String, nullable=True)
