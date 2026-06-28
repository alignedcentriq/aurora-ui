"""
HR Agent — LangGraph subgraph that handles all HR-domain requests.

Tools call the same service layer exposed by /api/skills/hr/* endpoints.
The agent decides which tool(s) to call; the LLM only reads results
and writes the final reply.
"""

from typing import Annotated, List, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import InjectedState, ToolNode

from app.config import settings
from app.services.llm_resilience import resilient_invoke
from app.hr_service import HRService
from app.services.policy_service import PolicyService
from app.services.prompt_service import PromptService


# ── State ──────────────────────────────────────────────────────────────────────

class HRState(TypedDict):
    messages: Annotated[List[BaseMessage], "Conversation messages"]
    user_email: str
    feedback_context: str


# ── Tools — each maps directly to a /api/skills/hr/* endpoint ─────────────────

@tool
def search_policy(query: str):
    """Search company HR policies (leave, attendance, reimbursement, POSH, PF, etc.).
    Call for ANY question about rules, entitlements, procedures, or company policy.
    Infer a clear search query from the user's message — never ask what to search."""
    results = PolicyService.search_policies(query, limit=3)
    if not results or "No policies found" in results:
        return "No relevant policy found for that query."
    return results


@tool
def get_leave_balance(state: Annotated[dict, InjectedState]):
    """Get the current user's leave balance across all leave types.
    Call immediately when the user asks about remaining leaves, CL, EL, SL, etc."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return HRService.get_leave_balance(email)


@tool
def apply_leave(
    start_date: str,
    end_date: str,
    leave_type: str,
    reason: str,
    state: Annotated[dict, InjectedState],
):
    """Apply for leave. Call when the user explicitly wants to submit a leave request.
    start_date and end_date must be YYYY-MM-DD. leave_type must be one of the types
    shown in their balance (e.g. 'Casual Leave', 'Earned Leave'). Ask for reason if missing."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return HRService.apply_leave(
        email=email,
        start_date=start_date,
        end_date=end_date,
        leave_type=leave_type,
        reason=reason,
    )


@tool
def submit_hr_query(
    category: str,
    subject: str,
    description: str,
    state: Annotated[dict, InjectedState],
):
    """Raise an HR query ticket (payroll discrepancy, attendance correction, tax queries, etc.).
    category examples: Payroll, Attendance, Tax, Benefits, General.
    Use the user's own words for subject and description."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    from app.services import actions  # routed through the action registry spine
    return actions.run("hr_query", actor_email=email, category=category,
                       subject=subject, description=description).human_message


@tool
def submit_grievance(
    category: str,
    description: str,
    is_anonymous: bool,
    state: Annotated[dict, InjectedState],
):
    """Submit an employee grievance to HR. is_anonymous=true hides the employee's identity.
    Call when the user describes workplace issues, harassment, or unfair treatment."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return HRService.submit_grievance(
        email=email,
        category=category,
        description=description,
        is_anonymous=is_anonymous,
    )


@tool
def get_team_absence(
    from_date: str,
    to_date: str,
    state: Annotated[dict, InjectedState],
):
    """Get team absence summary for a date range. Only valid for managers.
    from_date and to_date must be YYYY-MM-DD."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    return HRService.get_team_absence(
        manager_email=email,
        from_date_str=from_date,
        to_date_str=to_date,
    )


@tool
def onboarding_status(state: Annotated[dict, InjectedState]):
    """Show the user's onboarding progress and what to do next.
    Call when a new joiner asks 'what's next in my onboarding', 'how do I get set up',
    'what do I still need to do', or about their onboarding checklist/steps."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    from app.services import onboarding_service as ob
    view = ob.get_for_employee(email)
    if not view:
        return "I couldn't find an employee record for your account, so there's no onboarding journey yet."

    pct = view.get("progress_pct", 0)
    steps = view.get("steps", [])
    done = [s for s in steps if s["status"] in ("done", "skipped")]
    pending = [s for s in steps if s["status"] not in ("done", "skipped")]

    if view.get("status") == "completed":
        return f"🎉 You're all set — your onboarding is **100% complete**. Nice work!"

    lines = [f"**Your onboarding — {pct}% complete** ({len(done)}/{len(steps)} steps done)\n"]
    nxt_key = view.get("next_step")
    nxt = next((s for s in steps if s["key"] == nxt_key), None)
    if nxt:
        lines.append(f"👉 **Next up: {nxt['title']}** — {nxt['description']}")
    if len(pending) > 1:
        rest = [s["title"] for s in pending if s["key"] != nxt_key]
        if rest:
            lines.append("\nStill to do: " + ", ".join(rest) + ".")
    lines.append("\nOpen the **Onboarding** page to work through each step.")
    return "\n".join(lines)


_tools = [
    search_policy,
    get_leave_balance,
    apply_leave,
    submit_hr_query,
    submit_grievance,
    get_team_absence,
    onboarding_status,
]
_tool_node = ToolNode(_tools)

# Read-only tools whose output is display-ready — skip the LLM re-read
_PASSTHROUGH_TOOLS = {"get_leave_balance", "get_team_absence", "onboarding_status"}


# ── Agent Node ─────────────────────────────────────────────────────────────────

def hr_assistant(state: HRState):
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    default_prompt = (
        f"You are the HR Assistant for Aligned Automation.\n"
        f"Employee: {user_email}. Never ask for their email.\n"
        f"ALWAYS respond directly in first person. NEVER write a simulated dialogue or script.\n\n"
        f"Tool routing — act immediately:\n"
        f"  Policy / rules question → search_policy\n"
        f"  Leave balance query     → get_leave_balance\n"
        f"  Apply / submit leave    → apply_leave (confirm dates + type first if missing)\n"
        f"  Payroll / attendance issue → submit_hr_query\n"
        f"  Workplace grievance     → submit_grievance\n"
        f"  Team absence (manager)  → get_team_absence\n\n"
        f"Answer ONLY from tool results. Never invent policy details or leave balances.\n"
        f"FORMATTING: Use bullet points for lists, **bold** for key terms, short paragraphs.\n"
        f"Lead with a 1-2 sentence direct answer, then add relevant details.\n"
        f"Never paste raw policy text verbatim — synthesize and answer the specific question.\n"
        f"If a tool returns no result, say so and offer to raise an HR query.\n"
    )
    base_prompt = PromptService.get_system_prompt("hr", default_prompt)
    guardrail = PromptService.get_guardrail("hr")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    response = resilient_invoke("agent", messages,
                                build=lambda l: l.bind_tools(_tools),
                                default_timeout=45)
    return {"messages": [response]}


def _should_continue(state: HRState):
    last = state["messages"][-1]
    if getattr(last, "tool_calls", None):
        return "tools"
    return END


def _route_after_tools(state: HRState):
    last = state["messages"][-1]
    if isinstance(last, ToolMessage) and getattr(last, "name", "") in _PASSTHROUGH_TOOLS:
        return "passthrough"
    return "hr_assistant"


def _passthrough(state: HRState):
    """Emit tool result verbatim — no LLM needed for simple data lookups."""
    last = state["messages"][-1]
    return {"messages": [AIMessage(content=(getattr(last, "content", "") or "").strip())]}


# ── Graph ──────────────────────────────────────────────────────────────────────

_workflow = StateGraph(HRState)
_workflow.add_node("hr_assistant", hr_assistant)
_workflow.add_node("tools", _tool_node)
_workflow.add_node("passthrough", _passthrough)
_workflow.set_entry_point("hr_assistant")
_workflow.add_conditional_edges("hr_assistant", _should_continue, ["tools", END])
_workflow.add_conditional_edges("tools", _route_after_tools, ["passthrough", "hr_assistant"])
_workflow.add_edge("passthrough", END)

hr_agent = _workflow.compile()
