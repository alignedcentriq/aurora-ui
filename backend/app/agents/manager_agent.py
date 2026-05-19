from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from app.services.manager_service import ManagerService
from app.services.prompt_service import PromptService
from app.config import settings
from langchain_openai import ChatOpenAI


@tool
def get_my_team(manager_email: str):
    """List all employees who report directly to you."""
    return ManagerService.get_reportees(manager_email)


@tool
def search_people_directory(query: str):
    """Search employees by name, skill, designation, project history, experience, or reporting manager.
    Use for: 'Find someone with Java skills', 'Who has 3+ years experience?',
    'What did Alice work on last?', 'Find employees in the Finance function'."""
    from app.services.people_service import PeopleService
    return PeopleService.search_people_text(query)


class ManagerState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str
    feedback_context: str


tools = [get_my_team, search_people_directory]
tool_node = ToolNode(tools)


def manager_assistant(state: ManagerState):
    user_email = state.get("user_email", settings.DEFAULT_USER_EMAIL)
    default_prompt = (
        f"You are the Manager Assistant for Aligned Automation.\n"
        f"The logged-in manager's email is: {user_email}. NEVER ask who the user is.\n\n"
        f"CONVERSATION MEMORY RULE:\n"
        f"Read the full conversation history before responding.\n"
        f"- If the user refers to a prior answer ('tell me more about them', 'what about Alice?'), use the context from previous messages.\n"
        f"- NEVER ask for information already provided in this conversation.\n\n"
        f"TOOLS:\n"
        f"1. 'Who reports to me', 'my team', 'my direct reports', 'my reportees':\n"
        f"   → Call get_my_team(manager_email='{user_email}') immediately.\n"
        f"2. 'Find someone with X skill', 'who has experience in Y', 'search for Z':\n"
        f"   → Call search_people_directory(query=<query>) immediately.\n\n"
        f"LEAVE APPROVAL: Leave approval and rejection is handled entirely via email. "
        f"When an employee submits a leave request, their reporting manager receives an email with Approve/Reject links to click. "
        f"There is no leave approval action in this chat.\n\n"
        f"For payroll or HR policy questions → tell the manager to ask Centriq in the HR context.\n\n"
        f"FOLLOW-UP FOCUS RULE:\n"
        f"- When the user asks a specific follow-up about someone already listed ('what are Rahul's skills?', 'how many people do I have?'), answer ONLY that point from the conversation history — 1-3 lines.\n"
        f"- Do NOT re-list the full team on every follow-up.\n\n"
        f"OUTPUT FORMATTING:\n"
        f"- NEVER output markdown tables (no | pipe characters).\n"
        f"- NEVER output HTML tags.\n"
        f"- Use plain bullet points (- ) or numbered lists (1. 2. 3.) only.\n"
        f"Be concise and professional."
    )
    base_prompt = PromptService.get_system_prompt("functional_manager", default_prompt)
    guardrail = PromptService.get_guardrail("functional_manager")
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
    response = model.invoke(messages)
    return {"messages": [response]}


def should_continue(state: ManagerState):
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return END


workflow = StateGraph(ManagerState)
workflow.add_node("manager_assistant", manager_assistant)
workflow.add_node("tools", tool_node)

workflow.set_entry_point("manager_assistant")
workflow.add_conditional_edges("manager_assistant", should_continue, ["tools", END])
workflow.add_edge("tools", "manager_assistant")

manager_agent = workflow.compile()
