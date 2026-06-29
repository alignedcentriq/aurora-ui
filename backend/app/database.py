
import os
import time
import threading

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool, QueuePool
from sqlalchemy.orm import sessionmaker
from app.models import (
    Base,
    Employee,
    Leave,
    Attendance,
    Policy,
    PolicyChunk,
    PolicyImage,
    Project,
    Reimbursement,
    ITTicket,
    PromptConfig,
    PromptDraft,
    HITLRequest,
    ParkingSticker,
    Accommodation,
    FacilityComplaint,
    FoodVendorFeedback,
    EmployeeZohoProfile,
    EmployeeAllocation,
    Announcement,
    FoodComplaint,
    ChatFeedback,
    CachedAnswer,
    ApprovalToken,
    Grievance,
    CompanySettings,
    LeaveBalanceCache,
    ConversationSummary,
    UserMemory,
    ToolSession,
    AiRequestLog,
    AiLlmCallLog,
    GeneratedDocument,
    LeaveType,
    LeaveBalance,
    HRQuery,
    MS365User,
    EmployeeSkill,
    FormTemplate,
    UserRoleOverride,
    AppRole,
    RoleCapabilityMap,
    WelcomeResource,
    WelcomeLog,
    OnboardingRequest,
    OnboardingJourney,
    OnboardingStepProgress,
    OnboardingDocSubmission,
    PMOTeamRequest,
    Appreciation,
    Connector,
    ConnectorAuth,
    ConnectorOperation,
    ConnectorScope,
    ConnectorCallLog,
    Flow,
    FlowRun,
    FlowStepRun,
    Persona,
    PersonaAssignment,
    PersonaFeature,
    DashboardConfig,
    SavedDashboard,
    AutomationRule,
    PendingAction,
    TeTraining,
    TeTrainingLevel,
    TeMcqQuestion,
    TeAssignment,
    TeGroup,
    SCHEMA,
)
from app.config import settings
import datetime

# Database engine initialization
DATABASE_URL = settings.DATABASE_URL


_is_sqlite = DATABASE_URL.startswith("sqlite")
_base_engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool if _is_sqlite else QueuePool,
    **({} if _is_sqlite else {
        "pool_size": 20,
        "max_overflow": 10,
        "pool_pre_ping": True,
        "pool_recycle": 3600,
        # Server-side safety net: if any connection is left idle INSIDE a transaction
        # (e.g. a backend Ctrl-C'd mid-operation), Postgres aborts it after 5 min and
        # releases its locks, so orphaned transactions can't pile up and block the next
        # startup's migrations. Conservative (5 min) so it only catches true orphans,
        # never a transaction merely idle across a slow LLM/network call; the migration
        # lock_timeout (see _set_migration_timeouts) is what actually prevents the
        # "stuck migrating database" hang.
        "connect_args": {"options": "-c idle_in_transaction_session_timeout=300000"},
    }),
)
if _base_engine.dialect.name == "sqlite":
    engine = _base_engine.execution_options(schema_translate_map={SCHEMA: None})
else:
    engine = _base_engine
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _background_embed_policies():
    """Runs in a daemon thread — chunks + embeds all un-chunked policies."""
    try:
        from app.services.policy_service import PolicyService
        PolicyService.embed_all_policies()
    except Exception as e:
        pass



def _set_migration_timeouts(conn):
    """Bound how long a migration statement will WAIT to acquire a lock before aborting.

    On a shared database an idle-in-transaction session (or another running backend)
    can hold a lock on a table these migrations touch — a blocked CREATE INDEX / ALTER
    would otherwise hang the entire startup for the full 5-min launcher timeout. With a
    short lock_timeout the blocked statement aborts fast and falls through to the
    per-statement except handlers (skip-and-continue); the change applies on a later boot
    once the lock is free. lock_timeout fires only while WAITING for a lock, so it never
    aborts a legitimately long index build that has already started.
    """
    try:
        conn.execute(text("SET lock_timeout = '5s'"))
        conn.commit()
    except Exception:
        conn.rollback()


def init_db():
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()

    Base.metadata.create_all(bind=engine)

    # Migrations for SQLite
    if _base_engine.dialect.name == "sqlite":
        with engine.connect() as conn:
            try:
                conn.execute(text("ALTER TABLE employees ADD COLUMN role VARCHAR"))
                conn.commit()
            except Exception:
                # Column likely already exists
                pass

    # Drop removed tables
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            _set_migration_timeouts(conn)
            try:
                conn.execute(text(f'DROP TABLE IF EXISTS "{SCHEMA}".payroll CASCADE'))
                conn.commit()
            except Exception:
                conn.rollback()

    # Migrations: add columns that may not exist in older deployments
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            _set_migration_timeouts(conn)
            for stmt in [
                f'ALTER TABLE "{SCHEMA}".employees ADD COLUMN IF NOT EXISTS location VARCHAR',
                f'ALTER TABLE "{SCHEMA}".projects ADD COLUMN IF NOT EXISTS achievements TEXT',
                f'ALTER TABLE "{SCHEMA}".employee_allocations ADD COLUMN IF NOT EXISTS expected_end_date DATE',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_make VARCHAR',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR',
                f'ALTER TABLE "{SCHEMA}".announcements ADD COLUMN IF NOT EXISTS image_url VARCHAR',
                f'ALTER TABLE "{SCHEMA}".announcements ADD COLUMN IF NOT EXISTS image_action JSONB',
                f'ALTER TABLE "{SCHEMA}".announcements ADD COLUMN IF NOT EXISTS email_recipients JSONB',
                f'ALTER TABLE "{SCHEMA}".food_complaints ADD COLUMN IF NOT EXISTS closure_comment TEXT',
                f'ALTER TABLE "{SCHEMA}".food_complaints ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP',
                f'ALTER TABLE "{SCHEMA}".food_complaints ADD COLUMN IF NOT EXISTS ticket_id VARCHAR',
                f'ALTER TABLE "{SCHEMA}".policy_chunks ADD COLUMN IF NOT EXISTS image_urls JSONB',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".company_settings ('
                f'  key VARCHAR PRIMARY KEY, value TEXT NOT NULL DEFAULT \'\','
                f'  updated_at TIMESTAMP, updated_by VARCHAR'
                f')',
                f'ALTER TABLE "{SCHEMA}".policies ADD COLUMN IF NOT EXISTS minio_key VARCHAR',
                f'ALTER TABLE "{SCHEMA}".policies ADD COLUMN IF NOT EXISTS minio_etag VARCHAR',
                # Safe rename: only renames if the old column still exists
                f'DO $$ BEGIN '
                f'IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = \'{SCHEMA}\' AND table_name = \'policies\' AND column_name = \'minio_key\') '
                f'THEN ALTER TABLE "{SCHEMA}".policies RENAME COLUMN minio_key TO source_key; END IF; END $$',
                f'DO $$ BEGIN '
                f'IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = \'{SCHEMA}\' AND table_name = \'policies\' AND column_name = \'minio_etag\') '
                f'THEN ALTER TABLE "{SCHEMA}".policies RENAME COLUMN minio_etag TO source_etag; END IF; END $$',
                # BM25 full-text search on policy chunks (Phase 2 RAG upgrade)
                f'ALTER TABLE "{SCHEMA}".policy_chunks ADD COLUMN IF NOT EXISTS text_tsv tsvector '
                f"GENERATED ALWAYS AS (to_tsvector('english', COALESCE(text, ''))) STORED",
                # User memory HNSW index (created after table exists via Base.metadata.create_all)
                f'CREATE INDEX IF NOT EXISTS idx_user_memories_email ON "{SCHEMA}".user_memories(user_email)',
                # Self-serve skills editor: per-skill metadata + uploaded certification file
                f'ALTER TABLE "{SCHEMA}".employee_skills ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE',
                f'ALTER TABLE "{SCHEMA}".employee_skills ADD COLUMN IF NOT EXISTS years_experience DOUBLE PRECISION',
                f'ALTER TABLE "{SCHEMA}".employee_skills ADD COLUMN IF NOT EXISTS last_used DATE',
                f'ALTER TABLE "{SCHEMA}".employee_skills ADD COLUMN IF NOT EXISTS cert_file_data BYTEA',
                f'ALTER TABLE "{SCHEMA}".employee_skills ADD COLUMN IF NOT EXISTS cert_file_name VARCHAR',
                f'ALTER TABLE "{SCHEMA}".employee_skills ADD COLUMN IF NOT EXISTS cert_content_type VARCHAR',
                # Training-license requests: which platform (Udemy / Coursera / …)
                f'ALTER TABLE "{SCHEMA}".udemy_license_requests ADD COLUMN IF NOT EXISTS platform VARCHAR DEFAULT \'Udemy\'',
                # Document generation: approval-gated verification fields
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT \'draft\'',
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS verify_token VARCHAR',
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS verified_by_email VARCHAR',
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP',
                # Template-driven generation: filled placeholder values for audit/re-render
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS field_values JSONB',
                f'CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_documents_verify_token ON "{SCHEMA}".generated_documents(verify_token)',
                # DOCX mail-merge generation: raw Word template bytes + the filled .docx of each issued document
                f'ALTER TABLE "{SCHEMA}".document_templates ADD COLUMN IF NOT EXISTS template_blob BYTEA',
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS rendered_docx BYTEA',
                # MS365 directory: richer profile fields + manager hierarchy (require User.Read.All)
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS employee_id VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS employee_type VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS company_name VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS business_phone VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS city VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS state VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS country VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS account_enabled BOOLEAN',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS hire_date TIMESTAMP',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS manager_email VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ms365_users ADD COLUMN IF NOT EXISTS manager_name VARCHAR',
                # Super Admin role override table (Base.metadata.create_all handles new table; index is additive)
                f'CREATE INDEX IF NOT EXISTS idx_user_role_overrides_email ON "{SCHEMA}".user_role_overrides(email)',
                # Welcome system: unique indexes on token columns
                f'CREATE UNIQUE INDEX IF NOT EXISTS idx_welcome_logs_send_token ON "{SCHEMA}".welcome_logs(send_token)',
                f'CREATE UNIQUE INDEX IF NOT EXISTS idx_welcome_logs_skip_token ON "{SCHEMA}".welcome_logs(skip_token)',
                # URL Library + Form Library: chat intercept keywords
                f'ALTER TABLE "{SCHEMA}".app_links ADD COLUMN IF NOT EXISTS trigger_keywords TEXT',
                f'ALTER TABLE "{SCHEMA}".form_templates ADD COLUMN IF NOT EXISTS trigger_keywords TEXT',
                # Appreciations index
                f'CREATE INDEX IF NOT EXISTS idx_appreciations_employee_email ON "{SCHEMA}".appreciations(employee_email)',
                # Dynamic access management: additive per-user capability grants beyond assigned role
                f'ALTER TABLE "{SCHEMA}".user_role_overrides ADD COLUMN IF NOT EXISTS extra_capabilities JSONB',
                # Dynamic access management: role + capability map tables (create_all handles new tables;
                # these indexes are additive and idempotent)
                f'CREATE INDEX IF NOT EXISTS idx_role_capability_maps_role_slug ON "{SCHEMA}".role_capability_maps(role_slug)',
                f'CREATE INDEX IF NOT EXISTS idx_role_capability_maps_cap_key ON "{SCHEMA}".role_capability_maps(capability_key)',
                # Observability content-reveal audit trail (safety net — create_all handles it but this is idempotent)
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".content_reveal_audits ('
                f'  id SERIAL PRIMARY KEY,'
                f'  request_log_id INTEGER REFERENCES "{SCHEMA}".ai_request_logs(id) ON DELETE CASCADE,'
                f'  viewer_email VARCHAR,'
                f'  viewer_oid VARCHAR,'
                f'  domain VARCHAR,'
                f'  reason TEXT,'
                f'  created_at TIMESTAMP DEFAULT NOW()'
                f')',
                # Backfill viewer_oid column for tables created before it was added
                f'ALTER TABLE "{SCHEMA}".content_reveal_audits ADD COLUMN IF NOT EXISTS viewer_oid VARCHAR',
                # Phase 0: Latency SLO instrumentation on ai_request_logs
                f'ALTER TABLE "{SCHEMA}".ai_request_logs ADD COLUMN IF NOT EXISTS time_to_first_token_ms INTEGER',
                f'ALTER TABLE "{SCHEMA}".ai_request_logs ADD COLUMN IF NOT EXISTS queue_wait_ms INTEGER',
                f'ALTER TABLE "{SCHEMA}".ai_request_logs ADD COLUMN IF NOT EXISTS gate_result VARCHAR',
                f'ALTER TABLE "{SCHEMA}".ai_request_logs ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN DEFAULT FALSE',
                f'ALTER TABLE "{SCHEMA}".ai_request_logs ADD COLUMN IF NOT EXISTS served_from VARCHAR',
                # Phase 0: Per-LLM-call TTFT tracking
                f'ALTER TABLE "{SCHEMA}".ai_llm_call_logs ADD COLUMN IF NOT EXISTS ttft_ms INTEGER',
                # M1: Connector platform — core registry tables
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".connectors ('
                f'  id SERIAL PRIMARY KEY, slug VARCHAR UNIQUE NOT NULL, name VARCHAR NOT NULL,'
                f'  description TEXT, source_type VARCHAR NOT NULL, base_url VARCHAR,'
                f'  spec_blob BYTEA, spec_url VARCHAR, status VARCHAR DEFAULT \'draft\','
                f'  version INTEGER DEFAULT 1, created_by VARCHAR,'
                f'  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_connectors_slug ON "{SCHEMA}".connectors(slug)',
                f'CREATE INDEX IF NOT EXISTS idx_connectors_status ON "{SCHEMA}".connectors(status)',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".connector_auths ('
                f'  id SERIAL PRIMARY KEY,'
                f'  connector_id INTEGER UNIQUE REFERENCES "{SCHEMA}".connectors(id) ON DELETE CASCADE,'
                f'  auth_type VARCHAR NOT NULL, auth_mode VARCHAR DEFAULT \'service\','
                f'  config_enc TEXT, updated_at TIMESTAMP DEFAULT NOW()'
                f')',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".connector_operations ('
                f'  id SERIAL PRIMARY KEY,'
                f'  connector_id INTEGER REFERENCES "{SCHEMA}".connectors(id) ON DELETE CASCADE,'
                f'  name VARCHAR NOT NULL, display_name VARCHAR, description TEXT,'
                f'  method VARCHAR, path_template VARCHAR,'
                f'  params_schema JSONB, response_map JSONB,'
                f'  requires_confirmation BOOLEAN DEFAULT FALSE,'
                f'  minutes_saved DOUBLE PRECISION DEFAULT 0,'
                f'  response_mode VARCHAR DEFAULT \'passthrough\', template TEXT,'
                f'  enabled BOOLEAN DEFAULT TRUE, version INTEGER DEFAULT 1,'
                f'  python_ref VARCHAR, mcp_tool_name VARCHAR,'
                f'  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_connector_ops_connector_id ON "{SCHEMA}".connector_operations(connector_id)',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".connector_scopes ('
                f'  id SERIAL PRIMARY KEY,'
                f'  connector_id INTEGER REFERENCES "{SCHEMA}".connectors(id) ON DELETE CASCADE,'
                f'  operation_id INTEGER REFERENCES "{SCHEMA}".connector_operations(id) ON DELETE CASCADE,'
                f'  persona_id INTEGER, role VARCHAR, department VARCHAR'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_connector_scopes_connector ON "{SCHEMA}".connector_scopes(connector_id)',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".connector_call_logs ('
                f'  id SERIAL PRIMARY KEY,'
                f'  connector_id INTEGER REFERENCES "{SCHEMA}".connectors(id) ON DELETE SET NULL,'
                f'  operation_id INTEGER REFERENCES "{SCHEMA}".connector_operations(id) ON DELETE SET NULL,'
                f'  user_email VARCHAR, request_log_id INTEGER,'
                f'  flow_run_id INTEGER, status VARCHAR DEFAULT \'success\','
                f'  latency_ms INTEGER, error TEXT, created_at TIMESTAMP DEFAULT NOW()'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_connector_call_logs_created ON "{SCHEMA}".connector_call_logs(created_at)',
                f'CREATE INDEX IF NOT EXISTS idx_connector_call_logs_user ON "{SCHEMA}".connector_call_logs(user_email)',
                # M1: Connector platform — router examples FK
                f'ALTER TABLE "{SCHEMA}".router_examples ADD COLUMN IF NOT EXISTS connector_operation_id INTEGER REFERENCES "{SCHEMA}".connector_operations(id) ON DELETE SET NULL',
                # M2: Document template additive columns
                f'ALTER TABLE "{SCHEMA}".document_templates ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT \'sharepoint\'',
                f'ALTER TABLE "{SCHEMA}".document_templates ADD COLUMN IF NOT EXISTS created_by VARCHAR',
                f'ALTER TABLE "{SCHEMA}".document_templates ADD COLUMN IF NOT EXISTS category VARCHAR',
                f'CREATE INDEX IF NOT EXISTS idx_document_templates_category ON "{SCHEMA}".document_templates(category)',
                # M2: Persona layer
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".personas ('
                f'  id SERIAL PRIMARY KEY, name VARCHAR UNIQUE NOT NULL, description TEXT,'
                f'  match_rules JSONB, priority INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE,'
                f'  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()'
                f')',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".persona_assignments ('
                f'  id SERIAL PRIMARY KEY,'
                f'  persona_id INTEGER REFERENCES "{SCHEMA}".personas(id) ON DELETE CASCADE,'
                f'  user_email VARCHAR UNIQUE NOT NULL,'
                f'  assigned_by VARCHAR, created_at TIMESTAMP DEFAULT NOW()'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_persona_assignments_email ON "{SCHEMA}".persona_assignments(user_email)',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".persona_features ('
                f'  id SERIAL PRIMARY KEY,'
                f'  persona_id INTEGER REFERENCES "{SCHEMA}".personas(id) ON DELETE CASCADE,'
                f'  feature_type VARCHAR NOT NULL, feature_ref VARCHAR NOT NULL,'
                f'  config JSONB, sort_order INTEGER DEFAULT 0'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_persona_features_persona ON "{SCHEMA}".persona_features(persona_id)',
                # M5: Dashboard config
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".dashboard_configs ('
                f'  id SERIAL PRIMARY KEY,'
                f'  persona_id INTEGER REFERENCES "{SCHEMA}".personas(id) ON DELETE CASCADE,'
                f'  role VARCHAR, widgets JSONB,'
                f'  updated_by VARCHAR, updated_at TIMESTAMP DEFAULT NOW()'
                f')',
                # connector_scopes.persona_id FK (added after personas table exists)
                f'DO $$ BEGIN '
                f'IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = \'fk_connector_scopes_persona\') THEN '
                f'ALTER TABLE "{SCHEMA}".connector_scopes ADD CONSTRAINT fk_connector_scopes_persona '
                f'FOREIGN KEY (persona_id) REFERENCES "{SCHEMA}".personas(id) ON DELETE CASCADE; '
                f'END IF; END $$',
                # Connector access: grant to one specific user (alongside role/dept/persona)
                f'ALTER TABLE "{SCHEMA}".connector_scopes ADD COLUMN IF NOT EXISTS user_email VARCHAR',
                f'CREATE INDEX IF NOT EXISTS idx_connector_scopes_user_email ON "{SCHEMA}".connector_scopes(user_email)',
                # M3: Flow engine
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".flows ('
                f'  id SERIAL PRIMARY KEY, name VARCHAR NOT NULL, description TEXT,'
                f'  trigger JSONB, definition JSONB,'
                f'  is_active BOOLEAN DEFAULT FALSE, version INTEGER DEFAULT 1,'
                f'  minutes_saved DOUBLE PRECISION DEFAULT 0,'
                f'  created_by VARCHAR, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()'
                f')',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".flow_runs ('
                f'  id SERIAL PRIMARY KEY,'
                f'  flow_id INTEGER REFERENCES "{SCHEMA}".flows(id) ON DELETE CASCADE,'
                f'  status VARCHAR DEFAULT \'running\', context JSONB, current_step VARCHAR,'
                f'  started_by VARCHAR, started_at TIMESTAMP DEFAULT NOW(), finished_at TIMESTAMP'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_flow_runs_status ON "{SCHEMA}".flow_runs(status)',
                f'CREATE INDEX IF NOT EXISTS idx_flow_runs_started ON "{SCHEMA}".flow_runs(started_at)',
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".flow_step_runs ('
                f'  id SERIAL PRIMARY KEY,'
                f'  flow_run_id INTEGER REFERENCES "{SCHEMA}".flow_runs(id) ON DELETE CASCADE,'
                f'  step_id VARCHAR, step_type VARCHAR, status VARCHAR DEFAULT \'pending\','
                f'  input JSONB, output JSONB, error TEXT,'
                f'  started_at TIMESTAMP, finished_at TIMESTAMP'
                f')',
                f'CREATE INDEX IF NOT EXISTS idx_flow_step_runs_run ON "{SCHEMA}".flow_step_runs(flow_run_id)',
                # ROI / Analytics Studio: user-built dashboards (create_all handles the table; index is additive)
                f'CREATE INDEX IF NOT EXISTS idx_saved_dashboards_owner ON "{SCHEMA}".saved_dashboards(owner_email)',
                # roi_digest automation: kind + period config on automation_rules
                f'ALTER TABLE "{SCHEMA}".automation_rules ADD COLUMN IF NOT EXISTS automation_kind VARCHAR DEFAULT \'email\'',
                f'ALTER TABLE "{SCHEMA}".automation_rules ADD COLUMN IF NOT EXISTS extra_config JSON',
                # Feedback-triage flywheel: mark a thumbs-down once an admin has acted on it
                # (promoted a curated answer / routing fix / dismissed) so it leaves the queue.
                f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMP',
                f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN IF NOT EXISTS triaged_action VARCHAR',
                f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN IF NOT EXISTS triaged_by VARCHAR',
                # Alchemy directory enrichment: per-employee skills + projects, synced from
                # the Alchemy API into our DB so the directory serves them inline (no per-open
                # API call). Keyed by AASPL employee code.
                f'CREATE TABLE IF NOT EXISTS "{SCHEMA}".alchemy_profile_cache ('
                f'  employee_code VARCHAR PRIMARY KEY,'
                f'  skills JSONB DEFAULT \'[]\'::jsonb,'
                f'  projects JSONB DEFAULT \'[]\'::jsonb,'
                f'  available BOOLEAN DEFAULT TRUE,'
                f'  fetched_at TIMESTAMP DEFAULT NOW()'
                f')',
            ]:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception as e:
                    conn.rollback()  # clear error state so the next migration can still run

    # pgvector column migrations: convert TEXT embeddings to vector(768)
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            _set_migration_timeouts(conn)
            # policy_chunks.embedding: TEXT → vector(768). Wrapped so a lock_timeout
            # (blocked by another session) skips-and-continues instead of crashing boot.
            try:
                row = conn.execute(text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_schema = :s AND table_name = 'policy_chunks' AND column_name = 'embedding'"
                ), {"s": SCHEMA}).fetchone()
                if row and row[0] == "text":
                    conn.execute(text(f'ALTER TABLE "{SCHEMA}".policy_chunks DROP COLUMN embedding'))
                    conn.execute(text(f'ALTER TABLE "{SCHEMA}".policy_chunks ADD COLUMN embedding vector(768)'))
                    conn.commit()
            except Exception:
                conn.rollback()

            # chat_feedback.user_message_embedding: add as vector(768) or convert from TEXT
            try:
                row = conn.execute(text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_schema = :s AND table_name = 'chat_feedback' AND column_name = 'user_message_embedding'"
                ), {"s": SCHEMA}).fetchone()
                if row is None:
                    conn.execute(text(f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN user_message_embedding vector(768)'))
                    conn.commit()
                elif row[0] == "text":
                    conn.execute(text(f'ALTER TABLE "{SCHEMA}".chat_feedback DROP COLUMN user_message_embedding'))
                    conn.execute(text(f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN user_message_embedding vector(768)'))
                    conn.commit()
            except Exception:
                conn.rollback()

            # HNSW indexes for fast approximate nearest-neighbour search
            for idx_stmt in [
                f'CREATE INDEX IF NOT EXISTS idx_policy_chunks_embedding_hnsw ON "{SCHEMA}".policy_chunks '
                f'USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                f'CREATE INDEX IF NOT EXISTS idx_chat_feedback_embedding_hnsw ON "{SCHEMA}".chat_feedback '
                f'USING hnsw (user_message_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                # GIN index for BM25 full-text search on policy chunks
                f'CREATE INDEX IF NOT EXISTS idx_policy_chunks_tsv ON "{SCHEMA}".policy_chunks USING gin(text_tsv)',
                # HNSW index for user memory semantic search
                f'CREATE INDEX IF NOT EXISTS idx_user_memories_embedding_hnsw ON "{SCHEMA}".user_memories '
                f'USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                # HNSW index for the semantic answer cache (instant repeat-question lookups)
                f'CREATE INDEX IF NOT EXISTS idx_cached_answers_embedding_hnsw ON "{SCHEMA}".cached_answers '
                f'USING hnsw (query_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                # HNSW index for the semantic intent router (nearest labeled seed utterance)
                f'CREATE INDEX IF NOT EXISTS idx_router_examples_embedding_hnsw ON "{SCHEMA}".router_examples '
                f'USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                # HNSW index for the admin URL library (nearest registered app for a query)
                f'CREATE INDEX IF NOT EXISTS idx_app_links_embedding_hnsw ON "{SCHEMA}".app_links '
                f'USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                # HNSW index for the Form Library (nearest admin-defined form for a query)
                f'CREATE INDEX IF NOT EXISTS idx_form_templates_embedding_hnsw ON "{SCHEMA}".form_templates '
                f'USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
                # HNSW index for Project IQ (nearest past project to a "have we done this?" query)
                f'CREATE INDEX IF NOT EXISTS idx_project_profiles_embedding_hnsw ON "{SCHEMA}".project_profiles '
                f'USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
            ]:
                try:
                    conn.execute(text(idx_stmt))
                    conn.commit()
                except Exception as e:
                    conn.rollback()  # clear aborted txn so the next index still runs

            # employees.role: added with the Role & Access Management feature. create_all()
            # never adds columns to an existing table, so back-fill it idempotently here.
            try:
                conn.execute(text(
                    f'ALTER TABLE "{SCHEMA}".employees ADD COLUMN IF NOT EXISTS role VARCHAR'
                ))
                conn.commit()
            except Exception as e:
                conn.rollback()

            for _col_stmt in [
                f'ALTER TABLE "{SCHEMA}".automation_rules ADD COLUMN IF NOT EXISTS minute INTEGER DEFAULT 0',
                f'ALTER TABLE "{SCHEMA}".automation_rules ADD COLUMN IF NOT EXISTS co_owners_json JSON DEFAULT \'[]\'::json',
                f'ALTER TABLE "{SCHEMA}".attendance_schedules ADD COLUMN IF NOT EXISTS minute INTEGER DEFAULT 0',
                f'ALTER TABLE "{SCHEMA}".travel_requests ADD COLUMN IF NOT EXISTS expense_limit_currency VARCHAR DEFAULT \'INR\'',
                f'ALTER TABLE "{SCHEMA}".travel_expense_claims ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT \'INR\'',
                # Project IQ — evidence drill-through (fact → source PolicyChunk) + triage signals
                f'ALTER TABLE "{SCHEMA}".project_capabilities ADD COLUMN IF NOT EXISTS source_chunk_id INTEGER',
                f'ALTER TABLE "{SCHEMA}".project_integrations ADD COLUMN IF NOT EXISTS source_chunk_id INTEGER',
                f'ALTER TABLE "{SCHEMA}".project_lessons ADD COLUMN IF NOT EXISTS source_chunk_id INTEGER',
                f'ALTER TABLE "{SCHEMA}".project_reusable_assets ADD COLUMN IF NOT EXISTS source_chunk_id INTEGER',
                f'ALTER TABLE "{SCHEMA}".project_expertise ADD COLUMN IF NOT EXISTS source_chunk_id INTEGER',
                f'ALTER TABLE "{SCHEMA}".project_profiles ADD COLUMN IF NOT EXISTS query_count INTEGER DEFAULT 0',
                f'ALTER TABLE "{SCHEMA}".project_profiles ADD COLUMN IF NOT EXISTS last_queried_at TIMESTAMP',
            ]:
                try:
                    conn.execute(text(_col_stmt))
                    conn.commit()
                except Exception as e:
                    conn.rollback()

    db = SessionLocal()

    try:
        if db.query(PromptConfig).count() == 0:
            _seed_prompt_configs(db)
        else:
            _migrate_prompt_configs(db)
        if db.query(LeaveType).count() == 0:
            _seed_leave_types(db)
        if db.query(WelcomeResource).count() == 0:
            _seed_welcome_resources(db)
        _ = db.query(ChatFeedback).count()

        # Background thread: embeds any chunks still missing vectors
        try:
            threading.Thread(target=_background_embed_policies, daemon=True).start()
        except Exception as e:
            pass

        # Background thread: idempotently seed/back-fill the semantic intent router examples.
        # Non-blocking and self-healing — rows that failed to embed (ml01 down) back-fill next boot.
        try:
            from app.services.semantic_router_service import SemanticRouterService
            threading.Thread(target=SemanticRouterService.seed_from_catalog, daemon=True).start()
        except Exception as e:
            pass

        # Background thread: back-fill embeddings for URL-library rows that failed to embed
        # (admin added an app while ml01 was down). Self-healing on next boot.
        try:
            from app.services.app_directory_service import AppDirectoryService
            threading.Thread(target=AppDirectoryService.backfill_embeddings, daemon=True).start()
        except Exception as e:
            pass

        # Background thread: seed default forms (idempotent) then back-fill any Form Library
        # rows whose embedding is NULL (admin created a form while the embed model was down).
        try:
            def _form_library_boot():
                _seed_form_templates(SessionLocal())
                from app.services.form_library_service import FormLibraryService
                FormLibraryService.backfill_embeddings()
            threading.Thread(target=_form_library_boot, daemon=True).start()
        except Exception as e:
            pass

        # Background thread: seed the local TechElevate LMS (8 trainings + a spread of
        # assignments/completions) so the learning flywheel + analytics show live data.
        # Idempotent and self-contained; no-ops when TECHELEVATE_LOCAL is off.
        try:
            from app.config import settings as _s
            if getattr(_s, "TECHELEVATE_LOCAL", False):
                def _techelevate_local_boot():
                    from app.services.techelevate_local_service import seed_local_data
                    _db = SessionLocal()
                    try:
                        seed_local_data(_db)
                    finally:
                        _db.close()
                threading.Thread(target=_techelevate_local_boot, daemon=True).start()
        except Exception as e:
            pass

        # Background thread: polls SharePoint for new/changed policy documents
        try:
            from app.config import settings as _s
            if _s.SHAREPOINT_SITE_URL:
                from app.services.sharepoint_policy_sync import sharepoint_sync_loop
                _sp_interval = _s.SHAREPOINT_SYNC_INTERVAL
                threading.Thread(target=sharepoint_sync_loop, daemon=True).start()
            else:
                pass
        except Exception as e:
            pass

        # Background thread: polls the SharePoint "Projects" tree (summaries,
        # demo transcripts, project details) into the Project Showcase category
        try:
            from app.config import settings as _s
            if _s.SHAREPOINT_SITE_URL and getattr(_s, "SHAREPOINT_PROJECTS_ROOT", ""):
                from app.services.sharepoint_project_sync import project_sync_loop
                threading.Thread(target=project_sync_loop, daemon=True).start()
            else:
                pass
        except Exception as e:
            pass

# Background thread: keep the Alchemy directory-enrichment cache (skills +
        # projects per employee) warm so the directory serves them inline, no per-open
        # API call. No-ops when no service identity is connected.
        try:
            from app.config import settings as _s
            if getattr(_s, "ALCHEMY_SKILL_SEARCH_ENABLED", False):
                from app.services.alchemy_service import alchemy_enrichment_sync_loop
                threading.Thread(target=alchemy_enrichment_sync_loop, daemon=True).start()
        except Exception as e:
            pass

        # Background thread: accrues parking dues daily and emails reminders on the configured cadence
        try:
            from app.config import settings as _s
            if getattr(_s, "PARKING_REMINDER_SENDER", "") or _s.NOTIFY_TO_EMAIL:
                from app.services.parking_payment_service import parking_reminder_loop
                threading.Thread(target=parking_reminder_loop, daemon=True).start()
            else:
                pass
        except Exception as e:
            pass

    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()





def _seed_leave_types(db):
    """Seed the four standard leave types."""
    db.add_all([
        LeaveType(name="Casual Leave", code="CL", annual_entitlement=12, is_earned=False, carry_forward=False),
        LeaveType(name="Privileged Leave", code="PL", annual_entitlement=15, is_earned=False, carry_forward=True),
        LeaveType(name="Leave Without Pay", code="LWP", annual_entitlement=None, is_earned=False, carry_forward=False),
        LeaveType(name="Compensatory Off", code="CO", annual_entitlement=None, is_earned=True, carry_forward=False),
    ])
    db.commit()


# Default forms seeded into the Form Library so the feature is demoable out-of-the-box and the
# migrated Visitor Pass / Parking flows have a data-driven equivalent. Idempotent: only a form
# whose name doesn't already exist is inserted, so admin edits/deletes are never overwritten.
_DEFAULT_FORM_TEMPLATES = [
    {
        "name": "Visitor Pass",
        "description": ("Request a visitor / guest pass for someone coming to the office. "
                        "Register a visitor, guest entry, gate pass for a client or candidate."),
        "category": "Admin",
        "fields": [
            {"name": "visitor_name", "label": "Visitor Name", "type": "text", "required": True},
            {"name": "visitor_company", "label": "Visitor Company", "type": "text", "required": False},
            {"name": "visit_date", "label": "Visit Date", "type": "date", "required": True},
            {"name": "visit_time", "label": "Visit Time", "type": "text", "required": False,
             "placeholder": "e.g. 2:30 PM"},
            {"name": "purpose", "label": "Purpose of Visit", "type": "textarea", "required": True},
        ],
    },
    {
        "name": "Parking Request",
        "description": ("Request a parking sticker / parking spot for your vehicle. "
                        "Apply for office parking, car or bike parking permit."),
        "category": "Admin",
        "fields": [
            {"name": "vehicle_type", "label": "Vehicle Type", "type": "select", "required": True,
             "options": ["Car", "Bike", "Other"]},
            {"name": "vehicle_number", "label": "Vehicle Number", "type": "text", "required": True},
            {"name": "vehicle_make", "label": "Make", "type": "text", "required": False},
            {"name": "vehicle_model", "label": "Model", "type": "text", "required": False},
        ],
    },
    {
        "name": "Food Complaint",
        "description": ("Report a cafeteria or food quality complaint. "
                        "Food contamination, hygiene issue, wrong order, poor quality, service issue."),
        "category": "Admin",
        "trigger_keywords": "food,cafeteria,meal,lunch,canteen,contamination,hygiene,food quality,food complaint",
        "notify_domain": "admin",
        "fields": [
            {"name": "time_of_incident", "label": "Time of Incident", "type": "text", "required": False,
             "placeholder": "e.g. 1:00 PM"},
            {"name": "location", "label": "Location", "type": "select", "required": True,
             "options": ["Tower 2, 10th Floor", "Tower 3, 6th Floor", "Tower 3, 8th Floor", "Other"]},
            {"name": "feedback_category", "label": "Feedback Category", "type": "select", "required": True,
             "options": ["Food Quality", "Service Issue", "Other"]},
            {"name": "nature_of_complaint", "label": "Nature of Complaint", "type": "select", "required": True,
             "options": ["Contamination", "Hygiene", "Taste / Flavour", "Portion Size", "Temperature"]},
            {"name": "description", "label": "Description", "type": "textarea", "required": True,
             "placeholder": "Describe the issue in detail..."},
        ],
    },
    {
        "name": "Facility Complaint",
        "description": ("Report a facility issue or maintenance complaint at the office. "
                        "AC not working, lights flickering, lift stuck, washroom dirty, "
                        "housekeeping complaint, broken furniture, plumbing or electrical issue."),
        "category": "Admin",
        "trigger_keywords": "facility,complaint,ac,housekeeping,lift,lights,washroom,maintenance,broken,plumbing,electrical",
        "notify_domain": "admin",
        "fields": [
            {"name": "complaint_type", "label": "Complaint Type", "type": "select", "required": True,
             "options": ["AC/HVAC", "Electrical", "Plumbing", "Housekeeping", "Furniture", "Lift/Elevator", "Cafeteria", "Other"]},
            {"name": "priority", "label": "Priority", "type": "select", "required": True,
             "options": ["Low", "Medium", "High", "Critical"]},
            {"name": "location", "label": "Location", "type": "select", "required": True,
             "options": ["T-2 10th Floor", "T-3 6th Floor", "T-3 8th Floor", "Indore Office", "Other"]},
            {"name": "action_item", "label": "Action Item", "type": "textarea", "required": True,
             "placeholder": "Describe the issue in detail..."},
        ],
    },
]


def _seed_form_templates(db):
    """Seed default Form Library templates if absent (idempotent by name)."""
    try:
        from app.services.form_library_service import FormLibraryService
        for spec in _DEFAULT_FORM_TEMPLATES:
            if db.query(FormTemplate).filter(FormTemplate.name == spec["name"]).first():
                continue
            row = FormTemplate(
                name=spec["name"],
                description=spec["description"],
                category=spec.get("category"),
                fields=spec["fields"],
                trigger_keywords=spec.get("trigger_keywords"),
                notify_domain=spec.get("notify_domain"),
                embedding=FormLibraryService._embed_text(
                    spec["name"], spec["description"], spec.get("category"), spec["fields"]
                ),
                created_by="system",
            )
            db.add(row)
        db.commit()
    except Exception as e:
        db.rollback()
    finally:
        db.close()


def _migrate_prompt_configs(db):
    """Disable any DB-stored admin system prompt so the detailed hardcoded one in admin_agent.py is used."""
    config = db.query(PromptConfig).filter(
        PromptConfig.agent_domain == "admin",
        PromptConfig.prompt_key == "system_prompt",
        PromptConfig.is_active == True,
    ).first()
    if config:
        config.is_active = False
        db.commit()


def _seed_prompt_configs(db):
    # Prompts are configured by domain managers via the Config page — no defaults seeded.
    pass


_DEFAULT_WELCOME_RESOURCES = [
    {"name": "Centriq AI Assistant", "url": None, "description": "Your AI-powered workplace assistant — ask it anything about HR, IT, policies, and more.", "category": "App Guide", "icon": "🤖", "sort_order": 0},
    {"name": "Leave Management", "url": None, "description": "Apply for leave, check your balances, and track leave history through the chat.", "category": "HR", "icon": "📅", "sort_order": 1},
    {"name": "Policy Library", "url": None, "description": "Access all company HR, admin, and IT policies instantly.", "category": "Policy", "icon": "📋", "sort_order": 2},
    {"name": "Room Booking", "url": None, "description": "Book conference rooms and meeting spaces effortlessly.", "category": "Facilities", "icon": "🏢", "sort_order": 3},
    {"name": "IT Support", "url": None, "description": "Request software installations and get technical help from the IT team.", "category": "IT", "icon": "💻", "sort_order": 4},
    {"name": "Skills & Certifications", "url": None, "description": "Update your skills profile and upload your certifications.", "category": "HR", "icon": "🎓", "sort_order": 5},
    {"name": "Expense Reimbursement", "url": None, "description": "Submit and track expense reimbursement claims via the Admin portal.", "category": "Admin", "icon": "💰", "sort_order": 6},
    {"name": "Employee Directory", "url": None, "description": "Find colleagues, their roles, and contact information.", "category": "App Guide", "icon": "👥", "sort_order": 7},
]


def _seed_welcome_resources(db):
    """Seed default welcome resources (idempotent — only runs if table is empty)."""
    try:
        for spec in _DEFAULT_WELCOME_RESOURCES:
            db.add(WelcomeResource(**spec))
        db.commit()
    except Exception as e:
        db.rollback()
