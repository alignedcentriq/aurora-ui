"""
Centriq AI — Multi-Agent LangGraph Brain

Architecture:
  User Message → Intent Router (gpt-oss) → Domain Agent (llama3.2:3b)
                                         ↓
                              HR Agent (active, with tools)
                              Admin Agent (placeholder)
                              IT Support Agent (placeholder)
                              PMO Agent (placeholder)
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
from langchain_core.messages import (
    BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage,
)
from langchain_core.tools import tool

from app.hr_service import HRService
from app.config import settings
from app.router import classify_intent, get_domain_status, get_placeholder_response


# ═══════════════════════════════════════════════════════════════════════════════
# 1. STATE DEFINITION
# ═══════════════════════════════════════════════════════════════════════════════

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    domain: Optional[str]
    route_confidence: Optional[float]
    route_reasoning: Optional[str]


# ═══════════════════════════════════════════════════════════════════════════════
# 2. HR TOOLS (the only active agent's tools for now)
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
agent_llm = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.AGENT_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
)

# Agent LLM with HR tools bound
hr_llm = agent_llm.bind_tools(hr_tools)

# Summary LLM — plain, no tools, for converting tool results to natural language
summary_llm = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.AGENT_MODEL_NAME,
    temperature=0.3,
)


# ═══════════════════════════════════════════════════════════════════════════════
# 4. GRAPH NODES
# ═══════════════════════════════════════════════════════════════════════════════

def intent_router(state: AgentState):
    """
    Entry node — classifies user intent and routes to the correct domain.
    Uses the fast router model (gpt-oss).
    """
    last_human = None
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            last_human = msg.content
            break

    if not last_human:
        return {
            "domain": "general",
            "route_confidence": 0.0,
            "route_reasoning": "No user message found",
        }

    result = classify_intent(last_human)
    print(f"[Router] Domain: {result['domain']} | Confidence: {result['confidence']:.2f} | {result['reasoning']}")

    return {
        "domain": result["domain"],
        "route_confidence": result["confidence"],
        "route_reasoning": result["reasoning"],
    }


def hr_agent(state: AgentState):
    """HR Agent — handles leave, payroll, policies, attendance."""
    messages = state["messages"]

    # Inject system prompt if not already present
    if not any(isinstance(m, SystemMessage) for m in messages):
        system_prompt = SystemMessage(content=f"""You are Centriq HR Assistant.
The person you are talking to is '{settings.DEFAULT_USER_EMAIL}'.
They are fully authorized to view and manage their own HR data.

YOUR CAPABILITIES (use the tools provided):
- Check leave balance → get_leave_balance
- Apply for leave → apply_leave
- Search HR policies → search_hr_policies
- Get payroll/salary info → get_payroll_info

RULES:
1. If the user's request is incomplete (e.g. "apply leave" without dates), ask for the missing details.
2. Use '{settings.DEFAULT_USER_EMAIL}' for all email parameters.
3. NEVER write raw JSON in your response. Use tool calls instead.
4. Always respond in natural, conversational language.
5. If the user asks about any policy/benefit, ALWAYS use search_hr_policies first.
6. ALWAYS provide a meaningful response. Never return empty text.
""")
        messages = [system_prompt] + messages

    response = hr_llm.invoke(messages)
    return {"messages": [response]}


def general_agent(state: AgentState):
    """General Agent — handles greetings, chitchat, and unclear queries."""
    messages = state["messages"]

    if not any(isinstance(m, SystemMessage) for m in messages):
        system_prompt = SystemMessage(content=f"""You are Centriq, the Workplace AI Assistant.
You are talking to '{settings.DEFAULT_USER_EMAIL}'.

You can help with:
- HR queries (leave, payroll, policies)
- IT Support (coming soon)
- Admin requests (coming soon)
- Project Management (coming soon)
- Team management (coming soon)

For now, respond naturally and helpfully. If the user's request maps to a specific domain,
let them know you can help and guide them to rephrase if needed.
Always be friendly, professional, and concise.
""")
        messages = [system_prompt] + messages

    response = agent_llm.invoke(messages)
    return {"messages": [response]}


def placeholder_agent(state: AgentState):
    """Placeholder for domains that are not yet implemented."""
    domain = state.get("domain", "unknown")
    placeholder_msg = get_placeholder_response(domain)
    return {"messages": [AIMessage(content=placeholder_msg)]}


def summarizer(state: AgentState):
    """Takes tool results and converts them to a natural language response."""
    messages = state["messages"]
    tool_message = messages[-1]
    tool_output = tool_message.content if hasattr(tool_message, "content") else str(tool_message)

    prompt = [
        SystemMessage(content=f"""You are talking directly to '{settings.DEFAULT_USER_EMAIL}'.
You just performed an action for THEM using a tool.

The tool returned the following result:

{tool_output}

Report this result to the user naturally based ONLY on the tool result above.
DO NOT say you couldn't find it if the information is right there.
Keep it simple: one or two sentences in plain English.
ALWAYS provide an answer. Never respond with empty text.
"""),
    ] + messages[-2:-1]

    response = summary_llm.invoke(prompt)

    clean_content = re.sub(r'\{.*?\}', '', response.content, flags=re.DOTALL).strip()
    clean_content = re.sub(r'```.*?```', '', clean_content, flags=re.DOTALL).strip()

    if not clean_content and response.content:
        clean_content = response.content

    return {"messages": [AIMessage(content=clean_content)]}


# ═══════════════════════════════════════════════════════════════════════════════
# 5. ROUTING LOGIC
# ═══════════════════════════════════════════════════════════════════════════════

def route_to_agent(state: AgentState):
    """Routes from the intent_router node to the appropriate agent node."""
    domain = state.get("domain", "general")
    status = get_domain_status(domain)

    if status == "placeholder":
        return "placeholder_agent"
    elif domain == "hr":
        return "hr_agent"
    else:
        return "general_agent"


def should_continue_hr(state: AgentState):
    """After HR agent responds, check if it wants to call tools."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "hr_tools"
    return END


# ═══════════════════════════════════════════════════════════════════════════════
# 6. CHECKPOINTER (Redis with Memory fallback)
# ═══════════════════════════════════════════════════════════════════════════════

checkpointer = MemorySaver()

try:
    import redis.asyncio as aioredis
    from langgraph.checkpoint.redis.aio import AsyncRedisSaver

    if settings.USE_MEMORY_SAVER:
        print("Using MemorySaver due to USE_MEMORY_SAVER=true")
    else:
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
        checkpointer = AsyncRedisSaver(redis_client=redis_client)
        print(f"Redis checkpointer initialized (URL: {settings.REDIS_URL})")

except ImportError:
    print("langgraph-checkpoint-redis not installed. Using MemorySaver.")
except Exception as e:
    print(f"Redis initialization failed: {e}. Using MemorySaver.")


# ═══════════════════════════════════════════════════════════════════════════════
# 7. BUILD THE LANGGRAPH
# ═══════════════════════════════════════════════════════════════════════════════

workflow = StateGraph(AgentState)

# ── Nodes ──
workflow.add_node("intent_router", intent_router)
workflow.add_node("hr_agent", hr_agent)
workflow.add_node("general_agent", general_agent)
workflow.add_node("placeholder_agent", placeholder_agent)
workflow.add_node("hr_tools", hr_tool_node)
workflow.add_node("summarizer", summarizer)

# ── Entry ──
workflow.set_entry_point("intent_router")

# ── Edges ──
# Router → Agent
workflow.add_conditional_edges("intent_router", route_to_agent)

# HR Agent → Tools or END
workflow.add_conditional_edges("hr_agent", should_continue_hr)

# Tools → Summarizer → END
workflow.add_edge("hr_tools", "summarizer")
workflow.add_edge("summarizer", END)

# General & Placeholder → END
workflow.add_edge("general_agent", END)
workflow.add_edge("placeholder_agent", END)

# ── Compile ──
app_agent = workflow.compile(checkpointer=checkpointer)
