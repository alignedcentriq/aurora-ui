from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
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

# LLM built on demand from the live IT-tunable params (router tier).
from app.services import llm_controls_service as llm_controls


def manager_assistant(state: ManagerState):
    user_email = state.get("user_email", settings.DEFAULT_USER_EMAIL)
    default_prompt = (
        f"You are the Manager Assistant for Aligned Automation.\n"
        f"Manager email: {user_email}. Never ask who the user is.\n"
        f"Leave approval is handled via email links — there is no leave approval action in this chat.\n"
        f"For HR policy questions, tell the manager to ask Centriq in the HR context.\n"
        f"FORMATTING: Use bullet points for lists, **bold** for key terms, short paragraphs.\n"
        f"Lead with a direct 1-2 sentence answer. Synthesize tool results — never dump raw output.\n"
        f"ALWAYS respond in first person. Never write simulated dialogue or use labels like 'User:'.\n"
    )
    base_prompt = PromptService.get_system_prompt("functional_manager", default_prompt)
    guardrail = PromptService.get_guardrail("functional_manager")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    llm = llm_controls.get_llm("service", default_timeout=120).bind_tools(tools)
    return {"messages": [llm.invoke(messages)]}


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
