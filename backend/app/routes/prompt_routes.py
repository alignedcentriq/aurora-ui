from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, get_current_user, require_domain_manager
from app.services.prompt_service import PromptService, ROLE_DOMAIN_MAP

router = APIRouter(prefix="/api/prompts", tags=["Prompt Management"])


class PromptUpdate(BaseModel):
    value: str


class TestPromptRequest(BaseModel):
    domain: str
    draft_value: str
    test_query: str


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


@router.get("/{domain}")
def get_domain_prompts(domain: str, user: CurrentUser = Depends(get_current_user)):
    allowed = ROLE_DOMAIN_MAP.get(user.role, [])
    if domain not in allowed and user.role != "admin":
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

    if user.role == "admin":
        result = PromptService.update_prompt(domain, prompt_key, update.value, user.email, user.role)
        if "Unauthorized" in result:
            raise HTTPException(status_code=403, detail=result)
        return {"message": result, "mode": "saved"}

    result = PromptService.save_draft(domain, prompt_key, update.value, user.email)
    return {"message": result["message"], "mode": "draft", "draft_id": result["id"]}
