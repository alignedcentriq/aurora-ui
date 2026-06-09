# Centriq AI — 10-Minute Demo Script

**Audience:** Business stakeholders / decision-makers  
**Total time:** ~10 minutes  
**Presenter setup:** Log in as an employee user, have the chat window open on the main screen

---

## 0:00 — Opening Hook (45 sec)

> "Every employee request — leave, parking, reimbursements, IT tickets, policy questions — touches at least three systems and three people before it gets resolved. Centriq AI collapses that into a single conversation. Let me show you."

- Have the **AI Chat Assistant** open and ready
- Briefly gesture at the left sidebar: chat, My Requests, portals, control hub

---

## 0:45 — Live Demo: AI Chat Assistant (4 min)

### Scenario 1 — Employee Lookup (30 sec)

Type in chat:
> *"Who is Ananya Sharma?"*

**What to say:**
> "The assistant pulls live employee profile data — role, department, manager, contact — no HR ticket needed."

- Show the card response (name, team, photo if available)
- Point out the **response is instant** (semantic cache hit on common lookups)

---

### Scenario 2 — Leave Request (90 sec)

Type in chat:
> *"I want to apply for 3 days of sick leave starting next Monday."*

**What to say:**
> "Watch the intent router classify this as an HR request and hand it to the HR Agent. The agent calls our Zoho leave management integration, checks available balance, and submits the request — all in one turn."

- Show the **streaming response** with leave balance, dates confirmed
- Show the **approval email** that gets triggered to the manager (or describe it)
- Point out the manager gets a one-click approve/reject link — no portal login required

---

### Scenario 3 — Policy Question via RAG (60 sec)

Type in chat:
> *"What's the reimbursement limit for business travel meals?"*

**What to say:**
> "This one hits our policy RAG pipeline — the agent searches the SharePoint policy library, extracts the relevant clause, and cites the source document. Employees get accurate answers instead of guessing or emailing HR."

- Show the cited policy snippet in the response
- Mention: **answer is cached** — if 50 people ask the same question today, the first call hits the LLM; the rest return instantly

---

### Scenario 4 — Admin Request (60 sec)

Type in chat:
> *"I need a parking sticker for my car — registration number MH12AB1234."*

**What to say:**
> "Now we switch domains — the Admin Agent handles this, logs the request, and notifies the facilities team. The employee gets a ticket number and expected SLA right here in chat."

- Show the confirmation message with request ID

---

## 4:45 — Role-Based Portals (2 min 30 sec)

> "The chat handles the employee side. Behind it, operations teams have dedicated portals."

### HR Portal (45 sec)

- Switch to **HR Portal** in the sidebar
- Show the **Escalations** tab: open tickets with status, SLA timers, assign/resolve buttons
- Show **Welcome Packages**: new hire onboarding items tracked per employee
- Show **Grievance Tracker**: submitted, in-review, closed

> "HR can see everything in one view — no context-switching between Zoho, email, and spreadsheets."

---

### Admin Portal (45 sec)

- Switch to **Admin Portal**
- Show the **Parking Requests** queue (the one we just submitted is visible)
- Show **Reimbursements**: submitted claims, approve/reject with one click
- Mention **Desk Key** and **Travel** tabs exist too

> "Each request the chat assistant creates shows up here for the ops team to action."

---

### Email Automation Hub (60 sec)

- Navigate to **Control Hub → Email Automation Hub**
- Click "Create Rule" and show the form:
  - Trigger: Weekly, every Monday 9 AM
  - Recipients: HR team group
  - Template: Attendance summary
- Save the rule

> "Managers and teams can schedule recurring reports — leave summaries, project updates, IT ticket digests — without writing a single script. The system sends them on schedule via Outlook."

---

## 7:15 — AI Observability & Controls (2 min)

> "For the tech and ops teams, we have full visibility into what the AI is doing."

### AI Observability Dashboard (60 sec)

- Navigate to **Control Hub → AI Observability**
- Show the trace list: each chat message, which agent handled it, latency, token count
- Click one trace to expand: intent classification → agent routing → tool calls → response
- Show **cache hit rate** and **user feedback** thumbs up/down

> "Every LLM call is traced end-to-end via Langfuse. When something goes wrong, we know exactly where and why — not just 'the AI said something weird.'"

---

### LLM Controls (60 sec)

- Navigate to **Control Hub → LLM Model Controls**
- Show model selector (switch between models), temperature slider
- Show **Enable/Disable Chat** toggle per domain or globally

> "Ops teams can swap models, tune parameters, or disable specific agent domains without a deployment. This is how we manage cost versus capability tradeoffs in production."

---

## 9:15 — My Requests: The Employee's Audit Trail (30 sec)

- Navigate to **My Requests** in the sidebar
- Show the leave request + parking request we submitted during the demo

> "Every request the employee makes — across HR, admin, IT, PMO — lives in one place with status, timestamps, and comments. No more 'did my request go through?' emails."

---

## 9:45 — Close (15 sec)

> "One assistant. Every domain. Real integrations with Zoho, MS365, SharePoint, and ManageEngine — not mock data. That's Centriq AI."

---

## Fallback Talking Points (if live demo breaks)

| Scenario | Fallback |
|---|---|
| LLM slow/unavailable | "In production this runs on [model]. Let me show the cached response." Pull up a screenshot |
| Zoho API error on leave | "The integration is live — here's the confirmation email from a previous run" |
| Portal data empty | "This is a demo environment — in prod, this populates from the connected HR system" |

---

## Key Numbers to Mention (if asked)

- Intent classification: **<300ms** (llama3.2:3b local)
- Semantic cache hit: **<50ms**
- Agents in production: **7 domain agents** (HR, Admin, IT, PMO, FM, MS365, General)
- External integrations: **Zoho, Microsoft 365, SharePoint, ManageEngine, Azure AD**
- Request types supported: **20+** (leave, parking, reimbursements, desk keys, travel, books, software, hardware, …)
