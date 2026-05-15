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
from app.agents.admin_agent import admin_agent
from app.agents.it_agent import it_agent
from app.agents.manager_agent import manager_agent
from app.sharepoint_transfer_service import sharepoint_transfer_service
from app.services.employee_service import EmployeeService
from app.services.announcement_service import AnnouncementService
from app.services.prompt_service import PromptService


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

@tool
def transfer_sharepoint_to_minio(site_name: str, folder_path: str, minio_prefix: str = ""):
    """
    Pull documents from a SharePoint folder and transfer them to MinIO.
    site_name: e.g. 'tenant.sharepoint.com:/sites/SiteName'
    folder_path: e.g. 'Shared Documents/General'
    minio_prefix: Optional prefix for the objects in MinIO
    """
    return sharepoint_transfer_service.transfer_folder_to_minio(site_name, folder_path, minio_prefix)

@tool
def list_minio_documents(prefix: str = ""):
    """
    List all documents currently stored in MinIO.
    prefix: Optional prefix to filter the search.
    """
    from app.minio_client import minio_client
    return minio_client.list_objects(prefix)


# ── HR Employee Directory Tools ──────────────────────────────────────────────

@tool
def search_employee_directory(query: str, function: str = "", location: str = "", designation: str = ""):
    """Search the employee directory by name, skill, function, designation, or location."""
    return EmployeeService.search_directory(
        query=query,
        function=function or None,
        location=location or None,
        designation=designation or None,
    )

@tool
def get_employee_profile(name_or_email: str):
    """Get the full non-sensitive profile for an employee by name or email."""
    return EmployeeService.get_profile(name_or_email)

@tool
def get_org_chart(name_or_email: str):
    """Get the reporting chain (manager above and direct reports below) for an employee."""
    return EmployeeService.get_org_chart(name_or_email)

@tool
def get_team_roster(manager_name: str):
    """List all direct reports for a given manager."""
    return EmployeeService.get_team_roster(manager_name)

@tool
def find_skills_expert(skill: str):
    """Find employees who have a specific skill or expertise."""
    return EmployeeService.find_skills_expert(skill)

@tool
def get_department_headcount(function: str = ""):
    """Get headcount of active employees by function/department. Leave function blank for all departments."""
    return EmployeeService.get_department_headcount(function or None)

# ── HR Announcement Tools ─────────────────────────────────────────────────────

@tool
def create_announcement(title: str, body: str, category: str = "General", target_audience: str = "all", expires_days: int = 0):
    """
    Publish a company-wide announcement (HR role only).
    Categories: Policy Update, Holiday, Events, Hiring, Training, General, IT Alert.
    expires_days: 0 = never expires.
    """
    return AnnouncementService.create(
        title=title,
        body=body,
        category=category,
        created_by=settings.DEFAULT_USER_EMAIL,
        created_by_domain="hr",
        target_audience=target_audience,
        expires_days=expires_days if expires_days > 0 else None,
    )

@tool
def get_announcements(domain_filter: str = ""):
    """Get latest active announcements. Optionally filter by domain: hr, admin, it_support, functional_manager."""
    return AnnouncementService.get_active(domain_filter=domain_filter or None)

@tool
def deactivate_announcement(announcement_id: int):
    """Deactivate/remove an announcement by its ID (HR role only)."""
    return AnnouncementService.deactivate(announcement_id, requested_by=settings.DEFAULT_USER_EMAIL)

# ── HR Prompt Config Tool ─────────────────────────────────────────────────────

@tool
def update_hr_prompt(new_prompt: str):
    """Update the HR agent system prompt (HR manager role only)."""
    return PromptService.update_prompt(
        domain="hr",
        prompt_key="system_prompt",
        value=new_prompt,
        updated_by=settings.DEFAULT_USER_EMAIL,
        user_role="hr_manager",
    )


hr_tools = [
    get_leave_balance, apply_leave, search_hr_policies, get_payroll_info,
    transfer_sharepoint_to_minio, list_minio_documents,
    search_employee_directory, get_employee_profile, get_org_chart,
    get_team_roster, find_skills_expert, get_department_headcount,
    create_announcement, get_announcements, deactivate_announcement,
    update_hr_prompt,
]
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
        base = PromptService.get_system_prompt(
            "hr",
            f"You are Centriq HR Assistant for Aligned Automation. "
            f"The logged-in employee's email is: {settings.DEFAULT_USER_EMAIL}. "
            f"IMPORTANT: Always use this email for tool calls — NEVER ask who the user is. "
            f"Use tools for all HR data (leave, payroll, policies, directory). "
            f"Never answer HR questions from your training knowledge.",
        )
        guardrail = PromptService.get_guardrail("hr")
        messages = [SystemMessage(content=base + guardrail)] + messages

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


async def admin_agent_node(state: AgentState):
    """Admin Agent - handles reimbursement, parking, etc."""
    result = await admin_agent.ainvoke({
        "messages": state["messages"], 
        "user_email": settings.DEFAULT_USER_EMAIL
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process Admin request."))
    return {"messages": [last_ai]}


async def it_agent_node(state: AgentState):
    """IT Agent - handles software install, tickets, etc."""
    result = await it_agent.ainvoke({
        "messages": state["messages"], 
        "user_email": settings.DEFAULT_USER_EMAIL
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process IT request."))
    return {"messages": [last_ai]}


async def manager_agent_node(state: AgentState):
    """Manager Agent - handles team approvals, assignments, etc."""
    result = await manager_agent.ainvoke({
        "messages": state["messages"], 
        "user_email": settings.DEFAULT_USER_EMAIL
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process Manager request."))
    return {"messages": [last_ai]}


general_tools = [get_announcements, search_hr_policies]
general_tool_node = ToolNode(general_tools)
general_llm = agent_llm.bind_tools(general_tools)


def general_agent(state: AgentState):
    """General Agent — greetings, announcements, and policy Q&A."""
    base = PromptService.get_system_prompt(
        "general",
        "You are Centriq, the AI assistant for Aligned Automation. "
        "You handle greetings, small talk, company announcements, and general HR policy questions. "
        "You have two tools: get_announcements (call with no arguments to fetch all active company announcements) "
        "and search_hr_policies (search for policy details by topic). "
        "Always call get_announcements when the user asks about news, updates, or announcements. "
        "Always call search_hr_policies when the user asks about a policy. "
        "For all other domain questions (leave, payroll, parking, IT tickets, projects), direct the user to the right team. "
        "IMPORTANT: Do NOT answer company-specific questions from your own knowledge — use tools only.",
    )
    guardrail = PromptService.get_guardrail("general")
    messages = [SystemMessage(content=base + guardrail)] + state["messages"]
    try:
        response = general_llm.invoke(messages)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, I'm having trouble connecting right now.")]}
    return {"messages": [response]}


def should_continue_general(state: AgentState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "general_tools"
    return END


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
    
    # Use HumanMessage as some models (like llama3.2) return empty for SystemMessage-only prompts
    prompt = [
        HumanMessage(content=f"""You are an HR Assistant. Summarize this tool result for the employee.
        
TOOL RESULT:
{tool_output}

INSTRUCTIONS:
1. Provide a concise, friendly summary of the result.
2. IMPORTANT: If and ONLY IF the tool result contains a tag like [DOWNLOAD_PDF:url:title], include it exactly at the end.
3. If no such tag is present in the TOOL RESULT above, DO NOT make one up or add any links.
4. Do not include any JSON, curly braces, or technical metadata in your response.
""")
    ]
    try:
        response = summary_llm.invoke(prompt)
        content = response.content.strip()
        
        # Fallback if content is empty or model hallucinated the example tag
        if not content or "[DOWNLOAD_PDF:url:title]" in content:
            content = f"I've retrieved the information for you: {tool_output}"
            
        return {"messages": [AIMessage(content=content)]}
    except Exception as e:
        return {"messages": [AIMessage(content=f"The operation was successful, but I had trouble summarizing the result: {tool_output}")]}



# ═══════════════════════════════════════════════════════════════════════════════
# 5. ROUTING LOGIC
# ═══════════════════════════════════════════════════════════════════════════════

def route_to_agent(state: AgentState):
    domain = state.get("domain", "general")
    status = get_domain_status(domain)
    if domain == "pmo": return "pmo_agent"
    if domain == "admin": return "admin_agent"
    if domain == "it_support": return "it_agent"
    if domain == "functional_manager": return "manager_agent"
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
workflow.add_node("admin_agent", admin_agent_node)
workflow.add_node("it_agent", it_agent_node)
workflow.add_node("manager_agent", manager_agent_node)
workflow.add_node("general_agent", general_agent)
workflow.add_node("general_tools", general_tool_node)
workflow.add_node("dummy_test_agent", dummy_test_agent)
workflow.add_node("placeholder_agent", placeholder_agent)
workflow.add_node("hr_tools", hr_tool_node)
workflow.add_node("summarizer", summarizer)

workflow.set_entry_point("intent_router")
workflow.add_conditional_edges("intent_router", route_to_agent)
workflow.add_conditional_edges("hr_agent", should_continue_hr)
workflow.add_conditional_edges("general_agent", should_continue_general)
workflow.add_edge("hr_tools", "summarizer")
workflow.add_edge("general_tools", "general_agent")
workflow.add_edge("summarizer", END)
workflow.add_edge("pmo_agent", END)
workflow.add_edge("admin_agent", END)
workflow.add_edge("it_agent", END)
workflow.add_edge("manager_agent", END)
workflow.add_edge("dummy_test_agent", END)
workflow.add_edge("placeholder_agent", END)

app_agent = workflow.compile(checkpointer=checkpointer)
