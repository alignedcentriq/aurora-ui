---
name: project_centriq_ai
description: "Full architecture, stack, file map, all agent tools, DB models, REST API, frontend routes, env vars, and current state of Centriq AI (Aurora UI). Read this first on every new session."
metadata: 
  node_type: memory
  type: project
  originSessionId: cf7f106c-3a9e-474b-a62b-1077682a6606
---

# Centriq AI — Complete Project Reference

**Company:** Aligned Automation  
**Product:** Centriq AI — enterprise internal AI assistant  
**Repo root:** `/Users/sharmaji/aurora-ui/`  
**Backend port:** 8080  
**Frontend port:** 5173 (Vite dev server, proxies `/api` → `http://127.0.0.1:8080`)  
**Git branch:** `dev_sharmaji` → PR to `main`

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite, TanStack Router (file-based), Zustand, shadcn/ui, Tailwind |
| Auth | Azure MSAL SSO (`src/lib/msal.ts`, `useAuth()` hook). Frontend sends `x-user-email` + `x-user-role` headers derived from verified MSAL account on every API call. Backend reads headers in `auth.py` dependency. |
| Backend | FastAPI (Python 3.11+) |
| AI Framework | LangGraph StateGraph, LangChain `@tool` decorator |
| LLM | Local Ollama via OpenAI-compatible API. Two configs: ROUTER (`gpt-oss:20b` macOS / `gpt-oss:latest` Windows Aligned server) handles intent classification AND all domain agent tool calling; AGENT (`llama3.3:70b`) used only for summarization. All domain agents use ROUTER settings intentionally — `gpt-oss` family is the tool-capable model. |
| DB | PostgreSQL, schema `enterprise_ai`. SQLAlchemy ORM |
| Checkpointer | Redis (`AsyncRedisSaver`), falls back to `MemorySaver` if unavailable |
| Storage | MinIO (bucket: `aurora-bucket`) for PDF documents |
| Email | SMTP via `email_service.py` — IT helpdesk, admin notifications |
| Observability | Langfuse (LLM tracing), Loki + pythonjsonlogger logging |

---

## Architecture — LangGraph Multi-Agent Flow

```
User → POST /api/chat {message, session_id}
  → intent_router node  (classifier LLM → DOMAIN_REGISTRY → also extracts sub_intent + entities)
  → feedback_lookup node  (keyword similarity search in chat_feedback table → injects feedback_context)
  → route_to_agent()
      ├── hr_agent (inline node + hr_tools ToolNode → summarizer → END)
      ├── pmo_agent_node   (calls compiled pmo_agent sub-graph)
      ├── admin_agent_node (calls compiled admin_agent sub-graph)
      ├── it_agent_node    (calls compiled it_agent sub-graph; entity hint injected from router)
      ├── manager_agent_node (calls compiled manager_agent sub-graph)
      ├── general_agent    (get_announcements + search_hr_policies tools, ToolNode loop)
      └── placeholder_agent
```

**AgentState:**
```python
{
  messages: List[BaseMessage],
  domain: Optional[str],
  route_confidence: Optional[float],
  route_reasoning: Optional[str],
  sub_intent: Optional[str],    # granular intent label e.g. "software_install"
  entities: Optional[dict],     # pre-extracted entities e.g. {"software_name": "Node.js"}
  feedback_context: Optional[str],
  user_email: Optional[str],
}
```

**Entity hint injection:** `it_agent_node` appends `[Router extracted: sub_intent=..., entities={...}]` to `feedback_context` before calling the IT sub-graph. This reinforces direct action — the agent sees both the router's label and the extracted entity in context.

Each sub-agent has its own `StateGraph` with a `tools` node (ToolNode) that loops back to the agent node until no tool calls remain. All sub-agents accept `feedback_context: str` and `user_email: str` in their state TypedDicts and inject `feedback_context` after the guardrail in their system prompts.

**Session memory:** `session_id` from chat request = `thread_id` in LangGraph checkpointer = persistent conversation history per user session.

---

## Backend File Map

```
backend/app/
├── main.py                     # FastAPI app, all REST endpoints, startup event
├── auth.py                     # get_current_user() + require_admin() FastAPI Depends; reads x-user-email/x-user-role headers
├── agent.py                    # Main LangGraph: HR tools, sub-agent nodes, full graph compile
├── router.py                   # classify_intent() → {domain, confidence, sub_intent, entities}; DOMAIN_REGISTRY
├── config.py                   # Settings class reading env vars (settings singleton)
├── models.py                   # All SQLAlchemy ORM models (see DB section)
├── database.py                 # Engine, SessionLocal, init_db(), ALL seed functions
├── hr_service.py               # HRService: leave balance, apply leave, policy search, payroll
├── document_generation/
│   └── generator.py            # generate_pdf(doc_type, title, content, generated_by) → bytes
├── document_store.py           # store_pdf() / get_pdf() — in-memory dict cache for PDF downloads
├── minio_client.py             # MinIO client wrapper
├── sharepoint_routes.py        # MS Graph webhook endpoints
├── sharepoint_transfer_service.py  # Transfer SharePoint folder → MinIO
├── graph_sync.py               # renew_subscriptions() for MS Graph delta subscriptions
├── redis_config.py             # Redis connection URL
├── langfuse_tracing.py         # langfuse_trace() and langfuse_event() context managers
├── pmo_routes.py               # REST: GET /api/pmo/projects (list + single only)
├── agents/
│   ├── admin_agent.py          # Admin domain sub-graph (13 tools) — has Direct Action Rules
│   ├── it_agent.py             # IT Support domain sub-graph (5 tools) — has Direct Action Rules
│   ├── manager_agent.py        # Functional Manager domain sub-graph (1 tool: get_my_team)
│   └── pmo_agent.py            # PMO domain sub-graph (5 tools, pdf_interceptor node)
├── routes/
│   ├── announcement_routes.py  # REST: /api/announcements; GET=auth-required; POST/DELETE=admin-only
│   ├── employee_routes.py      # REST: /api/employees search/profile/org-chart/skills
│   ├── it_routes.py            # REST: /api/it; all endpoints auth-guarded; HITL=admin-only
│   └── prompt_routes.py        # REST: /api/prompts; PUT=admin-only (role from token, not body)
└── services/
    ├── admin_service.py        # Parking, reimbursement, accommodation, facility, food complaints
    ├── announcement_service.py # Announcement CRUD
    ├── email_service.py        # SMTP dispatcher (IT ticket, parking, facility, food, reimbursement, announcement)
    ├── employee_service.py     # Directory search, org chart, skills (uses EmployeeZohoProfile.skill_set only), headcount
    ├── feedback_service.py     # record(), get_relevant_feedback(), build_feedback_prompt(), get_stats() for ChatFeedback
    ├── it_service.py           # IT tickets, software requests, asset assignments; HITL approval (no passwords)
    ├── manager_service.py      # get_reportees() only — uses Employee.manager_id (NOT reporting_manager_id)
    ├── policy_service.py       # Ingest policies from OneDrive; RAG search
    └── prompt_service.py       # get_system_prompt(), get_guardrail(), update_prompt(), list_prompts()
```

**Deleted:** `services/transcript_service.py` — removed along with SessionTranscript model.

---

## Authentication (`auth.py`)

```python
@dataclass
class CurrentUser:
    email: str
    role: str  # "employee" | "admin" | "manager" | "hr" | "it" | "pmo"

def get_current_user(x_user_email, x_user_role) -> CurrentUser
# Reads headers set by frontend from verified MSAL token claims.
# Falls back to settings.DEFAULT_USER_EMAIL when headers are absent (dev mode).

def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser
# Raises HTTP 403 if user.role != "admin".
```

**Frontend side:** `AssistantView.tsx` sends `x-user-email: user.email` and `x-user-role: user.role.toLowerCase()` on every `POST /api/chat`. User object comes from `useAuth()` which reads verified MSAL `account.username` and `idTokenClaims.roles[0]`.

---

## Database — Active Tables (schema: `enterprise_ai`)

> Note: `employees`, `leaves`, `payroll`, `attendance`, `policies` have NO `__table_args__` — they land in the default schema, not `enterprise_ai`.

**Removed tables:** Sprint, TeamCapacity, Milestone, ProjectAssignment, SessionTranscript, TrainingAssignment, EmployeeSkillMap — out of scope, seed data removed too.

### HR Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `Employee` | `employees` | id, employee_id, name, email, department, designation, manager_id (self-ref FK), joining_date, employment_type, location, pf_number, insurance_plan, tax_regime, shift_type |
| `Leave` | `leaves` | employee_id→employees, leave_type (Casual/Sick/Earned/Optional), start_date, end_date, status (Pending/Approved/Rejected/Cancelled), reason |
| `Payroll` | `payroll` | employee_id, month, year, base_salary, bonus, deductions, net_salary, tax_paid, status |
| `Attendance` | `attendance` | employee_id, date, check_in, check_out, status (Present/Absent/WFH/Half-day) |
| `Policy` | `policies` | title, category (Leave/WFH/etc.), content |
| `EmployeeZohoProfile` | `employee_zoho_profiles` | employee_id (FK unique), zoho_link_id, first_name, last_name, official_email, function, designation, zoho_role, employment_type, employee_status, source_of_hire, date_of_joining, date_of_confirmation, tenure_in_aa, total_experience, reporting_manager, age, gender, about_me, blood_group, expertise, work_phone, extension, sub_location, tags, onboarding_status, organization_structure, level, grade, skill_set, functional_manager, language_known, resource_management_function, project_manager, project_manager_2, role, date_for_360_feedback, nationality, active_details |

**⚠️ SECURITY — NEVER expose from ZohoProfile:** Fixed CTC, Variable CTC, Total CTC, Bank Account, PAN, Aadhaar, UAN, Passport, Personal Mobile, Personal Email, Bank Name/Branch/IFSC, Monthly Pricing, Contract End Date.

### PMO Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `Project` | `projects` | name (unique), status, completion_pct, next_milestone, next_milestone_date, owner, achievements |

### Admin Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `Reimbursement` | `reimbursements` | employee_id, type, amount, receipt_url, status, approved_by, reason |
| `ParkingSticker` | `parking_stickers` | employee_id, vehicle_type, vehicle_number, vehicle_make, vehicle_model, sticker_number, valid_from, valid_until, status |
| `Accommodation` | `accommodations` | employee_id, type, check_in, check_out, location, status |
| `FacilityComplaint` | `facility_complaints` | ticket_id (FC-xxx), employee_id, category, description, location, priority, status, assigned_to, resolved_at |
| `FoodVendorFeedback` | `food_vendor_feedback` | employee_id, vendor_name, rating (1-5), food_quality, hygiene, service, comments |
| `FoodComplaint` | `food_complaints` | employee_id, vendor_name, complaint_type, description, status |

### IT Support Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `ITTicket` | `it_tickets` | ticket_id (IT-xxx / IT-SW-xxx), employee_id, category, subject, description, priority, status (Open/Awaiting Approval/In Progress/Resolved/Closed), requires_admin_password*, admin_password_provided*, resolved_at |
| `SoftwareRequest` | `software_requests` | employee_id, it_ticket_id, software_name, version, justification, requires_admin, status |
| `AssetAssignment` | `asset_assignments` | employee_id, asset_type, asset_tag, brand, model, serial_number, assigned_date, status |
| `HITLRequest` | `hitl_requests` | ticket_id→it_tickets, request_type (software_approval/escalation), status (Pending/Completed/Expired), completed_at, completed_by |

*`requires_admin_password` and `admin_password_provided` columns still exist in DB but are no longer written by service code. HITL is now a pure approval flow — no password concept.

### Functional Manager Domain
No dedicated tables. Manager agent has a single tool: `get_my_team` (lists direct reports via `Employee.manager_id`).

### Cross-Domain / System
| Model | Table | Key Columns |
|-------|-------|-------------|
| `PromptConfig` | `prompt_configs` | agent_domain, prompt_key (system_prompt/guardrail), prompt_value, version, is_active, allowed_roles, created_by |
| `Announcement` | `announcements` | title, body, category, created_by (email from auth token), created_by_domain, target_audience, is_active, expires_at |
| `ChatFeedback` | `chat_feedback` | session_id, domain, user_message, ai_response, rating (1/-1), feedback_text, created_at |
| `GraphSubscription` | `graph_subscriptions` | subscription_id, site_id, drive_id, expiration_time, status |
| `SharePointDeltaToken` | `sharepoint_delta_tokens` | drive_id (unique), delta_url, last_sync |
| `SharePointFile` | `sharepoint_files` | file_id (unique), name, path, web_url, last_modified, processing_status |
| `SyncFailureLog` | `sync_failure_logs` | resource_id, error_type, error_message, resolved |

---

## Agent Tools — Complete List

### HR Agent (defined in `agent.py`, node is `hr_agent`)
| Tool | What it calls |
|------|--------------|
| `get_leave_balance(email)` | HRService.get_leave_balance |
| `apply_leave(email, start_date, end_date, leave_type, reason)` | HRService.apply_leave |
| `search_hr_policies(query)` | HRService.search_policies |
| `get_payroll_info(email)` | HRService.get_payroll_info |
| `transfer_sharepoint_to_minio(site_name, folder_path, minio_prefix)` | sharepoint_transfer_service |
| `list_minio_documents(prefix)` | minio_client.list_objects |
| `search_employee_directory(query, function, location, designation)` | EmployeeService.search_directory |
| `get_employee_profile(name_or_email)` | EmployeeService.get_profile |
| `get_org_chart(name_or_email)` | EmployeeService.get_org_chart |
| `get_team_roster(manager_name)` | EmployeeService.get_team_roster |
| `find_skills_expert(skill)` | EmployeeService.find_skills_expert |
| `get_department_headcount(function)` | EmployeeService.get_department_headcount |
| `create_announcement(title, body, category, target_audience, expires_days)` | AnnouncementService.create |
| `get_announcements(domain_filter)` | AnnouncementService.get_active |
| `deactivate_announcement(id)` | AnnouncementService.deactivate |
| `update_hr_prompt(new_prompt)` | PromptService.update_prompt (hr_manager role required) |

### PMO Agent (`agents/pmo_agent.py` — 5 tools)
| Tool | Description |
|------|-------------|
| `list_projects()` | All project names from DB |
| `get_project_status(project_name)` | Status, completion %, next milestone, owner |
| `get_project_achievements(project_name)` | Achievements text |
| `generate_project_report(project_name, report_type)` | PDF → returns `[DOWNLOAD_PDF:/api/documents/download/{id}:title]` |
| `generate_multi_project_report(project_names, report_type)` | Multi-project PDF |

**PMO PDF Interceptor:** `pdf_interceptor` graph node fires BEFORE pmo_assistant. Detects PDF keywords in user message ("generate report", "create pdf", etc.) and directly emits the tool_call without going through the LLM.

### Admin Agent (`agents/admin_agent.py` — 13 tools, Direct Action Rules)
| Tool | Description |
|------|-------------|
| `submit_reimbursement(email, type, amount, reason)` | Create + email admin |
| `check_reimbursement_status(email)` | All reimbursements for employee |
| `request_parking_sticker(email, vehicle_type, vehicle_number, vehicle_make, vehicle_model)` | Create + email admin |
| `surrender_parking_sticker(email, vehicle_number)` | Surrender + email admin |
| `get_parking_info(email)` | All parking stickers |
| `request_accommodation(email, type, check_in, check_out, location)` | Guest house/hotel |
| `file_facility_complaint(email, category, description, location, priority)` | Create FC-xxx ticket + email admin |
| `check_complaint_status(ticket_id)` | Facility complaint status |
| `submit_food_complaint(email, vendor_name, complaint_type, description)` | Food complaint + email admin |
| `submit_food_feedback(email, vendor_name, rating, comments)` | Star rating (1-5) |
| `get_vendor_ratings(vendor_name)` | Average rating for vendor |
| `post_admin_announcement(title, body, category, target_audience)` | Admin announcement |
| `update_admin_prompt(new_prompt)` | Update Admin system prompt (admin_manager role) |

**Admin Direct Action Rules:** System prompt has 7 explicit trigger rules mapping user phrases to tool calls. Vehicle number is always required for parking sticker; vehicle make/model are optional.

### IT Agent (`agents/it_agent.py` — 5 tools, Direct Action Rules)

**Key pattern:** Email is injected from `ITState.user_email` via LangGraph `InjectedState` — it is **never in the LLM-visible tool schema**. The LLM cannot ask for email or justification because those fields do not exist in the schema it receives.

| Tool | LLM-visible params | Description |
|------|--------------------|-------------|
| `request_software_install` | `software_name` only | Creates ITTicket + SoftwareRequest + HITLRequest; email from state, no justification |
| `create_it_ticket` | `category, subject, description, priority` | Creates ITTicket + emails helpdesk; email from state |
| `check_ticket_status` | `ticket_id` | Status of IT ticket |
| `get_my_tickets` | _(none)_ | All IT tickets for the logged-in user; email from state |
| `get_my_assets` | _(none)_ | Assigned IT assets; email from state |

**IT Direct Action Rules:** 5 explicit rules in system prompt:
1. Install/setup request → call `request_software_install(software_name=<name>)` immediately. NEVER ask why.
2. Hardware/network/system issue → call `create_it_ticket` immediately, infer category + priority from context
3. Ticket status query → call `check_ticket_status(ticket_id=<id>)` immediately
4. "My tickets"/"my requests" → call `get_my_tickets` immediately (no params needed)
5. "My assets"/"my laptop" → call `get_my_assets` immediately (no params needed)

**Rules in system prompt:** NEVER ask for justification. NEVER ask for email. Act first.

### General Agent (`agent.py` — 2 tools, inline ToolNode loop)
| Tool | Description |
|------|-------------|
| `get_announcements(domain_filter)` | Fetch all active announcements |
| `search_hr_policies(query)` | RAG search for policy details by topic |

### Manager Agent (`agents/manager_agent.py` — 1 tool)
| Tool | Description |
|------|-------------|
| `get_my_team(manager_email)` | Direct reports via `Employee.manager_id` — name, designation, department |

Manager agent is read-only for team composition. All other employee details (leave, payroll, profile) go through HR domain.

---

## Grounding / Anti-Hallucination System

Every agent appends `PromptService.get_guardrail(domain)` after its system prompt. The guardrail:

```
GROUNDING RULES — MANDATORY, NON-NEGOTIABLE:
1. ONLY answer from tool results, company database, or policies in this conversation.
2. NEVER generate from training knowledge or general world knowledge.
3. NEVER provide generic industry examples, external products, or hypothetical scenarios.
4. If cannot answer → "I don't have that information in our system. Please reach out to the relevant team directly."
5. If outside domain → "This is outside my area. Please contact the relevant team."
6. Never fabricate employee data, project data, policy details, or company-specific information.
```

Guardrail can be overridden per-domain via `PromptConfig` row with `prompt_key='guardrail'` (admin-editable at runtime via `/api/prompts`).

**User identity injection:** ALL agents inject the logged-in user's email into their system prompt: `"The logged-in employee's email is: {user_email}. NEVER ask who the user is."` The email flows from `AgentState.user_email`, set by `intent_router` from the `x-user-email` header (falls back to `settings.DEFAULT_USER_EMAIL`).

---

## REST API Endpoints

### Core (`main.py`)
| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/` | None | `{status, message}` |
| POST | `/api/chat` | None | `{response, domain, id, processing_time, download_url}` |
| POST | `/api/feedback` | None | `{status}` |
| GET | `/api/feedback/stats` | None | `{total, helpful, unhelpful, score_pct}` |
| POST | `/api/track` | None | `{status}` |
| POST | `/api/upload` | None | `{text, filename, char_count}` |
| GET | `/api/documents/download/{file_id}` | None | PDF stream |
| GET | `/api/admin/stats` | **Admin only** | Ops metrics |
| GET | `/api/hr/dashboard` | **Auth required** | Dashboard scoped to calling user |
| GET | `/api/hr/leaves` | **Auth required** | Leaves scoped to calling user |
| GET | `/api/hr/payroll` | **Auth required** | Payroll scoped to calling user |

### PMO (`/api/pmo`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/pmo/projects` | None | Paginated, filter: `status` |
| GET | `/api/pmo/projects/{id}` | None | Single project |

### IT (`/api/it`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/it/hitl/complete?ticket_id=` | **Admin only** | Approves pending HITL; `approved_by` from token |
| GET | `/api/it/hitl/pending` | **Admin only** | All pending HITL requests |
| GET | `/api/it/tickets?status=&email=` | **Auth required** | Non-admins see only own tickets |

### Announcements (`/api/announcements`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/announcements?include_inactive=` | **Auth required** | |
| POST | `/api/announcements` | **Admin only** | `created_by` from auth token, not request body |
| DELETE | `/api/announcements/{id}` | **Admin only** | `requested_by` from auth token |

### Prompts (`/api/prompts`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/prompts?domain=` | **Auth required** | |
| GET | `/api/prompts/{domain}` | **Auth required** | |
| PUT | `/api/prompts/{domain}/{key}` | **Admin only** | Body: `{value}` only — `user_role` derived from token |

### Employees (`/api/employees`)
| GET `/api/employees/search?q=&function=&location=&designation=&limit=` | None |
| GET `/api/employees/profile?identifier=` | None |
| GET `/api/employees/org-chart?name_or_email=` | None |
| GET `/api/employees/team?manager=` | None |
| GET `/api/employees/skills?skill=` | None |
| GET `/api/employees/headcount?function=` | None |

### SharePoint (`/api`)
| POST `/api/sharepoint/webhook` | MS Graph delta webhook |
| GET `/api/sharepoint/files` | Synced files list |

---

## IT HITL Flow (Updated — No Passwords)

1. Employee says "install Node.js" → IT agent calls `request_software_install(email, "Node.js", justification)`
2. `ITService.request_software_install`:
   - Creates `ITTicket` (status: "Awaiting Approval")
   - Creates `SoftwareRequest`
   - Creates `HITLRequest` (request_type="software_approval", status="Pending")
3. Agent tells user: "Request submitted (Ticket ID: IT-SW-xxx). IT Admin will review and approve."
4. IT Admin sees pending requests via `GET /api/it/hitl/pending` (admin auth required)
5. IT Admin approves via `POST /api/it/hitl/complete?ticket_id=IT-SW-xxx` (admin auth required)
6. `ITService.approve_hitl_request(ticket_id, admin_email)`:
   - Updates `ITTicket.status` → "In Progress"
   - Updates `HITLRequest.status` → "Completed", sets `completed_by` = admin email from token

**No admin password involved anywhere in this flow.**

---

## Email Service (`services/email_service.py`)

SMTP (STARTTLS, port 587 default). Silent on failure — never blocks primary operation.

| Function | Trigger | To / CC |
|----------|---------|---------|
| `send_it_ticket_email(...)` | IT ticket created | `HELPDESK_EMAIL` CC employee |
| `send_parking_request_email(...)` | Parking request or surrender | `ADMIN_EMAIL` CC employee |
| `send_facility_complaint_email(...)` | Facility complaint | `ADMIN_EMAIL` CC employee |
| `send_food_complaint_email(...)` | Food complaint | `ADMIN_EMAIL` |
| `send_reimbursement_email(...)` | Reimbursement submitted | `ADMIN_EMAIL` CC employee |
| `send_announcement_email(recipients, ...)` | Announcement created | List of recipient emails |

---

## Frontend

```
src/
├── routes/
│   ├── _layout.index.tsx       # / — AssistantView (main chat)
│   ├── _layout.admin.tsx       # /admin — Admin Dashboard
│   ├── _layout.config.tsx      # /config — live prompt config editor (admin/manager only)
│   ├── _layout.settings.tsx    # /settings — user preferences
│   └── _layout.team.tsx        # /team — employee directory (placeholder, no content yet)
├── components/assistant/
│   ├── AssistantView.tsx       # Chat orchestrator; sends x-user-email/x-user-role headers on all API calls
│   ├── Message.tsx             # UserMessage + AIMessage (domain badge chip) + AnswerCard
│   ├── Composer.tsx            # Text input + send; real file upload to /api/upload; attached file chip
│   ├── AnnouncementBanner.tsx  # Dismissible banner: fetches /api/announcements
│   └── Sidebar.tsx             # Thread list
└── lib/
    ├── auth-store.tsx          # MSAL AuthProvider; user.email = account.username, user.role from idTokenClaims.roles[0]
    ├── chat-store.ts           # Zustand: threads Record<id, {turns: Turn[]}>, activeId, thinking
    └── settings-store.ts       # Zustand: theme, aiTone, userNickname, reasoningDepth, responseFormat
```

**API header pattern in AssistantView.tsx:**
```ts
headers: {
  "Content-Type": "application/json",
  ...(user?.email ? { "x-user-email": user.email } : {}),
  ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
}
```

---

## Configuration (`config.py`)

| Env Var | Default / "auto" | Purpose |
|---------|-----------------|---------|
| `ROUTER_BASE_URL` | `auto` → Aligned server (Win) / localhost (mac) | LLM API for routing + all agents |
| `ROUTER_MODEL_NAME` | `auto` → `gpt-oss:latest` (Win) / `gpt-oss:20b` (mac) | Tool-capable model |
| `AGENT_BASE_URL` | `auto` | Summarization LLM only |
| `AGENT_MODEL_NAME` | `llama3.3:70b` | Summarization only |
| `DATABASE_URL` | `auto` → `postgresql://postgres:postgres@{host}:5433/centriq` | PostgreSQL |
| `REDIS_URL` | `auto` → `redis://{host}:6380` | LangGraph checkpointer |
| `MINIO_ENDPOINT` | `auto` → `{host}:9000` | Object storage |
| `USE_MEMORY_SAVER` | `false` | Force MemorySaver (no Redis) |
| `DEFAULT_USER_EMAIL` | `employee1@centriq.ai` | Dev fallback when x-user-email header absent |
| `PORT` | `8080` | Backend port |
| `SMTP_HOST/PORT/USER/PASS` | `smtp.gmail.com/587` | Email |
| `HELPDESK_EMAIL` | `helpdesk@alignedautomation.com` | IT tickets destination |
| `ADMIN_EMAIL` | `admin@alignedautomation.com` | Admin notifications |
| `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET` | — | Azure AD for SharePoint Graph API |

---

## Key Patterns & Conventions

1. **`SessionLocal()` per method, closed in `finally`** — every service method manages its own DB session.
2. **Email never blocks** — all `send_*` calls wrapped in `try/except` with `pass`.
3. **`ilike(f"%{value}%")`** — fuzzy matching throughout for names, projects, teams.
4. **`[DOWNLOAD_PDF:url:title]` tag** — PDF tools embed this exact tag. PMO agent MUST preserve verbatim. `main.py /api/chat` parses it and sets `download_url` in response.
5. **Sub-agents as compiled sub-graphs** — each domain agent is a `StateGraph.compile()` result called via `.ainvoke()` in `agent.py`.
6. **`PromptService.get_system_prompt(domain, default)`** → DB first, falls back to hardcoded default. Admins can override at runtime via `/api/prompts`.
7. **`PromptService.get_guardrail(domain)`** → appended to ALL agent system prompts.
8. **`DEFAULT_USER_EMAIL`** → fallback only. Real identity comes from `x-user-email` header (MSAL-verified).
9. **IT HITL flow** → approval only, no passwords. Admin calls `POST /api/it/hitl/complete?ticket_id=` to advance to "In Progress".
10. **`ManagerService.get_reportees()`** uses `Employee.manager_id` (NOT `reporting_manager_id` which doesn't exist).
10a. **`InjectedState` pattern for tool params the LLM should never see:** Use `state: Annotated[dict, InjectedState]` as a tool parameter; LangGraph's `ToolNode` injects the current state at execution time and `bind_tools` strips it from the OpenAI-format schema. Use this for `email` (already known from auth) and any other field the user should never be asked about. IT agent tools use this for all email params and removed `justification` entirely from `request_software_install`.
11. **Loki logging** — `_SilentLokiHandler` suppresses connection errors when Loki is not running.
12. **Auth dependency pattern** — use `Depends(get_current_user)` for any endpoint returning user-specific data; use `Depends(require_admin)` for write/admin endpoints.

---

## Seeded Data (in `database.py`)

`init_db()` called on startup. Seeds only if count == 0.

| Seed Function | What It Creates |
|---------------|-----------------|
| `_seed_hr_data(db)` | Employees, Leaves, Payroll, Attendance, Policies |
| `_seed_pmo_data(db)` | 12 Projects only (no Sprints/Milestones/TeamCapacity) |
| `_seed_admin_data(db)` | Reimbursements, ParkingStickers, Accommodations, FacilityComplaints, FoodVendorFeedback |
| `_seed_it_data(db)` | ITTickets, SoftwareRequests, AssetAssignments |
| `_seed_prompt_configs(db)` | PromptConfig rows for hr, admin, it_support, pmo, functional_manager |
| `_seed_zoho_profiles(db)` | EmployeeZohoProfile rows for all employees |
| `_seed_announcements(db)` | Sample Announcements |

**Removed seed functions:** `_seed_manager_data()` (TrainingAssignments/SkillMap), `_seed_transcripts()` (SessionTranscripts).

---

## Domain Router (`router.py`)

`classify_intent(user_message)` → `{domain, confidence, reasoning, sub_intent, entities}`

| Domain | What routes here |
|--------|-----------------|
| `hr` | Leave, payroll, salary slips, attendance, HR policies, benefits, appraisals, WFH |
| `admin` | Reimbursement, parking sticker, accommodation, facility complaints, food, cafeteria |
| `it_support` | Software install (HITL approval), IT tickets, assets, password reset, VPN, network |
| `pmo` | Company/AI/internal projects, project status, completion %, achievements, PDF reports |
| `functional_manager` | "Who is on my team", "who reports to me", direct reports, team members |
| `general` | Greetings, small talk, questions about Centriq AI itself — NOT company data |

Router LLM outputs JSON with `sub_intent` (e.g., `"software_install"`) and `entities` (e.g., `{"software_name": "Node.js"}`). These flow into `AgentState` and are injected as a hint into `it_agent_node`.

---

## What Has Been Built (Completed Phases)

*(earlier phases omitted for brevity — see git log)*

**Phase 8 — Cleanup & Direct Action Rules:**
- Removed Sprint, TeamCapacity, Milestone, ProjectAssignment, SessionTranscript, TrainingAssignment, EmployeeSkillMap models and all related code
- PMO agent: 13 tools → 5 (project list/status/achievements + PDF generation only)
- Manager agent: 9 tools → 1 (`get_my_team` only — read-only team lookup)
- IT/Admin agents: added "Direct Action Rules" system prompt pattern — numbered trigger phrases mapped to specific tool calls with example parameters, preventing generic intake questions
- Router: added `sub_intent` + `entities` extraction; entity hint injected into IT agent context
- `AgentState`: extended with `sub_intent` and `entities` fields

**Phase 9 — Security Hardening:**
- `backend/app/auth.py` — new `get_current_user` + `require_admin` FastAPI dependencies
- All 5 confirmed vulnerability groups patched:
  - `/api/admin/stats` → admin-only
  - `/api/hr/dashboard`, `/api/hr/leaves`, `/api/hr/payroll` → auth-required, scoped to calling user (not hardcoded DEFAULT_USER_EMAIL)
  - `POST /api/it/hitl/complete` → admin-only; `approved_by` from token
  - `GET /api/it/hitl/pending` → admin-only
  - `GET /api/it/tickets` → auth-required; non-admins see only their own
  - `POST /api/announcements`, `DELETE /api/announcements/{id}` → admin-only; `created_by` from token
  - `PUT /api/prompts/{domain}/{key}` → admin-only; `user_role` no longer accepted from request body
- HITL simplified: `mark_admin_password_provided` → `approve_hitl_request`; `request_type` changed from `"admin_password"` → `"software_approval"`; all password language removed from messages
- Frontend `AssistantView.tsx`: sends `x-user-email` + `x-user-role` headers from MSAL account on every API call

---

## What Does NOT Exist Yet (Future Work)

- **Employee Directory `/team` route:** `_layout.team.tsx` exists but has no content
- **Semantic similarity for feedback:** Currently keyword overlap (no embeddings)
- **Pre-existing TS error in `_layout.settings.tsx`:** Lines 153-154 `Property 'department' does not exist on type 'User'`
- **JWT validation on backend:** Current auth reads headers directly — no cryptographic validation of MSAL JWT. For hardened production, add `python-jose` and validate Bearer tokens against Azure AD JWKS endpoint.

---

## Known Bugs Fixed

| Bug | File | Fix |
|-----|------|-----|
| IT agent asked for email and justification on software install | `it_agent.py`, `it_service.py` | Used `InjectedState` to inject email from state — absent from LLM schema entirely. Removed `justification` param from tool + service; description auto-generated. |
| "install nodejs" → agent asked "What IT issue?" instead of acting | `it_agent.py` | Added Direct Action Rules — numbered trigger phrases force immediate tool calls |
| `ManagerService.get_reportees()` always returned empty | `manager_service.py` | Wrong column: `Employee.reporting_manager_id` → `Employee.manager_id` |
| `json` not imported in `request_software_install` | `agents/it_agent.py` | Added `import json` |
| Admin/IT agents asked user for email/name | `admin_agent.py`, `it_agent.py` | Inject `user_email` from state into prompt |
| "AI projects" routed to general, giving ChatGPT examples | `router.py` | Added AI/tech project keywords to PMO domain |
| PMO hallucinated generic AI project examples | `pmo_agent.py` | Always call `list_projects` first |
| `/api/feedback` silently discarded data | `main.py` | Now stores to DB via `FeedbackService.record()` |
| `/api/hr/leaves` and `/api/hr/payroll` returned ALL employees' data | `main.py` | Now scoped to authenticated user via `employee_id` filter |
| `DEFAULT_USER_EMAIL` hardcoded as identity for HR dashboard | `main.py` | Now uses `user.email` from `get_current_user` dependency |
| HITL endpoint accepted `admin_email` as query param (unauthenticated) | `it_routes.py` | Admin auth required; email from token via `require_admin` |
| `user_role` could be set to "admin" by anyone via request body | `prompt_routes.py` | Removed from `PromptUpdate` body; derived from auth token only |
| `DATABASE_URL=auto` caused SQLAlchemy parse error | `create_db.py` | Uses `settings.DATABASE_URL` (resolved URL) |
| Loki `--- Logging error ---` spam when Loki not running | `main.py` | `_SilentLokiHandler` overrides `handleError` as no-op |
