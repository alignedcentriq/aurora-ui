"""Routing regression fixtures — Phase 0 of the architecture redesign.

These cases are the SAFETY NET that lets us refactor the routing layer (see
docs/architecture-redesign.md) without silently regressing edge cases that were
already fixed in production. Each case records its provenance in `source` — many
are lifted directly from the bug-fix comments embedded in app/agent.py.

Pure data, no imports. The runner is tests/test_routing_regression.py.

Case schema (dict):
  id                 short unique label
  message            the user message under test
  expect_domain      expected keyword-route domain, or None = expect FALLTHROUGH
                     (i.e. _try_keyword_route returns None so the message reaches
                      the semantic / LLM router)
  expect_sub_intent  expected sub_intent, or None = don't assert it
  forbid_sub_intent  assert the route does NOT carry this sub_intent (used to pin
                     the "must not misroute to X" bug-fixes); None = no constraint
  source             why this case exists / where the rule came from
"""

# ── Deterministic keyword-router cases (_try_keyword_route) ─────────────────────
# These exercise the zero-LLM keyword layer where precedence bugs live.
KEYWORD_CASES = [
    # --- core happy-path intents (baseline of current correct behavior) ---
    dict(id="greeting", message="hello",
         expect_domain="general", expect_sub_intent="greeting", forbid_sub_intent=None,
         source="core intent (greeting regex is anchored — fires only for a pure greeting)"),
    dict(id="hr_policy", message="what is the leave policy",
         expect_domain="hr", expect_sub_intent="policy_query", forbid_sub_intent=None,
         source="core intent"),
    dict(id="pmo_projects", message="list all projects",
         expect_domain="pmo", expect_sub_intent="list_projects", forbid_sub_intent=None,
         source="core intent"),
    dict(id="manager_team", message="show my team structure",
         expect_domain="functional_manager", expect_sub_intent="team_structure", forbid_sub_intent=None,
         source="core intent"),
    dict(id="ms365_read_email", message="read my latest emails",
         expect_domain="ms365", expect_sub_intent="read_email", forbid_sub_intent=None,
         source="core intent"),

    # --- bug-fix: skill/role people search must stay HR, not IT install ---
    # agent.py:1357 — "the role noun is the disambiguator ... otherwise the LLM
    # over-anchors on the tech word and misroutes to software_install."
    dict(id="find_python_devs", message="find Python developers",
         expect_domain="hr", expect_sub_intent="employee_search", forbid_sub_intent="software_install",
         source="agent.py:1357 — find <skill> developers stays HR"),
    dict(id="staffing_react", message="I need 2 React developers with 3+ years",
         expect_domain="hr", expect_sub_intent="resource_match", forbid_sub_intent="software_install",
         source="agent.py:1357 — staffing role+skill stays HR"),

    # --- bug-fix: bare "I need ..." must NOT trigger software_install ---
    # agent.py:1673 — "This is what prevented 'I need <anything>' from being
    # mistaken for a software install."
    dict(id="need_help_fallthrough", message="I need help",
         expect_domain=None, expect_sub_intent=None, forbid_sub_intent="software_install",
         source="agent.py:1673 — 'I need help' must not be software_install"),

    # --- bug-fix: visitor pass before IT install ---
    # agent.py:2083 — "must precede IT install to avoid 'I need to request a
    # visitor pass' -> software_install misroute."
    dict(id="visitor_pass", message="I need to request a visitor pass",
         expect_domain="admin", expect_sub_intent="visitor_pass", forbid_sub_intent="software_install",
         source="agent.py:2083 — visitor pass precedence over install"),

    # --- bug-fix: parking CHARGES (info) before parking STICKER (action) ---
    # agent.py:2040 — "checked before the sticker keyword so '... parking charges
    # ...' doesn't fall through to the semantic router (mis-matched to PF query)."
    dict(id="parking_charges", message="what are the parking charges for 2-wheeler",
         expect_domain="admin", expect_sub_intent="parking_charges", forbid_sub_intent="parking_sticker",
         source="agent.py:2040 — parking charges precedence over sticker"),

    # --- genuine install request SHOULD route to software_install ---
    dict(id="install_node", message="please install Node.js on my laptop",
         expect_domain="it_support", expect_sub_intent="software_install", forbid_sub_intent=None,
         source="core intent — real install request"),

    # --- resend escape hatch: must route to software_install with the named product so the
    #     cross-chat dedupe bypass (idempotency key) matches the original request ---
    dict(id="resend_install", message="resend the slack request",
         expect_domain="it_support", expect_sub_intent="software_install", forbid_sub_intent=None,
         source="cross-chat dedupe escape hatch — _KW_IT_RESEND"),

    # --- hardware issue ---
    dict(id="hardware_issue", message="my laptop is not working",
         expect_domain="it_support", expect_sub_intent="hardware_issue", forbid_sub_intent=None,
         source="core intent (hardware regex matches '<device> not working/crashing/...' forms)"),
]


# ── Curated cases promoted from real traffic ───────────────────────────────────
# Authentic user phrasings (discovered by mining ai_request_logs once, by hand), each
# with a HUMAN-CONFIRMED correct expectation — i.e. these assert what SHOULD happen,
# not merely what the code currently does. They carry no dependency on the
# observability layer: the wording is frozen here in version control.
REAL_CURATED_CASES = [
    # --- HR ---
    dict(id="rt_posh_policy", message="what is posh policy",
         expect_domain="hr", expect_sub_intent="policy_query", forbid_sub_intent=None,
         source="real traffic — POSH is an HR policy question"),
    dict(id="rt_experience_cert", message="Generate an experience certificate for me",
         expect_domain="hr", expect_sub_intent="document_request", forbid_sub_intent=None,
         source="real traffic — HR document generation"),
    dict(id="rt_grievance", message="I want to submit a grievance",
         expect_domain="hr", expect_sub_intent="grievance", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_who_is", message="Who is Shivam Sharma?",
         expect_domain="hr", expect_sub_intent="employee_search", forbid_sub_intent=None,
         source="real traffic — person lookup is HR directory"),
    dict(id="rt_appraisal", message="When is the next performance review cycle?",
         expect_domain="hr", expect_sub_intent="appraisal", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_attendance", message="How do I check my attendance?",
         expect_domain="hr", expect_sub_intent="attendance", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_leave_cancel", message="Can I cancel an approved leave request?",
         expect_domain="hr", expect_sub_intent="leave_cancel", forbid_sub_intent=None,
         source="real traffic — leave cancellation is an HR/leave action"),

    # --- IT ---
    dict(id="rt_install_python", message="I need to install Python",
         expect_domain="it_support", expect_sub_intent="software_install", forbid_sub_intent=None,
         source="real traffic — genuine install request"),
    dict(id="rt_laptop_overheat", message="My laptop is overheating",
         expect_domain="it_support", expect_sub_intent="hardware_issue", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_copilot_license", message="I need a GitHub Copilot license",
         expect_domain="it_support", expect_sub_intent="license_request", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_my_tickets", message="Show my IT tickets",
         expect_domain="it_support", expect_sub_intent="my_tickets", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_vpn", message="How do I connect to the office VPN?",
         expect_domain="it_support", expect_sub_intent="create_ticket", forbid_sub_intent=None,
         source="real traffic — VPN help → IT ticket"),
    dict(id="rt_headphones", message="i want headphones",
         expect_domain="it_support", expect_sub_intent="asset_request", forbid_sub_intent="software_install",
         source="real traffic — peripheral request, not install"),

    # --- Admin ---
    dict(id="rt_parking_charges", message="What are the parking charges for 2-Wheeler and 4-Wheeler ?",
         expect_domain="admin", expect_sub_intent="parking_charges", forbid_sub_intent="parking_sticker",
         source="real traffic — info query (was hijacked by form-library live; keyword is correct)"),
    dict(id="rt_visitor_pass", message="How do I register and manage a visitor pass for a guest?",
         expect_domain="admin", expect_sub_intent="visitor_pass", forbid_sub_intent="software_install",
         source="real traffic — visitor pass"),

    # --- MS365 ---
    dict(id="rt_book_room", message="How do I book a meeting room?",
         expect_domain="ms365", expect_sub_intent="room_availability", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_teams_send", message="send message to Suraj Ghuge",
         expect_domain="ms365", expect_sub_intent="send_teams_message", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_show_emails", message="show my emails",
         expect_domain="ms365", expect_sub_intent="read_email", forbid_sub_intent=None,
         source="real traffic"),

    # --- PMO ---
    dict(id="rt_list_projects", message="Show all company projects",
         expect_domain="pmo", expect_sub_intent="list_projects", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_udemy", message="I need a Udemy license",
         expect_domain="pmo", expect_sub_intent="udemy_license", forbid_sub_intent=None,
         source="real traffic"),

    # --- Manager / General / form / referral ---
    dict(id="rt_reports_to_me", message="Who reports to me?",
         expect_domain="functional_manager", expect_sub_intent="team_structure", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_company_values", message="What are our company's core values?",
         expect_domain="general", expect_sub_intent="company_info", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_salary_hike", message="I want a salary hike",
         expect_domain="general", expect_sub_intent="off_topic", forbid_sub_intent=None,
         source="real traffic — off-topic personal wish"),
    dict(id="rt_salary_credit", message="When is the salary credit date?",
         expect_domain="general", expect_sub_intent="salary_credit_date", forbid_sub_intent=None,
         source="real traffic — dedicated fixed-answer fast-path"),
    dict(id="rt_create_form", message="Create a form for gym membership",
         expect_domain="form_builder", expect_sub_intent="create_form", forbid_sub_intent=None,
         source="real traffic"),
    dict(id="rt_refer", message="i want to refer someone",
         expect_domain="referral_choice", expect_sub_intent="referral_choice", forbid_sub_intent=None,
         source="real traffic"),
]


# ── Known-gap cases (correct answer asserted; system FAILS today) ───────────────
# These make the curated suite honest: each asserts the HUMAN-CORRECT routing for a
# real phrasing the deterministic layer currently gets WRONG (found by mining
# ai_request_logs). They are EXPECTED to fail right now — the runner treats a still-
# failing known-gap as OK, but ALARMS if one starts passing (that means it's fixed and
# must be promoted into the curated set above). This is what proves the suite checks
# correctness rather than rubber-stamping current behavior.
#   id / message / expect_domain (the CORRECT answer) / source (the bug + who should confirm)
KNOWN_GAP_CASES = [
    dict(id="gap_form16", message="How to obtain Form 16 from HR department?",
         expect_domain="hr", expect_sub_intent=None, forbid_sub_intent=None,
         source="Form 16 is an HR tax document; keyword routes admin today. CONFIRM: HR owner"),
    dict(id="gap_bank_details", message="How do I update my bank account details for salary payment?",
         expect_domain="hr", expect_sub_intent=None, forbid_sub_intent=None,
         source="payroll/bank update is HR; keyword routes general today. CONFIRM: HR owner"),
    dict(id="gap_tax_certificate", message="Where do I get my tax certificate?",
         expect_domain="hr", expect_sub_intent=None, forbid_sub_intent=None,
         source="tax certificate is HR; a phrasing curated cases didn't anticipate. CONFIRM: HR owner"),
]


# ── Continuation detection (_is_continuation(message, last_ai)) ─────────────────
# True  => keep the sticky domain (genuine follow-up)
# False => self-standing message; allow re-routing
LONG_AI = "Here are the React developers: Alice, Bob, Carol, Dan and 30 more."

CONTINUATION_CASES = [
    dict(id="ack_yes", message="yes", last_ai="", expect=True,
         source="terse ack is a continuation"),
    dict(id="what_about_those", message="what about those", last_ai=LONG_AI, expect=True,
         source="'what about' + context ref"),
    dict(id="ref_it", message="is there any timeline for applying it", last_ai="Some prior answer.",
         expect=True, source="contains context ref 'it'"),
    # agent.py:2313 — "wifi not working is short but is a brand-new request."
    dict(id="new_request_short", message="wifi not working", last_ai="Here is your leave balance.",
         expect=False, source="agent.py:2313 — short != continuation"),
    # agent.py:2540 — a novel new-topic question mid-chat must not be swallowed.
    dict(id="new_topic_posh", message="what's the POSH policy?", last_ai="Your VPN is now configured.",
         expect=False, source="agent.py:2540 — new topic released, not sticky"),
]


# ── Anaphora / follow-up resolution (_needs_followup_resolution(msg, last_ai)) ──
# True  => rewrite the referential follow-up into a standalone query before routing
ANAPHORA_CASES = [
    dict(id="their_allocation", message="Show their current project allocation", last_ai=LONG_AI,
         expect=True, source="the reported bug — 'their' needs resolution"),
    dict(id="those_people", message="what about those people", last_ai=LONG_AI,
         expect=True, source="group anaphora"),
    dict(id="fresh_request", message="find me a React Developer for next week", last_ai=LONG_AI,
         expect=False, source="self-standing request, no anaphora"),
    dict(id="ack_no_rewrite", message="yes", last_ai=LONG_AI,
         expect=False, source="terse ack carries no resolvable subject"),
    dict(id="no_prior_answer", message="show their allocation", last_ai="",
         expect=False, source="no substantive prior answer to resolve against"),
    dict(id="clarify_reply_no_rewrite", message="HR: what is the leave policy", last_ai=LONG_AI,
         expect=False, source="domain-clarify reply must not be rewritten"),
]


# ── Focus extraction (_extract_focus(last_ai, domain, turn)) ───────────────────
# Phase 1 ConversationState. expect_kind=None => expect None (nothing tracked).
PEOPLE_ANSWER = (
    "**Top candidates for React**\n"
    "1. Alice Sharma — Senior Engineer\n"
    "2. Bob Kumar — Engineer\n"
    "3. Carol Lee — Developer\n"
)
PROJECTS_ANSWER = (
    "Here are all 3 projects in the organization:\n"
    "1. **Admin Dashboard**\n2. **Aurora UI**\n3. **Centriq AI**\n"
)
FOCUS_CASES = [
    dict(id="people_list", last_ai=PEOPLE_ANSWER, expect_kind="people",
         expect_entities=["Alice Sharma", "Bob Kumar", "Carol Lee"],
         source="people answer -> focus.kind=people with names"),
    dict(id="projects_list", last_ai=PROJECTS_ANSWER, expect_kind="projects",
         expect_entities=["Admin Dashboard", "Aurora UI", "Centriq AI"],
         source="projects answer -> focus.kind=projects"),
    dict(id="prose_no_list", last_ai="Your leave balance is 12 days.", expect_kind=None,
         expect_entities=None, source="plain prose with no list -> nothing tracked"),
]


# ── Local anaphora resolution (_resolve_anaphora_locally(msg, focus, turn)) ─────
# expect_resolved=True => returns a non-None standalone query (zero-LLM path)
_FOCUS_PEOPLE = {"kind": "people", "entities": ["Alice", "Bob", "Carol"], "domain": "hr", "turn": 1}
LOCAL_RESOLVE_CASES = [
    dict(id="their_with_focus", message="Show their current project allocation",
         focus=_FOCUS_PEOPLE, turn=2, expect_resolved=True,
         source="anaphora + fresh focus -> resolved without LLM"),
    dict(id="no_focus", message="Show their allocation", focus=None, turn=2,
         expect_resolved=False, source="no focus -> fall through to LLM"),
    dict(id="stale_focus", message="Show their allocation",
         focus={**_FOCUS_PEOPLE, "turn": 1}, turn=5, expect_resolved=False,
         source="focus >1 turn old -> not used (stale)"),
    dict(id="no_pronoun", message="list all projects", focus=_FOCUS_PEOPLE, turn=2,
         expect_resolved=False, source="no anaphora -> nothing to resolve"),
]


# ── Leave-param fast-path (_try_extract_leave_params(message)) ──────────────────
# expect_none=True  => not a clear leave request (returns None)
# else assert the parsed dict matches the provided keys
LEAVE_PARAM_CASES = [
    dict(id="apply_range", message="apply leave from 20 June to 22 June",
         expect_none=False, expect={"start_date": "2026-06-20", "end_date": "2026-06-22"},
         source="core fast-path"),
    dict(id="sick_iso", message="book sick leave from 2026-07-01 to 2026-07-03",
         expect_none=False, expect={"start_date": "2026-07-01", "end_date": "2026-07-03", "leave_type": "Sick"},
         source="leave type inference"),
    dict(id="policy_not_leave_req", message="what is the leave policy",
         expect_none=True, expect=None,
         source="a policy question is not a leave application"),
]
