# Comprehensive Auto-Learning Architecture

This diagram combines the entire baseline system architecture (Frontend, Teams, Telegram, Integrations, Cron Jobs) with the advanced **Self-Learning Loop**. 

The auto-learning components are highlighted in red, specifically the **Corrections Memory DB** and the **Self-Reflection Node**. This allows you to evaluate the full scope of the system if you choose to implement auto-learning.

```mermaid
graph TD
    %% Define Styles
    classDef frontend fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff
    classDef backend fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff
    classDef agent fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff
    classDef db fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#fff
    classDef external fill:#64748b,stroke:#334155,stroke-width:2px,color:#fff
    classDef highlight fill:#ef4444,stroke:#b91c1c,stroke-width:2px,color:#fff

    %% Interfaces
    subgraph User_Interfaces ["User & Vendor Interfaces"]
        UI["ReactJS Frontend<br>(Employees)"]:::frontend
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
        SelfCritique["Self-Reflection Node<br>(Auto-Correction)"]:::highlight
        Tools["Agent Tools<br>(Search, Forms, Drafts)"]:::agent
        LLM["OSS LLM API<br>(Secure Hosting)"]:::external
        
        Graph <--> Tools
        Graph <--> LLM
        Graph -. "User says 'Wrong'" .-> SelfCritique
        SelfCritique -. "Re-evaluates & Fixes" .-> Graph
    end

    %% Data Storage
    subgraph Storage ["PostgreSQL (Docker)"]
        VectorDB[("Official Policies<br>pgvector")]:::db
        CorrectionsDB[("Corrections Memory<br>pgvector")]:::highlight
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

    API -- "Invoke Agent" --> Graph
    API -- "Save Feedback" --> StateDB
    API -- "Embed & Save Correction" --> CorrectionsDB

    Graph -- "Fetch Prompts" --> ConfigDB
    
    Tools -- "Search Official Docs" --> VectorDB
    Tools -- "Search Past Corrections" --> CorrectionsDB

    Tools -- "Fetch/Draft" --> GraphAPI
    Tools -- "Query Data" --> Zoho

    Scheduler -- "Sync Docs" --> SharePoint
    Scheduler -- "Generate Embeddings" --> VectorDB
    Scheduler -- "Trigger Reminders" --> GraphAPI
    Scheduler -- "Daily Rating Summary" --> Telegram
```

## How the Unified System Works

### 1. Standard Interactions
- Employees use React or Teams to ask questions.
- The `FastAPI` server routes this to `LangGraph`.
- `LangGraph` fetches instructions from the `ConfigDB` and uses `Tools` to query `SharePoint` policies in `VectorDB` or check `Zoho` data.
- The `OSS LLM` synthesizes the final answer.

### 2. Auto-Learning Path (Highlighted in Red)
- **Ingestion**: If an employee clicks Thumbs Down and leaves a correction, `FastAPI` embeds that correction directly into the `CorrectionsDB`.
- **Dual-Retrieval**: On future queries, `LangGraph Tools` will automatically perform a semantic search on **both** the `Official Policies DB` and the `CorrectionsDB`.
- **Self-Reflection**: If an employee corrects the bot mid-conversation, `LangGraph` triggers the `Self-Reflection Node`, enabling it to immediately search for the right answer and correct itself live.

### 3. Background Automation
- `APScheduler` works tirelessly in the background: fetching new SharePoint documents, emailing unpaid parking sticker reminders via MS Graph, and pushing the daily food ratings to the vendor via Telegram.
