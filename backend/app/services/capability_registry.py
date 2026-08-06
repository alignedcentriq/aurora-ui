"""Canonical catalog of user-facing assistant capabilities.

ONE source of truth for "what Centriq can do", consumed by three features:
  • capability discovery — role-aware greeting + GET /api/capabilities
  • failed-query / abstention rescue — "here are the nearest things I CAN do"
  • feature-adoption analytics — the denominator: which capabilities exist, and
    which (domain, sub_intent) usage in AiRequestLog maps to each.

Keep this curated and human-readable: it is both the front door for discovery
AND the yardstick for adoption. Each capability declares the router `domain` and
the `sub_intents` that count as "used", so analytics can count unique users per
capability without a second registry drifting out of sync.
"""
from dataclasses import dataclass, field
from typing import Optional
import re
import time

# Roles in the system. A capability with roles=None is visible to everyone.
ALL_ROLES = {"employee", "manager", "hr", "it", "pmo", "admin"}


@dataclass(frozen=True)
class Capability:
    key: str                       # stable id; the analytics primary key
    title: str                     # imperative, user-facing ("Check your leave balance")
    description: str               # one line
    category: str                  # grouping for the discovery UI
    examples: tuple[str, ...]      # tap-to-run phrases (also the suggestion chips)
    domain: str                    # primary router domain (discovery + rescue bias)
    # Analytics mapping: the (domain, sub_intent) pairs in AiRequestLog that count
    # as "used this capability". A capability can span domains (e.g. leave flows
    # through both `hr` and `deeplink`). sub_intent "*" matches ANY sub_intent in
    # that domain (use sparingly — it also claims null-sub_intent rows). Calibrated
    # against real logged traffic, not guesses; check the Observability "Feature
    # Adoption > Unmapped traffic" table when retuning.
    usage: tuple[tuple[str, str], ...] = ()
    roles: Optional[frozenset] = None   # who can see it; None = everyone

    def visible_to(self, role: Optional[str]) -> bool:
        if self.roles is None:
            return True
        r = (role or "employee").strip().lower()
        # admin sees everything; otherwise the role must be listed.
        return r == "admin" or r in self.roles

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "examples": list(self.examples),
            "domain": self.domain,
        }


def _r(*roles: str) -> frozenset:
    return frozenset(roles)


# ── The catalog ───────────────────────────────────────────────────────────────
# Ordered roughly by how commonly an employee reaches for each — the greeting and
# discovery UI surface the first few visible to the user's role.
CAPABILITIES: tuple[Capability, ...] = (
    Capability(
        key="leave_balance", title="Check your leave balance",
        description="See how many casual, earned, and sick leaves you have left.",
        category="Time off",
        examples=("What's my leave balance?", "How many casual leaves do I have left?"),
        domain="hr",
        usage=(("hr", "leave_balance"), ("deeplink", "leave_balance")),
    ),
    Capability(
        key="apply_leave", title="Apply for leave",
        description="Start a leave request and hand off to the Zoho People form.",
        category="Time off",
        examples=("Apply for casual leave next Monday", "I want to take leave on Friday"),
        domain="hr",
        usage=(("hr", "leave_application"), ("deeplink", "submit_leave"),
               ("deeplink", "apply_leave"), ("deeplink", "leave_request_form")),
    ),
    Capability(
        key="cancel_leave", title="Cancel a leave",
        description="Withdraw a leave you applied for; approved leaves restore your balance.",
        category="Time off",
        examples=("Cancel my leave on the 14th", "Withdraw my pending leave"),
        domain="hr",
        usage=(("hr", "cancel_leave"),),
    ),
    Capability(
        key="holidays", title="See the holiday calendar",
        description="Check upcoming public and company holidays.",
        category="Time off",
        examples=("What are the holidays this month?", "When is the next holiday?"),
        domain="hr",
        usage=(("hr", "holidays"),),
    ),
    Capability(
        key="onboarding", title="Continue your onboarding",
        description="See your onboarding progress, the next step, and your joining documents.",
        category="HR & policy",
        examples=("What's next in my onboarding?", "Show my onboarding checklist"),
        domain="hr",
        usage=(("hr", "onboarding_status"),),
    ),
    Capability(
        key="hr_policy", title="Ask an HR policy question",
        description="Get answers from the company's HR and admin policy documents.",
        category="HR & policy",
        examples=("What's the maternity leave policy?", "How does the referral bonus work?"),
        domain="hr",
        usage=(("hr", "policy_query"), ("admin", "policy_query"),
               ("hr", "probation_confirmation_period"), ("hr", "salary_credit_date")),
    ),
    Capability(
        key="hr_query", title="Raise an HR query",
        description="Log a request to HR — payroll, WFH, grievances, referrals.",
        category="HR & policy",
        examples=("I want to raise a grievance", "I need to request work from home"),
        domain="hr",
        usage=(("hr", "grievance"), ("hr", "work_from_home_request"),
               ("hr", "employee_referral")),
    ),
    Capability(
        key="hr_document", title="Generate an HR document",
        description="Download an experience certificate, NOC, relieving letter, etc.",
        category="HR & policy",
        examples=("Generate my experience certificate", "I need a no-objection certificate"),
        domain="document",
        usage=(("document", "*"), ("hr", "document_request")),
    ),
    Capability(
        key="payslip", title="Get your payslip",
        description="Retrieve your latest salary slip.",
        category="HR & policy",
        examples=("Get my latest payslip", "Download my salary slip"),
        domain="deeplink",
        usage=(("deeplink", "retrieve_payslip"),),
    ),
    Capability(
        key="it_ticket", title="Raise an IT ticket",
        description="Report an IT or hardware problem and track it to resolution.",
        category="IT",
        examples=("My VPN keeps dropping", "Raise a ticket — laptop won't boot"),
        domain="it_support",
        usage=(("it_support", "create_ticket"), ("it_support", "ticket_request"),
               ("it_support", "hardware_issue"), ("it_support", "it_howto")),
    ),
    Capability(
        key="software_install", title="Request software",
        description="Ask for an app to be installed or licensed on your machine.",
        category="IT",
        examples=("I need Photoshop installed", "Request a Power BI license"),
        domain="it_support",
        usage=(("it_support", "software_install"), ("it_support", "license_request")),
    ),
    Capability(
        key="it_assets", title="See your IT assets & tickets",
        description="View the devices assigned to you and your open IT tickets.",
        category="IT",
        examples=("What assets are assigned to me?", "Show my open IT tickets"),
        domain="it_support",
        usage=(("it_support", "my_tickets"), ("it_support", "asset_request")),
    ),
    Capability(
        key="reimbursement", title="Check a reimbursement",
        description="See the status of an expense reimbursement.",
        category="Money & admin",
        examples=("What's the status of my reimbursement?", "Did my travel expense get approved?"),
        domain="admin",
        usage=(("admin", "reimbursement_status"),),
    ),
    Capability(
        key="parking", title="Parking",
        description="Parking stickers and charges.",
        category="Money & admin",
        examples=("How do I get a parking sticker?", "What are the parking charges?"),
        domain="admin",
        usage=(("admin", "parking_sticker"), ("admin", "parking_charges")),
    ),
    Capability(
        key="visitor_pass", title="Request a visitor pass",
        description="Arrange a gate pass for a guest or visitor.",
        category="Money & admin",
        examples=("I have a visitor coming tomorrow", "Request a visitor pass"),
        domain="admin",
        usage=(("admin", "visitor_pass"),),
    ),
    Capability(
        key="facility_issue", title="Report a facility issue",
        description="Log a complaint about the office facilities.",
        category="Money & admin",
        examples=("The AC isn't working on the 3rd floor", "Report a facility issue"),
        domain="admin",
        usage=(("admin", "facility_complaint"),),
    ),
    Capability(
        key="book_room", title="Book a meeting room",
        description="Check availability and reserve a meeting room.",
        category="Money & admin",
        examples=("Is meeting room 2 free this afternoon?", "Book a room for 3pm today"),
        domain="ms365",
        usage=(("ms365", "room_availability"),),
    ),
    Capability(
        key="find_app", title="Find the right portal or tool",
        description="Point you to the internal app, form, or portal for a task.",
        category="Getting around",
        examples=("Where do I book travel?", "Which portal do I use for timesheets?"),
        domain="hr",
        usage=(("hr", "form_request"), ("admin", "form_request")),
    ),
    Capability(
        key="company_info", title="Ask about the company",
        description="General company information, locations, and clients.",
        category="Getting around",
        examples=("Where are our offices?", "Tell me about the company"),
        domain="general",
        usage=(("general", "company_info"), ("general", "location_query"),
               ("admin", "client_list")),
    ),
    Capability(
        key="who_is", title="Look someone up",
        description="Find a colleague's role, department, manager, and skills.",
        category="People",
        examples=("Who is Priya Sharma?", "Find people who know AWS"),
        domain="hr",
        usage=(("hr", "employee_search"), ("hr", "employee_salary")),
    ),
    Capability(
        key="org_chart", title="See a team or org chart",
        description="View the reporting chain and direct reports for anyone.",
        category="People",
        examples=("Show me the org chart for engineering", "Who reports to Mona Manager?"),
        domain="hr",
        usage=(("hr", "team_structure"), ("functional_manager", "team_structure")),
    ),
    # ── Manager / leader capabilities ─────────────────────────────────────────
    Capability(
        key="team_attendance", title="Check your team's attendance",
        description="See attendance summaries for your direct reports.",
        category="My team",
        examples=("Show attendance for my team this month", "How many days was Riya in office?"),
        domain="hr",
        usage=(("hr", "attendance"),),
        roles=_r("manager", "hr"),
    ),
    Capability(
        key="team_absence", title="See who's on leave",
        description="Team absence summary for a date range.",
        category="My team",
        examples=("Who on my team is on leave this week?", "Team absence for next Monday"),
        domain="hr",
        usage=(("hr", "team_absence"),),
        roles=_r("manager", "hr"),
    ),
    Capability(
        key="approvals", title="Review pending approvals",
        description="See and act on leave requests waiting for your approval.",
        category="My team",
        examples=("Do I have any approvals pending?", "Show leave requests waiting on me"),
        domain="functional_manager",
        usage=(("functional_manager", "pending_approvals"), ("functional_manager", "approvals")),
        roles=_r("manager", "hr"),
    ),
    # ── PMO ───────────────────────────────────────────────────────────────────
    Capability(
        key="project_status", title="Check project & allocations",
        description="Project status, staffing, and resource allocation.",
        category="Projects",
        examples=("What's the status of the Atlas project?", "Who is allocated to Atlas?"),
        domain="pmo",
        usage=(("pmo", "list_projects"), ("pmo", "project_summary"),
               ("pmo", "project_status"), ("general", "project_status")),
        roles=_r("pmo", "manager"),
    ),
    Capability(
        key="udemy_license", title="Request a Udemy license",
        description="Ask for a Udemy (training) license for upskilling.",
        category="Projects",
        examples=("I need a Udemy license", "Request access to a Udemy course"),
        domain="pmo",
        usage=(("pmo", "udemy_license"),),
        roles=_r("pmo", "manager"),
    ),
    Capability(
        key="resource_match", title="Find people for a project",
        description="Match available people to a skill need for staffing.",
        category="Projects",
        examples=("Who's free who knows React?", "Find an available data engineer"),
        domain="pmo",
        usage=(("pmo", "resource_match"), ("pmo", "availability")),
        roles=_r("pmo", "manager"),
    ),
)

_BY_KEY = {c.key: c for c in CAPABILITIES}


# ── Skill / Mode dispatch spine (ARB #45) ────────────────────────────────────
# Replaces the hardcoded ``_MODE_ROUTES`` dict in agent.py with a declarative
# registry.  Each focus mode is a ``SkillSpec`` that declares not just the
# routing target but also the retrieval scope, the available tool groups, a
# prompt fragment that nudges tool selection, required permissions, and the
# risk class for the action-safety layer.
#
# Migration:  ``_active_mode_strategy`` in agent.py reads from
# ``SKILL_REGISTRY.route_for_mode()`` instead of the hardcoded dict.
# New skills are added here (data) rather than as code branches.

@dataclass(frozen=True)
class SkillSpec:
    """Declarative skill definition for a focus mode.

    key          — stable id matching the active_mode string ("analytics" etc.)
    domain       — LangGraph routing domain
    sub_intent   — LangGraph sub-intent
    display_name — human-readable name shown in the UI / greeting
    retrieval_scope — which policy/document categories to include in RAG
                      (None = default scope for the domain)
    tool_groups  — names of tool groups the agent should prefer (hints only;
                   the full tool list is always available for safety)
    prompt_fragment — appended to the system prompt to nudge tool selection
    roles        — frozenset of roles that may enter this mode, or None = all
    risk_class   — "read", "low", "medium", "high" — informs confirmation gates
    """
    key: str
    domain: str
    sub_intent: str
    display_name: str
    retrieval_scope: Optional[tuple[str, ...]] = None
    tool_groups: tuple[str, ...] = ()
    prompt_fragment: str = ""
    roles: Optional[frozenset] = None
    risk_class: str = "read"


SKILL_REGISTRY: tuple[SkillSpec, ...] = (
    SkillSpec(
        key="analytics",
        domain="analytics",
        sub_intent="builder",
        display_name="Analytics Builder",
        tool_groups=("analytics",),
        prompt_fragment=(
            "[ACTIVE MODE: Analytics Builder] The user has activated Analytics Builder mode. "
            "Prioritise structured metric queries, chart generation, and the analytics catalog. "
            "Do not answer free-form conversational questions — redirect to analytics tools."
        ),
        roles=_r("hr", "manager", "pmo", "admin"),
        risk_class="read",
    ),
    SkillSpec(
        key="training",
        domain="pmo",
        sub_intent="training",
        display_name="Learning Advisor",
        retrieval_scope=("PMO",),
        tool_groups=("udemy", "techelevate", "skill_gap"),
        prompt_fragment=(
            "[ACTIVE MODE: Learning Advisor] The user has activated Learning Advisor mode. "
            "Prioritise course recommendations (Udemy, TechElevate), skill gap analysis, "
            "and learning plans."
        ),
        risk_class="read",
    ),
    SkillSpec(
        key="project",
        domain="pmo",
        sub_intent="project_iq",
        display_name="Project IQ",
        retrieval_scope=("Project Showcase",),
        tool_groups=("project_iq",),
        prompt_fragment=(
            "[ACTIVE MODE: Project IQ] The user has activated Project IQ mode. "
            "Prioritise project insights, similar project discovery, lessons learned, "
            "SME identification, and reusable assets."
        ),
        roles=_r("pmo", "manager", "admin"),
        risk_class="read",
    ),
    SkillSpec(
        key="resource",
        domain="hr",
        sub_intent="resource_match",
        display_name="Resource Finder",
        tool_groups=("resource_match", "skill_supply"),
        prompt_fragment=(
            "[ACTIVE MODE: Resource Finder] The user has activated Resource Finder mode. "
            "Prioritise skill-to-availability matching, bench status, and staffing recommendations."
        ),
        roles=_r("pmo", "manager", "admin"),
        risk_class="read",
    ),
    SkillSpec(
        key="me",
        domain="ms365",
        sub_intent="personal",
        display_name="My Workspace",
        tool_groups=("ms365_email", "ms365_teams", "ms365_community"),
        prompt_fragment=(
            "[ACTIVE MODE: My Workspace] The user has activated My Workspace mode. "
            "Prioritise their personal Microsoft 365 delegated actions: send email, post to a "
            "Teams channel or Viva Engage community, send a Teams message, create a group chat, "
            "and read their own inbox/calendar/Teams chats."
        ),
        risk_class="medium",
    ),
)

_SKILL_BY_KEY: dict[str, SkillSpec] = {s.key: s for s in SKILL_REGISTRY}


def get_skill(mode_key: str) -> Optional[SkillSpec]:
    """Return the SkillSpec for the given active_mode key, or None."""
    return _SKILL_BY_KEY.get(mode_key)


def route_for_mode(mode_key: str) -> Optional[tuple[str, str, str]]:
    """Return (domain, sub_intent, prompt_fragment) for the given mode, or None.

    This replaces the hardcoded ``_MODE_ROUTES`` dict in agent.py (ARB #45).
    Returns None for unknown modes so callers can fall through to the normal
    routing pipeline.
    """
    skill = _SKILL_BY_KEY.get((mode_key or "").strip())
    if not skill:
        return None
    return skill.domain, skill.sub_intent, skill.prompt_fragment

_STOPWORDS = {
    "the", "a", "an", "my", "me", "i", "is", "are", "do", "does", "to", "for",
    "of", "in", "on", "at", "how", "what", "whats", "can", "you", "your", "and",
    "with", "about", "any", "have", "has", "get", "show", "need", "want", "this",
    "it", "please", "help",
}


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if t not in _STOPWORDS}


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def get(key: str) -> Optional[Capability]:
    return _BY_KEY.get(key)


def all_capabilities() -> tuple[Capability, ...]:
    """Every capability — the adoption-analytics denominator."""
    return CAPABILITIES


def _usage_match(cap: Capability, d: str, si: str) -> bool:
    """True if this capability's `usage` (domain,sub_intent) pairs claim (d, si) —
    the same exact/wildcard rule adoption_service.py uses to compute adoption %."""
    exact = {(_norm(cd), _norm(csi)) for cd, csi in cap.usage if csi != "*"}
    wildcard_domains = {_norm(cd) for cd, csi in cap.usage if csi == "*"}
    return (d, si) in exact or d in wildcard_domains


def capability_for_usage(domain: Optional[str], sub_intent: Optional[str] = None) -> Optional[str]:
    """The capability key whose `usage` claims this (domain, sub_intent), or None.
    Used by Memory Brain to cross-link a leaf to the Feature Adoption capability it feeds."""
    d, si = _norm(domain), _norm(sub_intent)
    for cap in all_capabilities():
        if _usage_match(cap, d, si):
            return cap.key
    return None


def short_label(domain: Optional[str], sub_intent: Optional[str] = None) -> str:
    """A 1-3 word human label for a (domain, sub_intent) pair — for places (Memory Brain
    leaves) that need a scannable tag instead of raw routing internals.

    1. exact (domain, sub_intent) match against SKILL_REGISTRY -> its display_name
       ("pmo","project_iq") -> "Project IQ". Only applied when sub_intent is given —
       matching on domain alone would be ambiguous (several skills share a domain).
    2. domain[,sub_intent] match against Capability.usage (same exact/wildcard logic
       adoption_service.py uses) -> its short category ("Time off", "IT Support").
    3. humanized raw domain string as a last resort ("it_support" -> "IT Support").
    """
    d, si = _norm(domain), _norm(sub_intent)

    if si:
        for skill in SKILL_REGISTRY:
            if _norm(skill.domain) == d and _norm(skill.sub_intent) == si:
                return skill.display_name

    for cap in all_capabilities():
        if _usage_match(cap, d, si):
            return cap.category

    if not d:
        return "General"
    known = {"hr": "HR", "it_support": "IT Support", "it": "IT", "pmo": "PMO",
             "ms365": "MS365", "admin": "Admin", "general": "General",
             "functional_manager": "Functional Manager",
             "project_iq": "Project IQ", "skill_supply": "Skill Supply",
             "workforce": "Workforce"}
    return known.get(d, d.replace("_", " ").replace(":", " ").title())


# ── Published connectors as capabilities (discovery only — NOT the adoption denominator) ──
# Each published connector surfaces as one "agent" in discovery, with its top seeded questions
# as starters and role visibility derived from its ConnectorScope role rows. Cached briefly so
# greetings / GET /api/capabilities don't hit the DB on every call.
_CONN_CACHE: tuple[float, tuple[Capability, ...]] = (0.0, ())
_CONN_CACHE_TTL = 60.0


def _connector_capabilities() -> tuple[Capability, ...]:
    global _CONN_CACHE
    now = time.monotonic()
    if now - _CONN_CACHE[0] < _CONN_CACHE_TTL:
        return _CONN_CACHE[1]
    caps: list[Capability] = []
    try:
        from app.database import SessionLocal
        from app.models import Connector, ConnectorScope, RouterExample
        with SessionLocal() as db:
            conns = db.query(Connector).filter(Connector.status == "published").all()
            if conns:
                conn_ids = [c.id for c in conns]
                # Role scopes at connector OR operation level → who may see this connector.
                role_scopes = db.query(ConnectorScope).filter(
                    ConnectorScope.connector_id.in_(conn_ids),
                    ConnectorScope.role.isnot(None),
                ).all()
                roles_by_conn: dict[int, set] = {}
                for s in role_scopes:
                    roles_by_conn.setdefault(s.connector_id, set()).add((s.role or "").strip().lower())
                for c in conns:
                    domain = f"connector:{c.slug}"
                    exs = db.query(RouterExample).filter(
                        RouterExample.domain == domain,
                        RouterExample.is_active == True,
                    ).order_by(RouterExample.created_at).limit(4).all()
                    roles = roles_by_conn.get(c.id)
                    caps.append(Capability(
                        key=f"connector_{c.slug}",
                        title=c.name,
                        description=(c.description or f"Ask about {c.name}.")[:140],
                        category="Connected apps",
                        examples=tuple(e.utterance for e in exs),
                        domain=domain,
                        usage=((domain, "*"),),
                        roles=frozenset(roles) if roles else None,
                    ))
    except Exception:
        return _CONN_CACHE[1]  # serve last-known on any error — never break discovery
    result = tuple(caps)
    _CONN_CACHE = (now, result)
    return result


def capabilities_for_role(role: Optional[str]) -> list[Capability]:
    """All capabilities visible to a role, in catalog order — including published connectors."""
    static = [c for c in CAPABILITIES if c.visible_to(role)]
    connectors = [c for c in _connector_capabilities() if c.visible_to(role)]
    return static + connectors


def nearest_capabilities(query: str, role: Optional[str] = None,
                         domain: Optional[str] = None, limit: int = 3) -> list[Capability]:
    """Best-effort "nearest things I CAN do" for a query the assistant couldn't
    answer. Deterministic token-overlap scoring (no embeddings) — fast and stable.
    Same-domain capabilities get a small boost so a domain hint sharpens results.
    Falls back to the role's most common capabilities when nothing overlaps."""
    q = _tokens(query)
    scored: list[tuple[float, int, Capability]] = []
    catalog = CAPABILITIES + _connector_capabilities()
    for idx, c in enumerate(catalog):
        if not c.visible_to(role):
            continue
        hay = _tokens(" ".join((c.title, c.description) + c.examples))
        overlap = len(q & hay)
        score = float(overlap)
        if domain and c.domain == domain:
            score += 0.5
        if score > 0:
            scored.append((score, -idx, c))
    scored.sort(reverse=True)
    picked = [c for _, _, c in scored[:limit]]
    if len(picked) < limit:
        # Pad with the role's top capabilities not already chosen.
        for c in capabilities_for_role(role):
            if c not in picked:
                picked.append(c)
            if len(picked) >= limit:
                break
    return picked[:limit]
