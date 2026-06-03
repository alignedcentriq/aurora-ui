import os
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.orm import declarative_base, sessionmaker

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "centriq_pmo.db")
DATABASE_URL = f"sqlite:///{os.path.abspath(DB_PATH)}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    status = Column(String, default="In Progress")
    completion_pct = Column(Float, default=0.0)
    sprint_name = Column(String)
    next_milestone = Column(String)
    next_milestone_date = Column(String)
    owner = Column(String)


class Sprint(Base):
    __tablename__ = "sprints"
    id = Column(Integer, primary_key=True, index=True)
    team = Column(String, nullable=False)
    name = Column(String, nullable=False)
    start_date = Column(String)
    end_date = Column(String)
    velocity = Column(Integer, default=0)
    committed = Column(Integer, default=0)
    completed = Column(Integer, default=0)
    blockers_count = Column(Integer, default=0)


class TeamCapacity(Base):
    __tablename__ = "team_capacity"
    id = Column(Integer, primary_key=True, index=True)
    team = Column(String, unique=True, nullable=False)
    total_members = Column(Integer, default=0)
    available = Column(Integer, default=0)
    on_leave = Column(Integer, default=0)
    capacity_pct = Column(Float, default=100.0)


class Milestone(Base):
    __tablename__ = "milestones"
    id = Column(Integer, primary_key=True, index=True)
    project_name = Column(String, nullable=False)
    name = Column(String, nullable=False)
    due_date = Column(String)
    status = Column(String, default="UPCOMING")  # DONE | IN_PROGRESS | UPCOMING


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    _seed()


def _seed():
    db = SessionLocal()
    try:
        if db.query(Project).count() > 0:
            return  # Already seeded

        # Projects
        db.add_all([
            Project(name="Centriq AI", status="In Progress", completion_pct=65.0,
                    sprint_name="Sprint 5", next_milestone="UAT",
                    next_milestone_date="2026-05-20", owner="Suraj G."),
            Project(name="Aurora UI", status="In Progress", completion_pct=72.0,
                    sprint_name="Sprint 5", next_milestone="Frontend Integration",
                    next_milestone_date="2026-05-19", owner="Suraj G."),
            Project(name="HR Integration", status="In Progress", completion_pct=45.0,
                    sprint_name="Sprint 4", next_milestone="API Finalization",
                    next_milestone_date="2026-05-22", owner="Shivam K."),
            Project(name="Admin Dashboard", status="In Progress", completion_pct=55.0,
                    sprint_name="Sprint 5", next_milestone="Grafana Setup",
                    next_milestone_date="2026-05-21", owner="Priyanka M."),
            Project(name="IT Support Agent", status="Planning", completion_pct=20.0,
                    sprint_name="Sprint 3", next_milestone="DB Schema",
                    next_milestone_date="2026-05-18", owner="Kajal S."),
            Project(name="LangGraph Routing Engine", status="In Progress", completion_pct=60.0,
                    sprint_name="Sprint 5", next_milestone="Intent Classifier v1",
                    next_milestone_date="2026-05-19", owner="Shivani R."),
            Project(name="Vector Search Pipeline", status="In Progress", completion_pct=50.0,
                    sprint_name="Sprint 4", next_milestone="Embedding Indexing",
                    next_milestone_date="2026-05-20", owner="Shivani R."),
            Project(name="Document Generation Service", status="In Progress", completion_pct=70.0,
                    sprint_name="Sprint 5", next_milestone="PDF Template Polish",
                    next_milestone_date="2026-05-18", owner="Suraj G."),
            Project(name="Redis Cache Layer", status="In Progress", completion_pct=40.0,
                    sprint_name="Sprint 4", next_milestone="Session Store Integration",
                    next_milestone_date="2026-05-22", owner="Suraj G."),
            Project(name="Feedback Analytics", status="Planning", completion_pct=15.0,
                    sprint_name="Sprint 3", next_milestone="Schema Design",
                    next_milestone_date="2026-05-23", owner="Suraj G."),
            Project(name="Power Automate Integration", status="In Progress", completion_pct=35.0,
                    sprint_name="Sprint 4", next_milestone="Approval Flow Trigger",
                    next_milestone_date="2026-05-24", owner="Shivam K."),
            Project(name="Grafana Monitoring", status="Planning", completion_pct=25.0,
                    sprint_name="Sprint 3", next_milestone="Loki Log Ingestion",
                    next_milestone_date="2026-05-21", owner="Priyanka M."),
        ])

        # Sprints
        db.add_all([
            Sprint(team="Centriq Team", name="Sprint 5", start_date="2026-05-05",
                   end_date="2026-05-19", velocity=42, committed=38, completed=28, blockers_count=2),
            Sprint(team="Centriq Team", name="Sprint 4", start_date="2026-04-21",
                   end_date="2026-05-04", velocity=38, committed=35, completed=35, blockers_count=0),
            Sprint(team="Centriq Team", name="Sprint 3", start_date="2026-04-07",
                   end_date="2026-04-20", velocity=35, committed=30, completed=27, blockers_count=1),
            Sprint(team="Dev Team", name="Sprint 5", start_date="2026-05-05",
                   end_date="2026-05-19", velocity=50, committed=45, completed=38, blockers_count=3),
            Sprint(team="Dev Team", name="Sprint 4", start_date="2026-04-21",
                   end_date="2026-05-04", velocity=48, committed=44, completed=44, blockers_count=0),
            Sprint(team="PMO Team", name="Sprint 5", start_date="2026-05-05",
                   end_date="2026-05-19", velocity=30, committed=28, completed=20, blockers_count=1),
        ])

        # Team Capacity
        db.add_all([
            TeamCapacity(team="Centriq Team", total_members=5, available=4, on_leave=1, capacity_pct=80.0),
            TeamCapacity(team="Dev Team", total_members=6, available=5, on_leave=1, capacity_pct=83.0),
            TeamCapacity(team="PMO Team", total_members=3, available=3, on_leave=0, capacity_pct=100.0),
            TeamCapacity(team="QA Team", total_members=4, available=3, on_leave=1, capacity_pct=75.0),
            TeamCapacity(team="HR Team", total_members=4, available=4, on_leave=0, capacity_pct=100.0),
        ])

        # Milestones
        db.add_all([
            # Centriq AI
            Milestone(project_name="Centriq AI", name="Requirements Finalized",
                      due_date="2026-04-10", status="DONE"),
            Milestone(project_name="Centriq AI", name="Architecture Design",
                      due_date="2026-04-25", status="DONE"),
            Milestone(project_name="Centriq AI", name="Backend APIs",
                      due_date="2026-05-15", status="IN_PROGRESS"),
            Milestone(project_name="Centriq AI", name="Frontend Integration",
                      due_date="2026-05-19", status="IN_PROGRESS"),
            Milestone(project_name="Centriq AI", name="UAT",
                      due_date="2026-05-20", status="UPCOMING"),
            Milestone(project_name="Centriq AI", name="Production Deploy",
                      due_date="2026-05-25", status="UPCOMING"),
            # Aurora UI
            Milestone(project_name="Aurora UI", name="Component Library Setup",
                      due_date="2026-04-15", status="DONE"),
            Milestone(project_name="Aurora UI", name="Auth Integration",
                      due_date="2026-04-28", status="DONE"),
            Milestone(project_name="Aurora UI", name="Chat UI",
                      due_date="2026-05-10", status="DONE"),
            Milestone(project_name="Aurora UI", name="PMO Agent UI",
                      due_date="2026-05-19", status="IN_PROGRESS"),
            Milestone(project_name="Aurora UI", name="Final QA",
                      due_date="2026-05-22", status="UPCOMING"),
            # HR Integration
            Milestone(project_name="HR Integration", name="HR Agent Design",
                      due_date="2026-04-20", status="DONE"),
            Milestone(project_name="HR Integration", name="LangFuse Setup",
                      due_date="2026-05-10", status="DONE"),
            Milestone(project_name="HR Integration", name="API Finalization",
                      due_date="2026-05-22", status="UPCOMING"),
            # Admin Dashboard
            Milestone(project_name="Admin Dashboard", name="Wireframes Approved",
                      due_date="2026-04-18", status="DONE"),
            Milestone(project_name="Admin Dashboard", name="KPI Charts",
                      due_date="2026-05-08", status="DONE"),
            Milestone(project_name="Admin Dashboard", name="Grafana Setup",
                      due_date="2026-05-21", status="IN_PROGRESS"),
            Milestone(project_name="Admin Dashboard", name="Loki Integration",
                      due_date="2026-05-23", status="UPCOMING"),
            # IT Support Agent
            Milestone(project_name="IT Support Agent", name="Requirements Gathering",
                      due_date="2026-04-22", status="DONE"),
            Milestone(project_name="IT Support Agent", name="DB Schema",
                      due_date="2026-05-18", status="IN_PROGRESS"),
            Milestone(project_name="IT Support Agent", name="Agent Logic",
                      due_date="2026-05-24", status="UPCOMING"),
            Milestone(project_name="IT Support Agent", name="Testing",
                      due_date="2026-05-26", status="UPCOMING"),
            # LangGraph Routing Engine
            Milestone(project_name="LangGraph Routing Engine", name="Domain Taxonomy Defined",
                      due_date="2026-04-25", status="DONE"),
            Milestone(project_name="LangGraph Routing Engine", name="Intent Classifier v1",
                      due_date="2026-05-19", status="IN_PROGRESS"),
            Milestone(project_name="LangGraph Routing Engine", name="Multi-Agent Handoff",
                      due_date="2026-05-22", status="UPCOMING"),
            Milestone(project_name="LangGraph Routing Engine", name="Integration Testing",
                      due_date="2026-05-25", status="UPCOMING"),
            # Vector Search Pipeline
            Milestone(project_name="Vector Search Pipeline", name="Chunking Strategy",
                      due_date="2026-04-28", status="DONE"),
            Milestone(project_name="Vector Search Pipeline", name="Embeddings Model Selection",
                      due_date="2026-05-05", status="DONE"),
            Milestone(project_name="Vector Search Pipeline", name="Embedding Indexing",
                      due_date="2026-05-20", status="IN_PROGRESS"),
            Milestone(project_name="Vector Search Pipeline", name="pgvector Integration",
                      due_date="2026-05-24", status="UPCOMING"),
            # Document Generation Service
            Milestone(project_name="Document Generation Service", name="PDF Template Design",
                      due_date="2026-05-10", status="DONE"),
            Milestone(project_name="Document Generation Service", name="Report Generator",
                      due_date="2026-05-15", status="DONE"),
            Milestone(project_name="Document Generation Service", name="PDF Template Polish",
                      due_date="2026-05-18", status="IN_PROGRESS"),
            Milestone(project_name="Document Generation Service", name="Frontend Integration",
                      due_date="2026-05-21", status="UPCOMING"),
            # Redis Cache Layer
            Milestone(project_name="Redis Cache Layer", name="Redis Docker Setup",
                      due_date="2026-05-05", status="DONE"),
            Milestone(project_name="Redis Cache Layer", name="Session Store Integration",
                      due_date="2026-05-22", status="IN_PROGRESS"),
            Milestone(project_name="Redis Cache Layer", name="Rate Limiting",
                      due_date="2026-05-25", status="UPCOMING"),
            # Feedback Analytics
            Milestone(project_name="Feedback Analytics", name="Schema Design",
                      due_date="2026-05-23", status="IN_PROGRESS"),
            Milestone(project_name="Feedback Analytics", name="Store Thumbs Up/Down",
                      due_date="2026-05-26", status="UPCOMING"),
            Milestone(project_name="Feedback Analytics", name="Admin Dashboard Widget",
                      due_date="2026-05-28", status="UPCOMING"),
            # Power Automate Integration
            Milestone(project_name="Power Automate Integration", name="Flow Design",
                      due_date="2026-04-30", status="DONE"),
            Milestone(project_name="Power Automate Integration", name="Approval Flow Trigger",
                      due_date="2026-05-24", status="IN_PROGRESS"),
            Milestone(project_name="Power Automate Integration", name="Email Notifications",
                      due_date="2026-05-27", status="UPCOMING"),
            # Grafana Monitoring
            Milestone(project_name="Grafana Monitoring", name="Grafana Docker Setup",
                      due_date="2026-05-08", status="DONE"),
            Milestone(project_name="Grafana Monitoring", name="Loki Log Ingestion",
                      due_date="2026-05-21", status="IN_PROGRESS"),
            Milestone(project_name="Grafana Monitoring", name="API Latency Dashboard",
                      due_date="2026-05-25", status="UPCOMING"),
            Milestone(project_name="Grafana Monitoring", name="Alerting Rules",
                      due_date="2026-05-28", status="UPCOMING"),
        ])

        db.commit()
        print("DB seeded with dummy PMO data.")
    except Exception as e:
        db.rollback()
        print(f"DB seed error: {e}")
    finally:
        db.close()
