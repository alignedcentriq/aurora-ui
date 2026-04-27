# Goal Description

Develop a Python backend for the Nexus AI Assistant using FastAPI and LangGraph. The backend will feature an open-source model integration, a RAG system that automatically syncs with SharePoint via cron jobs, a **Telegram webhook** to receive daily food menus securely, interactive chat forms, Microsoft 365 integrations (for drafting emails and manager lookup), the capability to be deployed as a Microsoft Teams bot, and seamless integrations with internal enterprise databases and 3rd party services like Zoho for live employee data retrieval.

## User Review Required

> [!IMPORTANT]
> **Database Initialization**
> We will use **PostgreSQL** as the mandatory database. To support RAG capabilities (embeddings), we will utilize the `pgvector` extension. Please ensure your PostgreSQL hosting environment supports `pgvector`.

> [!WARNING]
> **Secret Management**
> We will use a `.env` file to securely store your hosted model API URI, MS Graph credentials, Telegram Bot Token, Database URIs, and Zoho API credentials. This file will be added to `.gitignore` to ensure secrets are never pushed to the repository.

> [!NOTE]
> **Telegram Bot API**
> To receive messages from the food vendor via Telegram (a 100% free solution), you will need to create a bot via BotFather on Telegram. We will set up a webhook in our FastAPI app to listen for these incoming messages.

> [!NOTE]
> **Prompt-Level Training Strategy**
> To meet the requirement of "New capabilities via config, zero code changes", we will store system prompts and tool descriptions in the PostgreSQL database. When the LangGraph agent is invoked, it will fetch the latest configuration to dynamically adjust its capabilities.

## Open Questions

1. **Azure DevOps CI/CD**: Since the repository is on Azure DevOps Git, do you need us to create Azure Pipelines (`azure-pipelines.yml`) for the Dockerized build and deployment process as part of this implementation?
2. **LLM Integration**: For the OSS Open-Source Model, are we connecting via a standardized API (e.g., OpenAI compatible format) hosted on your secure servers?
3. **Escalation Routing**: For the "Smart Escalation" feature, how should the real-time alerts be delivered to HR/Admin/IT? (e.g., Email, MS Teams channel notification, or a ticketing system like Jira/ServiceNow)?

## Proposed Changes

### 1. Mandatory Tech Stack Setup
- **Dockerization**: Create `Dockerfile` for the FastAPI backend and a `docker-compose.yml` to spin up the backend, frontend (ReactJS), and a PostgreSQL instance with `pgvector` for local development.
- **PostgreSQL**: Initialize schemas for:
  - **Vector Store**: For RAG documents (Policies, Knowledge Base).
  - **Dynamic Configs**: Storing prompt-level training data.
  - **Feedback**: Storing thumbs up/down and comments.
  - **Conversations**: Chat history for context.
  - **Scheduled Tasks**: Storing pending reminder emails (e.g., unpaid parking fees).

### 2. LangGraph AI Agent & LangChain
- **Graph State**: Build a LangGraph state machine that routes between standard QA, RAG retrieval, document generation (NOC letters), and escalation.
- **Dynamic Prompts**: Fetch system prompts from PostgreSQL at runtime so behavior can be tuned without deploying code.
- **Smart Escalation Node**: If the LLM confidence is low or the user explicitly asks for human help, route to an Escalation Tool that alerts the respective department.

### 3. FastAPI Backend Endpoints
- `POST /api/chat`: Main LangGraph invocation endpoint.
- `GET /api/directory/search`: Endpoint for handling `@` mentions. Queries MS Graph to search for employees by name and returns their email/ID to the frontend.
- `POST /api/feedback`: 
  - **Workflow**: The frontend displays Thumbs Up/Down icons under AI messages. When clicked (with an optional comment), it hits this endpoint. The backend saves the `rating` (1 or -1), `comment`, `message_id`, and `user_id` in PostgreSQL. Admins can review downvoted answers later to perform Prompt-Level Training and improve the agent.
- `POST /api/forms`: Handle submissions for HR, Admin, and IT service requests (e.g., Leave apps, NOCs, Food Feedback).
- `POST /api/webhooks/telegram`: Webhook for food vendors to submit daily menus securely via Telegram.
- `GET /api/config`: Endpoints for admins to update prompt-level training configurations.

### 4. Enterprise & External Integrations
- **SharePoint Cron Job**: `APScheduler` job to continuously sync HR/Admin policies from SharePoint, chunk them, and upsert them into the PostgreSQL vector store.
- **Automated Reminder Cron**: A monthly `APScheduler` job that scans PostgreSQL for users with pending actions (e.g., unpaid 2-wheeler/4-wheeler parking stickers) and sends them reminder emails via MS Graph.
- **Vendor Daily Summary Cron**: An end-of-day `APScheduler` job (e.g., 5:00 PM) that aggregates all "food-vendor" form feedback from PostgreSQL for the current day. It calculates the average rating and lists the top comments, then uses the Telegram API to send an automated summary message directly back to the vendor.
- **Microsoft 365**: Graph API integrations for drafting emails directly to Outlook, looking up reporting manager hierarchies, and searching the directory for `@` mentions.
- **Internal APIs/DBs**: Tools within LangGraph to securely query other organizational databases for employee info and skills (e.g., Zoho APIs).

### 5. Document Generation & Private Utilities
- **Document Generation**: Implement automated workflows within LangGraph to generate standard templates (like NOC letters, Employment Verification) and return downloadable links to the user.
- **Private Calculators**: Tools injected into the LangGraph state that allow users to calculate private metrics (e.g., custom parking fees based on 2-wheeler/4-wheeler rules, or tax estimates) securely within their own chat session without saving to a public DB.

## Verification Plan

### Automated/Local Tests
- Bring up the entire stack using `docker-compose up`.
- Run database migrations and verify `pgvector` extension is active.
- Execute unit tests on the LangGraph router to ensure questions correctly route to RAG, Form Submission, or Escalation nodes.
- Test the Webhook logic by mocking a Telegram payload to ensure the food menu state updates correctly.

### Manual Verification
- Test the **User Feedback Loop** by voting on a response in the React UI and verifying it saves to PostgreSQL.
- Modify a prompt in the database and verify the agent's behavior changes instantly without a server restart (Prompt-Level Training).
- Simulate an unresolved query to trigger the **Smart Escalation** mechanism and check the alerts.
- Start the FastAPI dev server locally and use Ngrok to expose the server, then register the webhook URL with Telegram to test real messages from the vendor.

---

## Why Responses Are Saved to State DB

Every time a user asks a question and receives an AI response, both the question and the answer are saved to the **State DB** (PostgreSQL). This is not just logging — it serves multiple critical purposes:

### 1. Conversation Memory (Multi-Turn Context)

Without State DB (no memory):
> **User:** Who is the HR head?
> **Bot:** Priya Sharma is the HR Head.
> **User:** What's her email?
> **Bot:** ❌ *"Whose email? I don't know who you're referring to."*

With State DB (conversation context):
> **User:** Who is the HR head?
> **Bot:** Priya Sharma is the HR Head. *(saves to State DB)*
> **User:** What's her email?
> **Bot:** ✅ *"Priya Sharma's email is priya@company.com"* *(reads previous context from State DB)*

### 2. What Gets Stored

| Field | Purpose |
|---|---|
| `conversation_id` | Groups messages into a chat session |
| `user_message` | What the employee asked |
| `bot_response` | What the AI replied |
| `timestamp` | For ordering and session expiry |
| `feedback` | Thumbs up/down (when the user rates it later) |

### 3. Additional Capabilities Enabled

- **Chat History Page** — Employees can view past conversations in the React frontend (`GET /api/conversations`).
- **Analytics & Insights** — Admins can see what employees ask most frequently and identify knowledge gaps in the RAG database.
- **Self-Learning Feedback Loop** — Links the 👍/👎 rating back to the exact question-answer pair, enabling the Corrections Memory DB and Self-Reflection Node to learn from mistakes.
