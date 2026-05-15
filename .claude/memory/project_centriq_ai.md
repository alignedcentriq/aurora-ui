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
| Auth | Azure MSAL SSO (`src/lib/msal.ts`, `useAuth()` hook) |
| Backend | FastAPI (Python 3.11+) |
| AI Framework | LangGraph StateGraph, LangChain `@tool` decorator |
| LLM | Local Ollama (`llama3.2:3b`) via OpenAI-compatible API. Two configs: ROUTER (intent classification) and AGENT (tool calling) — both default to same model/URL |
| DB | PostgreSQL, schema `enterprise_ai`. SQLAlchemy ORM |
| Checkpointer | Redis (`AsyncRedisSaver`), falls back to `MemorySaver` if unavailable |
| Storage | MinIO (bucket: `aurora-bucket`) for PDF documents |
| Email | SMTP via `email_service.py` — IT helpdesk, admin notifications |
| Observability | Langfuse (LLM tracing), Loki + pythonjsonlogger logging |

---

## Architecture — LangGraph Multi-Agent Flow

```
User → POST /api/chat {message, session_id}
  → intent_router node  (classifier LLM → DOMAIN_REGISTRY)
  → route_to_agent()
      ├── hr_agent (inline node + hr_tools ToolNode → summarizer → END)
      ├── pmo_agent_node   (calls compiled pmo_agent sub-graph)
      ├── admin_agent_node (calls compiled admin_agent sub-graph)
      ├── it_agent_node    (calls compiled it_agent sub-graph)
      ├── manager_agent_node (calls compiled manager_agent sub-graph)
      ├── general_agent    (get_announcements + search_hr_policies tools, ToolNode loop)
      └── placeholder_agent
```

**AgentState:** `{ messages: List[BaseMessage], domain: str, route_confidence: float, route_reasoning: str }`

Each sub-agent has its own `StateGraph` with a `tools` node (ToolNode) that loops back to the agent node until no tool calls remain.

**Session memory:** `session_id` from chat request = `thread_id` in LangGraph checkpointer = persistent conversation history per user session.

---

## Backend File Map

```
backend/app/
├── main.py                     # FastAPI app, all REST endpoints, startup event
├── agent.py                    # Main LangGraph: HR tools, sub-agent nodes, full graph compile
├── router.py                   # classify_intent(), DOMAIN_REGISTRY, route descriptions
├── config.py                   # Settings class reading env vars (settings singleton)
├── models.py                   # All 27 SQLAlchemy ORM models
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
├── pmo_routes.py               # REST: GET /api/pmo/projects, /sprints, /milestones, /team-capacity
├── agents/
│   ├── admin_agent.py          # Admin domain sub-graph (13 tools)
│   ├── it_agent.py             # IT Support domain sub-graph (5 tools)
│   ├── manager_agent.py        # Functional Manager domain sub-graph (9 tools)
│   └── pmo_agent.py            # PMO domain sub-graph (13 tools, pdf_interceptor node)
├── routes/
│   ├── announcement_routes.py  # REST: /api/announcements CRUD
│   ├── employee_routes.py      # REST: /api/employees search/profile/org-chart/skills
│   ├── it_routes.py            # REST: /api/it HITL endpoints + ticket list
│   └── prompt_routes.py        # REST: /api/prompts CRUD (role-checked)
└── services/
    ├── admin_service.py        # Parking, reimbursement, accommodation, facility, food complaints
    ├── announcement_service.py # Announcement CRUD
    ├── email_service.py        # SMTP dispatcher (IT ticket, parking, facility, food, reimbursement, announcement)
    ├── employee_service.py     # Directory search, org chart, skills, headcount
    ├── feedback_service.py     # record(), get_top_responses(), get_stats() for ChatFeedback
    ├── it_service.py           # IT tickets, software requests, asset assignments, HITL
    ├── manager_service.py      # Team, attendance, leave approval, training, skills
    ├── policy_service.py       # Ingest policies from OneDrive; RAG search
    ├── prompt_service.py       # get_system_prompt(), get_guardrail(), update_prompt(), list_prompts()
    └── transcript_service.py   # save_transcript(), search_transcripts(), get_recent_sessions()
```

---

## Database — All 27 Tables (schema: `enterprise_ai`)

> Note: `employees`, `leaves`, `payroll`, `attendance`, `policies` have NO `__table_args__` — they land in the default schema, not `enterprise_ai`.

### HR Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `Employee` | `employees` | id, employee_id, name, email, department, designation, manager_id (self-ref FK), joining_date, employment_type, location, pf_number, insurance_plan, tax_regime, shift_type |
| `Leave` | `leaves` | employee_id→employees, leave_type (Casual/Sick/Earned/Optional), start_date, end_date, status (Pending/Approved/Rejected/Cancelled), reason |
| `Payroll` | `payroll` | employee_id, month, year, base_salary, bonus, deductions, net_salary, tax_paid, status |
| `Attendance` | `attendance` | employee_id, date, check_in, check_out, status (Present/Absent/WFH/Half-day) |
| `Policy` | `policies` | title, category (Leave/WFH/etc.), content |
| `EmployeeZohoProfile` | `employee_zoho_profiles` | employee_id (FK unique), zoho_link_id, first_name, last_name, official_email, function, designation, zoho_role, employment_type, employee_status, source_of_hire, date_of_joining, date_of_confirmation, tenure_in_aa, total_experience, reporting_manager, age, gender, about_me, blood_group, expertise, work_phone, extension, sub_location, tags, onboarding_status, organization_structure, level, grade, skill_set, functional_manager, language_known, resource_management_function, project_manager, project_manager_2, role, date_for_360_feedback, nationality, active_details |

**⚠️ SECURITY — NEVER expose from ZohoProfile:** Fixed CTC, Variable CTC, Total CTC, Bank Account, PAN, Aadhaar, UAN, Passport, Personal Mobile, Personal Email, Bank Name/Branch/IFSC, Monthly Pricing, Contract End Date. These columns are intentionally absent from the model.

### PMO Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `Project` | `projects` | name (unique), status, completion_pct, sprint_name, next_milestone, next_milestone_date, owner, achievements |
| `Sprint` | `sprints` | team, name, start_date, end_date, velocity, committed, completed, blockers_count |
| `TeamCapacity` | `team_capacity` | team (unique), total_members, available, on_leave, capacity_pct |
| `Milestone` | `milestones` | project_name, name, due_date, status |
| `ProjectAssignment` | `project_assignments` | employee_id, project_name, role, start_date, end_date, allocation_pct, status (Active/Completed/On Hold) |
| `SessionTranscript` | `session_transcripts` | project_name, session_title, session_date, summary, transcript_text, uploaded_by, session_type (Flash Review/Sprint Review/Project Review/Standup/PMO Monitored) |

### Admin Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `Reimbursement` | `reimbursements` | employee_id, type (Travel/Medical/Certification/Equipment), amount, receipt_url, status (Pending/Approved/Rejected), approved_by, reason |
| `ParkingSticker` | `parking_stickers` | employee_id, vehicle_type (2-wheeler/4-wheeler), vehicle_number, vehicle_make, vehicle_model, sticker_number, valid_from, valid_until, status (Active/Expired/Pending/Surrendered) |
| `Accommodation` | `accommodations` | employee_id, type (Guest House/Hotel), check_in, check_out, location, status |
| `FacilityComplaint` | `facility_complaints` | ticket_id (FC-xxx), employee_id, category, description, location, priority (Low/Medium/High/Critical), status (Open/In Progress/Resolved/Closed), assigned_to, resolved_at |
| `FoodVendorFeedback` | `food_vendor_feedback` | employee_id, vendor_name, rating (1-5), food_quality, hygiene, service, comments |
| `FoodComplaint` | `food_complaints` | employee_id, vendor_name, complaint_type (Quality/Hygiene/Pricing/Variety/Service/Foreign Object/Other), description, status (Open/Acknowledged/Resolved) |

### IT Support Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `ITTicket` | `it_tickets` | ticket_id (IT-xxx or IT-SW-xxx), employee_id, category (Software Install/Hardware/Network/Access/Security), subject, description, priority, status (Open/Awaiting Approval/In Progress/Resolved/Closed), requires_admin_password, admin_password_provided, resolved_at |
| `SoftwareRequest` | `software_requests` | employee_id, it_ticket_id, software_name, version, justification, requires_admin, status (Pending/Approved/Installed/Rejected) |
| `AssetAssignment` | `asset_assignments` | employee_id, asset_type, asset_tag (unique), brand, model, serial_number, assigned_date, status (Assigned/Returned) |
| `HITLRequest` | `hitl_requests` | ticket_id→it_tickets, request_type (admin_password/approval/escalation), status (Pending/Completed/Expired), completed_at, completed_by |

### Functional Manager Domain
| Model | Table | Key Columns |
|-------|-------|-------------|
| `TrainingAssignment` | `training_assignments` | employee_id, assigned_by, course_name, platform (Udemy/Coursera/LinkedIn Learning/Internal), due_date, status (Assigned/In Progress/Completed/Overdue) |
| `EmployeeSkillMap` | `employee_skills` | employee_id, skill_name, proficiency (Beginner/Intermediate/Expert), certified |

### Cross-Domain / System
| Model | Table | Key Columns |
|-------|-------|-------------|
| `PromptConfig` | `prompt_configs` | agent_domain, prompt_key (system_prompt / tool_instruction / **guardrail**), prompt_value, version, is_active, allowed_roles (comma-sep), created_by |
| `Announcement` | `announcements` | title, body, category (Policy Update/Holiday/Events/Hiring/Training/General/IT Alert), created_by (email), created_by_domain, target_audience, is_active, expires_at |
| `ChatFeedback` | `chat_feedback` | session_id, domain, user_message, ai_response, rating (1=helpful / -1=unhelpful), feedback_text, created_at |
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

### PMO Agent (`agents/pmo_agent.py` — 13 tools)
| Tool | Description |
|------|-------------|
| `list_projects()` | All project names from DB |
| `get_project_status(project_name)` | Status, completion %, sprint, milestone, owner |
| `get_project_achievements(project_name)` | Achievements text |
| `get_sprint_info(team)` | Sprint velocity, committed, completed, blockers |
| `get_team_capacity(team)` | Headcount, availability, capacity % |
| `get_milestones(project_name)` | Milestone list + status |
| `generate_project_report(project_name, report_type)` | PDF → returns `[DOWNLOAD_PDF:/api/documents/download/{id}:title]` |
| `generate_multi_project_report(project_names, report_type)` | Multi-project PDF |
| `get_resource_allocation(project_name)` | Active ProjectAssignments for a project |
| `get_employee_projects(employee_identifier)` | All projects an employee is assigned to |
| `upload_session_transcript(project_name, session_title, summary, session_type)` | Save to session_transcripts |
| `search_session_transcripts(query, project_name)` | Keyword search across transcripts |
| `get_recent_sessions(project_name, limit)` | Most recent session transcripts |

**PMO PDF Interceptor:** `pdf_interceptor` graph node fires BEFORE pmo_assistant. Detects PDF keywords in user message ("generate report", "create pdf", etc.) and directly emits the tool_call without going through the LLM.

### Admin Agent (`agents/admin_agent.py` — 13 tools)
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

### IT Agent (`agents/it_agent.py` — 5 tools)
| Tool | Description |
|------|-------------|
| `create_it_ticket(email, category, subject, description, priority)` | Creates ITTicket + emails helpdesk (ManageEngine parses) |
| `check_ticket_status(ticket_id)` | Status of IT ticket |
| `get_my_tickets(email)` | All IT tickets for employee |
| `request_software_install(email, software_name, justification)` | Creates ITTicket + SoftwareRequest + HITLRequest; returns `json.dumps({ticket_id, message})` |
| `get_my_assets(email)` | Assigned IT assets |

### General Agent (`agent.py` — 2 tools, inline ToolNode loop)
| Tool | Description |
|------|-------------|
| `get_announcements(domain_filter)` | Fetch all active announcements (call with no args for all) |
| `search_hr_policies(query)` | RAG search for policy details by topic |

**Wiring:** `general_agent` → `should_continue_general` → `general_tools` ToolNode → back to `general_agent` → `END`. System prompt explicitly instructs: always call `get_announcements` for news/updates, always call `search_hr_policies` for policy questions, redirect all other domain questions to the right team.

### Manager Agent (`agents/manager_agent.py` — 9 tools)
| Tool | Description |
|------|-------------|
| `get_my_team(manager_email)` | Direct reports |
| `get_team_attendance_today(manager_email, date)` | Team attendance |
| `get_pending_leave_requests(manager_email)` | Pending leave requests from team |
| `approve_leave_request(leave_id, manager_email)` | Approve leave |
| `reject_leave_request(leave_id, manager_email, reason)` | Reject leave |
| `assign_training(employee_email, course_name, platform, due_date, manager_email)` | Assign training |
| `get_training_status(employee_email)` | Training status |
| `get_employee_skills(employee_email)` | Skill profile |
| `get_employee_project_history(employee_email)` | Project assignments |

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

**User identity injection:** ALL agents inject the logged-in user's email into their system prompt: `"The logged-in employee's email is: {user_email}. NEVER ask who the user is."` The email comes from `state.get("user_email", settings.DEFAULT_USER_EMAIL)`. In production, `DEFAULT_USER_EMAIL` should be replaced with MSAL auth token claim.

---

## REST API Endpoints

### Core (`main.py`)
| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| GET | `/` | — | `{status, message}` |
| POST | `/api/chat` | `{message, history[], session_id}` | `{response, domain, id, processing_time, download_url}` |
| POST | `/api/feedback` | `{rating:"up"/"down", threadId, user_message, ai_response, domain?, feedback_text?}` | `{status}` |
| GET | `/api/feedback/stats` | `?domain=` | `{total, helpful, unhelpful, score_pct}` |
| POST | `/api/track` | `{event, data}` | `{status}` |
| GET | `/api/documents/download/{file_id}` | — | PDF stream |
| GET | `/api/admin/stats` | — | `{it_tickets, facility_complaints, parking, reimbursements, announcements, food_complaints}` |
| GET | `/api/hr/dashboard` | — | HR dashboard for DEFAULT_USER_EMAIL |
| GET | `/api/hr/leaves` | — | All leaves |
| GET | `/api/hr/payroll` | — | All payroll |

### PMO (`/api/pmo`)
| GET `/api/pmo/projects` | Paginated, filter: `status` |
| GET `/api/pmo/projects/{id}` | Single project |
| GET `/api/pmo/sprints` | Paginated, filter: `team` |
| GET `/api/pmo/team-capacity` | Paginated |
| GET `/api/pmo/milestones` | Paginated, filter: `project`, `status` |

### Upload (`main.py`)
| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| POST | `/api/upload` | `multipart/form-data: file` (PDF/txt/csv, max 10 MB) | `{text, filename, char_count}` — extracts text via pdfplumber (PDF) or UTF-8 decode (text/csv) |

### IT (`/api/it`)
| POST `/api/it/hitl/complete?ticket_id=&admin_email=` | IT Admin completes HITL |
| GET `/api/it/hitl/pending` | All pending HITL requests |
| GET `/api/it/tickets?status=&email=` | List IT tickets |

### Announcements (`/api/announcements`)
| GET `/api/announcements?include_inactive=` | All announcements |
| POST `/api/announcements` | Create: `{title, body, category, created_by, created_by_domain, target_audience, expires_days?}` |
| DELETE `/api/announcements/{id}?requested_by=` | Deactivate |

### Employees (`/api/employees`)
| GET `/api/employees/search?q=&function=&location=&designation=&limit=` | Search |
| GET `/api/employees/profile?identifier=` | Profile |
| GET `/api/employees/org-chart?name_or_email=` | Org chart |
| GET `/api/employees/team?manager=` | Team roster |
| GET `/api/employees/skills?skill=` | Find by skill |
| GET `/api/employees/headcount?function=` | Headcount |

### Prompts (`/api/prompts`)
| GET `/api/prompts?domain=` | All active prompt configs |
| GET `/api/prompts/{domain}` | Domain configs |
| PUT `/api/prompts/{domain}/{key}` | Update: `{value, updated_by, user_role}` (role-checked) |

### SharePoint (`/api`)
| POST `/api/sharepoint/webhook` | MS Graph delta webhook |
| GET `/api/sharepoint/files` | Synced files list |

---

## Email Service (`services/email_service.py`)

SMTP (STARTTLS, port 587 default). Silent on failure — never blocks primary operation.

| Function | Trigger | To / CC |
|----------|---------|---------|
| `send_it_ticket_email(...)` | IT ticket created | `HELPDESK_EMAIL` CC employee — ManageEngine parses subject `[IT Support] {Category} - {Subject} | {EmpID}` |
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
│   │                           #   Live ops tiles (6) from /api/admin/stats
│   │                           #   Announcement management (create + deactivate)
│   │                           #   KPI cards, charts, access control, observability links
│   ├── _layout.config.tsx      # /config — live prompt config editor
│   │                           #   Domain sidebar (HR/Admin/IT/PMO/Manager)
│   │                           #   Fetches GET /api/prompts/{domain}, shows system_prompt + guardrail
│   │                           #   PUT /api/prompts/{domain}/{key} to save; dirty indicator, version badge
│   │                           #   Access restricted: Employee + Functional Manager blocked
│   ├── _layout.settings.tsx    # /settings — user preferences
│   └── _layout.team.tsx        # /team — employee directory (placeholder, no content yet)
├── components/assistant/
│   ├── AssistantView.tsx       # Chat orchestrator: threads, message list, feedback, PDF modal, AnnouncementBanner
│   ├── Message.tsx             # UserMessage + AIMessage (domain badge chip) + AnswerCard
│   ├── Composer.tsx            # Text input + send; real file upload to /api/upload; attached file chip
│   ├── AnnouncementBanner.tsx  # Dismissible banner: fetches /api/announcements; expand/collapse per item
│   └── Sidebar.tsx             # Thread list
└── lib/
    ├── chat-store.ts           # Zustand: threads Record<id, {turns: Turn[]}>, activeId, thinking
    └── settings-store.ts       # Zustand: theme, aiTone, userNickname, reasoningDepth, responseFormat, actionExecution
```

**Chat turn structure:** `Turn { role: "user"|"ai", text: string, card?: boolean, downloadUrl?: string, downloadTitle?: string, domain?: string }`

**Domain badge map in `Message.tsx`:**
| domain key | Label | Color |
|-----------|-------|-------|
| `hr` | HR | emerald |
| `admin` | Admin | amber |
| `it_support` | IT Support | blue |
| `pmo` | PMO | violet |
| `functional_manager` | Manager | indigo |
| `general` | General | muted |

**AnnouncementBanner:** localStorage key `centriq_dismissed_announcements` (JSON array of dismissed IDs). Shows up to 3 active announcements. Each item has expand/collapse chevron and X dismiss. Category color map matches `AnnouncementBanner.tsx`.

**File upload flow in Composer:** Plus button → file picker (PDF/txt/csv, 10 MB max) → `POST /api/upload` (multipart) → stores `{filename, text}` as `attached` state → shows file chip → on submit: prepends `[Attached file: …]\n\`\`\`\n{text[:6000]}\n\`\`\`` to message, calls `onQuickAction(full)` to bypass state flush timing.

**Feedback flow:** `AssistantView.handleFeedback(rating, index)` → finds `prevUserTurn.text` and `aiTurn.text` → POST `/api/feedback` with full context.

**PDF download:** AI response containing `[DOWNLOAD_PDF:url:title]` is parsed in `main.py` → becomes `download_url` in response JSON → `AssistantView` renders a download button.

---

## Configuration (`config.py`)

| Env Var | Default | Purpose |
|---------|---------|---------|
| `ROUTER_BASE_URL` | `http://localhost:11434/v1` | LLM API (routing + agents) |
| `ROUTER_MODEL_NAME` | `llama3.2:3b` | Model for routing + agents |
| `ROUTER_API_KEY` | `ollama` | |
| `AGENT_BASE_URL` | same as ROUTER | Separate agent LLM if needed |
| `AGENT_MODEL_NAME` | same as ROUTER | |
| `DATABASE_URL` | `sqlite:///./centriq.db` | PostgreSQL in prod |
| `REDIS_URL` | `redis://localhost:6380` | LangGraph checkpointer |
| `USE_MEMORY_SAVER` | `false` | Force MemorySaver (no Redis) |
| `DEFAULT_USER_EMAIL` | `employee1@centriq.ai` | Injected into all agent system prompts |
| `PORT` | `8080` | Backend port |
| `HOST` | `0.0.0.0` | |
| `SMTP_HOST` | `smtp.gmail.com` | Email server |
| `SMTP_PORT` | `587` | STARTTLS |
| `SMTP_USER` | `""` | Email sender (set in prod) |
| `SMTP_PASS` | `""` | Email password |
| `SMTP_FROM_NAME` | `Centriq AI` | |
| `HELPDESK_EMAIL` | `helpdesk@alignedautomation.com` | IT tickets destination |
| `ADMIN_EMAIL` | `admin@alignedautomation.com` | Admin notifications |
| `MINIO_ENDPOINT` | `localhost:9000` | |
| `MINIO_BUCKET_NAME` | `aurora-bucket` | |
| `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET` | — | Azure AD for SharePoint |

---

## Key Patterns & Conventions

1. **`SessionLocal()` per method, closed in `finally`** — every service method manages its own DB session.
2. **Email never blocks** — all `send_*` calls wrapped in `try/except` with `pass`.
3. **`ilike(f"%{value}%")`** — fuzzy matching throughout for names, projects, teams.
4. **`[DOWNLOAD_PDF:url:title]` tag** — PDF tools embed this exact tag in their return string. PMO agent MUST preserve verbatim. `main.py /api/chat` parses it and sets `download_url` in response.
5. **Sub-agents as compiled sub-graphs** — each domain agent is a `StateGraph.compile()` result called via `.ainvoke()` in a node in `agent.py`.
6. **`PromptService.get_system_prompt(domain, default)`** → fetches active `PromptConfig` row from DB first, falls back to hardcoded default. Admins can override at runtime via `/api/prompts`.
7. **`PromptService.get_guardrail(domain)`** → fetches `guardrail` key from `PromptConfig` or falls back to `UNIVERSAL_GUARDRAIL` constant. Appended to ALL agent system prompts.
8. **`settings.DEFAULT_USER_EMAIL`** → single source of truth for logged-in user. Injected via `user_email` key in sub-agent state. Should be replaced with MSAL token in production.
9. **IT HITL flow:** `request_software_install` creates `ITTicket` (Awaiting Approval) + `SoftwareRequest` + `HITLRequest`. IT admin calls `POST /api/it/hitl/complete?ticket_id=&admin_email=` to advance status to In Progress.
10. **Loki logging:** Logger name `aurora-logger`. Falls back to console if `logging_loki` unavailable.
11. **Langfuse tracing:** All `/api/chat` calls wrapped in `langfuse_trace("chat", session_id=...)`. Custom events via `POST /api/track`.

---

## Seeded Data (in `database.py`)

`init_db()` is called on startup. Seeds only if count == 0.

| Seed Function | What It Creates |
|---------------|-----------------|
| `_seed_hr_data(db)` | Employees, Leaves, Payroll, Attendance, Policies |
| `_seed_pmo_data(db)` | Projects, Sprints, TeamCapacity, Milestones |
| `_seed_admin_data(db)` | Reimbursements, ParkingStickers, Accommodations, FacilityComplaints, FoodVendorFeedback |
| `_seed_it_data(db)` | ITTickets, SoftwareRequests, AssetAssignments |
| `_seed_manager_data(db)` | TrainingAssignments, EmployeeSkillMap, ProjectAssignments |
| `_seed_prompt_configs(db)` | PromptConfig rows for hr, admin, it_support, pmo, functional_manager |
| `_seed_zoho_profiles(db)` | EmployeeZohoProfile rows for all employees |
| `_seed_announcements(db)` | Sample Announcements |
| `_seed_transcripts(db)` | 6 SessionTranscript rows across different projects |

Also runs ALTER TABLE migrations for columns added after initial deploy: `projects.achievements`, `parking_stickers.vehicle_make`, `parking_stickers.vehicle_model`.

---

## Domain Router (`router.py`)

`classify_intent(user_message)` → `{domain, confidence, reasoning}`

| Domain | What routes here |
|--------|-----------------|
| `hr` | Leave, payroll, salary slips, attendance, HR policies, benefits, appraisals, WFH |
| `admin` | Reimbursement, parking sticker, accommodation, facility complaints, food, cafeteria |
| `it_support` | Software install (HITL), IT tickets, assets, password reset, VPN, network |
| `pmo` | Company/AI/internal projects, project timelines, sprints, milestones, resource allocation, session transcripts |
| `functional_manager` | Team management, leave approvals, training, skill assessments, attendance |
| `general` | Greetings, small talk, questions about Centriq AI itself — NOT company data |

---

## What Has Been Built (Completed Phases)

**Phase 1 — HR Enhancement:**
- `EmployeeZohoProfile` model (safe fields only)
- `EmployeeService` with 6 directory tools
- Announcements model + service + routes + HR tools
- `PromptService.update_prompt()` + `update_hr_prompt` tool

**Phase 2 — IT Enhancement:**
- `email_service.py` — full SMTP dispatcher
- IT ticket → ManageEngine email on create
- Software install HITL flow (HITLRequest model)
- `send_parking_request_email`, `send_facility_complaint_email`, etc.

**Phase 3 — PMO Enhancement:**
- `SessionTranscript` model + `TranscriptService`
- `ProjectAssignment` resource allocation tools (`get_resource_allocation`, `get_employee_projects`)
- 5 new PMO tools (3 transcript + 2 allocation)
- 6 seed transcript records

**Phase 4 — Admin Dashboard Frontend:**
- `/api/admin/stats` REST endpoint
- `_layout.admin.tsx` — live ops metrics tiles (6), announcement management UI (create + deactivate)

**Phase 4.5 — Grounding / Anti-Hallucination:**
- `UNIVERSAL_GUARDRAIL` constant in `prompt_service.py`
- `get_guardrail()` method (DB-first, then fallback)
- Guardrail appended to ALL 5 agents + general_agent
- `general_agent` given constrained system prompt (was completely ungrounded)
- HR agent system prompt strengthened
- All agents now inject `user_email` into prompts (no more identity questions)
- `ChatFeedback` model + `FeedbackService`
- `/api/feedback` stores to DB (was discarding all data)
- `AssistantView.handleFeedback` sends actual message content with rating

**Phase 5 — General Agent Enhancement:**
- `general_agent` in `agent.py` now has two real tools: `get_announcements`, `search_hr_policies`
- `general_tools` ToolNode + `should_continue_general` conditional edge — full LangGraph tool loop
- System prompt instructs: use `get_announcements` for news/updates, `search_hr_policies` for policy questions, redirect domain questions to proper team

**Phase 6 — Frontend:**
- `Message.tsx` — `AIMessage` now accepts `domain?: string` prop; renders colored badge chip (DOMAIN_BADGE map, 6 domains)
- `AnnouncementBanner.tsx` — new component; fetches `GET /api/announcements`, shows up to 3 active; per-item expand/collapse + X dismiss; dismissed IDs persisted to `localStorage["centriq_dismissed_announcements"]`
- `AssistantView.tsx` — imports `Turn` from `chat-store`, stores `data.domain` in turn, passes `domain` to `AIMessage`, renders `<AnnouncementBanner />` at top of main
- `_layout.config.tsx` — full rewrite; domain sidebar tabs (HR/Admin/IT/PMO/Manager); live `GET /api/prompts/{domain}` on tab switch; editable system_prompt + guardrail per domain; `PUT /api/prompts/{domain}/{key}` to save; dirty indicator + version badge; access restricted for Employee + Functional Manager roles
- `Composer.tsx` — real file upload: hidden `<input type="file">`, validates type/size, uploads via FormData to `POST /api/upload`, attached file chip with dismiss, submit prepends fenced block (6000 char cap) via `onQuickAction`
- `chat-store.ts` — added `domain?: string` to `Turn` interface; `POST /api/upload` endpoint in `main.py` using `pdfplumber` for PDF extraction

---

## What Does NOT Exist Yet (Future Work)

- **Employee Directory `/team` route:** `_layout.team.tsx` exists but has no content — no UI for employee search/org chart
- **Real user identity from MSAL:** `DEFAULT_USER_EMAIL` is a config value — should come from MSAL auth token claim
- **Feedback-driven response selection:** `ChatFeedback` table + `FeedbackService.get_top_responses()` exist but are not yet injected into agent context as few-shot examples
- **Pre-existing TS error in `_layout.settings.tsx`:** Lines 153-154 `Property 'department' does not exist on type 'User'` — not introduced by recent work, still unresolved

---

## Known Bugs Fixed

| Bug | File | Fix |
|-----|------|-----|
| `json` not imported in `request_software_install` | `agents/it_agent.py` | Added `import json` |
| Admin/IT agents asked user for email/name | `admin_agent.py`, `it_agent.py` | Inject `user_email` from state into prompt text |
| "AI projects" routed to general, giving ChatGPT examples | `router.py` | Added AI/tech project keywords to PMO domain description |
| PMO hallucinated generic AI project examples | `pmo_agent.py` | Strengthened system prompt: always call `list_projects` first |
| `general_agent` had zero system prompt, answered freely | `agent.py` | Constrained to greetings only, redirects domain questions |
| `/api/feedback` silently discarded data | `main.py` | Now stores to `chat_feedback` via `FeedbackService.record()` |
| Local `Turn` type in `AssistantView.tsx` was a discriminated union missing `domain` | `AssistantView.tsx` | Removed local type, imported `Turn` from `chat-store.ts`; added `domain?: string` to canonical interface |
| `threads[activeId]` TS error when `activeId: string \| null` | `AssistantView.tsx` | Changed to `(activeId ? threads[activeId]?.turns : undefined) \|\| []` |
| File attach → submit race: `onChange("")` + `onSubmit()` had state flush timing issue | `Composer.tsx` | Uses `onQuickAction(full)` to pass augmented message string directly, bypassing state |
