"""Seed utterances for the embedding-based semantic intent router.

Each entry maps an example phrasing to a (domain, sub_intent). At route time the incoming
message is embedded and matched against these by pgvector cosine similarity; the nearest
neighbours decide the domain. The router's output space is therefore the *closed set* of
labels below — it cannot invent a domain the way the generative LLM router does.

Maintenance model: a misroute is fixed by ADDING a labeled example here (or via the runtime
self-learning path), not by writing another brittle regex. Aim for 2-4 natural paraphrases per
intent so each intent occupies a dense, well-separated neighbourhood in embedding space.

These are PHRASINGS, never ANSWERS. Routing only decides which agent runs; the agent still makes
the live Zoho/Graph API call, reads announcements from the DB, and loads its prompt config at
answer time — none of that is affected by this table.

Sources blended here:
  (a) the 45 examples from router.py's LLM prompt (verbatim labels),
  (b) the canonical phrasing behind each _KW_* regex in agent.py,
  (c) hand-written paraphrases + the known misroute traps recorded in project memory.
"""

from typing import TypedDict


class Seed(TypedDict, total=False):
    utterance: str
    domain: str
    sub_intent: str
    entities: dict


# (utterance, domain, sub_intent) tuples — compact; entities are extracted live, so seeds
# rarely carry them. _as_seeds() expands to the Seed dicts consumed by the seeder.
_RAW: list[tuple[str, str, str]] = [
    # ── general ────────────────────────────────────────────────────────────────
    ("hi", "general", "greeting"),
    ("hello there", "general", "greeting"),
    ("hey, good morning", "general", "greeting"),
    ("thanks a lot", "general", "greeting"),
    ("what can you do", "general", "greeting"),
    ("who are you", "general", "greeting"),
    ("tell me about Aligned Automation", "general", "company_info"),
    ("company overview and details", "general", "company_info"),
    ("what is AASPL", "general", "company_info"),

    # ── general: company-project knowledge base (SharePoint Projects tree) ───────
    # Summaries, demo transcripts, project details of delivered work. Kept DISTINCT
    # from pmo/list_projects (status/tracking): these ask about content, not status.
    ("summarize the AIXChange project", "general", "company_projects"),
    ("give me the summary of the onboarding portal project", "general", "company_projects"),
    ("what was demoed for the analytics project", "general", "company_projects"),
    ("show me the demo transcript for project Falcon", "general", "company_projects"),
    ("project details for the data migration work", "general", "company_projects"),
    ("what did we build for the client", "general", "company_projects"),
    ("tell me about the projects we delivered for clients", "general", "company_projects"),
    ("recap of the customer portal project", "general", "company_projects"),

    # ── general: URL library / app directory (admin-registered apps & portals) ───
    # "which app/tool/portal/website do I use for X" — matched against admin-curated
    # AppLink rows by find_apps. Kept generic so new apps need no new seeds.
    ("is there an app for expense reports", "general", "app_directory"),
    ("what tool do I use to book travel", "general", "app_directory"),
    ("where do I go to submit my timesheet", "general", "app_directory"),
    ("is there a portal for raising IT requests", "general", "app_directory"),
    ("what website do I use to apply for leave", "general", "app_directory"),
    ("which application should I use to track my reimbursements", "general", "app_directory"),
    ("do we have a tool for booking meeting rooms", "general", "app_directory"),
    ("link to the employee self service portal", "general", "app_directory"),

    # ── hr: policy ───────────────────────────────────────────────────────────────
    ("leave policy", "hr", "policy_query"),
    ("what is the work from home policy", "hr", "policy_query"),
    ("maternity leave policy", "hr", "policy_query"),
    ("POSH / sexual harassment policy", "hr", "policy_query"),
    ("comp-off policy details", "hr", "policy_query"),
    ("holiday calendar for this year", "hr", "policy_query"),
    ("referral bonus policy", "hr", "policy_query"),
    # employee referral — quick-choice widget (policy vs portal); keyword also catches these
    ("how do I refer someone to the company", "referral_choice", "referral_choice"),
    ("how to refer a candidate for a job opening", "referral_choice", "referral_choice"),
    ("employee referral program details", "referral_choice", "referral_choice"),
    ("I want to refer my colleague for a job opening", "referral_choice", "referral_choice"),
    ("how to submit an employee referral", "referral_choice", "referral_choice"),
    ("where is the employee referral portal", "referral_choice", "referral_choice"),
    ("refer a friend to the company", "referral_choice", "referral_choice"),
    ("I'd like to refer someone to join our company", "referral_choice", "referral_choice"),
    ("referral process and portal link", "referral_choice", "referral_choice"),
    ("probation and confirmation policy", "hr", "policy_query"),
    ("what does my group health insurance cover", "hr", "policy_query"),
    ("how do I file a mediclaim insurance claim", "hr", "policy_query"),
    ("is my parents insurance covered", "hr", "policy_query"),
    ("ESIC eligibility and coverage", "hr", "policy_query"),
    # TRAP: medical treatment cost is governed by health-insurance policy (HR), NOT admin reimbursement
    ("is my surgery covered", "hr", "policy_query"),
    ("will hospitalization expenses be reimbursed", "hr", "policy_query"),
    ("is dental treatment covered by insurance", "hr", "policy_query"),
    ("are maternity hospital bills covered", "hr", "policy_query"),

    # ── hr: documents ──────────────────────────────────────────────────────────
    ("I need an experience certificate", "hr", "document_request"),
    ("generate an NOC for my visa", "hr", "document_request"),
    ("please issue a relieving letter", "hr", "document_request"),
    ("salary certificate for a loan", "hr", "document_request"),

    # ── hr: grievance ────────────────────────────────────────────────────────────
    ("I want to submit a grievance", "hr", "grievance"),
    ("file an anonymous HR complaint", "hr", "grievance"),
    ("report harassment to HR", "hr", "grievance"),

    # ── hr: people / skill search  (TRAP: 'developers' is PEOPLE, not software) ──
    ("find Python developers", "hr", "employee_search"),
    ("who knows React", "hr", "employee_search"),
    ("list our QA engineers", "hr", "employee_search"),
    ("find a senior data scientist", "hr", "employee_search"),
    ("show me the frontend engineers", "hr", "employee_search"),
    ("anyone with Kubernetes experience", "hr", "employee_search"),
    ("who has machine learning skills", "hr", "employee_search"),
    ("employee directory", "hr", "employee_search"),
    ("show the org chart", "hr", "employee_search"),
    ("department headcount", "hr", "employee_search"),
    ("find people with AWS skills", "hr", "employee_search"),

    # ── hr: zoho personal data ───────────────────────────────────────────────────
    ("my timesheet for this week", "hr", "timesheet"),
    ("how many hours did I log", "hr", "timesheet"),
    ("my attendance summary this month", "hr", "attendance"),
    ("how many days was I present", "hr", "attendance"),
    ("my appraisal status", "hr", "appraisal"),
    ("when is my performance review", "hr", "appraisal"),
    ("my training records", "hr", "training"),
    ("courses I have completed", "hr", "training"),
    ("upcoming training programs for me", "hr", "training"),

    # ── hr: alchemy skills portal ─────────────────────────────────────────────────
    ("my skills in alchemy", "hr", "alchemy_my_skills"),
    ("what skills do I have", "hr", "alchemy_my_skills"),
    ("my skill set", "hr", "alchemy_my_skills"),
    ("top skills across the company", "hr", "alchemy_skills_overview"),
    ("trending skills in the org", "hr", "alchemy_skills_overview"),
    ("org skills overview", "hr", "alchemy_skills_overview"),

    # ── admin: reimbursement  (TRAP: reimbursement is ADMIN, never HR) ──────────
    ("certification reimbursement policy", "admin", "policy_query"),
    ("how do I claim travel reimbursement", "admin", "policy_query"),
    ("equipment reimbursement process", "admin", "policy_query"),
    ("what is the expense claim limit", "admin", "policy_query"),
    ("raise a reimbursement claim", "admin", "policy_query"),

    # ── admin: parking ───────────────────────────────────────────────────────────
    ("I need a parking sticker for my car", "admin", "parking_sticker"),
    ("register my two-wheeler for parking", "admin", "parking_sticker"),
    ("surrender my parking pass", "admin", "parking_sticker"),
    ("parking info and rules", "admin", "parking_sticker"),

    # ── admin: parking charges (info, not a sticker request) ──────────────────────
    ("what are the parking charges for 2-wheeler and 4-wheeler", "admin", "parking_charges"),
    ("how much does parking cost per month", "admin", "parking_charges"),
    ("parking fee for my car", "admin", "parking_charges"),
    ("what is the monthly parking rate for a bike", "admin", "parking_charges"),

    # ── admin: facility ──────────────────────────────────────────────────────────
    ("the AC is not working", "admin", "facility_complaint"),
    ("lights are flickering in my bay", "admin", "facility_complaint"),
    ("washroom is dirty", "admin", "facility_complaint"),
    ("the lift is stuck", "admin", "facility_complaint"),
    ("housekeeping complaint", "admin", "facility_complaint"),
    ("my chair is broken", "admin", "facility_complaint"),

    # ── admin: food ──────────────────────────────────────────────────────────────
    ("food quality complaint", "admin", "food_complaint"),
    ("there was a foreign object in my food", "admin", "food_complaint"),
    ("rate the cafeteria vendor", "admin", "food_complaint"),

    # ── admin: accommodation ────────────────────────────────────────────────────
    ("book a guest house", "admin", "accommodation"),
    ("hotel accommodation request", "admin", "accommodation"),
    ("corporate accommodation booking", "admin", "accommodation"),

    # ── admin: desk key ──────────────────────────────────────────────────────────
    ("key for desk B-07", "admin", "desk_key_request"),
    ("I need a desk key", "admin", "desk_key_request"),

    # ── admin: office supplies ───────────────────────────────────────────────────
    ("I need pens", "admin", "office_supply_request"),
    ("need markers for the whiteboard", "admin", "office_supply_request"),
    ("I want a notebook", "admin", "office_supply_request"),
    ("can I get stationery", "admin", "office_supply_request"),
    ("need some sticky notes", "admin", "office_supply_request"),
    ("request highlighters and folders", "admin", "office_supply_request"),

    # ── admin: cabin directory ───────────────────────────────────────────────────
    ("where is HR seated", "admin", "cabin_info"),
    ("which cabin is the Admin team in", "admin", "cabin_info"),
    ("where can I find IT support", "admin", "cabin_info"),
    ("PMO cabin location", "admin", "cabin_info"),
    ("HR room number", "admin", "cabin_info"),
    ("where to find the HR department", "admin", "cabin_info"),

    # ── admin: visitor pass  (TRAP: not a software install) ──────────────────────
    ("register a visitor coming to meet me", "admin", "visitor_pass"),
    ("I need a guest pass for tomorrow", "admin", "visitor_pass"),
    ("visitor entry registration", "admin", "visitor_pass"),

    # ── admin: bookshelf ──────────────────────────────────────────────────────────
    ("what books are available in the library", "admin", "bookshelf.discover"),
    ("I need a book", "admin", "bookshelf.discover"),
    ("looking for some reading material", "admin", "bookshelf.discover"),
    ("recommend a book on machine learning", "admin", "bookshelf.discover"),
    ("browse the company library", "admin", "bookshelf.discover"),
    ("I want to borrow Atomic Habits", "admin", "bookshelf.borrow"),
    ("issue the book Clean Code to me", "admin", "bookshelf.borrow"),
    ("check my book request status", "admin", "bookshelf.status"),
    ("show my borrowed books", "admin", "bookshelf.status"),
    ("return my book BK-12345", "admin", "bookshelf.return"),
    ("I finished reading Clean Code", "admin", "bookshelf.return"),
    ("extend my borrow for 7 more days", "admin", "bookshelf.extend"),
    ("renew Atomic Habits, I need more time", "admin", "bookshelf.extend"),

    # ── admin: travel management ──────────────────────────────────────────────────
    ("I need to travel for a client meeting", "admin", "travel_request"),
    ("submit a business travel request", "admin", "travel_request"),
    ("apply for official travel", "admin", "travel_request"),
    ("I have to go to Mumbai for a project", "admin", "travel_request"),
    ("business trip to London, need visa too", "admin", "travel_request"),
    ("request approval for a work trip", "admin", "travel_request"),
    ("I'm travelling internationally for work", "admin", "travel_request"),
    ("check my travel request status", "admin", "travel_status"),
    ("show my pending travel approvals", "admin", "travel_status"),
    ("what is the status of my travel request", "admin", "travel_status"),
    ("submit my post-trip expenses", "admin", "travel_expense"),
    ("I'm back from the trip, file expenses", "admin", "travel_expense"),
    ("claim travel expense for my trip", "admin", "travel_expense"),
    ("raise expense claim for TRVL-0001", "admin", "travel_expense"),

    # ── it_support: software install  (the canonical install verbs) ─────────────
    ("install Node.js", "it_support", "software_install"),
    ("please install Slack on my laptop", "it_support", "software_install"),
    ("set up Docker for me", "it_support", "software_install"),
    ("I want Figma installed", "it_support", "software_install"),
    ("reinstall Python on my machine", "it_support", "software_install"),
    ("can you install IntelliJ", "it_support", "software_install"),

    # ── it_support: hardware ───────────────────────────────────────────────────
    ("my laptop is overheating", "it_support", "hardware_issue"),
    ("my system is very slow", "it_support", "hardware_issue"),
    ("computer keeps crashing", "it_support", "hardware_issue"),
    ("laptop won't start", "it_support", "hardware_issue"),
    ("blue screen on my machine", "it_support", "hardware_issue"),

    # ── it_support: tickets / assets / vpn ───────────────────────────────────────
    ("show my IT tickets", "it_support", "my_tickets"),
    ("what assets are assigned to me", "it_support", "my_assets"),
    ("raise an IT ticket", "it_support", "create_ticket"),
    ("VPN is not connecting", "it_support", "create_ticket"),
    ("reset my password", "it_support", "create_ticket"),
    ("network is down", "it_support", "create_ticket"),
    ("wifi is not working", "it_support", "create_ticket"),
    ("wifi not working in office", "it_support", "create_ticket"),
    ("internet is not working", "it_support", "create_ticket"),
    ("no internet connection", "it_support", "create_ticket"),
    ("office wifi keeps disconnecting", "it_support", "create_ticket"),
    ("who do I contact for wifi issues", "it_support", "it_howto"),
    ("who should I reach out to for internet problems", "it_support", "it_howto"),

    # ── it_support: how-to / setup (answered from IT docs, not a ticket) ─────────
    ("how do I connect to the VPN", "it_support", "it_howto"),
    ("how to connect vpn", "it_support", "it_howto"),
    ("how do I access the VPN", "it_support", "it_howto"),
    ("VPN setup guide", "it_support", "it_howto"),
    ("remote access setup", "it_support", "it_howto"),
    ("how to connect to wifi", "it_support", "it_howto"),
    ("connect to office wifi", "it_support", "it_howto"),
    ("what is the wifi password", "it_support", "it_howto"),
    ("how do I configure my email", "it_support", "it_howto"),
    ("set up email on my phone", "it_support", "it_howto"),
    ("how to set up the printer", "it_support", "it_howto"),
    ("how do I set up OneDrive", "it_support", "it_howto"),

    # ── it_support: licenses / assets ────────────────────────────────────────────
    ("I need a GitHub Copilot license", "it_support", "license_request"),
    ("request a Claude license", "it_support", "license_request"),
    ("request a monitor for my desk", "it_support", "asset_request"),
    ("I need a new keyboard and mouse", "it_support", "asset_request"),
    ("I want headphones", "it_support", "asset_request"),
    ("need a headset for work", "it_support", "asset_request"),
    ("can I get a mouse", "it_support", "asset_request"),
    ("I need an ethernet cable", "it_support", "asset_request"),
    ("request a USB hub", "it_support", "asset_request"),
    ("I want a webcam", "it_support", "asset_request"),
    ("I need a docking station", "it_support", "asset_request"),
    ("request an external monitor", "it_support", "asset_request"),

    # ── pmo ────────────────────────────────────────────────────────────────────
    ("show all company projects", "pmo", "list_projects"),
    ("what projects are active", "pmo", "list_projects"),
    ("project status report", "pmo", "list_projects"),
    ("generate a PDF report for project X", "pmo", "list_projects"),
    ("I need a Udemy license for a Python course", "pmo", "udemy_license"),
    ("can I get access to a Udemy course", "pmo", "udemy_license"),
    ("I need a Coursera license", "pmo", "udemy_license"),
    ("can I get a Coursera course subscription", "pmo", "udemy_license"),
    ("request an online course / training license", "pmo", "udemy_license"),
    ("who has Udemy licenses", "pmo", "list_license_holders"),

    # ── pmo: process / how-to / governance (answered from PMO docs) ──────────────
    ("what is the project onboarding process", "pmo", "pmo_howto"),
    ("PMO process guide", "pmo", "pmo_howto"),
    ("how do I raise a project change request", "pmo", "pmo_howto"),
    ("what is the project governance policy", "pmo", "pmo_howto"),

    # ── functional_manager ───────────────────────────────────────────────────────
    ("who reports to me", "functional_manager", "team_structure"),
    ("show my direct reports", "functional_manager", "team_structure"),
    ("who is on my team", "functional_manager", "team_structure"),
    ("list my reportees", "functional_manager", "team_structure"),

    # ── ms365: email ──────────────────────────────────────────────────────────────
    ("show my emails", "ms365", "read_email"),
    ("any unread emails", "ms365", "read_email"),
    ("any emails from John", "ms365", "read_email"),
    ("send an email to Priya", "ms365", "send_email"),
    ("compose an email to the team", "ms365", "send_email"),
    ("draft an email about the offsite", "ms365", "send_email"),

    # ── ms365: calendar ───────────────────────────────────────────────────────────
    ("what meetings do I have today", "ms365", "calendar"),
    ("check my calendar for next week", "ms365", "calendar"),
    ("am I free tomorrow afternoon", "ms365", "calendar"),

    # ── ms365: teams ──────────────────────────────────────────────────────────────
    ("read my Teams messages", "ms365", "teams_messages"),
    ("check my Teams chats", "ms365", "teams_messages"),
    ("send a message to Rahul on Teams", "ms365", "send_teams_message"),
    ("DM Anita on Teams", "ms365", "send_teams_message"),

    # ── ms365: rooms  (TRAP: 'book a room' is NOT a software install) ───────────
    ("is Salween room free tomorrow 2-3pm", "ms365", "room_availability"),
    ("which rooms are free at 3pm", "ms365", "room_availability"),
    ("book a conference room", "ms365", "room_availability"),
    ("reserve a meeting room for 4pm", "ms365", "room_availability"),

    # ── ms365: yammer / community ────────────────────────────────────────────────
    ("show my Viva Engage feed", "ms365", "yammer"),
    ("my communities", "ms365", "yammer"),
    ("search the community for the new cafeteria menu", "ms365", "community_search"),
    ("has anyone posted about the hackathon", "ms365", "community_search"),
    ("what's been shared on Viva Engage about WFH", "ms365", "community_search"),
    ("does anyone know if the company hosts its own LLM models", "ms365", "community_search"),

    # ── deeplink: leave + portals ──────────────────────────────────────────────
    ("how many leaves do I have", "deeplink", "leave_balance"),
    ("my remaining leave balance", "deeplink", "leave_balance"),
    ("apply sick leave from Monday", "deeplink", "submit_leave"),
    ("I want to take casual leave next Friday", "deeplink", "submit_leave"),
    ("raise a complaint about AC not working in the portal", "deeplink", "powerapps_complaint"),
    ("file a ticket in the admin action tracker", "deeplink", "powerapps_complaint"),
    ("get my payslip", "deeplink", "payslip"),
    ("setup zoho session", "deeplink", "setup_session"),
    ("setup powerapps session", "deeplink", "setup_session"),

    # ── form_builder: admin creates a NEW form template (role enforced server-side) ──
    ("create a form for gym membership reimbursement requests", "form_builder", "create_form"),
    ("create a new form", "form_builder", "create_form"),
    ("build a feedback form for the cafeteria", "form_builder", "create_form"),
    ("make a form to collect laptop upgrade requests", "form_builder", "create_form"),
    ("add a form to the form library", "form_builder", "create_form"),
    ("design a survey form for employees", "form_builder", "create_form"),
    ("set up a registration form for the offsite event", "form_builder", "create_form"),
    ("generate a form for travel reimbursement", "form_builder", "create_form"),
]


def _norm(s: str) -> str:
    """Normalisation used as the idempotency key (must match the service)."""
    return " ".join((s or "").lower().split())


def as_seeds() -> list[Seed]:
    """Expand the compact tuples into Seed dicts (entities default to empty)."""
    return [
        {"utterance": u, "domain": d, "sub_intent": si, "entities": {}}
        for (u, d, si) in _RAW
    ]


ROUTER_SEEDS: list[Seed] = as_seeds()
