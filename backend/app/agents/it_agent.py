from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import InjectedState, ToolNode
from app.services.it_service import ITService
from app.services.prompt_service import PromptService
from app.config import settings
from langchain_openai import ChatOpenAI


# -- State --------------------------------------------------------------------

class ITState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str
    feedback_context: str


# -- Tools (email injected from state — never visible to LLM) -----------------

@tool
def request_software_install(
    software_name: str,
    state: Annotated[dict, InjectedState],
):
    """Request software installation on your machine. Call immediately when the user names an actual
    software product (e.g. 'Node.js', 'Figma', 'Docker'). software_name must be the product name ONLY —
    never a sentence or a non-software phrase. If no specific software is named, ask which software they
    need instead of calling this. Do NOT ask for justification. Show the tool result as-is (mailto link)."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return ITService.request_software_install(email, software_name)


@tool
def create_it_ticket(
    category: str,
    subject: str,
    description: str,
    priority: str,
    state: Annotated[dict, InjectedState],
):
    """Create an IT support ticket. Call when user describes a specific problem.
    Infer category from description: Hardware (laptop/monitor/device), Network (wifi/VPN/internet), Software (app crash/error), Access (permissions/login), Security.
    Default priority to Medium unless user says urgent/critical/emergency.
    Use user's own words as subject and description. Never use placeholder text."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return ITService.create_ticket(email, category, subject, description, priority)


@tool
def check_ticket_status(ticket_id: str):
    """Check the status of an IT support ticket by its ID (e.g. IT-051212)."""
    return ITService.get_ticket_status(ticket_id)


@tool
def get_my_tickets(state: Annotated[dict, InjectedState]):
    """List all your IT support tickets and their current status."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return ITService.get_my_tickets(email)


@tool
def get_my_assets(state: Annotated[dict, InjectedState]):
    """List all IT assets (laptops, monitors, peripherals) assigned to you."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return ITService.get_my_assets(email)


tools = [request_software_install, create_it_ticket, check_ticket_status, get_my_tickets, get_my_assets]
tool_node = ToolNode(tools)

_it_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    timeout=45,
).bind_tools(tools)


# -- Agent Node ---------------------------------------------------------------

def it_assistant(state: ITState):
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    default_prompt = (
        f"You are the IT Support Assistant for Aligned Automation.\n"
        f"Employee: {user_email}. Never ask for email or justification.\n\n"
        f"Vague request ('create a ticket', 'I have a problem') → ask what the issue is.\n"
        f"Specific problem described → call create_it_ticket immediately.\n"
        f"Software install → call request_software_install immediately. Show result as-is (mailto link).\n"
        f"If ticket already created in this conversation, do not create another.\n"
        f"You ARE the helpdesk — never redirect to a portal or tell user to contact IT support.\n"
    )
    base_prompt = PromptService.get_system_prompt("it_support", default_prompt)
    guardrail = PromptService.get_guardrail("it_support")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    return {"messages": [_it_llm.invoke(messages)]}


def should_continue(state: ITState):
    if state["messages"][-1].tool_calls:
        return "tools"
    return END


# -- Graph --------------------------------------------------------------------

workflow = StateGraph(ITState)
workflow.add_node("it_assistant", it_assistant)
workflow.add_node("tools", tool_node)
workflow.set_entry_point("it_assistant")
workflow.add_conditional_edges("it_assistant", should_continue, ["tools", END])
workflow.add_edge("tools", "it_assistant")

it_agent = workflow.compile()
