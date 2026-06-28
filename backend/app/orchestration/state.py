"""AgentState — canonical TypedDict for the LangGraph conversation state.

Single source of truth.  Migrated from app.agent (ARB #23).
app.agent will import from here once the full strangler migration is complete.
For now this file is the reference copy; agent.py's inline definition must
stay in sync until the import is flipped.
"""
from __future__ import annotations

from typing import Annotated, List, Optional, TypedDict

from langchain_core.messages import BaseMessage


class AgentState(TypedDict, total=False):
    """LangGraph conversation state.  All fields are optional on creation;
    the graph merges partial updates via the Annotated reducer on ``messages``."""

    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    domain: Optional[str]
    route_confidence: Optional[float]
    route_reasoning: Optional[str]
    sub_intent: Optional[str]           # granular intent label ("software_install")
    entities: Optional[dict]            # pre-extracted entities from the user message
    feedback_context: Optional[str]     # injected feedback prompt block
    user_email: Optional[str]           # logged-in user email
    session_id: Optional[str]           # chat thread id, used for pending confirmations
    conversation_summary: Optional[str] # rolling summary of older turns
    resolved_query: Optional[str]       # follow-up rewritten to a standalone query
    focus: Optional[dict]               # ConversationState: subject of the last answer
    user_role: Optional[str]            # "employee" | "hr" | "admin" | "manager" | "it" | "pmo"
    graph_token: Optional[str]          # user's delegated MS Graph token (from frontend)
    user_location: Optional[str]        # detected from M365 profile (officeLocation / city)
    portal_context: Optional[dict]      # {page, active_filters} — what portal the user is on
    active_mode: Optional[str]          # "analytics" | "training" | "project" | "resource"
