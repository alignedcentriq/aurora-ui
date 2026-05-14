from typing import Annotated, List, TypedDict, Union
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from app.services.admin_service import AdminService
from app.services.prompt_service import PromptService
from app.config import settings
from langchain_openai import ChatOpenAI

# -- Tools --------------------------------------------------------------------

@tool
def submit_reimbursement(email: str, type: str, amount: float, reason: str = ""):
    """Submit a reimbursement request for travel, medical, certification, or equipment."""
    return AdminService.submit_reimbursement(email, type, amount, reason)

@tool
def check_reimbursement_status(email: str):
    """Check the status of all your reimbursement requests."""
    return AdminService.get_reimbursements(email)

@tool
def request_parking_sticker(email: str, vehicle_type: str, vehicle_number: str):
    """Request a parking sticker for a 2-wheeler or 4-wheeler."""
    return AdminService.request_parking_sticker(email, vehicle_type, vehicle_number)

@tool
def get_parking_info(email: str):
    """Get information about your assigned parking sticker."""
    return AdminService.get_parking_info(email)

@tool
def request_accommodation(email: str, type: str, check_in: str, check_out: str, location: str):
    """Request guest house or hotel accommodation. Dates format: YYYY-MM-DD."""
    return AdminService.request_accommodation(email, type, check_in, check_out, location)

@tool
def file_facility_complaint(email: str, category: str, description: str, location: str, priority: str = "Medium"):
    """File a complaint for housekeeping, electrical, plumbing, AC, or cafeteria issues."""
    return AdminService.submit_facility_complaint(email, category, description, location, priority)

@tool
def check_complaint_status(ticket_id: str):
    """Check the status of a facility complaint ticket (e.g., FC-051212)."""
    return AdminService.get_complaint_status(ticket_id)

@tool
def submit_food_feedback(email: str, vendor_name: str, rating: int, comments: str = ""):
    """Submit feedback for a food vendor (rating 1-5). Vendors: Fresh Bites, Spice Kitchen, Green Bowl."""
    return AdminService.submit_food_feedback(email, vendor_name, rating, comments)

@tool
def get_vendor_ratings(vendor_name: str):
    """Get the average rating for a food vendor."""
    return AdminService.get_vendor_ratings(vendor_name)

# -- Agent Logic --------------------------------------------------------------

class AdminState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str

tools = [
    submit_reimbursement, check_reimbursement_status, 
    request_parking_sticker, get_parking_info,
    request_accommodation, file_facility_complaint, 
    check_complaint_status, submit_food_feedback, get_vendor_ratings
]

tool_node = ToolNode(tools)

def admin_assistant(state: AdminState):
    default_prompt = "You are the Admin Services Assistant for Aligned Automation. Help employees with reimbursements, parking, guest houses, facility complaints, and food vendor feedback. Always use the user_email provided in the state for tool calls. If data is missing (like vehicle number or reimbursement type), ask for it politely."
    system_prompt = PromptService.get_system_prompt("admin", default_prompt)
    
    messages = [HumanMessage(content=system_prompt)] + state["messages"]
    model = ChatOpenAI(
        base_url=settings.ROUTER_BASE_URL,
        api_key=settings.ROUTER_API_KEY,
        model=settings.ROUTER_MODEL_NAME,
        temperature=settings.AGENT_TEMPERATURE,
    ).bind_tools(tools)
    response = model.invoke(messages)
    return {"messages": [response]}

def should_continue(state: AdminState):
    messages = state["messages"]
    last_message = messages[-1]
    if last_message.tool_calls:
        return "tools"
    return END

# -- Graph --------------------------------------------------------------------

workflow = StateGraph(AdminState)
workflow.add_node("admin_assistant", admin_assistant)
workflow.add_node("tools", tool_node)

workflow.set_entry_point("admin_assistant")
workflow.add_conditional_edges("admin_assistant", should_continue, ["tools", END])
workflow.add_edge("tools", "admin_assistant")

admin_agent = workflow.compile()
