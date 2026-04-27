# Nexus AI Assistant — Complete API, Access & Services Requirements

> A master checklist of **every** API key, service credential, platform access, backend library, and infrastructure component needed to run this project at full capability.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Azure Platform Services](#2-azure-platform-services)
3. [External APIs & Credentials](#3-external-apis--credentials)
4. [Zoho Integration (Leave → Email Flow)](#4-zoho-integration-leave--email-flow)
5. [Email Sending & Reminders](#5-email-sending--reminders)
6. [LangGraph Self-Learning Architecture](#6-langgraph-self-learning-architecture)
7. [Backend Python Packages](#7-backend-python-packages)
8. [Frontend (React) Dependencies](#8-frontend-react-dependencies)
9. [Database (PostgreSQL) Requirements](#9-database-postgresql-requirements)
10. [Complete .env Credential Checklist](#10-complete-env-credential-checklist)
11. [Access Requests Summary (Who to Ask)](#11-access-requests-summary-who-to-ask)

---

## 1. Architecture Overview

```mermaid
graph TD
    classDef azure fill:#0078d4,stroke:#005a9e,color:#fff
    classDef ext fill:#64748b,stroke:#334155,color:#fff
    classDef core fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef db fill:#f59e0b,stroke:#b45309,color:#fff

    User["React Frontend"] --> FastAPI["FastAPI Backend"]
    Teams["MS Teams Bot"] --> FastAPI
    Telegram["Telegram Bot"] --> FastAPI

    FastAPI --> LangGraph["LangGraph Agent"]:::core
    LangGraph --> LLM["Company OSS GPT Model"]:::ext
    LangGraph --> Tools["Agent Tools"]:::core

    Tools --> MSGraph["Microsoft Graph API"]:::azure
    Tools --> Zoho["Zoho People API"]:::ext
    Tools --> PG["PostgreSQL + pgvector"]:::db

    FastAPI --> Scheduler["APScheduler Cron"]
    Scheduler --> MSGraph
    Scheduler --> Zoho
    Scheduler --> PG

    FastAPI --> AzureBlob["Azure Blob Storage"]:::azure
    FastAPI --> KeyVault["Azure Key Vault"]:::azure
```

---

## 2. Azure Platform Services

These are the Azure resources you need provisioned. Request access through your Azure admin / cloud team.

| # | Azure Service | Purpose | Access Needed |
|---|---|---|---|
| 1 | **Azure Entra ID (Azure AD)** | OAuth2 authentication for users, service principals for Graph API | App Registration with appropriate API permissions |
| 2 | **Azure App Service / Container Apps** | Host the FastAPI backend (Docker) | Contributor role on the resource group |
| 3 | **Azure Database for PostgreSQL — Flexible Server** | Primary database with `pgvector` extension | Connection string, firewall rules to allow backend |
| 4 | **Azure Blob Storage** | Store uploaded files (vendor menus, generated NOC PDFs, SharePoint doc cache) | Storage account + container + SAS token or Managed Identity |
| 5 | **Azure Key Vault** | Securely store all secrets (API keys, DB passwords, bot tokens) | `Key Vault Secrets User` role for the app's Managed Identity |
| 6 | **Azure Bot Service** | Register the MS Teams bot channel | Bot resource linked to your Entra ID app registration |
| 7 | **Azure Static Web Apps** (optional) | Host the React frontend | Free tier available |
| 8 | **Azure Container Registry** (optional) | Store Docker images for CI/CD | Push/pull access |
| 9 | **Azure Application Insights** (optional) | Monitoring, logging, telemetry | Instrumentation key |

> [!IMPORTANT]
> **Azure Entra ID App Registration** is the single most critical setup — it gates access to Graph API, Teams Bot, and user SSO.

---

## 3. External APIs & Credentials

### 3.1 Microsoft Graph API (`graph.microsoft.com`)

| API Endpoint | Purpose | Permission Type | Permission Scope |
|---|---|---|---|
| `GET /me` | Get current user's profile | Delegated | `User.Read` |
| `GET /me/manager` | Fetch reporting manager for escalations/emails | Delegated | `User.Read.All` |
| `GET /users/{id}` | Lookup any employee by ID/email | Application | `User.Read.All` |
| `POST /me/messages` | Draft emails in user's Outlook | Delegated | `Mail.ReadWrite` |
| `POST /me/sendMail` | **Send emails directly** (reminders, leave notifications) | Delegated | `Mail.Send` |
| `POST /users/{id}/sendMail` | Send emails on behalf of a user or service account | Application | `Mail.Send` |
| `GET /sites/{site-id}/drive/root/children` | Download SharePoint documents for RAG | Application | `Sites.Read.All` |
| `GET /groups/{id}/members` | Get members of a distribution group (for group emails) | Application | `Group.Read.All` |
| `POST /groups/{id}/conversations` | Post to a group email thread | Application | `Group.ReadWrite.All` |

> [!WARNING]
> **Application permissions** (e.g., `Mail.Send` at the application level) require **Azure AD admin consent**. Work with your IT/Security team to get these approved.

### 3.2 Company OSS GPT Model (Azure-Hosted)

| Endpoint | Purpose |
|---|---|
| `POST /v1/chat/completions` | LLM inference for generating responses (OpenAI-compatible format) |
| `POST /v1/embeddings` | Generate vector embeddings for RAG documents |

**Required credentials:**
- `LLM_API_BASE_URL` — The internal server URL (e.g., `https://llm.internal.company.com`)
- `LLM_API_KEY` — API key or bearer token for authentication
- `LLM_MODEL_NAME` — The specific model identifier (e.g., `company-gpt-v2`)
- `EMBEDDING_MODEL_NAME` — The embedding model identifier

### 3.3 Zoho People API (`people.zoho.com/people/api/`)

| API Endpoint | Purpose |
|---|---|
| `GET /api/forms/P_EmployeeView/records` | Fetch employee profiles, skills, department data |
| `GET /api/forms/P_LeaveTracker/records` | **Fetch leave records** — who has applied for leave, status, dates |
| `GET /api/forms/P_ApprovalStatus/records` | Check approval workflows (who approved, pending) |
| `GET /api/attendance` | Attendance data |
| Zoho Webhooks (outgoing) | **Real-time push** when a leave is applied/approved |

**Required credentials:**
- `ZOHO_CLIENT_ID` — From Zoho API Console (Self Client or Server-based Application)
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN` — Generated via OAuth2 flow
- `ZOHO_ORG_ID` — Your Zoho People organization ID
- `ZOHO_ACCOUNTS_URL` — e.g., `https://accounts.zoho.com` (or `.in`, `.eu` based on DC)

### 3.4 Telegram Bot API (`api.telegram.org`)

| API Method | Purpose |
|---|---|
| `setWebhook` | Register your FastAPI endpoint to receive vendor messages |
| `sendMessage` | Send daily food rating summaries back to vendor |
| `getFile` / `downloadFile` | Download menu images/PDFs from vendor |

**Required credentials:**
- `TELEGRAM_BOT_TOKEN` — From BotFather
- `TELEGRAM_WEBHOOK_SECRET` — Self-generated secret for `X-Telegram-Bot-Api-Secret-Token` validation

### 3.5 Microsoft Teams Bot (Bot Framework)

| Component | Purpose |
|---|---|
| `POST /api/messages` (your endpoint) | Receives all Teams bot messages |
| Bot Framework SDK (`botbuilder-core`) | Parse and respond to Teams activities |
| Adaptive Cards | Render rich interactive responses with feedback buttons |

**Required credentials:**
- `MICROSOFT_APP_ID` — From Azure Bot registration
- `MICROSOFT_APP_PASSWORD` — Client secret from Azure AD
- `MICROSOFT_APP_TENANT_ID` — Your Azure tenant

---

## 4. Zoho Integration (Leave → Email Flow)

This is the critical workflow you described: **When an employee applies for leave in Zoho → Nexus should command Zoho to also notify the Reporting Manager and Project Manager via email.**

### Option A: Zoho Webhook → Nexus → Email (Recommended)

```mermaid
sequenceDiagram
    participant Employee
    participant Zoho as Zoho People
    participant Nexus as Nexus FastAPI
    participant LangGraph as LangGraph Agent
    participant Graph as MS Graph API
    participant RM as Reporting Manager
    participant PM as Project Manager

    Employee->>Zoho: Applies for leave
    Zoho->>Nexus: Webhook fires (POST /api/webhooks/zoho)
    Nexus->>Nexus: Parse leave details (who, dates, type)
    Nexus->>LangGraph: Invoke "Leave Notification" tool
    LangGraph->>Zoho: GET /api/forms/P_EmployeeView (fetch RM & PM info)
    LangGraph->>Graph: POST /users/{service}/sendMail (to RM)
    LangGraph->>Graph: POST /users/{service}/sendMail (to PM)
    Graph->>RM: 📧 Email: "Leave applied by {Employee}"
    Graph->>PM: 📧 Email: "Leave applied by {Employee}"
    LangGraph->>Nexus: Log action to PostgreSQL
    Nexus->>Zoho: Return 200 OK
```

#### How it works:
1. **Zoho Webhook Configuration**: In Zoho People → Settings → Webhooks, create a webhook that fires on the `Leave - On Apply` event.
2. **Webhook URL**: Point it to `https://your-nexus-api.com/api/webhooks/zoho`
3. **FastAPI receives** the leave payload (employee name, dates, leave type, status)
4. **LangGraph** is invoked with a `leave_notification` tool that:
   - Queries Zoho People API to get the employee's Reporting Manager and Project Manager
   - Uses MS Graph API `sendMail` to email both managers
   - Composes a professional notification email with leave details
5. **Logs** the action in PostgreSQL for audit

#### New FastAPI Endpoint Required:
```
POST /api/webhooks/zoho
```

#### New LangGraph Tools Required:
- `fetch_employee_manager_from_zoho` — Gets RM & PM for an employee
- `send_leave_notification_email` — Drafts and sends email via MS Graph
- `log_leave_event` — Saves the event to PostgreSQL

### Option B: Polling-Based (If Zoho webhooks are unavailable)

If your Zoho plan doesn't support outgoing webhooks:

```mermaid
sequenceDiagram
    participant Scheduler as APScheduler (every 15 min)
    participant Zoho as Zoho People API
    participant Nexus as FastAPI Backend
    participant Graph as MS Graph API

    Scheduler->>Zoho: GET /api/forms/P_LeaveTracker (filter: new since last poll)
    Zoho->>Scheduler: Return new leave applications
    Scheduler->>Nexus: Process each new leave
    Nexus->>Zoho: GET employee's RM & PM details
    Nexus->>Graph: sendMail to RM & PM
    Nexus->>Nexus: Mark leave as "notified" in PostgreSQL
```

### Zoho API Permissions Required

| Permission | Scope | Purpose |
|---|---|---|
| `ZohoPeople.forms.READ` | Read employee forms | Fetch employee profiles, RM, PM |
| `ZohoPeople.leave.READ` | Read leave records | Detect new leave applications |
| `ZohoPeople.attendance.READ` | Read attendance | Optional: Check attendance data |

> [!TIP]
> **Zoho Self Client** is the simplest OAuth setup for server-to-server integrations. Generate a refresh token from the Zoho API Console with the scopes above.

---

## 5. Email Sending & Reminders

### 5.1 Sending Emails to Individuals

| Method | API | When |
|---|---|---|
| MS Graph `sendMail` | `POST /users/{service-account}/sendMail` | Leave notifications, parking reminders, escalation alerts |
| MS Graph `createDraft` | `POST /me/messages` | When user asks the AI to draft an email |

### 5.2 Sending Emails to Groups / Distribution Lists

| Method | API | When |
|---|---|---|
| MS Graph `sendMail` with multiple `toRecipients` | `POST /users/{service-account}/sendMail` | Send to specific people |
| MS Graph Group email | `POST /groups/{group-id}/conversations` | Send to a company distribution group |
| Query group members first | `GET /groups/{id}/members` → then `sendMail` to each | When you need individual tracking |

> [!IMPORTANT]
> For sending emails **from a shared/service mailbox** (e.g., `nexus-bot@company.com`), you need either:
> - Application permission `Mail.Send` with admin consent, **or**
> - A dedicated service account with `Mail.Send` delegated permission

### 5.3 Scheduled Email Reminders (APScheduler Cron Jobs)

| Reminder | Schedule | Source Data | Action |
|---|---|---|---|
| Parking sticker unpaid fees | Monthly (1st of month) | PostgreSQL `reminders` table | Send email via MS Graph |
| Leave balance warnings | Weekly (Monday 9 AM) | Zoho People API | Send email to employees |
| Policy acknowledgment | On document sync | PostgreSQL `knowledge_documents` | Notify relevant departments |
| Food vendor rating summary | Daily (5 PM) | PostgreSQL feedback data | Send via Telegram to vendor |

---

## 6. LangGraph Self-Learning Architecture

### 6.1 Core LangGraph Components

| Component | Purpose | Dependencies |
|---|---|---|
| **State Machine (Router)** | Routes queries to RAG, forms, escalation, or tool nodes | `langgraph`, `langchain-core` |
| **Self-Reflection Node** | Re-evaluates answer when user says "that's wrong" | `langgraph` checkpoint |
| **Corrections Memory DB** | Stores past corrections as embeddings for dual-retrieval | PostgreSQL + `pgvector` |
| **Dynamic Prompt Loader** | Fetches system prompts from DB at runtime | PostgreSQL `system_configs` table |
| **Few-Shot Injector** | Injects approved examples into prompt dynamically | PostgreSQL `few_shot_examples` table |

### 6.2 LangGraph Tools (Agent Capabilities)

| Tool Name | Purpose | External API |
|---|---|---|
| `search_policies` | Semantic search over HR/IT/Admin policies | pgvector |
| `search_corrections` | Search past corrections for improved answers | pgvector (corrections DB) |
| `lookup_employee` | Find employee info from directory | MS Graph / Zoho |
| `lookup_manager` | Find reporting manager | MS Graph `GET /me/manager` |
| `draft_email` | Create email draft in Outlook | MS Graph |
| `send_email` | Send email directly | MS Graph |
| `send_group_email` | Send email to a distribution list | MS Graph |
| `fetch_leave_status` | Check leave status from Zoho | Zoho People API |
| `apply_leave_via_zoho` | (Optional) Submit leave request programmatically | Zoho People API |
| `generate_noc` | Generate NOC letter | Template engine |
| `calculate_parking_fee` | Private calculator for parking fees | Internal logic |
| `get_food_menu` | Retrieve today's menu | PostgreSQL |
| `submit_food_feedback` | Rate the food vendor | PostgreSQL |
| `escalate_to_human` | Route to HR/IT/Admin via email or Teams | MS Graph / Teams |

### 6.3 Planning Architecture (ReAct + Plan-and-Execute)

For complex multi-step tasks (e.g., "Apply leave for next week and notify my PM"), LangGraph uses:

```mermaid
graph LR
    Input["User Request"] --> Planner["Planner Node (LLM)"]
    Planner --> Plan["Step 1: Check Zoho calendar\nStep 2: Apply leave\nStep 3: Fetch PM email\nStep 4: Send notification"]
    Plan --> Executor["Executor (Tool Calls)"]
    Executor --> Reflect["Self-Reflection"]
    Reflect --> |"Looks good"| Output["Final Response"]
    Reflect --> |"Issue found"| Planner
```

---

## 7. Backend Python Packages

```
# Core Framework
fastapi
uvicorn[standard]
python-multipart

# AI / LLM
langgraph
langchain-core
langchain-community
langchain-openai          # OpenAI-compatible interface for company LLM
openai                     # For embeddings API calls

# Database
sqlalchemy[asyncio]
asyncpg                    # Async PostgreSQL driver
pgvector                   # pgvector SQLAlchemy integration
alembic                    # Database migrations

# Scheduling
apscheduler

# Microsoft Integrations
botbuilder-core            # MS Teams Bot Framework
botbuilder-integration-aiohttp
msal                       # Microsoft Authentication Library (for Graph API tokens)
httpx                      # Async HTTP client for Graph API calls

# Zoho Integration
httpx                      # For Zoho API calls (OAuth2 + REST)

# Telegram
python-telegram-bot        # Or use raw httpx for webhook handling

# Email / Documents
jinja2                     # Email templates and NOC letter generation

# Utilities
python-dotenv
pydantic
pydantic-settings

# Security
python-jose[cryptography]  # JWT token validation
passlib[bcrypt]             # Password hashing (if needed)

# Monitoring
opencensus-ext-azure       # Azure Application Insights (optional)
```

---

## 8. Frontend (React) Dependencies

Your React frontend already has most of what's needed. Additional packages to consider:

| Package | Purpose |
|---|---|
| `@microsoft/teams-js` | If embedding in MS Teams as a tab app |
| `@azure/msal-react` | Azure AD SSO authentication in React |
| `@azure/msal-browser` | MSAL browser library for token acquisition |
| `axios` or `fetch` | API calls to FastAPI backend |
| `socket.io-client` (optional) | Real-time streaming for chat responses |
| `react-markdown` | Render markdown AI responses |

---

## 9. Database (PostgreSQL) Requirements

### 9.1 PostgreSQL Extensions

| Extension | Purpose |
|---|---|
| `pgvector` | Vector similarity search for RAG embeddings |
| `uuid-ossp` | Generate UUIDs for primary keys |

### 9.2 Additional Tables Needed (for Zoho + Email features)

```sql
-- Leave Events (synced from Zoho or received via webhook)
CREATE TABLE leave_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id),
    employee_email VARCHAR(255) NOT NULL,
    leave_type VARCHAR(100) NOT NULL,        -- 'Casual', 'Sick', 'Earned', etc.
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',     -- 'pending', 'approved', 'rejected'
    zoho_record_id VARCHAR(255) UNIQUE,       -- Zoho's internal record ID (dedup)
    reporting_manager_email VARCHAR(255),
    project_manager_email VARCHAR(255),
    notification_sent BOOLEAN DEFAULT FALSE,  -- Track if RM/PM were notified
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Email Audit Log (track every email sent by Nexus)
CREATE TABLE email_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sent_to VARCHAR(255) NOT NULL,
    sent_from VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body_preview TEXT,
    trigger_source VARCHAR(100),              -- 'leave_webhook', 'cron_reminder', 'user_request'
    status VARCHAR(50) DEFAULT 'sent',        -- 'sent', 'failed', 'draft'
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled Reminders (generic reminder system)
CREATE TABLE scheduled_reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reminder_type VARCHAR(100) NOT NULL,      -- 'parking_fee', 'policy_ack', 'leave_balance'
    target_employee_id UUID REFERENCES employees(id),
    target_email VARCHAR(255),
    message_template TEXT NOT NULL,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    is_sent BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 10. Complete `.env` Credential Checklist

```env
# ─── Database ───────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/nexus_db

# ─── Company LLM (OSS GPT on Azure) ────────────────────
LLM_API_BASE_URL=https://llm.internal.company.com/v1
LLM_API_KEY=sk-xxxxxxxxxxxxxxxx
LLM_MODEL_NAME=company-gpt-v2
EMBEDDING_MODEL_NAME=company-embed-v1

# ─── Microsoft Entra ID (Azure AD) ─────────────────────
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ─── Microsoft Graph API ───────────────────────────────
MS_GRAPH_SCOPES=https://graph.microsoft.com/.default
SERVICE_ACCOUNT_EMAIL=nexus-bot@company.com

# ─── MS Teams Bot ──────────────────────────────────────
MICROSOFT_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_APP_PASSWORD=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MICROSOFT_APP_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# ─── Zoho People ──────────────────────────────────────
ZOHO_CLIENT_ID=1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ZOHO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ZOHO_REFRESH_TOKEN=1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ZOHO_ORG_ID=12345678
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com

# ─── Telegram Bot ─────────────────────────────────────
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_WEBHOOK_SECRET=random-secret-string-for-validation

# ─── Azure Blob Storage ──────────────────────────────
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_CONTAINER=nexus-uploads

# ─── Azure Key Vault (if used instead of .env) ──────
AZURE_KEY_VAULT_URL=https://nexus-kv.vault.azure.net/

# ─── SharePoint (for RAG document sync) ─────────────
SHAREPOINT_SITE_ID=company.sharepoint.com,site-guid,web-guid
SHAREPOINT_DRIVE_ID=drive-guid

# ─── App Settings ───────────────────────────────────
APP_ENV=production
LOG_LEVEL=INFO
CORS_ORIGINS=https://nexus.company.com
```

---

## 11. Access Requests Summary (Who to Ask)

This is a practical checklist of **who you need to contact** to get everything provisioned:

| # | What to Request | Who to Ask | Priority |
|---|---|---|---|
| 1 | **Azure Entra ID App Registration** with Graph API permissions (`Mail.Send`, `User.Read.All`, `Sites.Read.All`, `Group.Read.All`) | Azure AD Admin / IT Security | 🔴 Critical |
| 2 | **Admin consent** for application-level Graph API permissions | Azure Global Admin or Privileged Role Admin | 🔴 Critical |
| 3 | **Azure PostgreSQL Flexible Server** with `pgvector` extension enabled | Cloud/DevOps Team | 🔴 Critical |
| 4 | **Company OSS LLM API** base URL, API key, and model names | AI/ML Team or Platform Team | 🔴 Critical |
| 5 | **Azure Bot Service** registration + Teams channel | Azure Admin | 🟡 High |
| 6 | **Zoho People API** — OAuth2 Self Client credentials + scopes | Zoho Admin (HR/IT Admin who manages Zoho) | 🟡 High |
| 7 | **Zoho Webhook** configuration (Leave → On Apply event) | Zoho Admin | 🟡 High |
| 8 | **Service account mailbox** (`nexus-bot@company.com`) for sending emails | IT Admin / Exchange Admin | 🟡 High |
| 9 | **Azure Blob Storage** account + container | Cloud/DevOps Team | 🟢 Medium |
| 10 | **Azure Key Vault** access for secrets | Cloud/DevOps Team | 🟢 Medium |
| 11 | **SharePoint site access** for HR/Admin policy documents | SharePoint Admin | 🟢 Medium |
| 12 | **Telegram Bot Token** (self-service via BotFather) | Self (no approval needed) | 🟢 Medium |
| 13 | **Azure Container Registry** for Docker images | DevOps Team | 🟢 Medium |
| 14 | **Azure Application Insights** instrumentation key | Cloud/DevOps Team | ⚪ Optional |
| 15 | **Distribution group IDs** for company-wide emails | IT Admin | 🟢 Medium |

> [!CAUTION]
> Items marked 🔴 **Critical** must be resolved before any backend development can begin. Start these access requests **immediately** — Azure AD consent flows and Zoho OAuth setup can take days.

---

## Quick Summary

| Category | Count |
|---|---|
| Azure Platform Services | 9 |
| External API Integrations | 5 (Graph, Zoho, Telegram, LLM, SharePoint) |
| Graph API Permission Scopes | 8+ |
| Zoho API Scopes | 3 |
| New Database Tables Needed | 3 (`leave_events`, `email_audit_log`, `scheduled_reminders`) |
| LangGraph Agent Tools | 15 |
| Backend Python Packages | ~25 |
| Environment Variables | ~25 |
| Access Requests to File | 15 |
