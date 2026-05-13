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
