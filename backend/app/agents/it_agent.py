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

_it_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    timeout=120,
).bind_tools(tools)


# -- Agent Node ---------------------------------------------------------------

def it_assistant(state: ITState):
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    default_prompt = (
        f"You are the IT Support Assistant for Aligned Automation.\n"
        f"The logged-in employee is: {user_email}. NEVER ask for their email, name, or identity.\n\n"
        f"MULTI-TURN CONVERSATION RULE (READ FIRST):\n"
        f"Before responding, scan the full conversation history above.\n"
        f"- If a prior AI message asked the user to describe their problem, and the user's CURRENT message IS that description → IMMEDIATELY call create_it_ticket. Do NOT ask again.\n"
        f"- If a prior AI message asked for any detail (ticket ID, category, etc.) and the user just provided it → use it immediately. Do NOT ask again.\n"
        f"- NEVER repeat a question already asked in this conversation.\n\n"
        f"TICKET CREATION FLOW (multi-turn):\n"
        f"STEP 1 — User makes a vague request ('create a ticket', 'raise a ticket', 'log an issue', 'I have a problem'):\n"
        f"  → Reply ONLY with: 'Sure! What issue are you facing? Please describe the problem so I can raise the right ticket.'\n"
        f"  → Do NOT call any tool. Do NOT ask multiple questions.\n"
        f"STEP 2 — User describes a specific problem (in reply to your question OR in their first message):\n"
        f"  → IMMEDIATELY call create_it_ticket.\n"
        f"  → Infer category (Hardware/Network/Software/Access/Security) from the description.\n"
        f"  → Default priority to 'Medium' unless the user says urgent/critical/emergency.\n"
        f"  → Use the user's own words as subject and description.\n"
        f"  → NEVER use placeholder text ('Unknown', 'N/A', 'Please provide', 'TBD') in any field.\n"
        f"  → NEVER tell the user to 'contact IT support' or 'use the helpdesk portal' — you ARE the helpdesk.\n\n"
        f"WHEN TO ACT IMMEDIATELY (no clarification needed):\n"
        f"1. Software/app install ('install Node.js', 'I need Python', 'get me VS Code', 'setup Postman'):\n"
        f"   → Call request_software_install(software_name=<name>) right away. Do NOT ask why.\n"
        f"2. Specific problem described ('my laptop is slow', 'VPN not working', 'screen is broken', "
        f"'no internet since morning', 'mouse not detected', 'can't access the shared drive'):\n"
        f"   → Call create_it_ticket immediately.\n"
        f"3. Ticket status query ('status of IT-123', 'where is my ticket IT-050'):\n"
        f"   → Call check_ticket_status(ticket_id=<id>) immediately.\n"
        f"4. 'My tickets' / 'my requests' / 'open issues':\n"
        f"   → Call get_my_tickets immediately.\n"
        f"5. 'My assets', 'my laptop', 'what equipment do I have', 'what assets are assigned to me', 'what devices do I have':\n"
        f"   → Call get_my_assets immediately.\n\n"
        f"AFTER TICKET CREATED (check conversation history first):\n"
        f"If the conversation already contains a 'Ticket ID: IT-...' confirmation:\n"
        f"→ Do NOT create another ticket.\n"
        f"→ If the user provides additional context ('it happens when I open Chrome'), acknowledge it: 'Noted. Your ticket IT-[ID] is already logged with that context.'\n"
        f"→ If the user asks for the ticket ID or status, answer from history.\n\n"
        f"STYLE RULES:\n"
        f"- NEVER ask for their email — it is already known.\n"
        f"- NEVER ask for justification or reason for a software install.\n"
        f"- Ask exactly ONE focused clarifying question at a time when info is missing.\n"
        f"- For software installs: show the tool result exactly — it contains an Outlook mailto link the user clicks.\n\n"
        f"FOLLOW-UP FOCUS RULE:\n"
        f"- When the user asks a specific follow-up ('what is the ticket number?', 'what is the status?'), answer ONLY that point from the conversation history — do NOT re-list all ticket details.\n\n"
        f"OUTPUT FORMATTING:\n"
        f"- NEVER output markdown tables (no | pipe characters).\n"
        f"- NEVER output HTML tags.\n"
        f"- Use plain bullet points (- ) or numbered lists (1. 2. 3.) only.\n"
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
