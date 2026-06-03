import os
from typing import Literal

# Stub router — replace with Shivani's intent classifier when her work is merged.
# To integrate: swap route_to_domain() with Shivani's classify_intent() call.

PMO_KEYWORDS = {
    # PMO domain
    "project", "sprint", "milestone", "timeline", "delivery",
    "resource", "pmo", "deadline", "scope", "backlog", "velocity",
    "capacity", "release", "roadmap", "blocker", "standup",
    "retrospective", "burndown", "epic", "story point", "kickoff",
    "status report", "risk register", "dependency", "gantt",
    "progress", "jira", "task board", "action item",
    # Document / PDF generation — always needs 70B + generate_project_report tool
    "generate report", "generate pdf", "generate document",
    "create report", "create pdf", "create document",
    "export report", "export pdf", "export document",
    "download report", "download pdf",
    "meeting minutes", "sprint summary", "status summary",
    "make a report", "make a pdf", "write a report",
}

# Short phrases that signal a simple, low-complexity query
_SIMPLE_TRIGGERS = {
    "hi", "hello", "hey", "thanks", "thank you", "bye", "goodbye",
    "ok", "okay", "sure", "got it", "what is", "who is", "when is",
    "where is", "what are", "tell me", "what does",
}

# Document generation patterns — always need the large model even if they
# somehow reach general_assistant (safety net for select_model)
_DOC_TRIGGERS = {
    "generate", "export", "download", "create a report",
    "pdf", "docx", "meeting minutes", "sprint summary",
}


def route_to_domain(message: str) -> Literal["pmo", "general"]:
    msg_lower = message.lower()
    if any(kw in msg_lower for kw in PMO_KEYWORDS):
        return "pmo"
    return "general"


def select_model(message: str) -> str:
    """Pick the most efficient model for a general (non-PMO) query.

    Tiers (configured via env vars — swap without touching code):
      Small  — fast, good for greetings and simple lookups        (8B)
      Medium — balanced, handles HR/IT/Admin questions well        (20.9B)
      Large  — document generation or anything needing full power  (70B)
    """
    msg_lower = message.lower().strip()
    word_count = len(message.split())

    small  = os.getenv("LLM_MODEL_SMALL",  "MichelRosselli/apertus:8b-instruct-2509-bf16")
    medium = os.getenv("LLM_MODEL_MEDIUM", "gpt-oss:latest")
    large  = os.getenv("LLM_MODEL_LARGE",  "llama3.3:70b")

    # Document generation always needs the large model
    if any(t in msg_lower for t in _DOC_TRIGGERS):
        return large

    # Short message or simple opener → 8B
    if word_count <= 6 or any(t in msg_lower for t in _SIMPLE_TRIGGERS):
        return small

    # HR / IT / Admin / Org domain questions → 20.9B
    return medium
