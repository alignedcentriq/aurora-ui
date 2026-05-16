from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_admin
from app.services.prompt_service import PromptService

router = APIRouter(prefix="/api/prompts", tags=["Prompt Management"])


class PromptUpdate(BaseModel):
    value: str


@router.get("")
def list_all_prompts(domain: str = None, _: CurrentUser = Depends(get_current_user)):
    return PromptService.list_prompts(domain)


@router.get("/{domain}")
def get_domain_prompts(domain: str, _: CurrentUser = Depends(get_current_user)):
    return PromptService.list_prompts(domain)


@router.put("/{domain}/{prompt_key}")
def update_prompt(
    domain: str,
    prompt_key: str,
    update: PromptUpdate,
    admin: CurrentUser = Depends(require_admin),
):
    """Update a specific prompt. Admin only — role and identity come from auth token."""
    result = PromptService.update_prompt(
        domain=domain,
        prompt_key=prompt_key,
        value=update.value,
        updated_by=admin.email,
        user_role=admin.role,
    )
    if "Unauthorized" in result:
        raise HTTPException(status_code=403, detail=result)
    return {"message": result}
