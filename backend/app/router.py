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
                       "payroll, salary slips, attendance, HR policies, employee benefits, "
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
                       "asset management (laptops, monitors), password reset, VPN access, laptop issues, "
                       "email access, network connectivity, system access requests",
        "status": "active",
    },
    "pmo": {
        "description": "Project Management Office — company projects, internal projects, active projects, "
                       "AI projects, technology projects, initiatives the company is working on, "
                       "project timelines, milestones, resource allocation, sprint planning, JIRA tickets, "
                       "project status, risk management, deliverables, stakeholder updates, budget tracking, "
                       "status reports, PDF generation, sprint summaries, meeting minutes, session transcripts",
        "status": "active",
    },
    "functional_manager": {
        "description": "Functional Manager & Team Lead — team management, attendance tracking, "
                       "leave approvals, training assignments, skill assessments, performance feedback, "
                       "employee project history, 1-on-1 scheduling, task delegation",
        "status": "active",
    },
    "general": {
        "description": "General conversation — greetings, small talk, unclear requests, "
                       "questions about the AI assistant itself (Centriq), capabilities inquiry, thank you, goodbye. "
                       "NOT for questions about company projects, internal tools, or employee matters.",
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

Your ONLY job is to read the user's message and classify it into exactly ONE domain.

Available domains:
{domain_descriptions}

RULES:
1. Respond with ONLY a valid JSON object. No explanation, no markdown, no extra text.
2. The JSON must have exactly these keys: "domain", "confidence", "reasoning"
3. "domain" must be one of: {list(DOMAIN_REGISTRY.keys())}
4. "confidence" must be a float between 0.0 and 1.0
5. "reasoning" is a one-sentence explanation of your classification
6. If the intent is unclear or ambiguous, use "general"
7. If the user mentions multiple domains, pick the PRIMARY one

Example response:
{{"domain": "hr", "confidence": 0.95, "reasoning": "User is asking about their leave balance which is an HR function."}}
"""


# ── Router LLM ───────────────────────────────────────────────────────────────

_router_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=0,
    max_tokens=200,
)


def classify_intent(user_message: str) -> dict:
    """
    Classify a user message into a domain.

    Returns:
        dict with keys: domain, confidence, reasoning
    """
    system = SystemMessage(content=_build_router_prompt())
    human = HumanMessage(content=user_message)

    try:
        response = _router_llm.invoke([system, human])
        raw = response.content.strip()

        # Try to extract JSON from the response (model may wrap it in markdown)
        if "```" in raw:
            # Extract content between code fences
            import re
            match = re.search(r'```(?:json)?\s*(.*?)```', raw, re.DOTALL)
            if match:
                raw = match.group(1).strip()

        result = json.loads(raw)

        # Validate domain
        domain = result.get("domain", "general")
        if domain not in DOMAIN_REGISTRY:
            domain = "general"

        return {
            "domain": domain,
            "confidence": float(result.get("confidence", 0.5)),
            "reasoning": result.get("reasoning", "No reasoning provided"),
        }

    except (json.JSONDecodeError, Exception) as e:
        print(f"[Router] Classification failed: {e}. Falling back to 'general'.")
        return {
            "domain": "general",
            "confidence": 0.3,
            "reasoning": f"Classification failed ({str(e)[:80]}), defaulting to general.",
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
