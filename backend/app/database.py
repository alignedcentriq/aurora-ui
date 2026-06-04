
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
        print(f"[background] Policy embedding failed: {e}")



def init_db():
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()

    Base.metadata.create_all(bind=engine)

    # Drop removed tables
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            try:
                conn.execute(text(f'DROP TABLE IF EXISTS "{SCHEMA}".payroll CASCADE'))
                conn.commit()
            except Exception:
                pass

    # Migrations: add columns that may not exist in older deployments
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            for stmt in [
                f'ALTER TABLE "{SCHEMA}".employees ADD COLUMN IF NOT EXISTS location VARCHAR',
                f'ALTER TABLE "{SCHEMA}".projects ADD COLUMN IF NOT EXISTS achievements TEXT',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_make VARCHAR',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR',
                f'ALTER TABLE "{SCHEMA}".announcements ADD COLUMN IF NOT EXISTS image_url VARCHAR',
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
                # Document generation: approval-gated verification fields
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT \'draft\'',
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS verify_token VARCHAR',
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS verified_by_email VARCHAR',
                f'ALTER TABLE "{SCHEMA}".generated_documents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP',
                f'CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_documents_verify_token ON "{SCHEMA}".generated_documents(verify_token)',
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
            ]:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception as e:
                    conn.rollback()  # clear error state so the next migration can still run
                    print(f"Migration notice: {e}")

    # pgvector column migrations: convert TEXT embeddings to vector(768)
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            # policy_chunks.embedding: TEXT → vector(768)
            row = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_schema = :s AND table_name = 'policy_chunks' AND column_name = 'embedding'"
            ), {"s": SCHEMA}).fetchone()
            if row and row[0] == "text":
                conn.execute(text(f'ALTER TABLE "{SCHEMA}".policy_chunks DROP COLUMN embedding'))
                conn.execute(text(f'ALTER TABLE "{SCHEMA}".policy_chunks ADD COLUMN embedding vector(768)'))
                conn.commit()
                print("[init_db] Migrated policy_chunks.embedding to vector(768)")

            # chat_feedback.user_message_embedding: add as vector(768) or convert from TEXT
            row = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_schema = :s AND table_name = 'chat_feedback' AND column_name = 'user_message_embedding'"
            ), {"s": SCHEMA}).fetchone()
            if row is None:
                conn.execute(text(f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN user_message_embedding vector(768)'))
                conn.commit()
                print("[init_db] Added chat_feedback.user_message_embedding as vector(768)")
            elif row[0] == "text":
                conn.execute(text(f'ALTER TABLE "{SCHEMA}".chat_feedback DROP COLUMN user_message_embedding'))
                conn.execute(text(f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN user_message_embedding vector(768)'))
                conn.commit()
                print("[init_db] Migrated chat_feedback.user_message_embedding to vector(768)")

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
            ]:
                try:
                    conn.execute(text(idx_stmt))
                    conn.commit()
                except Exception as e:
                    print(f"[init_db] Index notice: {e}")

    db = SessionLocal()

    try:
        if db.query(PromptConfig).count() == 0:
            _seed_prompt_configs(db)
        else:
            _migrate_prompt_configs(db)
        if db.query(LeaveType).count() == 0:
            _seed_leave_types(db)
        _ = db.query(ChatFeedback).count()

        # Background thread: embeds any chunks still missing vectors
        try:
            print("[init_db] Starting background embedding pass...")
            threading.Thread(target=_background_embed_policies, daemon=True).start()
        except Exception as e:
            print(f"[init_db] Embedding thread notice: {e}")

        # Background thread: polls SharePoint for new/changed policy documents
        try:
            from app.config import settings as _s
            if _s.SHAREPOINT_SITE_URL:
                from app.services.sharepoint_policy_sync import sharepoint_sync_loop
                _sp_interval = _s.SHAREPOINT_SYNC_INTERVAL
                print(f"[init_db] Starting SharePoint policy sync loop (interval={_sp_interval}s)...")
                threading.Thread(target=sharepoint_sync_loop, daemon=True).start()
            else:
                print("[init_db] SharePoint sync skipped — SHAREPOINT_SITE_URL not configured.")
        except Exception as e:
            print(f"[init_db] SharePoint sync loop notice: {e}")

        # Background thread: polls the Aixchange folder for new/changed project decks
        try:
            from app.config import settings as _s
            if _s.SHAREPOINT_SITE_URL and _s.SHAREPOINT_PROJECT_FOLDER_PATH:
                from app.services.project_deck_sync import project_deck_sync_loop
                print(f"[init_db] Starting SharePoint project-deck sync loop "
                      f"(folder='{_s.SHAREPOINT_PROJECT_FOLDER_PATH}', interval={_s.SHAREPOINT_SYNC_INTERVAL}s)...")
                threading.Thread(target=project_deck_sync_loop, daemon=True).start()
            else:
                print("[init_db] Project-deck sync skipped — SHAREPOINT_PROJECT_FOLDER_PATH not configured.")
        except Exception as e:
            print(f"[init_db] Project-deck sync loop notice: {e}")

        # Background thread: accrues parking dues daily and emails reminders on the configured cadence
        try:
            from app.config import settings as _s
            if getattr(_s, "PARKING_REMINDER_SENDER", "") or _s.NOTIFY_TO_EMAIL:
                from app.services.parking_payment_service import parking_reminder_loop
                print("[init_db] Starting parking payment reminder loop (daily tick)...")
                threading.Thread(target=parking_reminder_loop, daemon=True).start()
            else:
                print("[init_db] Parking reminder loop skipped — no PARKING_REMINDER_SENDER / NOTIFY_TO_EMAIL.")
        except Exception as e:
            print(f"[init_db] Parking reminder loop notice: {e}")

    except Exception as e:
        print(f"Error during init_db: {e}")
        db.rollback()
        raise e
    finally:
        db.close()





def _seed_leave_types(db):
    """Seed the four standard leave types."""
    print("Seeding leave types...")
    db.add_all([
        LeaveType(name="Casual Leave", code="CL", annual_entitlement=12, is_earned=False, carry_forward=False),
        LeaveType(name="Privileged Leave", code="PL", annual_entitlement=15, is_earned=False, carry_forward=True),
        LeaveType(name="Leave Without Pay", code="LWP", annual_entitlement=None, is_earned=False, carry_forward=False),
        LeaveType(name="Compensatory Off", code="CO", annual_entitlement=None, is_earned=True, carry_forward=False),
    ])
    db.commit()
    print("Leave types seeding complete.")


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
        print("Disabled DB-stored admin system_prompt — using hardcoded detailed prompt with multi-turn RULE 5/6 logic.")


def _seed_prompt_configs(db):
    # Prompts are configured by domain managers via the Config page — no defaults seeded.
    pass
