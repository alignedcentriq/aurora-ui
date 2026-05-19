"""
Intent & Domain Router for Centriq AI.

Uses gpt-oss (or configured router model) for fast intent classification.
Routes user messages to the correct domain agent.
"""

import json
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from app.config import settings

# ── Domain Registry ──────────────────────────────────────────────────────────
# Each domain maps to a description used by the router for classification.
# When you build a new agent, register it here.

DOMAIN_REGISTRY = {
    "hr": {
        "description": "Human Resources — leave management, leave balance, leave applications, "
                       "attendance, HR policies, employee benefits, "
                       "onboarding, offboarding, referral bonuses, appraisals, PIP, "
                       "performance reviews, work from home policy, holidays, comp-off",
        "status": "active",
    },
    "admin": {
        "description": "Office Administration — reimbursement (travel, medical, certification, equipment), "
                       "parking sticker (2-wheeler, 4-wheeler), accommodation booking (guest house, hotel), "
                       "facility complaints (housekeeping, electrical, AC), food vendor feedback, cafeteria, "
                       "courier services, ID cards, access management",
        "status": "active",
    },
    "it_support": {
        "description": "IT Support & Helpdesk — software installation (with HITL approval flow), IT tickets, "
                       "asset management (laptops, monitors, keyboards, peripherals), password reset, VPN access, "
                       "laptop issues, email access, network connectivity, system access requests, "
                       "hardware problems (overheating, heating, system getting hot, device too hot, laptop fan loud), "
                       "device performance issues (slow system, system freezing, computer crashing, system hanging, "
                       "laptop not starting, blue screen, system restart), any issue with a computer, machine, "
                       "device, workstation, or IT equipment",
        "status": "active",
    },
    "pmo": {
        "description": "Project Management Office — company projects, internal projects, active projects, "
                       "AI projects, technology projects, initiatives the company is working on, "
                       "project status, completion percentage, project owner, next milestone, "
                       "PDF report generation, project summary, what projects exist",
        "status": "active",
    },
    "functional_manager": {
        "description": "Functional Manager & Team Lead — who is on my team, who reports to me, "
                       "my direct reports, team members, reportees, org structure",
        "status": "active",
    },
}


def _build_router_prompt() -> str:
    """Build the classification prompt dynamically from the domain registry."""
    domain_descriptions = "\n".join(
        f"  - \"{domain}\": {info['description']}"
        for domain, info in DOMAIN_REGISTRY.items()
    )
    return f"""You are an intent classification engine for an enterprise AI assistant called Centriq.

Your ONLY job is to read the user's message and output a JSON classification.

Available domains:
{domain_descriptions}

RULES:
1. Respond with ONLY a valid JSON object. No explanation, no markdown, no extra text.
2. The JSON must have exactly these keys: "domain", "confidence", "reasoning", "sub_intent", "entities"
3. "domain" must be one of: {list(DOMAIN_REGISTRY.keys())}
4. "confidence" must be a float between 0.0 and 1.0
5. "reasoning" is a one-sentence explanation of your classification
6. "sub_intent" is a short snake_case label for the specific action (e.g. "software_install", "leave_balance", "ticket_status", "parking_sticker", "team_attendance")
7. "entities" is a JSON object of key entities extracted from the message (e.g. {{"software_name": "Node.js"}}, {{"ticket_id": "IT-123"}}, {{"leave_type": "sick"}}) — use {{}} if none
8. If the intent is unclear or ambiguous, use "general" with confidence below 0.6
9. If the user mentions multiple domains, pick the PRIMARY one

Example responses:
{{"domain": "it_support", "confidence": 0.97, "reasoning": "User wants to install Node.js, which is a software installation request.", "sub_intent": "software_install", "entities": {{"software_name": "Node.js"}}}}
{{"domain": "it_support", "confidence": 0.95, "reasoning": "User reports their system is heating up, which is a hardware/device issue handled by IT support.", "sub_intent": "hardware_issue", "entities": {{"issue_type": "overheating"}}}}
{{"domain": "it_support", "confidence": 0.93, "reasoning": "User's laptop is slow/freezing, which is a device performance issue for IT support.", "sub_intent": "hardware_issue", "entities": {{"issue_type": "performance"}}}}
{{"domain": "hr", "confidence": 0.95, "reasoning": "User is asking about their leave balance.", "sub_intent": "leave_balance", "entities": {{}}}}
{{"domain": "pmo", "confidence": 0.98, "reasoning": "User wants to see all projects in the organization.", "sub_intent": "list_projects", "entities": {{}}}}
{{"domain": "pmo", "confidence": 0.98, "reasoning": "User is asking which projects exist in the company.", "sub_intent": "list_projects", "entities": {{}}}}
{{"domain": "pmo", "confidence": 0.97, "reasoning": "User wants the current status of a specific project.", "sub_intent": "project_status", "entities": {{"project_name": "Aurora UI"}}}}
{{"domain": "pmo", "confidence": 0.96, "reasoning": "User wants to know achievements of a specific project.", "sub_intent": "project_achievements", "entities": {{"project_name": "Centriq AI"}}}}
{{"domain": "pmo", "confidence": 0.96, "reasoning": "User wants a downloadable PDF report for all projects.", "sub_intent": "generate_report", "entities": {{"project_name": "all"}}}}
{{"domain": "pmo", "confidence": 0.96, "reasoning": "User wants a PDF report for a specific project.", "sub_intent": "generate_report", "entities": {{"project_name": "HR Integration"}}}}
{{"domain": "admin", "confidence": 0.95, "reasoning": "User asking about certification reimbursement policy — admin handles reimbursement policy information.", "sub_intent": "policy_query", "entities": {{"policy_topic": "certification reimbursement"}}}}
{{"domain": "admin", "confidence": 0.93, "reasoning": "User asking about travel expense policy — admin handles expense and reimbursement policies.", "sub_intent": "policy_query", "entities": {{"policy_topic": "travel expense"}}}}
{{"domain": "hr", "confidence": 0.94, "reasoning": "User asking about leave policy — HR handles leave and attendance policies.", "sub_intent": "policy_query", "entities": {{"policy_topic": "leave"}}}}
{{"domain": "general", "confidence": 0.5, "reasoning": "Ambiguous greeting with no clear domain.", "sub_intent": "greeting", "entities": {{}}}}
"""


# ── Router LLM ───────────────────────────────────────────────────────────────

_router_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=0,
    max_tokens=350,  # increased to support entities + sub_intent fields
)


def classify_intent(user_message: str) -> dict:
    """
    Classify a user message into a domain with sub-intent and entity extraction.

    Returns:
        dict with keys: domain, confidence, reasoning, sub_intent, entities
    """
    system = SystemMessage(content=_build_router_prompt())
    human = HumanMessage(content=user_message)

    try:
        response = _router_llm.invoke([system, human])
        raw = response.content.strip()

        if "```" in raw:
            import re
            match = re.search(r'```(?:json)?\s*(.*?)```', raw, re.DOTALL)
            if match:
                raw = match.group(1).strip()

        result = json.loads(raw)

        domain = result.get("domain", "general")
        if domain not in DOMAIN_REGISTRY:
            domain = "general"

        entities = result.get("entities", {})
        if not isinstance(entities, dict):
            entities = {}

        return {
            "domain": domain,
            "confidence": float(result.get("confidence", 0.5)),
            "reasoning": result.get("reasoning", "No reasoning provided"),
            "sub_intent": result.get("sub_intent", "unknown"),
            "entities": entities,
        }

    except (json.JSONDecodeError, Exception) as e:
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
