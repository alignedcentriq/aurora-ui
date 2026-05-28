"""
Intent & Domain Router for Centriq AI.

Uses gpt-oss (or configured router model) for fast intent classification.
Routes user messages to the correct domain agent.
"""

from pydantic import BaseModel, Field
from typing import Literal
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from app.config import settings
from app.services.policy_service import _expand_query

# ── Domain Registry ──────────────────────────────────────────────────────────
# Each domain maps to a description used by the router for classification.
# When you build a new agent, register it here.

DOMAIN_REGISTRY = {
    "hr": {
        "description": "Human Resources — attendance, HR policies, employee benefits, onboarding, "
                       "offboarding, referral bonuses, appraisals, PIP, performance reviews, "
                       "work from home policy, holidays, comp-off. "
                       "Do NOT use for leave balance queries or leave applications — both go through Zoho (deeplink).",
        "status": "active",
    },
    "admin": {
        "description": "Office Administration — reimbursement (travel, medical, certification, equipment), "
                       "parking sticker (2-wheeler, 4-wheeler), accommodation booking (guest house, hotel), "
                       "facility complaints (housekeeping, electrical, AC), food vendor feedback, cafeteria, "
                       "courier services, ID cards, access management, desk key requests, desk assignments, "
                       "Bookshelf Buddy — company library, borrow a book, issue a book, return a book, "
                       "what books are available, check book request status",
        "status": "active",
    },
    "it_support": {
        "description": "IT Support & Helpdesk — software installation (with HITL approval flow), IT tickets, "
                       "asset management (laptops, monitors, keyboards, peripherals, headphones, headset), "
                       "password reset, VPN access, laptop issues, email access, network connectivity, "
                       "system access requests, hardware problems (overheating, heating, system getting hot, "
                       "device too hot, laptop fan loud), device performance issues (slow system, system freezing, "
                       "computer crashing, system hanging, laptop not starting, blue screen, system restart), "
                       "any issue with a computer, machine, device, workstation, or IT equipment, "
                       "requesting software licenses (Claude, GitHub Copilot, Loveable), "
                       "requesting hardware peripherals (monitor, mouse, keyboard, headset, headphones), "
                       "checking what licenses or assets are assigned to me",
        "status": "active",
    },
    "pmo": {
        "description": "Project Management Office — company projects, internal projects, active projects, "
                       "AI projects, technology projects, initiatives the company is working on, "
                       "project status, completion percentage, project owner, next milestone, "
                       "PDF report generation, project summary, what projects exist, "
                       "managing Udemy training licenses — assigning seats, checking who has access, "
                       "revoking expired Udemy licenses",
        "status": "active",
    },
    "functional_manager": {
        "description": "Functional Manager & Team Lead — who is on my team, who reports to me, "
                       "my direct reports, team members, reportees, org structure. "
                       "Do NOT use for meeting rooms or conference room booking — those go to ms365.",
        "status": "active",
    },
    "ms365": {
        "description": "Microsoft 365 & Viva Engage — reading emails from Outlook inbox, sending emails via Outlook, "
                       "checking calendar events, finding meetings by date or keyword, "
                       "meeting rooms and conference rooms (list rooms, check availability, book a room), "
                       "reading Teams chat messages, reading Teams channel messages, posting to Teams channels, "
                       "reading Yammer/Viva Engage feed, listing communities, reading community posts, posting to communities. "
                       "Use for: 'show my emails', 'send an email to X', 'what meetings do I have today', "
                       "'check my calendar for next week', 'read my Teams messages', 'any emails from John', "
                       "'which rooms are free at 3pm', 'book conference room', 'is room X available tomorrow', "
                       "'show my Yammer feed', 'my communities', 'posts in X community', 'post to X community'. "
                       "Do NOT use for email access issues (password reset, can't login) — those go to it_support.",
        "status": "active",
    },
    "deeplink": {
        "description": "External portal automation — use for: "
                       "(1) Applying/submitting/requesting leave of any type (casual, sick, earned, optional) — these go through Zoho People; "
                       "(2) Checking leave balance — 'how many leaves do I have', 'my leave balance', 'remaining leaves', "
                       "'leave status' — fetches live data from Zoho People (headless); "
                       "(3) Raising/filing/submitting/logging a complaint or ticket in the PowerApps Admin Action Tracker — "
                       "any message where the user wants to formally raise a complaint, report a premises/facility/office issue, "
                       "or submit a ticket; "
                       "(4) Retrieving a payslip from the payroll portal; "
                       "(5) Setup commands: 'setup zoho session', 'setup powerapps session', 'setup payroll session'. "
                       "This is the ONLY domain for all Zoho People interactions (leave applications AND leave balance).",
        "status": "active",
    },
}


# ── Structured Output Schema ──────────────────────────────────────────────────

class RouterOutput(BaseModel):
    """Structured classification output from the intent router."""
    domain: Literal["hr", "admin", "it_support", "pmo", "functional_manager", "ms365", "deeplink", "general"]
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence from 0.0 to 1.0")
    reasoning: str = Field(description="One-sentence explanation of the classification")
    sub_intent: str = Field(description="Short snake_case label for the specific action, e.g. software_install")
    entities: dict = Field(default_factory=dict, description="Key entities extracted from the message")


# ── Router Prompt ─────────────────────────────────────────────────────────────

def _build_router_prompt() -> str:
    """Build the classification prompt dynamically from the domain registry."""
    domain_descriptions = "\n".join(
        f"  - \"{domain}\": {info['description']}"
        for domain, info in DOMAIN_REGISTRY.items()
    )
    return f"""You are an intent classification engine for an enterprise AI assistant called Centriq.

Classify the user's message into the correct domain.

Available domains:
{domain_descriptions}
  - "general": Use when the intent is unclear, ambiguous, or does not fit any domain above.

CLASSIFICATION RULES:
1. If the intent is unclear or ambiguous, use "general" with confidence below 0.6
2. If the user mentions multiple domains, pick the PRIMARY one
3. sub_intent is a short snake_case label for the specific action (e.g. "software_install", "leave_balance", "ticket_status", "parking_sticker", "team_attendance", "document_request", "desk_key_request")
4. entities contains key values extracted from the message (software name, ticket ID, leave type, dates, room name) — use empty dict if none
5. confidence is your certainty: 0.9+ = very clear, 0.7-0.9 = likely, 0.5-0.7 = uncertain, <0.5 = very ambiguous

EXAMPLES:
- "install Node.js" → domain: it_support, sub_intent: software_install, entities: {{"software_name": "Node.js"}}
- "my laptop is overheating" → domain: it_support, sub_intent: hardware_issue, entities: {{"issue_type": "overheating"}}
- "my system is very slow" → domain: it_support, sub_intent: hardware_issue, entities: {{"issue_type": "performance"}}
- "I need a GitHub Copilot license" → domain: it_support, sub_intent: license_request, entities: {{"license_name": "GitHub Copilot"}}
- "request a monitor for my desk" → domain: it_support, sub_intent: asset_request, entities: {{"asset_type": "monitor"}}
- "how many leaves do I have" → domain: deeplink, sub_intent: leave_balance, entities: {{}}
- "apply sick leave from Monday" → domain: deeplink, sub_intent: submit_leave, entities: {{"leave_type": "sick"}}
- "raise a complaint about AC not working" → domain: deeplink, sub_intent: powerapps_complaint, entities: {{"issue": "AC not working"}}
- "certification reimbursement policy" → domain: admin, sub_intent: policy_query, entities: {{"policy_topic": "certification reimbursement"}}
- "I need a parking sticker for my car" → domain: admin, sub_intent: parking_sticker, entities: {{"vehicle_type": "4-wheeler"}}
- "key for desk B-07" → domain: admin, sub_intent: desk_key_request, entities: {{"desk_number": "B-07"}}
- "I need to request a visitor pass" → domain: admin, sub_intent: visitor_pass, entities: {{}}
- "register a guest visiting me tomorrow" → domain: admin, sub_intent: visitor_pass, entities: {{"visit_date": "tomorrow"}}
- "show all company projects" → domain: pmo, sub_intent: list_projects, entities: {{}}
- "who has Udemy licenses" → domain: pmo, sub_intent: list_license_holders, entities: {{"license_name": "Udemy"}}
- "who reports to me" → domain: functional_manager, sub_intent: team_structure, entities: {{}}
- "is Salween room free tomorrow 2-3pm" → domain: ms365, sub_intent: room_availability, entities: {{"room_name": "Salween", "date": "tomorrow", "start_time": "14:00", "end_time": "15:00"}}
- "I need an experience certificate" → domain: hr, sub_intent: document_request, entities: {{"doc_type": "experience_certificate"}}
- "generate an NOC for my visa" → domain: hr, sub_intent: document_request, entities: {{"doc_type": "noc", "purpose": "visa"}}
- "leave policy" → domain: hr, sub_intent: policy_query, entities: {{"policy_topic": "leave"}}
- "hi" → domain: general, sub_intent: greeting, entities: {{}}
"""


# ── Router LLM ───────────────────────────────────────────────────────────────

_router_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=0,
    max_tokens=256,
    timeout=30,
).with_structured_output(RouterOutput)


async def classify_intent_async(user_message: str) -> dict:
    """Async version of classify_intent — uses ainvoke to avoid blocking the event loop."""
    expanded_message, did_you_mean = _expand_query(user_message)
    if expanded_message != user_message:
        print(f"[Router] Query expanded: '{user_message}' → '{expanded_message}'")

    system = SystemMessage(content=_build_router_prompt())
    human = HumanMessage(content=expanded_message)

    try:
        result: RouterOutput = await _router_llm.ainvoke([system, human])

        domain = result.domain
        if domain not in DOMAIN_REGISTRY:
            domain = "general"

        entities = result.entities if isinstance(result.entities, dict) else {}

        return {
            "domain": domain,
            "confidence": result.confidence,
            "reasoning": result.reasoning,
            "sub_intent": result.sub_intent,
            "entities": entities,
        }

    except Exception as e:
        print(f"[Router] Classification failed: {e}. Falling back to 'general'.")
        return {
            "domain": "general",
            "confidence": 0.3,
            "reasoning": f"Classification failed ({str(e)[:80]}), defaulting to general.",
            "sub_intent": "unknown",
            "entities": {},
        }


def classify_intent(user_message: str) -> dict:
    """
    Classify a user message into a domain with sub-intent and entity extraction.

    Returns:
        dict with keys: domain, confidence, reasoning, sub_intent, entities
    """
    expanded_message, did_you_mean = _expand_query(user_message)
    if expanded_message != user_message:
        print(f"[Router] Query expanded: '{user_message}' → '{expanded_message}'")

    system = SystemMessage(content=_build_router_prompt())
    human = HumanMessage(content=expanded_message)

    try:
        result: RouterOutput = _router_llm.invoke([system, human])

        domain = result.domain
        if domain not in DOMAIN_REGISTRY:
            domain = "general"

        entities = result.entities if isinstance(result.entities, dict) else {}

        return {
            "domain": domain,
            "confidence": result.confidence,
            "reasoning": result.reasoning,
            "sub_intent": result.sub_intent,
            "entities": entities,
        }

    except Exception as e:
        print(f"[Router] Classification failed: {e}. Falling back to 'general'.")
        return {
            "domain": "general",
            "confidence": 0.3,
            "reasoning": f"Classification failed ({str(e)[:80]}), defaulting to general.",
            "sub_intent": "unknown",
            "entities": {},
        }


def get_domain_status(domain: str) -> str:
    """Check if a domain agent is active or placeholder."""
    return DOMAIN_REGISTRY.get(domain, {}).get("status", "unknown")


def get_placeholder_response(domain: str) -> str:
    """Return a helpful message for domains that are not yet implemented."""
    domain_labels = {
        "admin": "Office Administration",
        "it_support": "IT Support & Helpdesk",
        "pmo": "Project Management Office",
        "functional_manager": "Functional Manager",
    }
    label = domain_labels.get(domain, domain.replace("_", " ").title())
    return (
        f"I understand you need help with **{label}**. "
        f"This capability is currently being developed and will be available soon. "
        f"In the meantime, please reach out to the {label} team directly, "
        f"or I can help you with HR queries, leave management, or policy information."
    )
