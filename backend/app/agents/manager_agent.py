from typing import Annotated, List, TypedDict, Union
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from app.services.manager_service import ManagerService
from app.services.prompt_service import PromptService
from app.config import settings
from langchain_openai import ChatOpenAI


# -- Tools --------------------------------------------------------------------

@tool
def get_my_team(manager_email: str):
    """List all your direct reportees."""
    return ManagerService.get_reportees(manager_email)

@tool
def get_team_attendance_today(manager_email: str, date: str = None):
    """Get the attendance status for your team for today or a specific date (YYYY-MM-DD)."""
    return ManagerService.get_team_attendance(manager_email, date)

@tool
def get_pending_leave_requests(manager_email: str):
    """List all pending leave requests from your team members."""
    return ManagerService.get_team_leave_requests(manager_email, status="Pending")

@tool
def approve_leave_request(leave_id: int, manager_email: str):
    """Approve a team member's leave request by its ID."""
    return ManagerService.approve_leave(leave_id, manager_email)

@tool
def reject_leave_request(leave_id: int, manager_email: str, reason: str = ""):
    """Reject a team member's leave request by its ID."""
    return ManagerService.reject_leave(leave_id, manager_email, reason)

@tool
def assign_training(employee_email: str, course_name: str, platform: str, due_date: str, manager_email: str):
    """Assign a training course to a team member. Dates format: YYYY-MM-DD. Platforms: Udemy, Coursera, Internal, LinkedIn Learning."""
    return ManagerService.assign_training(employee_email, course_name, platform, due_date, manager_email)

@tool
def get_training_status(employee_email: str):
    """Get the status of all training courses assigned to an employee."""
    return ManagerService.get_training_status(employee_email)

@tool
def get_employee_skills(employee_email: str):
    """Review the skill profile and proficiency levels of an employee."""
    return ManagerService.get_employee_skills(employee_email)

@tool
def get_employee_project_history(employee_email: str):
    """Get the project history and current project assignments for an employee."""
    return ManagerService.get_employee_projects(employee_email)

# -- Agent Logic --------------------------------------------------------------

class ManagerState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str

tools = [
    get_my_team, get_team_attendance_today, 
    get_pending_leave_requests, approve_leave_request, 
    reject_leave_request, assign_training, 
    get_training_status, get_employee_skills, get_employee_project_history
]

tool_node = ToolNode(tools)

def manager_assistant(state: ManagerState):
    user_email = state.get("user_email", settings.DEFAULT_USER_EMAIL)
    default_prompt = (
        f"You are the Manager Assistant for Aligned Automation. "
        f"The currently logged-in manager's email is: {user_email}. "
        f"IMPORTANT: Always use this email as manager_email for tool calls — NEVER ask who the user is. "
        f"Help managers manage their teams, track attendance, approve or reject leaves, "
        f"assign trainings, and review employee skills and projects. "
        f"Only perform actions for which this manager is authorized."
    )
    base_prompt = PromptService.get_system_prompt("functional_manager", default_prompt)
    guardrail = PromptService.get_guardrail("functional_manager")
    system_prompt = base_prompt + guardrail

    messages = [HumanMessage(content=system_prompt)] + state["messages"]
    model = ChatOpenAI(
        base_url=settings.ROUTER_BASE_URL,
        api_key=settings.ROUTER_API_KEY,
        model=settings.ROUTER_MODEL_NAME,
        temperature=settings.AGENT_TEMPERATURE,
    ).bind_tools(tools)
    response = model.invoke(messages)
    return {"messages": [response]}

def should_continue(state: ManagerState):
    messages = state["messages"]
    last_message = messages[-1]
    if last_message.tool_calls:
        return "tools"
    return END

# -- Graph --------------------------------------------------------------------

workflow = StateGraph(ManagerState)
workflow.add_node("manager_assistant", manager_assistant)
workflow.add_node("tools", tool_node)

workflow.set_entry_point("manager_assistant")
workflow.add_conditional_edges("manager_assistant", should_continue, ["tools", END])
workflow.add_edge("tools", "manager_assistant")

manager_agent = workflow.compile()
