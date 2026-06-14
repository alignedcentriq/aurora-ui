from typing import Annotated, List, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage
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
import app.services.travel_service as _travel_svc


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
    # Scoped to admin-owned categories: Admin (relocation/travel/parking/accommodation) +
    # Finance (reimbursement/expense/PF — where the Reimbursement Policy actually lives).
    from app.services.policy_service import PolicyService
    return PolicyService.search_admin_docs(query, limit=3)

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
def get_parking_charges(state: Annotated[dict, InjectedState] = None):
    """Get the monthly parking charges (fee / cost / rate / price) for 2-wheelers and
    4-wheelers, as configured by the Admin team. Call this for ANY question about how much
    parking costs — e.g. 'parking charges', 'parking fee', 'parking cost for my car/bike'.
    Do NOT ask the user for anything; the rates are global."""
    from app.services.parking_payment_service import ParkingPaymentService
    return ParkingPaymentService.format_charges()

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
def request_visitor_pass(
    visitor_name: str,
    visit_date: str,
    purpose: str,
    visit_time: str = "",
    visitor_company: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Request a visitor/guest pass for someone coming to the office to meet the employee.
    REQUIRED: visitor_name, visit_date (YYYY-MM-DD), purpose — ask for any that are missing, one at a time.
    visit_time and visitor_company are optional — only include if the user states them, never guess.
    Do NOT call with placeholder values. Admin/reception is notified by email."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.request_visitor_pass(email, visitor_name, visit_date, purpose, visit_time, visitor_company)

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
    Call this ONLY when the user asks to see the full list without naming a specific book.
    If the user names a specific book they want to borrow, use borrow_book_by_name instead."""
    books = BookshelfService.list_available_books()
    if not books:
        return "No books are currently available in the company library. Please check back later or contact Admin."
    lines = ["Here are the books currently available in our company library:\n"]
    for b in books[:8]:  # cap the chat list — full list lives on /books
        avail = b["available_copies"]
        total = b["total_copies"]
        status = b.get("availability_status", "")
        lines.append(
            f"**[{b['id']}] {b['title']}** by {b['author']}"
            + (f" ({b['category']})" if b['category'] else "")
            + f" — {avail}/{total} copies available | {status}"
        )
    if len(books) > 8:
        lines.append(f"\n…and {len(books) - 8} more.")
    lines.append("\nTo request a book, just tell me the title. Or browse the full catalog here: <<NAV:/books|Open Book Catalog>>")
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
    name = email.split("@")[0].replace(".", " ").replace("_", " ").title()
    return BookshelfService.request_book(email, name, book_id, notes)


@tool
def check_book_requests(state: Annotated[dict, InjectedState] = None):
    """Check the status of your book borrow requests (Bookshelf Buddy)."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    text = BookshelfService.check_my_requests(email)
    if isinstance(text, str) and not text.startswith("You haven't"):
        text += "\n\nManage your borrows here: <<NAV:/my-library|Open My Library>>"
    return text


@tool
def borrow_book_by_name(
    book_name: str,
    notes: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Borrow a book by title — searches the library and submits the request in one step.
    Use this INSTEAD of list_available_books + request_book when the user names a specific book.
    book_name: partial or full title (case-insensitive match). Admin is notified by email."""
    books = BookshelfService.list_available_books()
    if not books:
        return "No books are currently available in the company library."
    name_lower = book_name.lower()
    match = next((b for b in books if name_lower in b["title"].lower()), None)
    if not match:
        titles = ", ".join(b["title"] for b in books[:5])
        return f"No available book matching '{book_name}' found. Available books include: {titles}."
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    emp_name = email.split("@")[0].replace(".", " ").replace("_", " ").title()
    return BookshelfService.request_book(email, emp_name, match["id"], notes)


@tool
def return_my_book(
    ticket_id: str,
    state: Annotated[dict, InjectedState] = None,
):
    """Return one of your currently-borrowed books (Bookshelf Buddy).
    REQUIRED: ticket_id — the borrow ticket (e.g. BK-...). Ask user for it, or call check_book_requests first if missing.
    Only the original borrower can return their own book."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    result = BookshelfService.employee_return(email, ticket_id)
    return result.get("message", "Done.")


@tool
def request_book_extension(
    ticket_id: str,
    additional_days: int = 7,
    reason: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Request an extension on an active borrow (Bookshelf Buddy).
    REQUIRED: ticket_id (e.g. BK-...). additional_days defaults to 7 (max 30).
    Admin is notified and must approve or reject. Use check_book_requests to find your ticket if needed."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    try:
        days = int(additional_days)
    except (TypeError, ValueError):
        days = 7
    result = BookshelfService.request_extension(email, ticket_id, days, reason or "")
    return result.get("message", "Done.")


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
def request_office_supply(
    item_name: str,
    state: Annotated[dict, InjectedState] = None,
):
    """Request an office supply or stationery item (pens, markers, notebooks, notepads,
    stationery, whiteboard markers, sticky notes, folders, binders, books).
    Call immediately when the user asks for any office supply. item_name must be the item
    only — never a sentence. Do not ask for justification. Admin team is notified."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.request_office_supply(email, item_name)


@tool
def request_desk_key(
    desk_number: str,
    reason: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Request a desk key for a specific desk.
    REQUIRED: desk_number (e.g. B-07, A-3) — ask the user for it if not stated; never guess.
    reason: optional note on why the key is needed.
    The request is automatically declined if that desk is already assigned to someone else.
    The Admin team is notified by email."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return AdminService.request_desk_key(email, desk_number, reason)

@tool
def get_cabin_info(state: Annotated[dict, InjectedState] = None):
    """Look up cabin/room numbers for Admin, HR, IT Support, and PMO at the user's office.
    Call when user asks where to find a department, which cabin HR is in, or where to go for Admin/IT/PMO.
    Also call when referring the user to a department so you can give them the exact location.
    The user's office location is detected automatically — no need to ask."""
    from app.services.company_settings_service import CompanySettingsService
    location = (state or {}).get("user_location", "")
    if not location:
        return "Your office location is not set in your profile. Ask IT to update officeLocation in your M365 account."
    return CompanySettingsService.get_cabin_info(location)


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


@tool
def submit_travel_request(
    business_reason: str,
    from_location: str,
    to_destination: str,
    travel_date: str,
    return_date: str = "",
    is_international: bool = False,
    visa_required: bool = False,
    mode_of_travel: str = "Flight",
    accommodation_required: bool = False,
    estimated_cost: float = 0.0,
    notes: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Submit a business travel request. Collect ALL required fields before calling.
    REQUIRED: business_reason, from_location, to_destination, travel_date (YYYY-MM-DD).
    Ask for missing fields one at a time. Infer is_international if destination is a different country.
    Set visa_required=True for international travel. accommodation_required if user says they need hotel/stay.
    mode_of_travel: Flight / Train / Car / Other.
    Reporting manager is notified by email for approval. Do NOT call with placeholder values."""
    missing = [f for f, v in [
        ("business_reason", business_reason),
        ("from_location", from_location),
        ("to_destination", to_destination),
        ("travel_date", travel_date),
    ] if not (v or "").strip()]
    if missing:
        return f"Cannot submit — required field(s) missing: {', '.join(missing)}. Please ask the user for these before calling this tool."
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    result = _travel_svc.submit_travel_request(
        employee_email=email,
        business_reason=business_reason,
        from_location=from_location,
        to_destination=to_destination,
        travel_date=travel_date,
        return_date=return_date,
        is_international=is_international,
        visa_required=visa_required,
        mode_of_travel=mode_of_travel,
        accommodation_required=accommodation_required,
        estimated_cost=estimated_cost,
        notes=notes,
    )
    return result.get("message", "Travel request submitted.")


@tool
def check_travel_requests(state: Annotated[dict, InjectedState] = None):
    """Check the status of all your business travel requests."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    return _travel_svc.get_my_travel_requests(email)


@tool
def submit_travel_expense(
    travel_ref_id: str,
    amount: float,
    breakdown: str = "",
    over_limit_reason: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Submit a post-trip expense claim for a completed/approved travel request.
    REQUIRED: travel_ref_id (e.g. TRVL-0001), amount.
    breakdown: itemised description of expenses (meals, transport, etc.).
    over_limit_reason: REQUIRED only if the amount exceeds the trip's approved limit — ask the user for it.
    Do NOT call with placeholder values. Check check_travel_requests first to find the ref_id."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    result = _travel_svc.submit_expense_claim(
        employee_email=email,
        travel_ref_id=travel_ref_id,
        amount=amount,
        breakdown=breakdown,
        over_limit_reason=over_limit_reason,
    )
    if result.get("over_limit"):
        return (
            f"The claimed amount INR {result['amount']:,.0f} exceeds the approved limit of "
            f"INR {result['limit']:,.0f}. Please provide a reason for the excess amount, "
            f"then I'll resubmit with your explanation."
        )
    return result.get("message", "Expense claim submitted.")


# ── Agent Logic ───────────────────────────────────────────────────────────────

tools = [
    submit_reimbursement, check_reimbursement_status, search_admin_policies,
    request_parking_sticker, surrender_parking_sticker, get_parking_info, get_parking_charges,
    request_accommodation, request_visitor_pass,
    file_facility_complaint, check_complaint_status,
    submit_food_complaint, submit_food_feedback, get_vendor_ratings,
    list_available_books, borrow_book_by_name, request_book, check_book_requests,
    return_my_book, request_book_extension,
    request_office_supply,
    request_desk_key,
    post_admin_announcement, update_admin_prompt,
    submit_travel_request, check_travel_requests, submit_travel_expense,
    get_cabin_info,
]

_BOOKSHELF_TOOLS = [
    list_available_books, borrow_book_by_name, request_book, check_book_requests,
    return_my_book, request_book_extension,
]

# Narrow tool sets per sub_intent — prevents the LLM from calling unrelated tools
_TOOL_GROUPS: dict[str, list] = {
    "bookshelf":          _BOOKSHELF_TOOLS,
    "bookshelf.discover": [list_available_books],
    "bookshelf.borrow":   [list_available_books, borrow_book_by_name, request_book],
    "bookshelf.status":   [check_book_requests],
    "bookshelf.return":   [check_book_requests, return_my_book],
    "bookshelf.extend":   [check_book_requests, request_book_extension],
    "parking_sticker":    [request_parking_sticker, surrender_parking_sticker, get_parking_info, get_parking_charges],
    "parking_charges":    [get_parking_charges],
    "facility_complaint": [file_facility_complaint, check_complaint_status],
    "food_complaint":     [submit_food_complaint, submit_food_feedback, get_vendor_ratings],
    "accommodation":      [request_accommodation, search_admin_policies],
    "visitor_pass":       [request_visitor_pass],
    "policy_query":       [search_admin_policies, submit_reimbursement, check_reimbursement_status],
    "office_supply_request": [request_office_supply],
    "desk_key_request":   [request_desk_key],
    "travel_request":     [submit_travel_request, check_travel_requests, search_admin_policies],
    "travel_expense":     [check_travel_requests, submit_travel_expense],
    "travel_status":      [check_travel_requests],
    "cabin_info":         [get_cabin_info],
}

import re as _re
_SUB_INTENT_RE = _re.compile(r'\[SUB_INTENT:([^\]]+)\]')

tool_node = ToolNode(tools)

# LLM built on demand from the live IT-tunable params (router tier).
from app.services.llm_resilience import resilient_invoke


def admin_assistant(state: AdminState):
    user_email = state.get("user_email", settings.DEFAULT_USER_EMAIL)
    default_prompt = (
        f"You are the Admin Services Assistant for Aligned Automation.\n"
        f"Employee email: {user_email}. Never ask for it.\n\n"
        f"Answer from tool results and provided policy context only. Never invent facts.\n"
        f"FORMATTING: Use bullet points for lists, **bold** for key terms, short paragraphs.\n"
        f"Lead with a 1-2 sentence direct answer. Never paste raw policy text verbatim — synthesize.\n"
        f"Office supply request (pens, markers, notebooks, notepads, stationery, sticky notes, folders) → "
        f"call request_office_supply IMMEDIATELY. Never ask for justification.\n"
        f"If [PRE-SEARCHED POLICY] is in context, answer from it directly — do not call search_admin_policies.\n"
        f"If [POLICY SEARCH RESULT] says none found, tell user and suggest contacting Admin team or Zoho (expense.zoho@alignedautomation.com).\n"
        f"'Hotel reimbursement' or 'hotel expense' is a policy question — search policies, not book accommodation.\n"
        f"After a tool result is already in the conversation, present it clearly — do not re-call tools.\n"
        f"When user asks where HR/Admin/IT/PMO is located, which cabin/room/floor, or where to go — call get_cabin_info immediately.\n"
        f"When referring the user to a department, also call get_cabin_info to include their cabin location.\n"
        f"Never open with greetings — act immediately.\n"
    )
    base_prompt = PromptService.get_system_prompt("admin", default_prompt)
    guardrail = PromptService.get_guardrail("admin")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    # Detect sub_intent injected by admin_agent_node and select a narrow tool set.
    # Fallback to all tools when sub_intent is unknown or a follow-up.
    _m = _SUB_INTENT_RE.search(feedback_ctx)
    detected_sub = _m.group(1).strip() if _m else ""
    pre_fetched = "[PRE-SEARCHED POLICY]" in feedback_ctx or "[POLICY SEARCH RESULT]" in feedback_ctx

    policy_already_injected = "[PRE-SEARCHED POLICY]" in feedback_ctx
    no_policy_found = "[POLICY SEARCH RESULT]" in feedback_ctx and "No policy found" in feedback_ctx

    if detected_sub in _TOOL_GROUPS:
        active_tools = _TOOL_GROUPS[detected_sub]
        if pre_fetched:
            active_tools = [t for t in active_tools if t.name != "search_admin_policies"]
    else:
        active_tools = [t for t in tools if not (pre_fetched and t.name == "search_admin_policies")]

    messages = [SystemMessage(content=system_prompt)] + state["messages"]

    # When policy was already injected, strip all tools — the LLM must answer in plain
    # text from the pre-fetched context. Leaving tools bound causes weak models to emit
    # tool calls as JSON text instead of prose.
    if policy_already_injected or no_policy_found:
        response = resilient_invoke("service", messages, default_timeout=120)
    else:
        response = resilient_invoke("service", messages,
                                    build=lambda l: l.bind_tools(active_tools),
                                    default_timeout=120)

    # If the model returned empty text with no tool calls, retry once with the tool result
    # explicitly in the prompt rather than dumping it raw.
    if not (response.content or "").strip() and not getattr(response, "tool_calls", None):
        last_tool = next(
            (m for m in reversed(state["messages"]) if isinstance(m, ToolMessage) and m.content),
            None,
        )
        if last_tool:
            user_q = next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
            retry_messages = messages + [
                last_tool,
                HumanMessage(content=(
                    f"Based on the above result, answer this question clearly and concisely "
                    f"using bullet points where appropriate: {user_q}"
                )),
            ]
            response = resilient_invoke("service", retry_messages, default_timeout=60)
            if not (response.content or "").strip():
                response = AIMessage(content=last_tool.content)

    return {"messages": [response]}


def should_continue(state: AdminState):
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return END


# Read-only lookups whose service output is already display-ready AND that never
# feed a follow-up tool call. These skip the LLM re-read entirely (no latency, no
# paraphrase drift). Tools that can chain (e.g. list_available_books → request_book)
# are deliberately excluded so ReAct flows still work.
_PASSTHROUGH_TOOLS = {
    "check_reimbursement_status", "get_parking_info", "get_parking_charges", "get_vendor_ratings",
    "check_complaint_status", "check_book_requests",
}


def admin_passthrough(state: AdminState):
    """Emit a display-ready tool result verbatim — zero LLM."""
    last = state["messages"][-1]
    return {"messages": [AIMessage(content=(getattr(last, "content", "") or "").strip())]}


def route_after_tools(state: AdminState):
    last = state["messages"][-1]
    if isinstance(last, ToolMessage) and getattr(last, "name", "") in _PASSTHROUGH_TOOLS:
        return "passthrough"
    return "admin_assistant"


# ── Graph ─────────────────────────────────────────────────────────────────────

workflow = StateGraph(AdminState)
workflow.add_node("admin_assistant", admin_assistant)
workflow.add_node("tools", tool_node)
workflow.add_node("passthrough", admin_passthrough)

workflow.set_entry_point("admin_assistant")
workflow.add_conditional_edges("admin_assistant", should_continue, ["tools", END])
workflow.add_conditional_edges("tools", route_after_tools, ["passthrough", "admin_assistant"])
workflow.add_edge("passthrough", END)

admin_agent = workflow.compile()
