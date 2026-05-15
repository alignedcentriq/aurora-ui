from typing import Annotated, List, TypedDict, Union
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from app.services.it_service import ITService
from app.services.prompt_service import PromptService
from app.config import settings
from langchain_openai import ChatOpenAI

# -- Tools --------------------------------------------------------------------

@tool
def create_it_ticket(email: str, category: str, subject: str, description: str, priority: str = "Medium"):
    """Create an IT Support Ticket for hardware, software, network, or access issues."""
    return ITService.create_ticket(email, category, subject, description, priority)

@tool
def check_ticket_status(ticket_id: str):
    """Check the status of an IT support ticket (e.g., IT-051212)."""
    return ITService.get_ticket_status(ticket_id)

@tool
def get_my_tickets(email: str):
    """List all your IT support tickets."""
    return ITService.get_my_tickets(email)

@tool
def request_software_install(email: str, software_name: str, justification: str):
    """Request a software installation. Note: Some software may require an admin password flow."""
    result = ITService.request_software_install(email, software_name, justification)
    return json.dumps(result)

@tool
def get_my_assets(email: str):
    """List all IT assets (laptops, monitors, etc.) assigned to you."""
    return ITService.get_my_assets(email)

# -- Agent Logic --------------------------------------------------------------

class ITState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str

tools = [
    create_it_ticket, check_ticket_status, 
    get_my_tickets, request_software_install, get_my_assets
]

tool_node = ToolNode(tools)

def it_assistant(state: ITState):
    default_prompt = "You are the IT Support Assistant for Aligned Automation. Help employees with software installation, hardware issues, network problems, and asset management. Note that software installations requiring admin passwords will trigger an asynchronous HITL (Human-In-The-Loop) request to the IT Admin team. Inform the user when such a request is initiated."
    system_prompt = PromptService.get_system_prompt("it_support", default_prompt)
    
    messages = [HumanMessage(content=system_prompt)] + state["messages"]
    model = ChatOpenAI(
        base_url=settings.ROUTER_BASE_URL,
        api_key=settings.ROUTER_API_KEY,
        model=settings.ROUTER_MODEL_NAME,
        temperature=settings.AGENT_TEMPERATURE,
    ).bind_tools(tools)
    response = model.invoke(messages)
    return {"messages": [response]}

def should_continue(state: ITState):
    messages = state["messages"]
    last_message = messages[-1]
    if last_message.tool_calls:
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
