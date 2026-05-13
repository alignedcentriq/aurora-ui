import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # ── Router Model (intent classification & domain routing) ──
    ROUTER_BASE_URL = os.getenv("ROUTER_BASE_URL", "http://localhost:11434/v1")
    ROUTER_MODEL_NAME = os.getenv("ROUTER_MODEL_NAME", "llama3.2:3b")
    ROUTER_API_KEY = os.getenv("ROUTER_API_KEY", "ollama")

    # ── Agent Model (reasoning, tool calling, response generation) ──
    AGENT_BASE_URL = os.getenv("AGENT_BASE_URL", os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"))
    AGENT_MODEL_NAME = os.getenv("AGENT_MODEL_NAME", os.getenv("LLM_MODEL_NAME", "llama3.2:3b"))
    AGENT_API_KEY = os.getenv("AGENT_API_KEY", os.getenv("LLM_API_KEY", "ollama"))
    AGENT_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # ── Agent Model (reasoning, tool calling, response generation) ──

    # ── Legacy aliases (backward compat) ──
    LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
    LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "llama3.2:3b")
    LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")
    LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # Database
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./centriq.db")
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

    # Redis
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6380")
    USE_MEMORY_SAVER = os.getenv("USE_MEMORY_SAVER", "false").lower() == "true"

    # Microsoft Graph
    GRAPH_TENANT_ID = os.getenv("GRAPH_TENANT_ID")
    GRAPH_CLIENT_ID = os.getenv("GRAPH_CLIENT_ID")
    GRAPH_CLIENT_SECRET = os.getenv("GRAPH_CLIENT_SECRET")
    GRAPH_CLIENT_STATE = os.getenv("GRAPH_CLIENT_STATE", "secretClientState")

    # App
    DEFAULT_USER_EMAIL = os.getenv("DEFAULT_USER_EMAIL", "employee1@centriq.ai")
    PORT = int(os.getenv("PORT", "8080"))
    HOST = os.getenv("HOST", "0.0.0.0")

settings = Config()
