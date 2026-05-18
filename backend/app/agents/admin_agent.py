from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode, InjectedState
from langchain_openai import ChatOpenAI

from app.services.admin_service import AdminService
from app.services.announcement_service import AnnouncementService
from app.services.prompt_service import PromptService
from app.hr_service import HRService
from app.config import settings


# ── Agent State ───────────────────────────────────────────────────────────────

class AdminState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str
    feedback_context: str


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def submit_reimbursement(
    type: str,
    amount: float,
    reason: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Submit a reimbursement request for travel, medical, certification, or equipment. Admin is notified by email."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.submit_reimbursement(email, type, amount, reason)

@tool
def check_reimbursement_status(state: Annotated[dict, InjectedState] = None):
    """Check the status of all your reimbursement requests."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.get_reimbursements(email)

@tool
def search_admin_policies(query: str):
    """Search company policy documents for reimbursement limits, approval rules, expense guidelines, and other admin policies."""
    return HRService.search_policies(query, limit=2)

@tool
def request_parking_sticker(
    vehicle_type: str,
    vehicle_number: str,
    vehicle_make: str = "",
    vehicle_model: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """
    Request a parking sticker for a 2-wheeler or 4-wheeler.
    Provide vehicle_number (e.g. MH12AB1234), vehicle_make (e.g. Honda), vehicle_model (e.g. Activa).
    Admin is notified by email.
    """
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.request_parking_sticker(email, vehicle_type, vehicle_number, vehicle_make, vehicle_model)

@tool
def surrender_parking_sticker(
    vehicle_number: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """
    Surrender / close your parking sticker. Optionally provide vehicle_number if you have multiple.
    Admin is notified by email.
    """
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.surrender_parking_sticker(email, vehicle_number)

@tool
def get_parking_info(state: Annotated[dict, InjectedState] = None):
    """Get information about your assigned parking sticker(s)."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.get_parking_info(email)

@tool
def request_accommodation(
    type: str,
    check_in: str,
    check_out: str,
    location: str,
    state: Annotated[dict, InjectedState] = None,
):
    """Request guest house or hotel accommodation. Dates format: YYYY-MM-DD."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.request_accommodation(email, type, check_in, check_out, location)

@tool
def file_facility_complaint(
    category: str,
    description: str,
    location: str,
    priority: str = "Medium",
    state: Annotated[dict, InjectedState] = None,
):
    """
    File a complaint for facility issues.
    Categories: Cleanliness, Electrical, AC, Plumbing, Furniture, Safety, Other.
    Priority: Low, Medium, High, Critical.
    Admin is notified by email.
    """
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.submit_facility_complaint(email, category, description, location, priority)

@tool
def check_complaint_status(ticket_id: str):
    """Check the status of a facility complaint ticket (e.g., FC-051212)."""
    return AdminService.get_complaint_status(ticket_id)

@tool
def submit_food_complaint(
    vendor_name: str,
    complaint_type: str,
    description: str,
    state: Annotated[dict, InjectedState] = None,
):
    """
    Lodge a food or cafeteria complaint (separate from a rating).
    complaint_type: Quality, Hygiene, Pricing, Variety, Service, Foreign Object, Other.
    Admin is notified by email.
    """
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.submit_food_complaint(email, vendor_name, complaint_type, description)

@tool
def submit_food_feedback(
    vendor_name: str,
    rating: int,
    comments: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Submit a star rating (1-5) for a food vendor. Vendors: Fresh Bites, Spice Kitchen, Green Bowl."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
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


# ── Agent Logic ───────────────────────────────────────────────────────────────

tools = [
    submit_reimbursement, check_reimbursement_status, search_admin_policies,
    request_parking_sticker, surrender_parking_sticker, get_parking_info,
    request_accommodation,
    file_facility_complaint, check_complaint_status,
    submit_food_complaint, submit_food_feedback, get_vendor_ratings,
    post_admin_announcement, update_admin_prompt,
]

tool_node = ToolNode(tools)


def admin_assistant(state: AdminState):
    user_email = state.get("user_email", settings.DEFAULT_USER_EMAIL)
    default_prompt = (
        f"You are the Admin Services Assistant for Aligned Automation.\n"
        f"The logged-in employee's email is: {user_email}. NEVER ask for their email or name — it is already known.\n\n"
        f"TOOL-CALL RULES — these are MANDATORY, not suggestions:\n\n"
        f"RULE 1 — REIMBURSEMENT KEYWORD DETECTED:\n"
        f"If the user's message contains ANY of these words: reimbursement, reimburse, claim, expense, expenses\n"
        f"AND they are NOT submitting with a specific amount already stated:\n"
        f"→ Call search_admin_policies IMMEDIATELY. Do NOT greet. Do NOT ask 'How can I help you?'.\n"
        f"→ Answer based on the search result.\n"
        f"Examples that MUST trigger search_admin_policies:\n"
        f"  'how can I raise reimbursement for hotels' → search_admin_policies\n"
        f"  'what is the reimbursement process' → search_admin_policies\n"
        f"  'can I claim medical expenses' → search_admin_policies\n"
        f"  'reimbursement policy' → search_admin_policies\n\n"
        f"RULE 2 — REIMBURSEMENT SUBMISSION (specific amount stated):\n"
        f"('I spent 5000 on travel', 'submit claim for 2000', 'I paid 3000 for hotel stay'):\n"
        f"→ Call search_admin_policies first to check limits, then call submit_reimbursement.\n"
        f"→ Only ask for: type (if unclear) and amount. Never ask for email.\n\n"
        f"RULE 3 — REIMBURSEMENT STATUS:\n"
        f"('my reimbursements', 'status of my claims', 'pending claims', 'my expenses'):\n"
        f"→ Call check_reimbursement_status immediately.\n\n"
        f"RULE 4 — PARKING STICKER:\n"
        f"('I need a parking sticker', 'register my bike/car', 'parking pass'):\n"
        f"→ Call request_parking_sticker. Vehicle number IS required — ask for it if missing.\n\n"
        f"RULE 5 — FACILITY COMPLAINT:\n"
        f"('AC not working', 'lights broken', 'dirty washroom', 'maintenance issue'):\n"
        f"→ Call file_facility_complaint immediately. Infer category and location from context.\n\n"
        f"RULE 6 — FOOD COMPLAINT:\n"
        f"('bad food at Fresh Bites', 'hygiene issue at Spice Kitchen'):\n"
        f"→ Call submit_food_complaint immediately.\n\n"
        f"RULE 7 — FOOD RATING:\n"
        f"('rate Fresh Bites 4 stars', 'give feedback on Green Bowl'):\n"
        f"→ Call submit_food_feedback immediately.\n\n"
        f"RULE 8 — ACCOMMODATION BOOKING:\n"
        f"('book guest house', 'need hotel stay for official trip', 'corporate accommodation'):\n"
        f"→ Call request_accommodation. Dates and location required — ask if genuinely missing.\n"
        f"→ NOTE: 'hotel reimbursement' or 'hotel expense' is RULE 1 (search policies), NOT this rule.\n\n"
        f"RULE 9 — AFTER TOOL RESULTS (HIGHEST PRIORITY — overrides all other rules):\n"
        f"If the conversation already contains a tool result (ToolMessage):\n"
        f"→ DO NOT call any tool again.\n"
        f"→ Present the information from the tool result clearly and helpfully to the user.\n"
        f"→ If the result is a policy, summarize the key points relevant to the user's question.\n"
        f"→ If no direct policy exists, say: 'There is no specific policy for this. Please raise it via Zoho (expense.zoho@alignedautomation.com) or contact the Admin team.'\n"
        f"→ NEVER respond with 'What would you like to do?' or 'How can I help?' after a tool result — always present what was found.\n\n"
        f"RESPONSE STYLE:\n"
        f"- NEVER open any response with 'How can I help you?' or 'I'm ready to assist' — always act.\n"
        f"- Act first. Only ask for details that are TRULY missing and cannot be inferred.\n"
        f"- Never ask for email — it is always {user_email}.\n"
        f"- One focused clarifying question at a time, if needed at all.\n\n"
        f"OUTPUT FORMATTING (STRICT):\n"
        f"- NEVER output HTML tags — no <br>, <p>, <b>, <ul>, <li>, <table>, <tr>, <td> or any other HTML.\n"
        f"- NEVER format data as a markdown table using | pipe characters.\n"
        f"- Use plain bullet points (- ) or numbered lists (1. 2. 3.) only.\n"
        f"- When presenting a policy result: summarize ONLY the policy directly relevant to the user's question.\n"
        f"- Do NOT list all available reimbursement types unless the user explicitly asks 'what types are available'.\n"
        f"- Focus on: what it covers, the process/steps, limits, and who to contact.\n"
    )
    base_prompt = PromptService.get_system_prompt("admin", default_prompt)
    guardrail = PromptService.get_guardrail("admin")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    model = ChatOpenAI(
        base_url=settings.ROUTER_BASE_URL,
        api_key=settings.ROUTER_API_KEY,
        model=settings.ROUTER_MODEL_NAME,
        temperature=settings.AGENT_TEMPERATURE,
        timeout=120,
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
