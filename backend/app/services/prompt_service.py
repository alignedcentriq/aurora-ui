import datetime
import hashlib
import json
import re
import time
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import PromptConfig, PromptDraft
from app.redis_config import get_redis_client

# Module-level cache for company context — avoid a DB hit on every single LLM call
_company_ctx_cache: dict = {"value": None, "ts": 0.0}
_COMPANY_CTX_TTL = 60.0  # seconds

# L1 in-process caches for system_prompt and guardrail — avoids a Redis round-trip on every
# agent call (which can be 3-4 per request). TTL matches the Redis TTL so they stay consistent.
_sysprompt_l1_cache: dict[str, tuple[str, float]] = {}
_SYSPROMPT_L1_TTL = 30.0  # seconds
_guardrail_l1_cache: dict[str, tuple[str, float]] = {}
_GUARDRAIL_L1_TTL = 60.0  # seconds

# Per-domain cache: does the domain have any custom (non-system_prompt, non-guardrail) context?
_custom_ctx_exists_cache: dict[str, tuple[bool, float]] = {}
_CUSTOM_CTX_TTL = 60.0  # seconds

# Per-domain cache: the actual custom configs (key + value) for fast lookup
_custom_configs_cache: dict[str, tuple[list, float]] = {}
_CUSTOM_CONFIGS_TTL = 30.0  # seconds

# Cache for context relevance check results — avoids repeated LLM calls for same question
_context_relevance_cache: dict[str, tuple[str | None, float]] = {}
_CONTEXT_RELEVANCE_TTL = 90.0  # seconds

# Synonym map: expands single base words to related terms for keyword matching
_CONTEXT_KEYWORD_SYNONYMS: dict[str, set[str]] = {
    "hiring":   {"hire", "hired", "job", "jobs", "position", "positions",
                 "vacancy", "vacancies", "opening", "openings", "recruit",
                 "recruitment", "headcount", "workforce", "staff"},
    "training": {"train", "trained", "course", "learning", "workshop",
                 "program", "programme", "upskill", "certification", "module"},
    "freeze":   {"frozen", "pause", "paused", "hold", "halt", "stop", "stopped",
                 "suspended", "on hold"},
    "policy":   {"policies", "rule", "rules", "guideline", "guidelines", "procedure"},
    "leave":    {"leaves", "absence", "vacation", "time off", "day off"},
}

_CONTEXT_STOP_WORDS = {
    "is", "are", "there", "any", "a", "an", "the", "what", "how", "does", "do",
    "can", "will", "have", "has", "i", "my", "we", "our", "about", "for",
    "of", "in", "on", "at", "it", "this", "that", "was", "be", "been",
    "with", "from", "by", "to", "and", "or", "not", "no", "yes", "please",
    "tell", "me", "know", "want", "need", "get", "give", "show",
}

# Roles allowed to manage each domain's prompts
ROLE_DOMAIN_MAP: dict[str, list[str]] = {
    "hr": ["hr"],
    "it": ["it_support"],
    "pmo": ["pmo"],
    "admin": ["hr", "admin", "it_support", "pmo", "functional_manager"],
    "super admin": ["general"],
}

UNIVERSAL_GUARDRAIL = """
GROUNDING:
- Answer ONLY from tool results, database data, policies in this conversation, or information explicitly provided in the [DOMAIN CONTEXT] section of the system prompt. Never use training knowledge.
- For service requests with a matching tool, ALWAYS call the tool. Ask for missing details if needed.
- If outside your domain AND not covered in [DOMAIN CONTEXT]: "This is outside my area. Please contact the relevant team."
- Never fabricate employee data, project data, policy details, ticket IDs, or dates.

CONVERSATION:
- Read full conversation history before responding. Never repeat a question already asked.
- Never re-ask for information the user already provided earlier.
- For follow-ups, answer ONLY the specific point asked in 1-3 lines. Do not re-summarize.
- Act immediately when intent is clear. Ask ONE missing field at a time.

OUTPUT:
- No HTML tags. No markdown tables (no | pipes). Use bullet points (-) or numbered lists only.
- Never mention document metadata: author/reviewer names, version numbers, review dates, confidentiality notices.
- Policy answers: state policy name once, focus on rules/procedures/entitlements/contacts only.
- Images only when meaningful (diagrams, forms). No logos or headers.

RESPONSE FORMAT — CRITICAL:
- NEVER generate a simulated dialogue, roleplay, or scripted conversation. Do NOT use labels like "You:", "Me:", "User:", "Shivam:", "Employee:", or any name/role prefix.
- NEVER write out a fictional back-and-forth exchange as part of your answer.
- Respond directly to the user in first person (e.g. "Here are the VPN setup steps:…"). One voice, one response.
- Do NOT add meta-commentary like "(Note: I will wait for Shivam's response…)" or stage directions.
"""


# Conversational/meta replies that mean the model did NOT actually answer from context.
# Chat-tuned models (gpt-oss, and sometimes the small instruct models) emit these instead
# of the required NO_CONTEXT token; we must treat them as "not covered" so the request
# falls through to the agent's tools rather than returning the filler as an answer.
_NON_ANSWER_RE = re.compile(
    r"(go ahead and ask|please (go ahead|provide|ask|share|specify|tell me|let me know)|"
    r"\bi'?m ready\b|\bi am ready\b|ready to (answer|help|assist)|"
    r"what(?:'s| is| would)? your question|how (can|may) i (help|assist)|"
    r"feel free to ask|ask (me )?(your|any|the) question|"
    r"i (don'?t|do not) have (enough|any|sufficient) (context|information|details)|"
    r"happy to (help|answer|assist))",
    re.I,
)


def _keyword_pre_filter(query: str, configs: list[dict]) -> bool:
    """Return True if the query has keyword overlap with any context config (LLM check needed).
    Returns False when there is clearly no match — caller can skip the LLM entirely.
    """
    raw_q_words = set(re.findall(r'\b\w+\b', query.lower())) - _CONTEXT_STOP_WORDS
    if not raw_q_words:
        return False

    # Expand query words with synonyms
    q_words = set(raw_q_words)
    for base, syns in _CONTEXT_KEYWORD_SYNONYMS.items():
        if base in raw_q_words or raw_q_words & syns:
            q_words.add(base)
            q_words |= syns

    for cfg in configs:
        ctx_raw = set(cfg['key'].replace('_', ' ').lower().split())
        ctx_raw |= set(re.findall(r'\b\w+\b', cfg['value'].lower()))
        ctx_raw -= _CONTEXT_STOP_WORDS

        # Expand context words with synonyms
        ctx_words = set(ctx_raw)
        for base, syns in _CONTEXT_KEYWORD_SYNONYMS.items():
            if base in ctx_raw or ctx_raw & syns:
                ctx_words.add(base)
                ctx_words |= syns

        if q_words & ctx_words:
            return True
    return False


# Singleton LLM for context relevance checks — created once, reused every call.
# Uses the fast model (7b) with a low token cap since answers are short.
_context_llm_instance = None

def _get_context_llm():
    global _context_llm_instance
    if _context_llm_instance is None:
        from langchain_openai import ChatOpenAI
        from app.config import settings
        _context_llm_instance = ChatOpenAI(
            base_url=settings.AGENT_BASE_URL,
            api_key=settings.AGENT_API_KEY,
            model=settings.ROUTER_MODEL_NAME,
            temperature=0,
            max_tokens=200,
            timeout=120,
            # This is an internal classifier that runs INSIDE an agent node. Under
            # astream_events the runtime would otherwise stream its raw output (the
            # "NO_CONTEXT" sentinel) straight to the user, since the node isn't in the
            # main.py skip-list. Disable streaming so it only ever emits start/end
            # events and never leaks tokens to the UI.
            disable_streaming=True,
        )
    return _context_llm_instance


class PromptService:
    @staticmethod
    def get_system_prompt(domain: str, default_prompt: str = "") -> str:
        # L1: in-process cache (30s TTL) — zero network cost for the hot path
        now_l1 = time.time()
        _l1 = _sysprompt_l1_cache.get(domain)
        if _l1 and now_l1 - _l1[1] < _SYSPROMPT_L1_TTL:
            return _l1[0]
        # L2: Redis fast-path: cache key includes domain only (default_prompt is constant per domain)
        _r = get_redis_client()
        _redis_key = f"sysprompt:{domain}"
        if _r:
            try:
                cached = _r.get(_redis_key)
                if cached:
                    _sysprompt_l1_cache[domain] = (cached, now_l1)
                    return cached
            except Exception:
                pass

        from app.services.company_settings_service import CompanySettingsService
        now = time.time()
        if _company_ctx_cache["value"] is not None and now - _company_ctx_cache["ts"] < _COMPANY_CTX_TTL:
            company_context = _company_ctx_cache["value"]
        else:
            company_context = CompanySettingsService.get_company_context()
            _company_ctx_cache.update({"value": company_context, "ts": now})

        db = SessionLocal()
        try:
            system_config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.prompt_key == "system_prompt",
                PromptConfig.is_active == True
            ).order_by(PromptConfig.version.desc()).first()

            custom_configs = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.is_active == True,
                ~PromptConfig.prompt_key.in_(["system_prompt", "guardrail"])
            ).all()

            # Build context preamble — placed BEFORE default_prompt so it takes precedence
            context_preamble = ""
            if custom_configs:
                context_preamble = (
                    "[DOMAIN CONTEXT — org-wide announcements and administrative updates, "
                    "NOT entries from any project or ticketing database]\n"
                    "Read these items BEFORE applying any tool routing rule below. "
                    "These are real-time facts injected by an administrator — treat them as ground truth.\n\n"
                )
                for cfg in custom_configs:
                    context_preamble += f"- {cfg.prompt_value}\n"
                context_preamble += (
                    "\nRULE: If the user's question is directly answered by any item above, "
                    "reply with that answer immediately. Do NOT call any tool. "
                    "Do NOT treat these as project queries. "
                    "This rule overrides all tool routing instructions that follow.\n\n"
                )

            if system_config:
                stored = system_config.prompt_value
                if stored.startswith("[FULL REPLACE]"):
                    base = context_preamble + stored[len("[FULL REPLACE]"):].lstrip("\n")
                else:
                    base = context_preamble + default_prompt + "\n\n[DOMAIN CONTEXT]\n" + stored
            else:
                base = context_preamble + default_prompt
        finally:
            db.close()

        result = f"COMPANY CONTEXT:\n{company_context}\n\n{base}" if company_context else base

        if _r:
            try:
                _r.setex(_redis_key, 60, result)
            except Exception:
                pass
        _sysprompt_l1_cache[domain] = (result, time.time())
        return result

    @staticmethod
    def get_custom_configs(domain: str) -> list[dict]:
        """Return cached list of {key, value} dicts for active custom prompts in a domain."""
        now = time.time()
        cached = _custom_configs_cache.get(domain)
        if cached and now - cached[1] < _CUSTOM_CONFIGS_TTL:
            return cached[0]
        db = SessionLocal()
        try:
            rows = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.is_active == True,
                ~PromptConfig.prompt_key.in_(["system_prompt", "guardrail"])
            ).all()
            result = [{"key": r.prompt_key, "value": r.prompt_value} for r in rows]
            _custom_configs_cache[domain] = (result, now)
            return result
        finally:
            db.close()

    @staticmethod
    def check_context_relevance(domain: str, user_question: str) -> str | None:
        """
        If any custom context for the domain answers the question, return the answer.
        Returns None when the question needs tool-based lookup.

        Fast-path 1: skip entirely if no custom context exists.
        Fast-path 2: skip LLM if keyword pre-filter finds no overlap (saves ~25s per call).
        Fast-path 3: return cached result for repeated questions (TTL 90s).
        """
        custom_configs = PromptService.get_custom_configs(domain)
        if not custom_configs:
            return None

        # Fast-path: keyword pre-filter — skip LLM when query is clearly unrelated to context
        if not _keyword_pre_filter(user_question, custom_configs):
            return None

        # Cache check — Redis first, fall back to in-memory, avoids repeated LLM calls
        _q_hash = hashlib.sha256(user_question.lower().strip().encode()).hexdigest()[:16]
        _r = get_redis_client()
        _redis_ctx_key = f"ctx_rel:{domain}:{_q_hash}"
        if _r:
            try:
                cached_val = _r.get(_redis_ctx_key)
                if cached_val is not None:
                    return None if cached_val == "__NONE__" else cached_val
            except Exception:
                pass
        else:
            # In-memory fallback when Redis unavailable
            now = time.time()
            cached = _context_relevance_cache.get(f"{domain}:{_q_hash}")
            if cached and now - cached[1] < _CONTEXT_RELEVANCE_TTL:
                return cached[0]

        llm = _get_context_llm()
        from langchain_core.messages import SystemMessage as SM, HumanMessage as HM

        ctx_text = "\n".join(
            f"- [{c['key'].replace('_', ' ')}] {c['value']}" for c in custom_configs
        )
        resp = llm.invoke([
            SM(content=(
                "You are a strict classifier, NOT a chat assistant. Never greet, never ask the "
                "user anything, never add preamble.\n\n"
                "You have the following context:\n\n"
                f"{ctx_text}\n\n"
                "Rules:\n"
                "1. If the question is directly answered by the context above, output ONLY the "
                "answer text (no preamble).\n"
                "2. Otherwise output ONLY this exact token: NO_CONTEXT\n"
                "Do not explain. Do not say 'NO_CONTEXT' if you can answer."
            )),
            HM(content=user_question),
        ])
        content = (resp.content or "").strip()
        # Fail-open: treat an explicit NO_CONTEXT, an empty reply, OR conversational filler
        # (a non-answer that doesn't use the context) as "not covered" so the request falls
        # through to the agent's tools. Chat-tuned models (e.g. gpt-oss) tend to emit meta
        # replies like "I'm ready to answer, go ahead and ask" instead of NO_CONTEXT, which
        # must NOT be returned as a real answer.
        # Match NO_CONTEXT even when the model wraps it (markdown, quotes, trailing
        # punctuation) so the sentinel can never leak through as a real answer.
        if not content or re.search(r'\bNO_CONTEXT\b', content, re.IGNORECASE) \
                or _NON_ANSWER_RE.search(content):
            result = None
        else:
            result = content

        # Store in Redis (or in-memory fallback)
        if _r:
            try:
                _r.setex(_redis_ctx_key, int(_CONTEXT_RELEVANCE_TTL), result if result is not None else "__NONE__")
            except Exception:
                pass
        else:
            _context_relevance_cache[f"{domain}:{_q_hash}"] = (result, time.time())
        return result

    @staticmethod
    def has_custom_context(domain: str) -> bool:
        """Return True if the domain has any active custom (non-system_prompt, non-guardrail) prompts."""
        now = time.time()
        cached = _custom_ctx_exists_cache.get(domain)
        if cached and now - cached[1] < _CUSTOM_CTX_TTL:
            return cached[0]
        db = SessionLocal()
        try:
            exists = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.is_active == True,
                ~PromptConfig.prompt_key.in_(["system_prompt", "guardrail"])
            ).first() is not None
            _custom_ctx_exists_cache[domain] = (exists, now)
            return exists
        finally:
            db.close()

    @staticmethod
    def update_prompt(domain: str, prompt_key: str, value: str, updated_by: str, user_role: str):
        db = SessionLocal()
        try:
            # Check if role is authorized
            config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.prompt_key == prompt_key,
                PromptConfig.is_active == True
            ).order_by(PromptConfig.version.desc()).first()
            
            if config:
                allowed_roles = config.allowed_roles.split(",")
                if user_role not in allowed_roles:
                    return f"Unauthorized. Roles allowed: {config.allowed_roles}"
                
                # Deactivate current
                config.is_active = False
                new_version = config.version + 1
            else:
                new_version = 1
                allowed_roles = "admin" # Default
                
            new_config = PromptConfig(
                agent_domain=domain,
                prompt_key=prompt_key,
                prompt_value=value,
                version=new_version,
                is_active=True,
                allowed_roles=",".join(allowed_roles) if config else allowed_roles,
                created_by=updated_by
            )
            db.add(new_config)
            db.commit()
            # Invalidate all caches so next request picks up the new value
            _sysprompt_l1_cache.pop(domain, None)
            _guardrail_l1_cache.pop(domain, None)
            _guardrail_l1_cache.pop("global", None)
            _r = get_redis_client()
            if _r:
                try:
                    _r.delete(f"sysprompt:{domain}")
                    # Also clear custom configs cache
                    _custom_configs_cache.pop(domain, None)
                    _custom_ctx_exists_cache.pop(domain, None)
                except Exception:
                    pass
            return f"Prompt updated for {domain} ({prompt_key}) to version {new_version}."
        finally:
            db.close()

    @staticmethod
    def get_guardrail(domain: str = "") -> str:
        """Return the active guardrail for a domain, falling back to the universal guardrail."""
        _key = domain or "global"
        now_gl = time.time()
        _gl = _guardrail_l1_cache.get(_key)
        if _gl and now_gl - _gl[1] < _GUARDRAIL_L1_TTL:
            return _gl[0]
        db = SessionLocal()
        try:
            config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == _key,
                PromptConfig.prompt_key == "guardrail",
                PromptConfig.is_active == True,
            ).order_by(PromptConfig.version.desc()).first()
            result = config.prompt_value if config else UNIVERSAL_GUARDRAIL
            _guardrail_l1_cache[_key] = (result, now_gl)
            return result
        finally:
            db.close()

    @staticmethod
    def delete_prompt(domain: str, prompt_key: str, deleted_by: str) -> str:
        db = SessionLocal()
        try:
            config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.prompt_key == prompt_key,
                PromptConfig.is_active == True,
            ).order_by(PromptConfig.version.desc()).first()
            if not config:
                return "No active prompt found."
            config.is_active = False
            db.commit()
            return f"Prompt deleted for {domain} ({prompt_key})."
        finally:
            db.close()

    @staticmethod
    def save_draft(domain: str, prompt_key: str, value: str, submitted_by: str) -> dict:
        db = SessionLocal()
        try:
            existing = db.query(PromptDraft).filter(
                PromptDraft.agent_domain == domain,
                PromptDraft.prompt_key == prompt_key,
                PromptDraft.submitted_by == submitted_by,
                PromptDraft.status == "pending",
            ).first()
            if existing:
                existing.draft_value = value
                db.commit()
                return {"id": existing.id, "message": "Draft updated — awaiting approval."}
            draft = PromptDraft(
                agent_domain=domain,
                prompt_key=prompt_key,
                draft_value=value,
                submitted_by=submitted_by,
            )
            db.add(draft)
            db.commit()
            db.refresh(draft)
            return {"id": draft.id, "message": "Draft submitted — awaiting a second approval."}
        finally:
            db.close()

    @staticmethod
    def list_pending_drafts(domain: str = None, exclude_email: str = None) -> list:
        db = SessionLocal()
        try:
            q = db.query(PromptDraft).filter(PromptDraft.status == "pending")
            if domain:
                q = q.filter(PromptDraft.agent_domain == domain)
            if exclude_email:
                q = q.filter(PromptDraft.submitted_by != exclude_email)
            return [
                {
                    "id": d.id,
                    "domain": d.agent_domain,
                    "key": d.prompt_key,
                    "value": d.draft_value,
                    "submitted_by": d.submitted_by,
                    "created_at": d.created_at.isoformat(),
                }
                for d in q.order_by(PromptDraft.created_at.desc()).all()
            ]
        finally:
            db.close()

    @staticmethod
    def list_own_drafts(email: str) -> list:
        db = SessionLocal()
        try:
            drafts = (
                db.query(PromptDraft)
                .filter(PromptDraft.status == "pending", PromptDraft.submitted_by == email)
                .order_by(PromptDraft.created_at.desc())
                .all()
            )
            return [
                {
                    "id": d.id,
                    "domain": d.agent_domain,
                    "key": d.prompt_key,
                    "value": d.draft_value,
                    "submitted_by": d.submitted_by,
                    "created_at": d.created_at.isoformat(),
                }
                for d in drafts
            ]
        finally:
            db.close()

    @staticmethod
    def approve_draft(draft_id: int, reviewed_by: str) -> str:
        db = SessionLocal()
        try:
            draft = db.query(PromptDraft).filter(PromptDraft.id == draft_id).first()
            if not draft:
                return "Draft not found."
            if draft.status != "pending":
                return f"Draft is already {draft.status}."
            if draft.submitted_by == reviewed_by:
                return "You cannot approve your own draft."

            current = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == draft.agent_domain,
                PromptConfig.prompt_key == draft.prompt_key,
                PromptConfig.is_active == True,
            ).order_by(PromptConfig.version.desc()).first()

            new_version = (current.version + 1) if current else 1
            if current:
                current.is_active = False

            db.add(PromptConfig(
                agent_domain=draft.agent_domain,
                prompt_key=draft.prompt_key,
                prompt_value=draft.draft_value,
                version=new_version,
                is_active=True,
                allowed_roles="admin,hr,it,pmo",
                created_by=reviewed_by,
            ))
            draft.status = "approved"
            draft.reviewed_by = reviewed_by
            draft.reviewed_at = datetime.datetime.utcnow()
            db.commit()
            return f"Approved and applied as version {new_version}."
        finally:
            db.close()

    @staticmethod
    def reject_draft(draft_id: int, reviewed_by: str) -> str:
        db = SessionLocal()
        try:
            draft = db.query(PromptDraft).filter(PromptDraft.id == draft_id).first()
            if not draft:
                return "Draft not found."
            if draft.submitted_by == reviewed_by:
                return "You cannot reject your own draft."
            draft.status = "rejected"
            draft.reviewed_by = reviewed_by
            draft.reviewed_at = datetime.datetime.utcnow()
            db.commit()
            return "Draft rejected."
        finally:
            db.close()

    @staticmethod
    def test_prompt(domain: str, draft_value: str, test_query: str) -> str:
        """Run a draft prompt against a test query without saving — returns raw LLM response."""
        from langchain_core.messages import HumanMessage, SystemMessage
        from app.services import llm_controls_service as llm_controls

        # Use the live agent-tier params so a test reflects production behavior.
        llm = llm_controls.get_llm("agent")
        result = llm.invoke([SystemMessage(content=draft_value), HumanMessage(content=test_query)])
        return result.content

    @staticmethod
    def list_prompts(domain: str = None):
        db = SessionLocal()
        try:
            query = db.query(PromptConfig).filter(PromptConfig.is_active == True)
            if domain:
                query = query.filter(PromptConfig.agent_domain == domain)
            
            configs = query.all()
            return [
                {
                    "domain": c.agent_domain,
                    "key": c.prompt_key,
                    "value": c.prompt_value,
                    "version": c.version,
                    "updated_at": c.updated_at.isoformat()
                } for c in configs
            ]
        finally:
            db.close()
