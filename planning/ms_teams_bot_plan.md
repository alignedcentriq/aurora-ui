# Implementation Plan: MS Teams Bot Integration for Nexus AI Assistant

Based on your existing architecture (FastAPI, LangGraph, PostgreSQL vector store, and Microsoft Graph API integrations), integrating Microsoft Teams will leverage the same conversational core while adapting to the Teams ecosystem. Furthermore, we will wire this up to the **self-learning architecture** (dynamic prompt-level training) using Teams' interactive capabilities.

## 1. Azure Setup & Registration

Since your app already integrates with the Microsoft Graph API, you likely have an Azure AD Application. To add a bot:

*   **Create an Azure Bot Resource:** Go to the Azure Portal and create an "Azure Bot" resource.
*   **App Registration:** Link this Bot resource to your existing Azure AD app (or create a new single-tenant/multi-tenant app specifically for the bot).
*   **Add the MS Teams Channel:** In the Azure Bot settings under "Channels", add Microsoft Teams.
*   **Configure Webhook:** Set the messaging endpoint to your FastAPI backend's public URL (e.g., `https://api.yourdomain.com/api/messages`). During local development, use `ngrok` to expose your local FastAPI port securely.

## 2. FastAPI Backend Integration

The bot needs an endpoint to receive messages and events from Teams.

*   **Dependencies:** Install Microsoft's Bot Builder Python SDK:
    ```bash
    pip install botbuilder-core botbuilder-integration-aiohttp botbuilder-schema
    ```
*   **FastAPI Endpoint:** Create a `POST /api/messages` endpoint in your FastAPI router. 
*   **Adapter:** Use the `CloudAdapter` to authenticate incoming requests from Microsoft Bot Framework. Since BotBuilder uses `aiohttp` by default, you will need to map the FastAPI `Request` and `Response` objects to Bot Framework formats.
*   **Activity Handler:** Create a custom `ActivityHandler` (e.g., `TeamsBotHandler`) to process incoming message activities (`on_message_activity`).

## 3. Integrating with LangGraph and RAG Pipeline

When a user sends a message on Teams, map it to your LangGraph logic:

*   **Context Extraction:** Extract the user's identity (AAD Object ID or email) from the incoming activity (`turn_context.activity.from_property.aad_object_id`). This is crucial for HR/IT/Admin personalized queries and authorization.
*   **Graph Execution:** Pass the message and user identity into your LangGraph pipeline. Let LangGraph perform the PostgreSQL vector store search and synthesize the response.
*   **Formatting Responses:** Convert the Markdown output from LangGraph into Teams-compatible formats (Teams supports basic Markdown, but Adaptive Cards are better for structured data).

## 4. Hooking into the "Self-Learning" Architecture

The key to your "self-learning" or prompt-level training architecture is capturing user feedback to refine the knowledge base or prompt configurations. 

*   **Adaptive Cards for Feedback:** Instead of sending plain text, the bot should return an **Adaptive Card** containing the AI's answer, along with `👍 Helpful` and `👎 Not Helpful` action buttons.
*   **Handling `invoke` Activities:** When a user clicks a feedback button, MS Teams sends an `invoke` activity to your bot.
*   **Processing Feedback:** 
    *   In your `ActivityHandler`, override `on_invoke_activity`.
    *   Capture the context, the user's feedback, and the original prompt.
    *   Feed this data back into your backend (e.g., store in PostgreSQL).
    *   Your dynamic configuration logic can periodically analyze negative feedback to update system prompts, add new RAG entries, or trigger a notification for a human-in-the-loop review.

## 5. Security & Deployment

*   **Secrets Management:** Add `MicrosoftAppId`, `MicrosoftAppPassword`, and `MicrosoftAppTenantId` to your `.env` and Docker environment configurations.
*   **Dockerization:** The FastAPI app structure remains the same. Rebuild your Docker container with the new bot builder dependencies.
*   **Proactive Messaging (Optional):** Since you have automated internal reminders and policy syncing (via cron jobs), you can use the Bot Framework's proactive messaging capabilities to send direct notifications to users or channels in MS Teams when a new policy is synced from SharePoint.

## Next Steps
Would you like me to start implementing the FastAPI `/api/messages` endpoint and the basic Bot Builder structure, or should we begin with generating the Azure Bot setup scripts?
