from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_openai import ChatOpenAI

from app.services.admin_service import AdminService
from app.services.announcement_service import AnnouncementService
from app.services.prompt_service import PromptService
from app.config import settings


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def submit_reimbursement(email: str, type: str, amount: float, reason: str = ""):
    """Submit a reimbursement request for travel, medical, certification, or equipment. Admin is notified by email."""
    return AdminService.submit_reimbursement(email, type, amount, reason)

@tool
def check_reimbursement_status(email: str):
    """Check the status of all your reimbursement requests."""
    return AdminService.get_reimbursements(email)

@tool
def request_parking_sticker(email: str, vehicle_type: str, vehicle_number: str, vehicle_make: str = "", vehicle_model: str = ""):
    """
    Request a parking sticker for a 2-wheeler or 4-wheeler.
    Provide vehicle_number (e.g. MH12AB1234), vehicle_make (e.g. Honda), vehicle_model (e.g. Activa).
    Admin is notified by email.
    """
    return AdminService.request_parking_sticker(email, vehicle_type, vehicle_number, vehicle_make, vehicle_model)

@tool
def surrender_parking_sticker(email: str, vehicle_number: str = ""):
    """
    Surrender / close your parking sticker. Optionally provide vehicle_number if you have multiple.
    Admin is notified by email.
    """
    return AdminService.surrender_parking_sticker(email, vehicle_number)

@tool
def get_parking_info(email: str):
    """Get information about your assigned parking sticker(s)."""
    return AdminService.get_parking_info(email)

@tool
def request_accommodation(email: str, type: str, check_in: str, check_out: str, location: str):
    """Request guest house or hotel accommodation. Dates format: YYYY-MM-DD."""
    return AdminService.request_accommodation(email, type, check_in, check_out, location)

@tool
def file_facility_complaint(email: str, category: str, description: str, location: str, priority: str = "Medium"):
    """
    File a complaint for facility issues.
    Categories: Cleanliness, Electrical, AC, Plumbing, Furniture, Safety, Other.
    Priority: Low, Medium, High, Critical.
    Admin is notified by email.
    """
    return AdminService.submit_facility_complaint(email, category, description, location, priority)

@tool
def check_complaint_status(ticket_id: str):
    """Check the status of a facility complaint ticket (e.g., FC-051212)."""
    return AdminService.get_complaint_status(ticket_id)

@tool
def submit_food_complaint(email: str, vendor_name: str, complaint_type: str, description: str):
    """
    Lodge a food or cafeteria complaint (separate from a rating).
    complaint_type: Quality, Hygiene, Pricing, Variety, Service, Foreign Object, Other.
    Admin is notified by email.
    """
    return AdminService.submit_food_complaint(email, vendor_name, complaint_type, description)

@tool
def submit_food_feedback(email: str, vendor_name: str, rating: int, comments: str = ""):
    """Submit a star rating (1-5) for a food vendor. Vendors: Fresh Bites, Spice Kitchen, Green Bowl."""
    return AdminService.submit_food_feedback(email, vendor_name, rating, comments)

@tool
def get_vendor_ratings(vendor_name: str):
    """Get the average star rating for a food vendor."""
    return AdminService.get_vendor_ratings(vendor_name)

@tool
def post_admin_announcement(title: str, body: str, category: str = "General", target_audience: str = "all"):
    """
    Publish an announcement from the Admin team (Admin role only).
    Categories: Policy Update, Events, General, IT Alert.
    """
    return AnnouncementService.create(
        title=title,
        body=body,
        category=category,
        created_by=settings.DEFAULT_USER_EMAIL,
        created_by_domain="admin",
        target_audience=target_audience,
    )

@tool
def update_admin_prompt(new_prompt: str):
    """Update the Admin agent system prompt (Admin manager role only)."""
    return PromptService.update_prompt(
        domain="admin",
        prompt_key="system_prompt",
        value=new_prompt,
        updated_by=settings.DEFAULT_USER_EMAIL,
        user_role="admin_manager",
    )


# ── Agent State ───────────────────────────────────────────────────────────────

class AdminState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str


tools = [
    submit_reimbursement, check_reimbursement_status,
    request_parking_sticker, surrender_parking_sticker, get_parking_info,
    request_accommodation,
    file_facility_complaint, check_complaint_status,
    submit_food_complaint, submit_food_feedback, get_vendor_ratings,
    post_admin_announcement, update_admin_prompt,
]

tool_node = ToolNode(tools)


# ── Agent Logic ───────────────────────────────────────────────────────────────

def admin_assistant(state: AdminState):
    user_email = state.get("user_email", settings.DEFAULT_USER_EMAIL)
    default_prompt = (
        f"You are the Admin Services Assistant for Aligned Automation. "
        f"The logged-in employee's email is: {user_email}. Never ask for their email or name. "
        f"You handle: parking stickers, reimbursements, accommodation, facility complaints, food complaints and ratings. "
        f"For every request, call the matching tool. If required details are missing (e.g. vehicle number for a parking sticker), "
        f"ask the user for them. Never refuse a request you have a tool for."
    )
    base_prompt = PromptService.get_system_prompt("admin", default_prompt)
    guardrail = PromptService.get_guardrail("admin")
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


def should_continue(state: AdminState):
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return END


# ── Graph ─────────────────────────────────────────────────────────────────────

workflow = StateGraph(AdminState)
workflow.add_node("admin_assistant", admin_assistant)
workflow.add_node("tools", tool_node)

workflow.set_entry_point("admin_assistant")
workflow.add_conditional_edges("admin_assistant", should_continue, ["tools", END])
workflow.add_edge("tools", "admin_assistant")

admin_agent = workflow.compile()
