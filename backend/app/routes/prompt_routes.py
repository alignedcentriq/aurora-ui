import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, get_current_user, require_domain_manager
from app.services.prompt_service import PromptService, ROLE_DOMAIN_MAP, UNIVERSAL_GUARDRAIL

router = APIRouter(prefix="/api/prompts", tags=["Prompt Management"])


class PromptUpdate(BaseModel):
    value: str


class TestPromptRequest(BaseModel):
    domain: str
    draft_value: str
    test_query: str


class GeneratePromptRequest(BaseModel):
    domain: str
    prompt_key: str
    instruction: str
    current: str = ""


# Human-readable domain names so the meta-prompt grounds the assistant correctly.
_DOMAIN_LABELS: dict[str, str] = {
    "hr": "HR (people, leave, policies, payroll questions)",
    "admin": "Admin / Facilities (office, parking, assets, general administration)",
    "it_support": "IT Support (accounts, access, devices, software, tickets)",
    "pmo": "PMO (projects, allocations, staffing, skills, delivery)",
    "functional_manager": "Functional Manager (team, approvals, direct reports)",
    "general": "General assistant (greetings, small talk, catch-all)",
}

# What each prompt_key IS, so the model writes the right kind of text.
_KEY_GUIDANCE: dict[str, str] = {
    "system_prompt": (
        "the SYSTEM PROMPT for this domain's assistant — its persona, scope, and "
        "operating instructions. It is APPENDED after the agent's built-in instructions "
        "inside a [DOMAIN CONTEXT] block, so write domain-specific guidance, NOT a generic "
        "'you are a helpful assistant' preamble. Be directive and concrete."
    ),
    "guardrail": (
        "the GUARDRAIL — anti-hallucination and scope-control rules appended after the "
        "system prompt. It must keep the assistant grounded (answer only from tool "
        "results / provided data), refuse out-of-scope requests politely, and enforce "
        "the house output format."
    ),
}

_HOUSE_STYLE = (
    "HOUSE STYLE the prompt text MUST follow and instruct the assistant to follow:\n"
    "- Plain instructional text. No markdown tables (no | pipes), no HTML.\n"
    "- Organise rules as short bullet points (-) or numbered lists.\n"
    "- Ground answers ONLY in tool results, database data, or provided context — never training knowledge.\n"
    "- Respond in one direct voice; never roleplay or script a 'User:'/'Me:' dialogue.\n"
    "- Be concise and operational; every line should change the assistant's behaviour.\n"
)


def _clean_prompt_text(raw: str) -> str:
    """Strip code fences and common 'Here is the prompt:' preambles from a drafted prompt."""
    s = (raw or "").strip()
    # Drop a leading ```/```text fence and a trailing fence.
    s = re.sub(r"^```[a-zA-Z]*\s*\n?", "", s)
    s = re.sub(r"\n?```$", "", s).strip()
    # Drop a single leading meta line like "Here is the system prompt:" / "Sure! ..."
    s = re.sub(
        r"^(sure[!,. ]*|certainly[!,. ]*|here(?:'s| is)[^\n:]*:?|"
        r"below is[^\n:]*:?)\s*\n+",
        "",
        s,
        flags=re.IGNORECASE,
    ).strip()
    return s


def _draft_prompt(domain: str, prompt_key: str, instruction: str, current: str = "") -> str:
    """LLM-author (or revise) a domain prompt from a natural-language instruction.

    Returns clean prompt text. Raises HTTPException on bad input or unusable model output.
    """
    from app.services import llm_controls_service as llm_controls

    instruction = (instruction or "").strip()
    if not instruction:
        raise HTTPException(status_code=422, detail="Describe what this prompt should do.")

    domain_label = _DOMAIN_LABELS.get(domain, domain)
    key_guidance = _KEY_GUIDANCE.get(
        prompt_key,
        f"the '{prompt_key}' instructions block for this domain's assistant.",
    )
    reference = ""
    if prompt_key == "guardrail":
        reference = (
            "Reference — the platform's default universal guardrail (match its rigor and "
            "format, then tailor to this domain):\n"
            f"{UNIVERSAL_GUARDRAIL.strip()}\n\n"
        )

    revising = bool((current or "").strip())
    if revising:
        task = (
            "Revise the CURRENT prompt below by applying the requested change. Return the "
            "COMPLETE revised prompt, preserving everything the change does not touch.\n\n"
            f"CURRENT PROMPT:\n{current.strip()}\n\n"
            f"CHANGE REQUESTED: {instruction}\n"
        )
    else:
        task = f"Write the prompt from this request: {instruction}\n"

    # Quality-sensitive and infrequent → use the capable agent tier, not the tiny fast model.
    model = llm_controls.get_llm("agent", default_timeout=90, default_max_tokens=900)
    meta = (
        "You are a world-class prompt engineer authoring production system prompts for an "
        "enterprise employee-assistant platform.\n\n"
        f"You are writing {key_guidance}\n\n"
        f"Target domain: {domain_label}\n\n"
        f"{_HOUSE_STYLE}\n"
        f"{reference}"
        f"{task}\n"
        "OUTPUT RULES:\n"
        "- Output ONLY the finished prompt text, ready to paste. No preamble, no explanation, "
        "no markdown code fences, no quotes around it.\n"
        "- Do not address me; write the prompt as instructions to the assistant."
    )
    try:
        resp = model.invoke(meta)
        text = _clean_prompt_text(resp.content or "")
    except Exception:
        raise HTTPException(status_code=502, detail="The model couldn't draft a prompt right now. Try again.")
    if len(text) < 20:
        raise HTTPException(status_code=502, detail="Couldn't draft a usable prompt from that — try rephrasing.")
    return text


@router.get("")
def list_all_prompts(domain: Optional[str] = None, user: CurrentUser = Depends(get_current_user)):
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    effective_domain = domain if (domain and domain in allowed) else None
    if not allowed:
        return []
    return PromptService.list_prompts(effective_domain or (allowed[0] if len(allowed) == 1 else None))


@router.get("/drafts")
def list_pending_drafts(user: CurrentUser = Depends(require_domain_manager)):
    """List pending drafts submitted by others in the same domain(s)."""
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    drafts = []
    for domain in allowed:
        drafts.extend(PromptService.list_pending_drafts(domain, exclude_email=user.email))
    return drafts


@router.post("/drafts/{draft_id}/approve")
def approve_draft(draft_id: int, user: CurrentUser = Depends(require_domain_manager)):
    result = PromptService.approve_draft(draft_id, user.email)
    if any(w in result.lower() for w in ("not found", "cannot", "already")):
        raise HTTPException(status_code=400, detail=result)
    return {"message": result}


@router.post("/drafts/{draft_id}/reject")
def reject_draft(draft_id: int, user: CurrentUser = Depends(require_domain_manager)):
    result = PromptService.reject_draft(draft_id, user.email)
    if any(w in result.lower() for w in ("not found", "cannot")):
        raise HTTPException(status_code=400, detail=result)
    return {"message": result}


@router.post("/test")
def test_draft_prompt(req: TestPromptRequest, user: CurrentUser = Depends(require_domain_manager)):
    """Run a draft prompt against a test query — does not save anything."""
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    if req.domain not in allowed:
        raise HTTPException(status_code=403, detail=f"Not authorized to test the {req.domain} domain.")
    response = PromptService.test_prompt(req.domain, req.draft_value, req.test_query)
    return {"response": response}


@router.post("/generate")
def generate_prompt(req: GeneratePromptRequest, user: CurrentUser = Depends(require_domain_manager)):
    """AI-draft a domain prompt from a natural-language description.

    Returns a DRAFT only — nothing is persisted. The client drops it into the editor where
    the manager can refine, test, and save through the normal version/approval flow.
    Pass `current` (non-empty) to REFINE the existing prompt instead of drafting fresh.
    """
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    if req.domain not in allowed:
        raise HTTPException(status_code=403, detail=f"Your role cannot author prompts for the {req.domain} domain.")
    value = _draft_prompt(req.domain, req.prompt_key, req.instruction, req.current)
    return {"value": value, "mode": "refine" if (req.current or "").strip() else "draft"}


@router.get("/drafts/mine")
def list_my_drafts(user: CurrentUser = Depends(require_domain_manager)):
    """Return pending drafts submitted by the current user (for self-testing)."""
    return PromptService.list_own_drafts(user.email)


@router.post("/drafts/{draft_id}/force-approve")
def force_approve_draft(draft_id: int, user: CurrentUser = Depends(require_domain_manager)):
    """Test-only: approve own draft using a synthetic reviewer identity."""
    result = PromptService.approve_draft(draft_id, "test-reviewer@centriq.ai")
    if any(w in result.lower() for w in ("not found", "already")):
        raise HTTPException(status_code=400, detail=result)
    return {"message": result}


@router.get("/{domain}")
def get_domain_prompts(domain: str, user: CurrentUser = Depends(get_current_user)):
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    if domain not in allowed and user.role not in ("admin", "super admin"):
        raise HTTPException(status_code=403, detail=f"Not authorized to view the {domain} domain.")
    return PromptService.list_prompts(domain)


@router.delete("/{domain}/{prompt_key}")
def delete_prompt(
    domain: str,
    prompt_key: str,
    user: CurrentUser = Depends(require_domain_manager),
):
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    if domain not in allowed:
        raise HTTPException(status_code=403, detail=f"Your role cannot delete prompts for the {domain} domain.")
    result = PromptService.delete_prompt(domain, prompt_key, user.email)
    if "not found" in result.lower():
        raise HTTPException(status_code=404, detail=result)
    return {"message": result}


@router.put("/{domain}/{prompt_key}")
def update_prompt(
    domain: str,
    prompt_key: str,
    update: PromptUpdate,
    user: CurrentUser = Depends(require_domain_manager),
):
    """Admin saves directly. HR/IT/PMO create a draft that requires a peer to approve."""
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    if domain not in allowed:
        raise HTTPException(status_code=403, detail=f"Your role cannot edit the {domain} domain.")

    if user.role in ("admin", "super admin"):
        result = PromptService.update_prompt(domain, prompt_key, update.value, user.email, user.role)
        if "Unauthorized" in result:
            raise HTTPException(status_code=403, detail=result)
        return {"message": result, "mode": "saved"}

    result = PromptService.save_draft(domain, prompt_key, update.value, user.email)
    return {"message": result["message"], "mode": "draft", "draft_id": result["id"]}
