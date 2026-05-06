-- =========================================================
-- ENTERPRISE AI ASSISTANT DATABASE SCHEMA
-- PostgreSQL + pgvector
-- FIXED VERSION FOR CUSTOM SCHEMA + VECTOR
-- =========================================================

-- =========================================================
-- EXTENSIONS
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================================
-- SCHEMA
-- =========================================================

CREATE SCHEMA IF NOT EXISTS enterprise_ai;

SET search_path TO enterprise_ai, public;

-- =========================================================
-- 1. AUTHENTICATION & USER MANAGEMENT
-- =========================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    designation VARCHAR(150) NOT NULL,
    manager_id UUID REFERENCES users(id),
    location VARCHAR(100) NOT NULL,
    joining_date DATE NOT NULL,
    employment_type VARCHAR(30) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    avatar_url TEXT,
    phone VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50) NOT NULL,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash VARCHAR(512) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- =========================================================
-- 2. CONVERSATION & AI ENGINE
-- =========================================================

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    domain VARCHAR(50) NOT NULL,
    title VARCHAR(300),
    status VARCHAR(20) DEFAULT 'active',
    escalated_to UUID REFERENCES users(id),
    session_metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    content_tokens INTEGER,
    intent VARCHAR(100),
    intent_confidence FLOAT4,
    domain VARCHAR(50),
    tool_calls JSONB,
    sources JSONB,
    latency_ms INTEGER,
    model_version VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE message_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id),
    user_id UUID NOT NULL REFERENCES users(id),
    rating SMALLINT CHECK (rating IN (1, -1)),
    comment TEXT,
    tags VARCHAR[],
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- 3. KNOWLEDGE BASE & RAG
-- =========================================================

CREATE TABLE knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    category VARCHAR(100) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    minio_path TEXT,
    source_url TEXT,
    version VARCHAR(20) DEFAULT '1.0',
    is_active BOOLEAN DEFAULT TRUE,
    uploaded_by UUID REFERENCES users(id),
    effective_from DATE,
    effective_to DATE,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES knowledge_documents(id),
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding public.vector(1536) NOT NULL,
    token_count INTEGER,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE faq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(50) NOT NULL,
    category VARCHAR(100) NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    question_embedding public.vector(1536) NOT NULL,
    related_doc_ids UUID[],
    view_count INTEGER DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- 4. LEAVE MANAGEMENT
-- =========================================================

CREATE TABLE leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    max_days_per_year DECIMAL(5,2) NOT NULL,
    carry_forward_days DECIMAL(5,2) DEFAULT 0,
    is_paid BOOLEAN DEFAULT TRUE,
    requires_approval BOOLEAN DEFAULT TRUE,
    min_notice_days INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    leave_type_id UUID REFERENCES leave_types(id),
    year SMALLINT NOT NULL,
    entitled_days DECIMAL(5,2) NOT NULL,
    taken_days DECIMAL(5,2) DEFAULT 0,
    pending_days DECIMAL(5,2) DEFAULT 0,
    carry_forward DECIMAL(5,2) DEFAULT 0,
    adjusted_days DECIMAL(5,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    leave_type_id UUID REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5,2) NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    approved_by UUID REFERENCES users(id),
    approval_note TEXT,
    approved_at TIMESTAMPTZ,
    document_url TEXT,
    conversation_id UUID REFERENCES conversations(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- 5. FORMS & DOCUMENT GENERATION
-- =========================================================

CREATE TABLE form_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    schema JSONB NOT NULL,
    description TEXT,
    sla_hours INTEGER,
    auto_assignee_role VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_template_id UUID REFERENCES form_templates(id),
    user_id UUID NOT NULL REFERENCES users(id),
    data JSONB NOT NULL,
    status VARCHAR(30) DEFAULT 'submitted',
    assigned_to UUID REFERENCES users(id),
    resolution_note TEXT,
    conversation_id UUID REFERENCES conversations(id),
    submitted_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    sla_deadline TIMESTAMPTZ
);

CREATE TABLE generated_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    doc_type VARCHAR(100) NOT NULL,
    template_key VARCHAR(100) NOT NULL,
    parameters JSONB NOT NULL,
    minio_path TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    generated_by UUID REFERENCES users(id),
    form_submission_id UUID REFERENCES form_submissions(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- 6. ESCALATION & TICKETING
-- =========================================================

CREATE TABLE escalation_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(30) UNIQUE NOT NULL,
    conversation_id UUID REFERENCES conversations(id),
    user_id UUID NOT NULL REFERENCES users(id),
    domain VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    subject VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'open',
    assigned_to UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ,
    resolution TEXT,
    sla_deadline TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ticket_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES escalation_tickets(id),
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- 7. ANNOUNCEMENTS & HOLIDAY
-- =========================================================

CREATE TABLE announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(400) NOT NULL,
    body TEXT NOT NULL,
    domain VARCHAR(50) NOT NULL,
    audience JSONB,
    pinned BOOLEAN DEFAULT FALSE,
    published_by UUID REFERENCES users(id),
    published_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE holiday_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    holiday_date DATE NOT NULL,
    type VARCHAR(30) NOT NULL,
    location VARCHAR(100),
    year SMALLINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    work_date DATE NOT NULL,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    mode VARCHAR(20) DEFAULT 'office',
    status VARCHAR(20) DEFAULT 'present',
    source VARCHAR(30) DEFAULT 'system',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- 8. ONBOARDING
-- =========================================================

CREATE TABLE onboarding_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(300) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL,
    assigned_role VARCHAR(50) NOT NULL,
    due_day_offset INTEGER DEFAULT 0,
    resource_links JSONB,
    is_mandatory BOOLEAN DEFAULT TRUE,
    order_index INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE onboarding_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    task_id UUID REFERENCES onboarding_tasks(id),
    status VARCHAR(20) DEFAULT 'pending',
    completed_at TIMESTAMPTZ,
    notes TEXT,
    due_date DATE
);

-- =========================================================
-- 9. AI INFRASTRUCTURE
-- =========================================================

CREATE TABLE prompt_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(200) UNIQUE NOT NULL,
    domain VARCHAR(50) NOT NULL,
    prompt_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE llm_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    message_id UUID REFERENCES messages(id),
    model VARCHAR(100) NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    cost_usd NUMERIC(10,6),
    status VARCHAR(20) DEFAULT 'success',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    domain VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    input_schema JSONB NOT NULL,
    endpoint TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    requires_auth BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cache_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key VARCHAR(512) UNIQUE NOT NULL,
    domain VARCHAR(50) NOT NULL,
    query_hash VARCHAR(128) NOT NULL,
    response_preview TEXT,
    hit_count INTEGER DEFAULT 0,
    ttl_seconds INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- =========================================================
-- 10. NOTIFICATIONS
-- =========================================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(80) NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    channel VARCHAR(30) DEFAULT 'in_app',
    is_read BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_users_email
ON users(email);

CREATE INDEX idx_conversations_user_id
ON conversations(user_id);

CREATE INDEX idx_messages_conversation_id
ON messages(conversation_id);

CREATE INDEX idx_leave_requests_user_id
ON leave_requests(user_id);

CREATE INDEX idx_notifications_user_id
ON notifications(user_id);

CREATE INDEX idx_escalation_tickets_user_id
ON escalation_tickets(user_id);

CREATE INDEX idx_document_chunks_embedding
ON document_chunks
USING ivfflat (embedding vector_cosine_ops);

CREATE INDEX idx_faq_embedding
ON faq_items
USING ivfflat (question_embedding vector_cosine_ops);