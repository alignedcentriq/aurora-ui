import os
import platform
import subprocess
from dotenv import load_dotenv

load_dotenv()

ALIGNED_LLM_BASE_URL = "http://ml01.alignedautomation.com:11434/v1"
LOCAL_LLM_BASE_URL = "http://localhost:11434/v1"
AUTO_BASE_URL_VALUES = {"", "auto", "platform"}


def _platform_llm_base_url() -> str:
    """Use the shared Aligned server on Windows and local Ollama elsewhere."""
    if platform.system().lower() == "windows":
        return ALIGNED_LLM_BASE_URL
    return LOCAL_LLM_BASE_URL


def _resolve_llm_base_url(env_name: str, fallback_env_name: str | None = None) -> str:
    value = os.getenv(env_name)
    if value is None and fallback_env_name:
        value = os.getenv(fallback_env_name)

    if value is not None and value.strip().lower() not in AUTO_BASE_URL_VALUES:
        return value.strip()

    return _platform_llm_base_url()


def _resolve_infra_host() -> str:
    """On Windows, Docker/Redis/Postgres run inside WSL — get the WSL IP dynamically.
    On macOS/Linux they are reachable via 127.0.0.1."""
    if platform.system().lower() == "windows":
        try:
            output = subprocess.check_output(["wsl", "hostname", "-I"], timeout=5)
            return output.decode().strip().split()[0]
        except Exception:
            return "127.0.0.1"
    return "127.0.0.1"


def _resolve_db_url() -> str:
    """Return DATABASE_URL, substituting 'auto' with the platform-appropriate host."""
    value = os.getenv("DATABASE_URL", "").strip()
    if not value or value.lower() in AUTO_BASE_URL_VALUES:
        host = _resolve_infra_host()
        return f"postgresql://postgres:postgres@{host}:5433/centriq"
    if value.startswith("postgres://"):
        value = value.replace("postgres://", "postgresql://", 1)
    return value


def _resolve_redis_url() -> str:
    """Return REDIS_URL, substituting 'auto' with the platform-appropriate host."""
    value = os.getenv("REDIS_URL", "").strip()
    if not value or value.lower() in AUTO_BASE_URL_VALUES:
        host = _resolve_infra_host()
        return f"redis://{host}:6380"
    return value


def _resolve_minio_endpoint() -> str:
    """Return MINIO_ENDPOINT, substituting 'auto' with the platform-appropriate host."""
    value = os.getenv("MINIO_ENDPOINT", "").strip()
    if not value or value.lower() in AUTO_BASE_URL_VALUES:
        host = _resolve_infra_host()
        return f"{host}:9000"
    return value


def _resolve_router_model() -> str:
    """Windows uses gpt-oss:latest (Aligned server); macOS/Linux use gpt-oss:20b (local Ollama)."""
    value = os.getenv("ROUTER_MODEL_NAME", "").strip()
    if value and value.lower() not in AUTO_BASE_URL_VALUES:
        return value
    if platform.system().lower() == "windows":
        return "gpt-oss:latest"
    return "gpt-oss:20b"


class Config:
    # ── Router Model (intent classification & domain routing) ──
    ROUTER_BASE_URL = _resolve_llm_base_url("ROUTER_BASE_URL")
    ROUTER_MODEL_NAME = _resolve_router_model()
    ROUTER_API_KEY = os.getenv("ROUTER_API_KEY", "ollama")

    # ── Agent Model (reasoning, tool calling, response generation) ──
    AGENT_BASE_URL = os.getenv("AGENT_BASE_URL", os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"))
    AGENT_MODEL_NAME = os.getenv("AGENT_MODEL_NAME", os.getenv("LLM_MODEL_NAME", "llama3.2:3b"))
    AGENT_API_KEY = os.getenv("AGENT_API_KEY", os.getenv("LLM_API_KEY", "ollama"))
    AGENT_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # ── General Model (greetings, small talk) ──
    GENERAL_MODEL_NAME = os.getenv("GENERAL_MODEL_NAME", "MichelRosselli/apertus:8b-instruct-2509-bf16")

    # ── Legacy aliases (backward compat) ──
    LLM_BASE_URL = _resolve_llm_base_url("LLM_BASE_URL")
    LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "llama3.3:70b")
    LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")
    LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # ── Agent Model (reasoning, tool calling, response generation) ──
    AGENT_BASE_URL = _resolve_llm_base_url("AGENT_BASE_URL", "LLM_BASE_URL")
    AGENT_MODEL_NAME = os.getenv("AGENT_MODEL_NAME", os.getenv("LLM_MODEL_NAME", "llama3.3:70b"))
    AGENT_API_KEY = os.getenv("AGENT_API_KEY", os.getenv("LLM_API_KEY", "ollama"))
    AGENT_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # ── Embedding + Chunking Models (semantic search / RAG ingestion) ──
    EMBEDDING_BASE_URL = _resolve_llm_base_url("EMBEDDING_BASE_URL", "LLM_BASE_URL")
    EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "llama3.3:70b")
    EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", os.getenv("LLM_API_KEY", "ollama"))

    CHUNKING_BASE_URL = _resolve_llm_base_url("CHUNKING_BASE_URL", "EMBEDDING_BASE_URL")
    CHUNKING_MODEL_NAME = os.getenv("CHUNKING_MODEL_NAME", os.getenv("EMBEDDING_MODEL_NAME", "llama3.3:70b"))
    CHUNKING_API_KEY = os.getenv("CHUNKING_API_KEY", os.getenv("EMBEDDING_API_KEY", "ollama"))
    POLICY_CHUNK_SIZE = int(os.getenv("POLICY_CHUNK_SIZE", "800"))
    POLICY_CHUNK_OVERLAP = int(os.getenv("POLICY_CHUNK_OVERLAP", "100"))

    # Database
    DATABASE_URL = _resolve_db_url()

    # Redis
    REDIS_URL = _resolve_redis_url()
    USE_MEMORY_SAVER = os.getenv("USE_MEMORY_SAVER", "false").lower() == "true"

    # Microsoft Graph
    GRAPH_TENANT_ID = os.getenv("GRAPH_TENANT_ID")
    GRAPH_CLIENT_ID = os.getenv("GRAPH_CLIENT_ID")
    GRAPH_CLIENT_SECRET = os.getenv("GRAPH_CLIENT_SECRET")
    GRAPH_CLIENT_STATE = os.getenv("GRAPH_CLIENT_STATE", "secretClientState")

    # MinIO
    MINIO_ENDPOINT = _resolve_minio_endpoint()
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
    MINIO_BUCKET_NAME = os.getenv("MINIO_BUCKET_NAME", "aurora-bucket")

    # App
    DEFAULT_USER_EMAIL = os.getenv("DEFAULT_USER_EMAIL", "employee1@centriq.ai")
    PORT = int(os.getenv("PORT", "8080"))
    HOST = os.getenv("HOST", "0.0.0.0")

    # SMTP / Email (for IT helpdesk tickets + admin notifications)
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")
    SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Centriq AI")
    HELPDESK_EMAIL = os.getenv("HELPDESK_EMAIL", "helpdesk@alignedautomation.com")
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@alignedautomation.com")

settings = Config()
