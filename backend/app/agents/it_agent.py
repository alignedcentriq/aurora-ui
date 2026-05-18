from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage
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
    """Request installation of a software application on your machine."""
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
    """Create an IT support ticket for hardware, software, network, or access issues."""
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


# -- Agent Node ---------------------------------------------------------------

def it_assistant(state: ITState):
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    default_prompt = (
        f"You are the IT Support Assistant for Aligned Automation.\n"
        f"The logged-in employee is: {user_email}. NEVER ask for their email, name, or identity.\n\n"
        f"TICKET CREATION RULE — CRITICAL:\n"
        f"- ONLY call create_it_ticket when the user has described a SPECIFIC problem.\n"
        f"- If the user says 'I need to raise a ticket', 'create a ticket', 'open a ticket', "
        f"'log an issue', or any other VAGUE request WITHOUT describing the actual problem, "
        f"you MUST ask them to describe the issue first. Example: "
        f"'Sure, I can help with that! What issue are you facing? Please describe the problem so I can raise the right ticket.'\n"
        f"- NEVER create a ticket from a vague request. The user must tell you what is wrong.\n\n"
        f"WHEN TO ACT IMMEDIATELY:\n"
        f"1. Software/app install ('install Node.js', 'I need Python', 'get me VS Code', 'setup Postman'):\n"
        f"   → Call request_software_install(software_name=<name>) right away. Do NOT ask why.\n"
        f"2. Specific problem described ('my laptop is slow', 'VPN not working', 'screen is broken', "
        f"'no internet since morning', 'mouse not detected', 'can't access the shared drive'):\n"
        f"   → The user described the problem — call create_it_ticket immediately. "
        f"Infer category (Hardware/Network/Software/Access/Security) and priority from context.\n"
        f"3. Ticket status query ('status of IT-123', 'where is my ticket IT-050'):\n"
        f"   → Call check_ticket_status(ticket_id=<id>) immediately.\n"
        f"4. 'My tickets' / 'my requests' / 'open issues':\n"
        f"   → Call get_my_tickets immediately.\n"
        f"5. 'My assets' / 'my laptop' / 'what equipment do I have':\n"
        f"   → Call get_my_assets immediately.\n\n"
        f"STYLE RULES:\n"
        f"- NEVER ask for their email — it is already known.\n"
        f"- NEVER ask for justification or reason for a software install.\n"
        f"- Ask exactly ONE focused clarifying question at a time when info is missing.\n"
        f"- For software installs: show the tool result exactly — it contains an Outlook mailto link the user clicks.\n"
    )
    base_prompt = PromptService.get_system_prompt("it_support", default_prompt)
    guardrail = PromptService.get_guardrail("it_support")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    messages = [HumanMessage(content=system_prompt)] + state["messages"]
    model = ChatOpenAI(
        base_url=settings.ROUTER_BASE_URL,
        api_key=settings.ROUTER_API_KEY,
        model=settings.ROUTER_MODEL_NAME,
        temperature=settings.AGENT_TEMPERATURE,
        timeout=120,
    ).bind_tools(tools)
    return {"messages": [model.invoke(messages)]}


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
