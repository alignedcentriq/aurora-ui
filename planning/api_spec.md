# Nexus AI Assistant - API Specification

This document lists all the Application Programming Interfaces (APIs) required for the system. It is divided into the APIs we will build in FastAPI, and the external APIs our backend will consume.

---

## 1. Frontend-Facing APIs (Exposed by FastAPI)
These endpoints are consumed by the React/Angular frontend.

### Chat & AI
- **`POST /api/chat`**
  - **Purpose**: Main entry point for user queries. Passes input to the LangGraph agent.
  - **Payload**: `{"message": "I need a parking sticker", "conversation_id": "123", "attachments": []}`
  - **Response**: `{"response": "...", "form_trigger": "parking-sticker", "documents": []}`

- **`POST /api/feedback`**
  - **Purpose**: "User Feedback Loop". Logs thumbs up/down and comments for AI responses to PostgreSQL.
  - **Payload**: `{"message_id": "msg_abc123", "rating": "up", "comment": "Very helpful!"}`

- **`GET /api/conversations`**
  - **Purpose**: Fetch the authenticated user's historical chat sessions.

### Forms & Actions
- **`POST /api/forms`**
  - **Purpose**: Process structured form submissions from the chat UI (e.g., Leave requests, NOC generation).
  - **Payload**: `{"form_type": "parking-sticker", "data": {"vehicle_number": "AB12CD"}}`

- **`GET /api/employee/profile`**
  - **Purpose**: Retrieve basic user context to pre-fill chat forms.

---

## 2. Webhooks & Integrations (Exposed by FastAPI)
These endpoints listen for incoming data from external platforms.

- **`POST /api/webhooks/whatsapp`**
  - **Purpose**: Receives messages from the food vendor. Extracts text/images to update the daily menu vector/database.
  - **Payload**: Standard WhatsApp/Twilio webhook JSON containing the vendor's message.

- **`POST /api/messages`**
  - **Purpose**: Microsoft Teams Bot endpoint. Receives events and messages when users chat with the bot in MS Teams.
  - **Payload**: Microsoft Bot Framework Activity payload.

---

## 3. Admin & Configuration APIs (Exposed by FastAPI)
These endpoints manage the dynamic aspects of the system without requiring code deployments.

- **`GET /api/admin/prompts`**
  - **Purpose**: Retrieve current system prompts and tool descriptions.

- **`PUT /api/admin/prompts/{prompt_id}`**
  - **Purpose**: "Prompt-Level Training". Updates instructions in PostgreSQL, instantly changing the AI's behavior.
  - **Payload**: `{"system_prompt": "You are an HR assistant. Always be polite..."}`

- **`POST /api/admin/sync/sharepoint`**
  - **Purpose**: Manually trigger the background job that fetches new files from SharePoint and updates the Vector Database (useful for testing outside of the Cron schedule).

---

## 4. External APIs Consumed by the Backend
Our FastAPI server acts as a client calling these external services.

### Microsoft Graph API (`graph.microsoft.com`)
- **SharePoint Documents**: `GET /sites/{site-id}/drive/root/children` (For downloading org policies into the RAG vector store).
- **Outlook Drafts**: `POST /me/messages` (To draft emails in the user's outbox).
- **Directory Services**: `GET /me/manager` (To auto-route escalations or forms to the user's reporting manager).

### Third-Party & Enterprise Apps
- **Zoho People API** (`zohoapis.com/people/api/`)
  - **Employee Profiles & Skills**: Fetch live employee records to answer queries like "What are John's primary skills?".
- **Custom OSS LLM API**
  - **Chat Completions**: `POST https://your-secure-server.com/v1/chat/completions` (OpenAI-compatible format for generating responses).
  - **Embeddings**: `POST https://your-secure-server.com/v1/embeddings` (To generate vector embeddings for the PostgreSQL RAG database).
