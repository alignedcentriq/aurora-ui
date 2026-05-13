"""
Centriq AI — Multi-Agent LangGraph Brain

Architecture:
  User Message → Intent Router (gpt-oss) → Domain Agent (llama3.2:3b)
                                         ↓
                              HR Agent (active, with tools)
                              Admin Agent (placeholder)
                              IT Support Agent (placeholder)
                              PMO Agent (active, with tools)
                              Functional Manager Agent (placeholder)
                              General Agent (direct LLM response)
"""

import os
import json
import re
from typing import TypedDict, Annotated, List, Optional

from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

from langchain_openai import ChatOpenAI
from openai import APIConnectionError
from langchain_core.messages import (
    BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage,
)
from langchain_core.tools import tool

from app.hr_service import HRService
from app.config import settings
from app.router import classify_intent, get_domain_status, get_placeholder_response
from app.agents.pmo_agent import pmo_agent


DOWNLOAD_TAG_PATTERN = re.compile(r"\[DOWNLOAD_PDF:[^\]]+\]")


# ═══════════════════════════════════════════════════════════════════════════════
# 1. STATE DEFINITION
# ═══════════════════════════════════════════════════════════════════════════════

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    domain: Optional[str]
    route_confidence: Optional[float]
    route_reasoning: Optional[str]


# ═══════════════════════════════════════════════════════════════════════════════
# 2. HR TOOLS
# ═══════════════════════════════════════════════════════════════════════════════

@tool
def get_leave_balance(email: str):
    """Get the current leave balance for an employee."""
    return HRService.get_leave_balance(email)

@tool
def apply_leave(
    email: str,
    start_date: str,
    end_date: str,
    leave_type: str = "Casual",
    reason: str = "Applied via AI Assistant",
):
    """Submit a leave request. Use YYYY-MM-DD format for dates."""
    return HRService.apply_leave(email, start_date, end_date, leave_type, reason)

@tool
def search_hr_policies(query: str):
    """Search HR policy documents for a specific topic."""
    return HRService.search_policies(query)

@tool
def get_payroll_info(email: str):
    """Get the latest payroll / salary information for an employee."""
    return HRService.get_payroll_info(email)


hr_tools = [get_leave_balance, apply_leave, search_hr_policies, get_payroll_info]
hr_tool_node = ToolNode(hr_tools)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. LLM INSTANCES
# ═══════════════════════════════════════════════════════════════════════════════
# Agent LLM — used for reasoning and tool calling
# Switching to Router settings for tool support
agent_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    max_retries=3,
    timeout=30,
)


# Agent LLM with HR tools bound
hr_llm = agent_llm.bind_tools(hr_tools)


summary_llm = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.AGENT_MODEL_NAME,
    temperature=0.3,
    max_retries=3,
    timeout=30,
)



# ═══════════════════════════════════════════════════════════════════════════════
# 4. GRAPH NODES
# ═══════════════════════════════════════════════════════════════════════════════

def intent_router(state: AgentState):
    """Entry node — classifies user intent and routes to the correct domain."""
    last_human = None
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            last_human = msg.content
            break

    if not last_human:
        return {"domain": "general", "route_confidence": 0.0, "route_reasoning": "No user message found"}

    if "five project name" in last_human.lower():
        return {"domain": "dummy_test", "route_confidence": 1.0, "route_reasoning": "Testing trigger detected."}

    try:
        result = classify_intent(last_human)
        print(f"[Router] Domain: {result['domain']} | Confidence: {result['confidence']:.2f}")
    except APIConnectionError:
        return {"domain": "general", "route_confidence": 0.5, "route_reasoning": "LLM connection failed."}

    return {
        "domain": result["domain"],
        "route_confidence": result["confidence"],
        "route_reasoning": result["reasoning"],
    }


def hr_agent(state: AgentState):
    """HR Agent — handles leave, payroll, policies."""
    messages = state["messages"]
    if not any(isinstance(m, SystemMessage) for m in messages):
        system_prompt = SystemMessage(content=f"You are Centriq HR Assistant. Use the provided tools to help '{settings.DEFAULT_USER_EMAIL}'.")
        messages = [system_prompt] + messages

    try:
        response = hr_llm.invoke(messages)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, the HR system is currently unreachable.")]}
    
    return {"messages": [response]}


async def pmo_agent_node(state: AgentState):
    """PMO Agent - handles project and report requests."""
    result = await pmo_agent.ainvoke({"messages": state["messages"]})
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process PMO request."))
    return {"messages": [last_ai]}


def general_agent(state: AgentState):
    """General Agent — handles greetings and chitchat."""
    try:
        response = agent_llm.invoke(state["messages"])
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, I'm having trouble connecting to my brain right now.")]}
    return {"messages": [response]}


def dummy_test_agent(state: AgentState):
    """Dummy Agent — returns fixed data for testing."""
    dummy_projects = ["1. Centriq AI", "2. Aurora UI", "3. HR Integration", "4. Admin Dashboard", "5. IT Support Agent"]
    response = "Here are five project names for testing:\n\n" + "\n".join(dummy_projects)
    return {"messages": [AIMessage(content=response)]}


def placeholder_agent(state: AgentState):
    """Placeholder for domains that are not yet implemented."""
    domain = state.get("domain", "unknown")
    return {"messages": [AIMessage(content=get_placeholder_response(domain))]}


def summarizer(state: AgentState):
    """Converts tool results to natural language, preserving download tags."""
    tool_message = state["messages"][-1]
    tool_output = tool_message.content if hasattr(tool_message, "content") else str(tool_message)
    
    prompt = [
        SystemMessage(content=f"""Summarize this tool result for '{settings.DEFAULT_USER_EMAIL}'.
        
IMPORTANT:
1. If the tool result contains a tag like [DOWNLOAD_PDF:...], you MUST include it EXACTLY as-is.
2. NEVER convert it to a standard markdown link like [title](url).
3. NEVER change the URL or host.
4. If there is a download tag, make sure it is at the end of your response.

Tool result:
{tool_output}
""")
    ]
    response = summary_llm.invoke(prompt)
    return {"messages": [AIMessage(content=response.content)]}



# ═══════════════════════════════════════════════════════════════════════════════
# 5. ROUTING LOGIC
# ═══════════════════════════════════════════════════════════════════════════════

def route_to_agent(state: AgentState):
    domain = state.get("domain", "general")
    status = get_domain_status(domain)
    if domain == "pmo": return "pmo_agent"
    if domain == "dummy_test": return "dummy_test_agent"
    if status == "placeholder": return "placeholder_agent"
    if domain == "hr": return "hr_agent"
    return "general_agent"

def should_continue_hr(state: AgentState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "hr_tools"
    return END


# ═══════════════════════════════════════════════════════════════════════════════
# 6. CHECKPOINTER
# ═══════════════════════════════════════════════════════════════════════════════

checkpointer = MemorySaver()
try:
    import redis.asyncio as aioredis
    from langgraph.checkpoint.redis.aio import AsyncRedisSaver
    if not settings.USE_MEMORY_SAVER:
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
        checkpointer = AsyncRedisSaver(redis_client=redis_client)
except Exception as e:
    print(f"Redis initialization failed: {e}. Using MemorySaver.")


# ═══════════════════════════════════════════════════════════════════════════════
# 7. BUILD THE LANGGRAPH
# ═══════════════════════════════════════════════════════════════════════════════

workflow = StateGraph(AgentState)

workflow.add_node("intent_router", intent_router)
workflow.add_node("hr_agent", hr_agent)
workflow.add_node("pmo_agent", pmo_agent_node)
workflow.add_node("general_agent", general_agent)
workflow.add_node("dummy_test_agent", dummy_test_agent)
workflow.add_node("placeholder_agent", placeholder_agent)
workflow.add_node("hr_tools", hr_tool_node)
workflow.add_node("summarizer", summarizer)

workflow.set_entry_point("intent_router")
workflow.add_conditional_edges("intent_router", route_to_agent)
workflow.add_conditional_edges("hr_agent", should_continue_hr)
workflow.add_edge("hr_tools", "summarizer")
workflow.add_edge("summarizer", END)
workflow.add_edge("general_agent", END)
workflow.add_edge("pmo_agent", END)
workflow.add_edge("dummy_test_agent", END)
workflow.add_edge("placeholder_agent", END)

app_agent = workflow.compile(checkpointer=checkpointer)
