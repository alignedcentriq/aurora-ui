import os
from pathlib import Path
from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent.parent  # centriq_ai/
load_dotenv(_ROOT / ".env.local", override=True)
load_dotenv()  # fallback: .env

ALIGNED_LLM_BASE_URL = "http://ml01.alignedautomation.com:11434/v1"
AUTO_BASE_URL_VALUES = {"", "auto", "platform"}
LOCAL_INFRA_HOST = "127.0.0.1"
ALIGNED_LLM_HOST = "ml01.alignedautomation.com"


def _append_no_proxy(*hosts: str) -> None:
    current = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    entries = [entry.strip() for entry in current.split(",") if entry.strip()]
    seen = {entry.lower() for entry in entries}
    for host in hosts:
        if host.lower() not in seen:
            entries.append(host)
            seen.add(host.lower())
    value = ",".join(entries)
    os.environ["NO_PROXY"] = value
    os.environ["no_proxy"] = value


_append_no_proxy(ALIGNED_LLM_HOST)


def _platform_llm_base_url() -> str:
    """Use the shared Aligned server for this Windows-only local app."""
    return ALIGNED_LLM_BASE_URL


def _resolve_llm_base_url(env_name: str, fallback_env_name: str | None = None) -> str:
    value = os.getenv(env_name)
    if value is None and fallback_env_name:
        value = os.getenv(fallback_env_name)

    if value is not None and value.strip().lower() not in AUTO_BASE_URL_VALUES:
        return value.strip()

    return _platform_llm_base_url()


def _resolve_infra_host() -> str:
    """Docker runs in WSL, but published ports are reached from Windows via localhost."""
    return LOCAL_INFRA_HOST


def _resolve_db_url() -> str:
    """Return DATABASE_URL, substituting 'auto' with the platform-appropriate host."""
    value = os.getenv("DATABASE_URL", "").strip()
    if not value or value.lower() in AUTO_BASE_URL_VALUES:
        host = _resolve_infra_host()
        return f"postgresql://postgres:postgres@{host}:5433/centriq"
    if value.startswith("postgres://"):
        value = value.replace("postgres://", "postgresql://", 1)
    return value


def _resolve_redis_url() -> str:
    """Return REDIS_URL, substituting 'auto' with the platform-appropriate host."""
    value = os.getenv("REDIS_URL", "").strip()
    if not value or value.lower() in AUTO_BASE_URL_VALUES:
        host = _resolve_infra_host()
        return f"redis://{host}:6380"
    return value



def _resolve_router_model() -> str:
    """Use llama3.2:3b for routing/admin/IT/PMO/manager — tiny, instant, and reliable
    at the structured (tool-calling) output the router needs via .with_structured_output."""
    value = os.getenv("ROUTER_MODEL_NAME", "").strip()
    if value and value.lower() not in AUTO_BASE_URL_VALUES:
        return value
    return "llama3.2:3b"


class Config:
    # ── Router Model (intent classification & domain routing) ──
    ROUTER_BASE_URL = _resolve_llm_base_url("ROUTER_BASE_URL")
    ROUTER_MODEL_NAME = _resolve_router_model()
    ROUTER_API_KEY = os.getenv("ROUTER_API_KEY", "ollama")

    # ── Agent Model (reasoning, tool calling, response generation) ──
    AGENT_BASE_URL = os.getenv("AGENT_BASE_URL", os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"))
    AGENT_MODEL_NAME = os.getenv("AGENT_MODEL_NAME", os.getenv("LLM_MODEL_NAME", "gpt-oss:latest"))
    AGENT_API_KEY = os.getenv("AGENT_API_KEY", os.getenv("LLM_API_KEY", "ollama"))
    AGENT_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # ── Service-agent Model (tool-calling for Admin / IT / PMO / Manager) ──
    # These agents do real tool-calling. llama3.2:3b is too weak — it refuses
    # ("outside my area") instead of calling the tool. gpt-oss is reliable but too
    # heavy on the shared ml01 box (cold-reloads of the ~20B model time out >120s
    # under contention). llama3.1:8b is the sweet spot: a capable tool-caller that
    # stays fast on the shared server. Override via SERVICE_MODEL_NAME (e.g. gpt-oss
    # if ml01 gets dedicated capacity).
    SERVICE_MODEL_NAME = os.getenv("SERVICE_MODEL_NAME", "llama3.1:8b")

    # ── General Model (greetings, small talk) ──
    GENERAL_MODEL_NAME = os.getenv("GENERAL_MODEL_NAME", "llama3.2:3b")

    # ── Summarizer Model (context_manager_node, conversation summaries) ──
    # 8B (not 3B) here — summarization benefits from the extra capacity.
    SUMMARIZER_MODEL_NAME = os.getenv("SUMMARIZER_MODEL_NAME", "llama3.1:8b")

    # ── Fast Model (lightweight agents: manager, general, summarizer, suggestions) ──
    FAST_MODEL_NAME = os.getenv("FAST_MODEL_NAME", "llama3.2:3b")

    # ── Legacy aliases (backward compat) ──
    LLM_BASE_URL = _resolve_llm_base_url("LLM_BASE_URL")
    LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "gpt-oss:latest")
    LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")
    LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # ── Agent Model (reasoning, tool calling, response generation) ──
    AGENT_BASE_URL = _resolve_llm_base_url("AGENT_BASE_URL", "LLM_BASE_URL")
    AGENT_MODEL_NAME = os.getenv("AGENT_MODEL_NAME", os.getenv("LLM_MODEL_NAME", "gpt-oss:latest"))
    AGENT_API_KEY = os.getenv("AGENT_API_KEY", os.getenv("LLM_API_KEY", "ollama"))
    AGENT_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))

    # ── Embedding + Chunking Models (semantic search / RAG ingestion) ──
    EMBEDDING_BASE_URL = _resolve_llm_base_url("EMBEDDING_BASE_URL", "LLM_BASE_URL")
    EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "nomic-embed-text")
    EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", os.getenv("LLM_API_KEY", "ollama"))

    # "remote" (default): embed via the OpenAI-compatible client against EMBEDDING_BASE_URL
    # (shared ml01 box). "local": embed in-process via fastembed (nomic-embed-text-v1.5),
    # removing the network round-trip + ml01 contention that dominates cache-lookup latency.
    # See docs/specs/2026-07-21-local-embedding-backend-design.md.
    EMBEDDING_BACKEND = os.getenv("EMBEDDING_BACKEND", "remote").strip().lower()

    POLICY_CHUNK_SIZE = int(os.getenv("POLICY_CHUNK_SIZE", "800"))
    POLICY_CHUNK_OVERLAP = int(os.getenv("POLICY_CHUNK_OVERLAP", "100"))

    # ── Routing clarification gate (wrong-answer prevention) ──
    # When the LLM router's confidence is below this, the assistant shows a quick-choice
    # card asking the user to pick the domain instead of guessing. A clarifying question
    # costs one click; a confident wrong-domain answer costs trust.
    CLARIFY_CONF_THRESHOLD = float(os.getenv("CLARIFY_CONF_THRESHOLD", "0.6"))

    # ── Semantic Answer Cache (instant repeat-question answers, zero LLM) ──
    ANSWER_CACHE_ENABLED = os.getenv("ANSWER_CACHE_ENABLED", "true").lower() == "true"
    # Cosine similarity required to serve a cached answer. High by design — a near-miss must
    # recompute rather than risk returning a subtly-wrong answer.
    ANSWER_CACHE_SIM_THRESHOLD = float(os.getenv("ANSWER_CACHE_SIM_THRESHOLD", "0.93"))
    # Safety net: never serve a cached answer older than this, even if not explicitly invalidated.
    ANSWER_CACHE_MAX_AGE_DAYS = int(os.getenv("ANSWER_CACHE_MAX_AGE_DAYS", "7"))

    # ── URL Library (admin-curated app directory, semantically matched to user queries) ──
    # Broad recall for the find_apps tool: the agent asked for matches, so surface anything
    # plausibly relevant and let the LLM decide. Lower than the answer cache on purpose.
    APP_DIRECTORY_SIM_THRESHOLD = float(os.getenv("APP_DIRECTORY_SIM_THRESHOLD", "0.45"))
    # Stricter gate for the proactive mid-conversation nudge — only volunteer an app link when
    # the match is confident, so unrelated chats aren't peppered with link suggestions.
    APP_DIRECTORY_NUDGE_THRESHOLD = float(os.getenv("APP_DIRECTORY_NUDGE_THRESHOLD", "0.62"))

    # ── Form Library (admin-defined fillable forms, semantically matched to user queries) ──
    # A form match short-circuits the router and renders the form inline, suppressing normal
    # agent handling — so the gate is deliberately high: only a confident match should trigger a
    # form, otherwise a vaguely-similar message falls through to normal routing untouched.
    FORM_MATCH_SIM_THRESHOLD = float(os.getenv("FORM_MATCH_SIM_THRESHOLD", "0.62"))
    # Higher gate for info-phrased queries ("how do I…", "what is the process for…") that have no
    # action verb — only a very strong embedding match should short-circuit to a form there,
    # because the question may genuinely need a policy/HR answer, not just a form widget.
    # When an action verb IS present (submit, apply, request, book…), the normal threshold applies.
    FORM_MATCH_INFO_SIM_THRESHOLD = float(os.getenv("FORM_MATCH_INFO_SIM_THRESHOLD", "0.80"))

    # ── Semantic Intent Router (embedding nearest-neighbour domain classification) ──
    # Closed-set routing: the message is matched against labeled seed utterances by cosine
    # similarity instead of being classified by the generative LLM router (which hallucinates).
    SEMANTIC_ROUTER_ENABLED = os.getenv("SEMANTIC_ROUTER_ENABLED", "true").lower() == "true"
    # >= this similarity AND top-k agreement → route directly, zero LLM. Conservative 0.85: the
    # Fast Intent Dictionary already handles exact/seeded phrasings, so this only gates NOVEL
    # paraphrases. Eval shows precision stays 100% down to ~0.72, so this is safely tunable
    # lower at runtime (llm_controls.semantic_router_cfg) to trade more LLM calls for coverage.
    SEMANTIC_ROUTER_HIGH_THRESHOLD = float(os.getenv("SEMANTIC_ROUTER_HIGH_THRESHOLD", "0.85"))
    # A near-exact match to a curated seed (>= this) is the highest-confidence signal there is,
    # so it routes directly even if lower-ranked neighbours from other domains break agreement
    # (e.g. "find python developers" matches its seed at 1.00 though "python" also pulls install
    # neighbours into the top-k). Bypasses the agreement check only.
    SEMANTIC_ROUTER_STRONG_THRESHOLD = float(os.getenv("SEMANTIC_ROUTER_STRONG_THRESHOLD", "0.90"))
    # Below this → too weak to trust the neighbours; fall through to the LLM router.
    SEMANTIC_ROUTER_AMBIG_LOW = float(os.getenv("SEMANTIC_ROUTER_AMBIG_LOW", "0.55"))
    # Fraction of the top-k neighbours that must share the winning domain for a HIGH route.
    SEMANTIC_ROUTER_AGREE_FRAC = float(os.getenv("SEMANTIC_ROUTER_AGREE_FRAC", "0.6"))
    # Neighbours fetched per lookup.
    SEMANTIC_ROUTER_K = int(os.getenv("SEMANTIC_ROUTER_K", "5"))

    # Database
    DATABASE_URL = _resolve_db_url()

    # Redis
    REDIS_URL = _resolve_redis_url()
    USE_MEMORY_SAVER = os.getenv("USE_MEMORY_SAVER", "false").lower() == "true"

    # Microsoft Graph (used for webhook subscriptions / general Graph calls)
    GRAPH_TENANT_ID = os.getenv("GRAPH_TENANT_ID")
    GRAPH_CLIENT_ID = os.getenv("GRAPH_CLIENT_ID")
    GRAPH_CLIENT_SECRET = os.getenv("GRAPH_CLIENT_SECRET")
    GRAPH_CLIENT_STATE = os.getenv("GRAPH_CLIENT_STATE", "secretClientState")

    # SharePoint document ingestion reuses the single GRAPH_* Azure AD app
    # (see graph_sync.GraphClient); no separate SharePoint credentials.
    # Base folder path inside the document library.
    # Graph API drive root IS "Shared Documents", so strip that prefix automatically.
    # e.g. SHAREPOINT_FOLDER_PATH=/Shared Documents/IQ/ → SHAREPOINT_BASE_FOLDER = "IQ"
    SHAREPOINT_BASE_FOLDER = (
        lambda raw: (
            raw[len("shared documents/"):].strip("/")
            if raw.lower().startswith("shared documents/")
            else ("" if raw.lower() == "shared documents" else raw)
        )
    )(os.getenv("SHAREPOINT_FOLDER_PATH", "").strip("/").strip())

    # ── AI chat concurrency gate ──────────────────────────────────────────────
    # Caps simultaneous LLM generations so a burst of users doesn't overwhelm the
    # shared GPU server. Extra requests wait in a bounded queue; when the queue is
    # full they're rejected fast with a "busy" signal. Tune CHAT_MAX_CONCURRENCY to
    # the number of parallel generations ml01 sustains at acceptable latency.
    CHAT_MAX_CONCURRENCY = int(os.getenv("CHAT_MAX_CONCURRENCY", "8"))
    CHAT_MAX_QUEUE = int(os.getenv("CHAT_MAX_QUEUE", "50"))
    CHAT_QUEUE_TIMEOUT = float(os.getenv("CHAT_QUEUE_TIMEOUT_SECONDS", "90"))

    # Company website — the public portal the Company Context can be auto-pulled from.
    # The super-admin "Pull from portal" action fetches this site, extracts the text, and
    # the LLM distills it into a factual company profile (see company_settings_service).
    COMPANY_WEBSITE_URL = os.getenv("COMPANY_WEBSITE_URL", "https://alignedautomation.com")

    # App
    DEFAULT_USER_EMAIL = os.getenv("DEFAULT_USER_EMAIL", "employee1@centriq.ai")
    # Demo leave balances: when the signed-in user can't be matched to a row in
    # app/data/leave_balances.csv, fall back to this employee code (AASPL-####) so
    # the demo still shows real CSV data. Empty -> use the generic static fixture.
    LEAVE_BALANCE_DEMO_EMPLOYEE = os.getenv("LEAVE_BALANCE_DEMO_EMPLOYEE", "AASPL-1333")
    PORT = int(os.getenv("PORT", "8080"))
    HOST = os.getenv("HOST", "0.0.0.0")

    # ── Access allowlist ──────────────────────────────────────────────────────
    # Anyone who can SSO in with an @alignedautomation.com account may use the
    # app — access is gated by Azure AD SSO itself, not a hand-maintained list.
    # Override via ALLOWED_EMAIL_DOMAIN env var if the company domain changes.
    ALLOWED_EMAIL_DOMAIN = os.getenv("ALLOWED_EMAIL_DOMAIN", "alignedautomation.com").strip().lower()

    # Only this Super Admin may use the test-role-switcher (x-impersonate-role). Other
    # accounts granted "super admin" via a DB override still can't switch roles — the
    # capability is pinned to one trusted person, not the role itself.
    ROLE_SWITCH_ALLOWED_EMAIL = os.getenv(
        "ROLE_SWITCH_ALLOWED_EMAIL", "shivam.sharma@alignedautomation.com"
    ).strip().lower()

    # Email — all outbound notifications go to this address (Teams channel or shared inbox)
    # Set NOTIFY_TO_EMAIL in .env — no fallback; emails are silently skipped if unset
    NOTIFY_TO_EMAIL = os.getenv("NOTIFY_TO_EMAIL", "")
    # When EMAIL_TEST_MODE=true (the default), _send() intercepts every outbound email
    # and redirects it to NOTIFY_TO_EMAIL regardless of the original recipient.
    # The original To address is appended to the subject so you can see where it would
    # have gone.  Set EMAIL_TEST_MODE=false in .env only when ready for real delivery.
    EMAIL_TEST_MODE = os.getenv("EMAIL_TEST_MODE", "true").lower() not in ("false", "0", "no")
    HELPDESK_EMAIL = os.getenv("HELPDESK_EMAIL", "shivam.sharma@alignedautomation.com")
    # Mailbox used as the SENDER for unattended/background emails (parking reminders).
    # Must be an account that has connected MS365 (delegated Graph token). Falls back to NOTIFY_TO_EMAIL.
    PARKING_REMINDER_SENDER = os.getenv("PARKING_REMINDER_SENDER", "")
    # Bookshelf Buddy — book request notifications go to this admin
    BOOKSHELF_NOTIFY_EMAIL = os.getenv("BOOKSHELF_NOTIFY_EMAIL", "shivam.sharma@alignedautomation.com")
    # Nexus Library mock server — single source of truth for book inventory
    NEXUS_LIBRARY_URL = os.getenv("NEXUS_LIBRARY_URL", "http://localhost:8092")
    APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:8080")

    # Base URL used ONLY for OAuth redirect URIs and the connect-popup postMessage
    # origin. Falls back to APP_BASE_URL. Set this to the browser-facing origin
    # (e.g. http://localhost:3000 in local dev) when it differs from APP_BASE_URL,
    # which also drives email/deep links. The provider callback is
    # {OAUTH_REDIRECT_BASE_URL}/api/integrations/callback/{provider} and must be
    # registered verbatim in the Microsoft / Zoho app console.
    OAUTH_REDIRECT_BASE_URL = os.getenv("OAUTH_REDIRECT_BASE_URL", "") or APP_BASE_URL

    # Power Automate — SharePoint/PowerApps complaint sync
    # Set this to the HTTP trigger URL from your Power Automate flow.
    # Leave empty to disable; complaints will still save locally and email admins.
    POWER_AUTOMATE_WEBHOOK_URL = os.getenv("POWER_AUTOMATE_WEBHOOK_URL", "")
    # Per-use-case PA webhook URLs — empty string disables that hook; local flows still run
    PA_WEBHOOK_REIMBURSEMENT_DECISION  = os.getenv("PA_WEBHOOK_REIMBURSEMENT_DECISION", "")
    PA_WEBHOOK_PARKING_ACTIVATED       = os.getenv("PA_WEBHOOK_PARKING_ACTIVATED", "")
    PA_WEBHOOK_PARKING_REVOKED         = os.getenv("PA_WEBHOOK_PARKING_REVOKED", "")
    PA_WEBHOOK_LEAVE_APPROVED          = os.getenv("PA_WEBHOOK_LEAVE_APPROVED", "")
    PA_WEBHOOK_ANNOUNCEMENT_CREATED    = os.getenv("PA_WEBHOOK_ANNOUNCEMENT_CREATED", "")
    PA_WEBHOOK_COMPLAINT_NEW           = os.getenv("PA_WEBHOOK_COMPLAINT_NEW", "")
    PA_WEBHOOK_REIMBURSEMENT_SUBMITTED = os.getenv("PA_WEBHOOK_REIMBURSEMENT_SUBMITTED", "")
    PA_CALLBACK_SECRET                 = os.getenv("PA_CALLBACK_SECRET", "")

    # ── Connected Accounts (OAuth2 delegated -- per-user token storage) ────────
    # Microsoft: reuses MSAL app registration (add Web platform + client secret)
    MICROSOFT_OAUTH_CLIENT_ID = (
        os.getenv("MICROSOFT_OAUTH_CLIENT_ID")
        or os.getenv("VITE_MSAL_CLIENT_ID", "")
    )
    MICROSOFT_OAUTH_CLIENT_SECRET = os.getenv("MICROSOFT_OAUTH_CLIENT_SECRET", "")
    MICROSOFT_OAUTH_TENANT_ID = (
        os.getenv("MICROSOFT_OAUTH_TENANT_ID")
        or os.getenv("VITE_MSAL_TENANT_ID")
        or os.getenv("GRAPH_TENANT_ID", "")
    )
    # NOTE: org-directory reads (all users, any user's profile/manager/reports) use the
    # *application* User.Read.All on the GRAPH_* app via client-credentials — NOT a
    # delegated scope (see ms365_service._app_token). So User.Read.All is deliberately
    # absent here; the delegated flow only needs the signed-in user's own + basic reads.
    MICROSOFT_OAUTH_SCOPES = os.getenv(
        "MICROSOFT_OAUTH_SCOPES",
        "openid profile email offline_access User.Read User.ReadBasic.All "
        "Mail.Read Mail.ReadWrite Mail.Send "
        "Calendars.Read Calendars.Read.Shared Calendars.ReadWrite "
        "Chat.Read Chat.ReadWrite "
        "Place.Read.All "
        "Team.ReadBasic.All Channel.ReadBasic.All "
        "ChannelMessage.Read.All ChannelMessage.Send "
        # Teams Activity-feed notifications (sendActivityNotification). Inert until the
        # Centriq Teams app is installed per user + admin consent is granted; users must
        # reconnect MS365 after this scope is added so the new consent is captured.
        "TeamsActivity.Send",
    )

    # ── Proactive Nudge layer (system-initiated, deterministic — zero LLM) ────
    # A background scan turns the assistant from reactive → proactive: it detects
    # actionable situations (leaves about to lapse, an approval the manager hasn't
    # actioned) and surfaces a one-click nudge in the in-app feed. Detection is
    # pure DB look-ups; the LLM is NOT in the loop (messages are templated).
    # The in-app feed is the source of truth; Teams/email push is best-effort and
    # gated OFF by default (stays silent until Azure/Teams is provisioned).
    NUDGE_SCAN_INTERVAL_MIN = int(os.getenv("NUDGE_SCAN_INTERVAL_MIN", "30"))
    # Earned/non-carry-forward leaves with a remaining balance lapse at the FINANCIAL
    # year-end. The company follows the Indian financial year (ends 31 March), so the
    # default is "03-31". There is no fiscal-year concept in the schema, hence it's
    # defined here as MM-DD. NOTE: LeaveBalance is calendar-year-bucketed throughout
    # the app — but the expiry window (LEAVE_EXPIRY_WINDOW_DAYS before 31 Mar) always
    # lands in Jan–Mar, the same calendar year as that 31 Mar, so the detector's
    # current-calendar-year balance lookup lines up with what the user sees.
    FISCAL_YEAR_END = os.getenv("FISCAL_YEAR_END", "03-31")
    LEAVE_EXPIRY_WINDOW_DAYS = int(os.getenv("LEAVE_EXPIRY_WINDOW_DAYS", "45"))
    # A leave left "Pending" longer than this many days is treated as stale → the
    # employee gets a one-click "nudge manager" to re-send the approval request.
    STALE_APPROVAL_DAYS = int(os.getenv("STALE_APPROVAL_DAYS", "3"))
    # A nudge auto-expires (drops off the feed) this many days after creation.
    NUDGE_TTL_DAYS = int(os.getenv("NUDGE_TTL_DAYS", "14"))
    # Minimum gap between successive "nudge manager" re-sends for the same request,
    # so a manager can't be spammed by repeated clicks.
    NUDGE_MANAGER_COOLDOWN_HOURS = int(os.getenv("NUDGE_MANAGER_COOLDOWN_HOURS", "24"))
    # Master switch for best-effort Teams/email push of new nudges. OFF until Azure
    # is set up (see "Teams notification model"); the in-app feed works regardless.
    NUDGE_PUSH_ENABLED = os.getenv("NUDGE_PUSH_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")

    # ── Employee onboarding journey ───────────────────────────────────────────
    # A new hire (joining_date within this many days) gets a guided, tracked
    # onboarding flow: a personal step-by-step page, proactive nudges for the next
    # step, and an HR tracking view. See services/onboarding_service.py.
    ONBOARDING_WINDOW_DAYS = int(os.getenv("ONBOARDING_WINDOW_DAYS", "60"))
    # A journey with no step completed in this many days is flagged "stalled" in the
    # HR tracker so HR can follow up.
    ONBOARDING_STALL_DAYS = int(os.getenv("ONBOARDING_STALL_DAYS", "7"))
    # Filled joining documents are emailed to this address (the HR inbox). Falls back
    # to NOTIFY_TO_EMAIL. Uploads are recorded regardless of whether the email sends.
    ONBOARDING_HR_EMAIL = os.getenv("ONBOARDING_HR_EMAIL", "") or os.getenv("NOTIFY_TO_EMAIL", "")
    # Induction video shown in the journey's video step. A direct URL the in-app HTML5
    # player can load (e.g. a SharePoint/Stream/CDN MP4). Chapters let the hire seek.
    INDUCTION_VIDEO_URL = os.getenv("INDUCTION_VIDEO_URL", "")
    INDUCTION_VIDEO_TITLE = os.getenv("INDUCTION_VIDEO_TITLE", "Welcome to the team")

    # ── Action receipts + undo ────────────────────────────────────────────────
    # Every executed write action emits a durable ActionReceipt. For actions whose
    # downstream still allows reversal (a freshly-created IT ticket / HR query that no
    # one has actioned yet), the receipt carries a one-click undo link valid for this
    # many minutes after execution. 0 disables the time window (undo allowed until the
    # downstream itself closes the door, e.g. the ticket leaves "Open").
    RECEIPT_UNDO_WINDOW_MIN = int(os.getenv("RECEIPT_UNDO_WINDOW_MIN", "120"))

    # ── Teams Activity-feed notifications ─────────────────────────────────────
    # Decisions, reminders and info notices are emailed AND pinged to the recipient's
    # Teams Activity feed (the bell) via Graph sendActivityNotification. This stays a
    # no-op until the prerequisites are provisioned (Centriq Teams app installed for the
    # user, TeamsActivity.Send consented, activityType declared in the app manifest).
    TEAMS_ACTIVITY_NOTIFICATIONS_ENABLED = os.getenv(
        "TEAMS_ACTIVITY_NOTIFICATIONS_ENABLED", "false"
    ).strip().lower() in ("1", "true", "yes", "on")
    # activityType must match an entry declared in the Teams app manifest's
    # activities.activityTypes (Graph rejects undeclared types with 400).
    TEAMS_ACTIVITY_TYPE = os.getenv("TEAMS_ACTIVITY_TYPE", "centriqNotification")
    # Fernet key for encrypting tokens at rest (32-byte URL-safe base64)
    TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")

    # ── External Portal Automation (Playwright MCP) ───────────────────────────
    ZOHO_PEOPLE_URL    = os.getenv("ZOHO_PEOPLE_URL", "")
    # Deep-link to the Zoho People document/letter generation area (employees fill it
    # there). The exact hash route varies per org — override this env var with the
    # confirmed URL. Falls back to ZOHO_PEOPLE_URL / people.zoho.com when unset.
    ZOHO_PEOPLE_DOCS_URL = os.getenv("ZOHO_PEOPLE_DOCS_URL", "")
    # Zoho OAuth2 API (replaces session-file scraping)
    ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID", "")
    ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET", "")
    ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN", "")
    ZOHO_ACCOUNTS_URL  = os.getenv("ZOHO_ACCOUNTS_URL", "") or "https://accounts.zoho.com"
    ZOHO_BASE_URL      = os.getenv("ZOHO_BASE_URL", "") or "https://people.zoho.com"
    # Expense and Recruit live on different hosts than People (cannot reuse ZOHO_BASE_URL).
    # Recruit's data API is recruit.zoho.com/recruit/v2 (the www.zohoapis.com/recruit form
    # bounces to a CRM error page). On the .in datacenter, override these env vars to .in.
    ZOHO_EXPENSE_BASE_URL = os.getenv("ZOHO_EXPENSE_BASE_URL", "") or "https://www.zohoapis.com/expense/v1"
    ZOHO_RECRUIT_BASE_URL = os.getenv("ZOHO_RECRUIT_BASE_URL", "") or "https://recruit.zoho.com/recruit/v2"
    # DEMO MODE: when true, all Zoho service calls (People/Expense/Recruit) return realistic
    # mock data instead of hitting the live API. Used for competition demos while real API
    # access is pending org approval. Flip to false once the admin grants API access.
    ZOHO_DEMO_MODE     = os.getenv("ZOHO_DEMO_MODE", "true").lower() in ("1", "true", "yes", "on")
    POWERAPPS_URL      = os.getenv("POWERAPPS_URL", "")
    PAYROLL_PORTAL_URL = os.getenv("PAYROLL_PORTAL_URL", "")

    # ── Zoho employee-profile DB (read-only directory source) ─────────────────
    # A separate Postgres server exposes a SQL VIEW of Zoho People profiles
    # (vb_employees). The Employee Directory reads this view live instead of the
    # synced MS365/Zoho-overlay tables. ZOHO_DBURL may be a full SQLAlchemy URL
    # (postgresql://host:port/db, creds optional) or a bare host[:port][/db];
    # username/password/view are supplied separately. Empty = feature disabled
    # (directory falls back to the MS365 source). See services/zoho_directory_service.py.
    ZOHO_DBURL     = os.getenv("ZOHO_DBURL", "")
    ZOHO_USERNAME  = os.getenv("ZOHO_USERNAME", "")
    ZOHO_PASSWORD  = os.getenv("ZOHO_PASSWORD", "")
    ZOHO_VIEW      = os.getenv("ZOHO_VIEW", "vb_employees")

    # ── Zoho leave DB (read-only leave source, same server as ZOHO_DBURL) ─────
    # Same reporting Postgres server also exposes leave-tracker views in the
    # "people" schema. Used by services/zoho_leave_service.py instead of the
    # synthetic LeaveType/LeaveBalance tables or the CSV/REST fallback.
    ZOHO_LEAVE_TYPES_VIEW    = os.getenv("ZOHO_LEAVE_TYPES_VIEW", "people.vt_leave_types")
    ZOHO_LEAVE_BALANCES_VIEW = os.getenv("ZOHO_LEAVE_BALANCES_VIEW", "people.vt_leave_balances")
    ZOHO_LEAVE_DETAILS_VIEW  = os.getenv("ZOHO_LEAVE_DETAILS_VIEW", "people.vt_leave_details")
    ZOHO_HOLIDAY_LIST_VIEW   = os.getenv("ZOHO_HOLIDAY_LIST_VIEW", "people.vt_holiday_list")

    # ── eSSL Attendance DB (read-only SQL Server source) ──────────────────────
    # A separate SQL Server database exposes a view of eSSL biometric attendance
    # punches (dbo.vbUserTimeEntryLog). When configured, attendance queries use
    # this live source instead of the locally-seeded dummy table. Employee records
    # are matched by name (USERNAME column). ATTENDANCE_DBURL may be a JDBC-style
    # URL (jdbc:sqlserver://;serverName=...;databaseName=...) or a plain MSSQL URL.
    # Requires a Microsoft ODBC Driver for SQL Server on the host/container OS
    # (Driver 18 in the prod image, Driver 17 on Windows dev — auto-detected).
    ATTENDANCE_DBURL     = os.getenv("ATTENDANCE_DBURL", "")
    ATTENDANCE_USERNAME  = os.getenv("ATTENDANCE_USERNAME", "")
    ATTENDANCE_PASSWORD  = os.getenv("ATTENDANCE_PASSWORD", "")
    ATTENDANCE_VIEW      = os.getenv("ATTENDANCE_VIEW", "dbo.vbUserTimeEntryLog")
    # ODBC driver name — leave blank to auto-detect the newest installed
    # "ODBC Driver NN for SQL Server". Override only if you must pin a specific one.
    ATTENDANCE_ODBC_DRIVER = os.getenv("ATTENDANCE_ODBC_DRIVER", "")
    # Encrypt mode. Driver 18 defaults to Encrypt=yes; the internal eSSL server has no
    # TLS, so default to "no" to mirror the working Driver-17 connection. Set to "yes"
    # if the server presents a certificate.
    ATTENDANCE_ODBC_ENCRYPT = os.getenv("ATTENDANCE_ODBC_ENCRYPT", "no")
    # Check-in after this time (HH:MM, 24h) counts as "Late" on a Present day.
    # Single source of truth for late-arrival across all attendance features.
    ATTENDANCE_LATE_CUTOFF = os.getenv("ATTENDANCE_LATE_CUTOFF", "13:00")

    # ── Alchemy Skills Portal (Azure AD-secured internal API) ─────────────────
    ALCHEMY_BASE_URL          = os.getenv("ALCHEMY_BASE_URL", "https://apps.alignedautomation.com/alchemyapi/api/v1")
    # Prefix prepended to numeric employee IDs when calling the Alchemy API.
    # DB stores "1540", Alchemy expects "AASPL-1540" → prefix = "AASPL-"
    ALCHEMY_EMPLOYEE_PREFIX   = os.getenv("ALCHEMY_EMPLOYEE_PREFIX", "AASPL-")
    # Master switch for skill-based people search ("find python developers"):
    #   true  → query the authoritative Alchemy Skills Portal (skill name → id → users)
    #   false → fall back to the internal DB directory (dummy/demo data)
    ALCHEMY_SKILL_SEARCH_ENABLED = os.getenv("ALCHEMY_SKILL_SEARCH_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    # Email of a connected-Microsoft account used as the shared SERVICE identity to read
    # any employee's Alchemy skills/projects for the directory (Alchemy allows cross-user
    # reads with one token). Blank → fall back to the first active Microsoft connection.
    ALCHEMY_SERVICE_EMAIL = os.getenv("ALCHEMY_SERVICE_EMAIL", "")

    # ── TechElevate Local LMS ─────────────────────────────────────────────────
    TECHELEVATE_LOCAL    = os.getenv("TECHELEVATE_LOCAL", "true").lower() in ("1", "true", "yes", "on")
    TECHELEVATE_SEED_ASSIGNMENTS = os.getenv("TECHELEVATE_SEED_ASSIGNMENTS", "false").lower() in ("1", "true", "yes", "on")
    TECHELEVATE_PORTAL_URL = os.getenv("TECHELEVATE_PORTAL_URL", "")

    # ── Udemy Business (Enterprise REST API, HTTP Basic auth) ─────────────────
    # Org-level service credential — NOT per-user OAuth. The client id/secret are
    # base64-encoded as Basic auth against https://{subdomain}.udemy.com/api-2.0.
    # Catalog + reporting endpoints are scoped to the numeric organization id.
    UDEMY_SUBDOMAIN     = os.getenv("UDEMY_SUBDOMAIN", "alignedautomation")
    UDEMY_ORG_ID        = os.getenv("UDEMY_ORG_ID", "178490")
    UDEMY_CLIENT_ID     = os.getenv("UDEMY_CLIENT_ID", "")
    UDEMY_CLIENT_SECRET = os.getenv("UDEMY_CLIENT_SECRET", "")
    UDEMY_ENABLED       = os.getenv("UDEMY_ENABLED", "true").lower() in ("1", "true", "yes", "on")

    @property
    def UDEMY_API_BASE(self) -> str:
        return f"https://{self.UDEMY_SUBDOMAIN}.udemy.com/api-2.0"

    @property
    def UDEMY_PORTAL_BASE(self) -> str:
        return f"https://{self.UDEMY_SUBDOMAIN}.udemy.com"

    # Udemy seat ledger. The Reporting API can NOT reproduce Udemy's live seat count:
    # org/subscription endpoints are blocked, pending invitations (which consume a
    # seat) aren't readable, and the activity report's active flag != billing. So PMO
    # reads these two numbers off the Udemy admin dashboard and sets them here; used
    # is derived as purchased - available so the pills match Udemy exactly.
    # Defaults from PMO 2026-06-29: 230 purchased, 1 available. AVAILABLE -1 = unknown.
    UDEMY_LICENSE_TOTAL = int(os.getenv("UDEMY_LICENSE_TOTAL", "230"))
    UDEMY_LICENSE_AVAILABLE = int(os.getenv("UDEMY_LICENSE_AVAILABLE", "1"))

    # Seat-hygiene: a learner with no Udemy visit in this many days is "inactive"
    # and surfaced to PMO/HR so they can manually deactivate the seat in Udemy
    # admin (we don't auto-revoke — the actual deactivation lives in Udemy/Entra).
    UDEMY_INACTIVE_DEFAULT_DAYS = int(os.getenv("UDEMY_INACTIVE_DEFAULT_DAYS", "30"))

    # ── Udemy SCIM 2.0 provisioning (SEPARATE registered app) ─────────────────
    # Distinct from the catalog/reporting Basic-auth credential above: SCIM is a
    # different Udemy app with its own Bearer token + base URL (from Udemy's
    # provisioning setup page). Drives real provision/deprovision/groups/license
    # pools. Dormant until both are set — every SCIM call no-ops with "not_configured"
    # so the app runs fine without it. Azure AD (or Custom/OneLogin/Okta) is the IdP.
    UDEMY_SCIM_BASE_URL = os.getenv("UDEMY_SCIM_BASE_URL", "").rstrip("/")
    UDEMY_SCIM_TOKEN    = os.getenv("UDEMY_SCIM_TOKEN", "")
    UDEMY_SCIM_ENABLED  = os.getenv("UDEMY_SCIM_ENABLED", "true").lower() in ("1", "true", "yes", "on")

    @property
    def UDEMY_ADMIN_USERS_URL(self) -> str:
        """Deep-link to the Udemy Business admin 'Manage Users' list (search + the
        three-dots → Deactivate menu live here). Used as the fallback when a learner's
        numeric id is unknown. Must end with a trailing slash; per-user detail pages
        are built as '<this>detail/<id>/'. Overridable via env if Udemy moves the path."""
        return os.getenv(
            "UDEMY_ADMIN_USERS_URL",
            f"https://{self.UDEMY_SUBDOMAIN}.udemy.com/organization-manage-v2/users/",
        )

    # ── ManageEngine Endpoint Central ─────────────────────────────────────────
    # Set to http://localhost:8091 to use the mock server during development.
    MANAGE_ENGINE_BASE_URL = os.getenv("MANAGE_ENGINE_BASE_URL", "http://localhost:8091")
    MANAGE_ENGINE_API_KEY = os.getenv("MANAGE_ENGINE_API_KEY", "mock-api-key")

    # ── SharePoint Policy Sync ─────────────────────────────────────────────────
    # Full SharePoint site URL, e.g. https://tenant.sharepoint.com/sites/Centriq
    SHAREPOINT_SITE_URL = os.getenv("SHAREPOINT_SITE_URL", "")
    # Comma-separated folder names in the document library to sync as policies
    # These are top-level folder names, e.g. "ADMIN,IT PMO,HR"
    SHAREPOINT_POLICY_FOLDERS = os.getenv("SHAREPOINT_POLICY_FOLDERS", "ADMIN,IT PMO")
    # How often (seconds) to poll SharePoint for new/changed files (default 10 min)
    SHAREPOINT_SYNC_INTERVAL = int(os.getenv("SHAREPOINT_SYNC_INTERVAL_SECONDS", "600"))

    # ── SharePoint Document-Template Sync ──────────────────────────────────────
    # FULL path (from the document-library root) to the folder holding the HR document
    # templates — plain PDF/DOCX, no markup. This is a SIBLING of the policies folder, NOT
    # under SHAREPOINT_BASE_FOLDER; set it like SHAREPOINT_PROJECTS_ROOT, e.g.
    # "General/Templates". Each file becomes a generatable document type. Blank = disabled.
    SHAREPOINT_TEMPLATES_FOLDER = os.getenv("SHAREPOINT_TEMPLATES_FOLDER", "")
    # File extensions to ingest as templates. DOCX only — HR authors letters in Word with
    # {{ placeholder }} fields; generation fills the .docx and renders it via Word (keeps layout).
    SHAREPOINT_TEMPLATES_EXTS = os.getenv("SHAREPOINT_TEMPLATES_EXTS", "docx")
    # Company name used for the {{company_name}} auto-field in generated documents.
    DOC_COMPANY_NAME = os.getenv("DOC_COMPANY_NAME", "Aligned Automation")

    # ── SharePoint Company-Project Sync ────────────────────────────────────────
    # Root folder holding one sub-folder per company/project (summaries, demo
    # transcripts, project details). Inner structure may change; the top-level
    # sub-folder name is used as the project key. Leave blank to disable.
    SHAREPOINT_PROJECTS_ROOT = os.getenv("SHAREPOINT_PROJECTS_ROOT", "General/Projects")
    # File extensions to ingest from project folders (comma-separated, no dots).
    # xlsx/csv excluded — large tabular files cause MemoryError in MarkItDown.
    SHAREPOINT_PROJECT_EXTS = os.getenv(
        "SHAREPOINT_PROJECT_EXTS", "pdf,docx,pptx,vtt,srt,txt,md,html,htm"
    )

    # ── Observability content-reveal access (Azure AD groups, validated JWT) ───
    # When enabled, the /observability reveal endpoints validate the Azure access
    # token (signature/audience/issuer) and read the `groups` claim. When disabled
    # (local dev), they fall back to header identity + DEV_REVEAL_DOMAINS.
    AZURE_JWT_ENABLED = os.getenv("AZURE_JWT_ENABLED", "false").lower() == "true"
    AZURE_TENANT_ID = os.getenv("AZURE_TENANT_ID") or os.getenv("GRAPH_TENANT_ID", "")
    AZURE_CLIENT_ID = os.getenv("AZURE_CLIENT_ID") or os.getenv("VITE_MSAL_CLIENT_ID", "")
    AZURE_API_AUDIENCE = os.getenv("AZURE_API_AUDIENCE") or (
        f"api://{os.getenv('AZURE_CLIENT_ID') or os.getenv('VITE_MSAL_CLIENT_ID', '')}"
    )
    # Domains a dev user may reveal when AZURE_JWT_ENABLED is false.
    DEV_REVEAL_DOMAINS = [
        d.strip() for d in os.getenv(
            "DEV_REVEAL_DOMAINS", "hr,it_support,pmo,admin,general"
        ).split(",") if d.strip()
    ]

    # Map of conversation domain → set of Azure AD security-group object IDs whose
    # members may reveal that domain's content. Each env var is a CSV of GUIDs.
    REVEAL_GROUP_DOMAIN_MAP = {
        domain: {g.strip() for g in os.getenv(env_var, "").split(",") if g.strip()}
        for domain, env_var in (
            ("hr", "REVEAL_GROUP_HR"),
            ("it_support", "REVEAL_GROUP_IT"),
            ("pmo", "REVEAL_GROUP_PMO"),
            ("admin", "REVEAL_GROUP_ADMIN"),
            ("general", "REVEAL_GROUP_GENERAL"),
        )
    }

settings = Config()
