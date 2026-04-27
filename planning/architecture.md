# High-Level Architecture Diagram

This diagram outlines the complete architecture of the Nexus AI Assistant, detailing the frontend interfaces, the FastAPI backend, the LangGraph orchestration, database storage, and external enterprise integrations.

```mermaid
graph TD
    %% Define Styles
    classDef frontend fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff
    classDef backend fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff
    classDef agent fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff
    classDef db fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#fff
    classDef external fill:#64748b,stroke:#334155,stroke-width:2px,color:#fff

    %% Interfaces
    subgraph User_Interfaces ["User & Vendor Interfaces"]
        UI["ReactJS / Angular Frontend<br>(Employees)"]:::frontend
        Teams["Microsoft Teams Bot<br>(Employees)"]:::frontend
        Telegram["Telegram Bot<br>(Food Vendor)"]:::frontend
    end

    %% Backend Server
    subgraph Backend ["FastAPI Backend Server (Docker)"]
        API["REST API & Webhooks"]:::backend
        Scheduler["APScheduler<br>(Cron Jobs)"]:::backend
        
        API <--> Scheduler
    end

    %% Core AI Engine
    subgraph AI_Engine ["AI Core & Orchestration"]
        Graph["LangGraph State Machine<br>(Agent Router)"]:::agent
        Tools["Agent Tools<br>(Search, Forms, Drafts)"]:::agent
        LLM["OSS LLM API<br>(Secure Hosting)"]:::external
        
        Graph <--> Tools
        Graph <--> LLM
    end

    %% Data Storage
    subgraph Storage ["PostgreSQL (Docker)"]
        VectorDB[("pgvector<br>(RAG Embeddings)")]:::db
        ConfigDB[("Dynamic Prompts<br>& Configurations")]:::db
        StateDB[("Conversations,<br>Feedback & Reminders")]:::db
    end

    %% External Systems
    subgraph Enterprise_Systems ["External Enterprise APIs"]
        GraphAPI["Microsoft Graph API<br>(Outlook, Directory)"]:::external
        SharePoint["SharePoint<br>(HR/Admin Policies)"]:::external
        Zoho["Zoho APIs / Internal DBs<br>(Employee Skills)"]:::external
    end

    %% Connections
    UI -- "HTTP/REST" --> API
    Teams -- "Bot Framework" --> API
    Telegram -- "Webhook" --> API

    API -- "Invoke" --> Graph
    Graph -- "Fetch Prompts" --> ConfigDB
    Graph -- "Save State/Feedback" --> StateDB
    Tools -- "Semantic Search" --> VectorDB

    Tools -- "Fetch/Draft" --> GraphAPI
    Tools -- "Query Data" --> Zoho

    Scheduler -- "Sync Docs" --> SharePoint
    Scheduler -- "Generate Embeddings" --> VectorDB
    Scheduler -- "Trigger Reminders" --> GraphAPI
    Scheduler -- "Daily Rating Summary" --> Telegram
```

## Key Workflows

1. **User Chat & RAG**: User sends a message via React UI or Teams. The FastAPI server passes it to LangGraph. LangGraph pulls the system prompt from PostgreSQL, checks if the query requires external knowledge, queries the `pgvector` database for policies, and synthesizes an answer using the OSS LLM.
2. **Food Vendor Update**: Vendor sends a message on Telegram. Telegram hits our FastAPI Webhook. The backend updates the internal state for the day's menu.
3. **Automated Document Sync**: The Cron Job (APScheduler) wakes up daily, connects to SharePoint via MS Graph, downloads new HR/Admin policies, chunks them, creates embeddings using the LLM API, and saves them to PostgreSQL (`pgvector`).
4. **Email Drafting / Reminders**: The Agent uses MS Graph tools to locate a reporting manager and save an email draft. Alternatively, the Cron Job finds unpaid parking fees in PostgreSQL and automatically emails reminders at the end of the month.
