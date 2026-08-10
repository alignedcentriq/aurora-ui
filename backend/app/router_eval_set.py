"""Held-out evaluation set for the intent router.

These (utterance, expected_domain, expected_sub_intent) rows are deliberately NOT in
router_seeds.py — they are paraphrases and hard cases the router has never been shown, so
accuracy on them measures genuine generalisation, not memorisation. Use with
backend/scripts/eval_router.py to calibrate thresholds and compare old vs new routing.

`expected_sub_intent` may be None where only the domain matters for the test.
"""

# (utterance, expected_domain, expected_sub_intent | None)
EVAL_SET: list[tuple[str, str, str | None]] = [
    # ── the original bug + the people-vs-software trap family ────────────────────
    ("find me some python developers", "hr", "employee_search"),
    ("we need to hire java engineers, who do we have", "hr", "employee_search"),
    ("which colleagues are skilled in golang", "hr", "employee_search"),
    ("who on staff knows terraform", "hr", "employee_search"),
    ("show employees experienced in node", "hr", "employee_search"),
    ("install python on my laptop please", "it_support", "software_install"),
    ("can you get docker set up for me", "it_support", "software_install"),
    ("i want intellij installed", "it_support", "software_install"),

    # ── reimbursement vs medical-insurance trap ──────────────────────────────────
    ("how do I get my travel costs reimbursed", "admin", None),
    ("claim back my certification fee", "admin", None),
    ("will my heart surgery be covered", "hr", "policy_query"),
    ("are hospital bills reimbursed under insurance", "hr", "policy_query"),

    # ── room booking vs install trap ─────────────────────────────────────────────
    ("can I set up the Ganges room for 3pm", "ms365", "room_availability"),
    ("reserve a cabin for a meeting tomorrow", "ms365", "room_availability"),
    ("is any conference room open at noon", "ms365", "room_availability"),

    # ── hr policy ────────────────────────────────────────────────────────────────
    ("what's the policy on working from home", "hr", "policy_query"),
    ("how many public holidays this year", "hr", "policy_query"),
    ("explain the paternity leave rules", "hr", "policy_query"),
    ("details of the referral bonus scheme", "hr", "policy_query"),

    # ── hr documents / grievance ─────────────────────────────────────────────────
    ("I need a letter proving my employment", "hr", "document_request"),
    ("can you create an NOC for higher studies", "hr", "document_request"),
    ("I'd like to raise a confidential complaint with HR", "hr", "grievance"),

    # ── hr zoho personal ─────────────────────────────────────────────────────────
    ("how many hours have I clocked this week", "hr", "timesheet"),
    ("show my present and absent days this month", "hr", "attendance"),
    ("where is my appraisal in the cycle", "hr", "appraisal"),
    ("which trainings have I finished", "hr", "training"),

    # ── deeplink: leave ───────────────────────────────────────────────────────────
    ("how much leave is left for me", "deeplink", "leave_balance"),
    ("do I still have any casual leaves", "deeplink", "leave_balance"),
    ("book me sick leave for next monday", "deeplink", "submit_leave"),
    ("I want to apply earned leave on friday", "deeplink", "submit_leave"),

    # ── it_support ────────────────────────────────────────────────────────────────
    ("my machine keeps freezing", "it_support", "hardware_issue"),
    ("the laptop fan is super loud and it's hot", "it_support", "hardware_issue"),
    ("I can't connect to the VPN", "it_support", None),
    ("need a github copilot seat", "it_support", "license_request"),
    ("what gadgets are assigned to me", "it_support", "my_assets"),
    ("open a support ticket for me", "it_support", "create_ticket"),
    ("can you create a new azure devops project for our team", "it_support", None),
    ("I need to register an app in azure ad", "it_support", None),
    ("we need api permissions added for our azure ad app", "it_support", None),
    ("can I get access to the sales database", "it_support", None),
    ("I need an export of data from the crm system", "it_support", None),

    # ── pmo ────────────────────────────────────────────────────────────────────
    ("list every active company project", "pmo", "list_projects"),
    ("give me a status report on our initiatives", "pmo", "list_projects"),
    ("I'd like a udemy course license", "pmo", "udemy_license"),
    ("can I get a coursera license for a course", "pmo", "udemy_license"),
    ("who currently holds udemy access", "pmo", "list_license_holders"),

    # ── general: company-project knowledge base (vs pmo status/tracking) ─────────
    ("can you summarise the falcon project for me", "general", "company_projects"),
    ("what was shown in the demo for the analytics work", "general", "company_projects"),
    ("pull up the demo transcript for the migration project", "general", "company_projects"),
    ("what did we deliver for that retail client", "general", "company_projects"),

    # ── functional_manager ──────────────────────────────────────────────────────
    ("show me everyone reporting into me", "functional_manager", "team_structure"),
    ("who are my team members", "functional_manager", "team_structure"),

    # ── ms365 ────────────────────────────────────────────────────────────────────
    ("any new mail in my inbox", "ms365", "read_email"),
    ("shoot an email over to the design team", "ms365", "send_email"),
    ("what's on my calendar this afternoon", "ms365", "calendar"),
    ("read out my latest teams chats", "ms365", "teams_messages"),
    ("has anyone in the communities talked about the offsite", "ms365", "community_search"),
    ("show my viva engage feed", "ms365", "yammer"),

    # ── admin: facility / parking / bookshelf / visitor ──────────────────────────
    ("the air conditioning stopped working on the 3rd floor", "admin", "facility_complaint"),
    ("I want a parking permit for my bike", "admin", "parking_sticker"),
    ("recommend something good to read", "admin", "bookshelf.discover"),
    ("I'd like to check out Atomic Habits", "admin", "bookshelf.borrow"),
    ("a client is visiting me tomorrow, register them", "admin", "visitor_pass"),

    # ── general ────────────────────────────────────────────────────────────────
    ("good evening", "general", "greeting"),
    ("what kind of things can you help with", "general", "greeting"),
    ("tell me about the company", "general", "company_info"),
]
