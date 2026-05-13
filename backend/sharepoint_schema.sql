-- =========================================================
-- SharePoint Event-Driven Ingestion Flow Tables
-- =========================================================

SET search_path TO enterprise_ai, public;

CREATE TABLE IF NOT EXISTS graph_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id VARCHAR(255) UNIQUE NOT NULL,
    site_id VARCHAR(255),
    drive_id VARCHAR(255),
    expiration_time TIMESTAMPTZ,
    status VARCHAR(50),
    webhook_endpoint TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sharepoint_delta_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id VARCHAR(255) UNIQUE NOT NULL,
    delta_url TEXT,
    last_sync TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sharepoint_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(500),
    path TEXT,
    web_url TEXT,
    last_modified TIMESTAMPTZ,
    is_deleted BOOLEAN DEFAULT FALSE,
    drive_id VARCHAR(255),
    processing_status VARCHAR(50) DEFAULT 'Pending',
    last_processed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_failure_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id VARCHAR(255) NOT NULL,
    error_type VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved BOOLEAN DEFAULT FALSE
);
