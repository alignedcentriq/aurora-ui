from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode, InjectedState
from langchain_openai import ChatOpenAI

from app.services.admin_service import AdminService
from app.services.announcement_service import AnnouncementService
from app.services.bookshelf_service import BookshelfService
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
    """Submit a reimbursement request. Call ONLY when user states a specific amount.
    Types: Travel, Medical, Certification, Equipment — infer from context, ask if ambiguous.
    Do NOT call with placeholder values. Ask for type and amount first if not stated.
    Admin is notified by email."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.submit_reimbursement(email, type, amount, reason)

@tool
def check_reimbursement_status(state: Annotated[dict, InjectedState] = None):
    """Check the status of all your reimbursement requests."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.get_reimbursements(email)

@tool
def search_admin_policies(query: str):
    """Search admin policy documents. Call for any reimbursement/expense/claim/policy question
    where the user is NOT submitting a specific amount. Infer query from user message — never ask what to search."""
    return HRService.search_policies(query, limit=2)

@tool
def request_parking_sticker(
    vehicle_type: str,
    vehicle_number: str,
    vehicle_make: str = "",
    vehicle_model: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Request a parking sticker for a 2-wheeler or 4-wheeler.
    REQUIRED: vehicle_number (e.g. MH12AB1234) — ask if not stated.
    vehicle_make and vehicle_model are optional — only include if user explicitly states them, never guess.
    Admin is notified by email."""
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
    """Request guest house or hotel accommodation. REQUIRED: type, check_in, check_out (YYYY-MM-DD), location.
    Ask for missing fields one at a time. NOTE: 'hotel reimbursement' is a policy question, not accommodation booking."""
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
    """File a facility complaint for infrastructure issues (AC, electrical, plumbing, washroom, furniture, safety).
    Infer category from the issue: 'AC not working'→AC, 'lights broken'→Electrical, 'washroom dirty'→Cleanliness, 'pipe leak'→Plumbing.
    Default priority to Medium unless user says urgent/critical.
    REQUIRED: location must be a specific floor/room/area — ask if not stated. 'Office' or 'building' is NOT a location.
    Admin is notified by email."""
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
    """Lodge a food or cafeteria complaint. Collect description + vendor/machine + location before calling.
    vendor_name: use exact vendor name, or 'Vending Machine' / 'Coffee Machine' if applicable.
    Infer complaint_type from description: Quality, Hygiene, Pricing, Variety, Service, Foreign Object, Other.
    REQUIRED: all of vendor_name, complaint_type, description. Ask for missing fields one at a time.
    Admin is notified by email."""
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
def list_available_books():
    """Show all books currently available to borrow from the company library (Bookshelf Buddy).
    Call this when the user asks what books are available, wants to borrow a book, or asks about the bookshelf.
    Always call this BEFORE request_book so the user can pick from the list."""
    books = BookshelfService.list_available_books()
    if not books:
        return "No books are currently available in the company library. Please check back later or contact Admin."
    lines = ["Here are the books currently available in our company library:\n"]
    for b in books:
        lines.append(
            f"**[{b['id']}] {b['title']}** by {b['author']}"
            + (f" ({b['category']})" if b['category'] else "")
            + f" — {b['available_copies']} copy/copies available"
        )
    lines.append("\nTo request a book, just tell me the book title or ID.")
    return "\n".join(lines)


@tool
def request_book(
    book_id: int,
    notes: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Submit a request to borrow a book from the company library (Bookshelf Buddy).
    REQUIRED: book_id — get this from list_available_books first.
    notes: optional reason or message for the admin.
    Admin is notified by email. Request status can be tracked with check_book_requests."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return BookshelfService.request_book(email, book_id, notes)


@tool
def check_book_requests(state: Annotated[dict, InjectedState] = None):
    """Check the status of your book borrow requests (Bookshelf Buddy)."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return BookshelfService.check_my_requests(email)


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
    list_available_books, request_book, check_book_requests,
    post_admin_announcement, update_admin_prompt,
]

tool_node = ToolNode(tools)

_admin_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    timeout=45,
)
def admin_assistant(state: AdminState):
    user_email = state.get("user_email", settings.DEFAULT_USER_EMAIL)
    default_prompt = (
        f"You are the Admin Services Assistant for Aligned Automation.\n"
        f"Employee email: {user_email}. Never ask for it.\n\n"
        f"Answer from tool results and provided policy context only.\n"
        f"If [PRE-SEARCHED POLICY] is in context, answer from it directly — do not call search_admin_policies.\n"
        f"If [POLICY SEARCH RESULT] says none found, tell user and suggest contacting Admin team or Zoho (expense.zoho@alignedautomation.com).\n"
        f"'Hotel reimbursement' or 'hotel expense' is a policy question — search policies, not book accommodation.\n"
        f"After a tool result is already in the conversation, present it clearly — do not re-call tools.\n"
        f"Never open with greetings — act immediately.\n"
    )
    base_prompt = PromptService.get_system_prompt("admin", default_prompt)
    guardrail = PromptService.get_guardrail("admin")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    # If policy was already pre-fetched by the parent graph node, strip search_admin_policies
    # from the tools list so the LLM cannot trigger a redundant second embedding + tool call.
    pre_fetched = "[PRE-SEARCHED POLICY]" in feedback_ctx or "[POLICY SEARCH RESULT]" in feedback_ctx
    active_tools = [t for t in tools if not (pre_fetched and t.name == "search_admin_policies")]

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    response = _admin_llm.bind_tools(active_tools).invoke(messages)
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
