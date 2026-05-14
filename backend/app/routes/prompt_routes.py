from fastapi import APIRouter, HTTPException
from app.services.prompt_service import PromptService
from pydantic import BaseModel

router = APIRouter(prefix="/api/prompts", tags=["Prompt Management"])

class PromptUpdate(BaseModel):
    value: str
    updated_by: str
    user_role: str

@router.get("")
def list_all_prompts(domain: str = None):
    """List all active prompt configurations."""
    return PromptService.list_prompts(domain)

@router.get("/{domain}")
def get_domain_prompts(domain: str):
    """Get all active prompts for a specific domain."""
    return PromptService.list_prompts(domain)

@router.put("/{domain}/{prompt_key}")
def update_prompt(domain: str, prompt_key: str, update: PromptUpdate):
    """Update a specific prompt (role-checked)."""
    result = PromptService.update_prompt(
        domain=domain,
        prompt_key=prompt_key,
        value=update.value,
        updated_by=update.updated_by,
        user_role=update.user_role
    )
    if "Unauthorized" in result:
        raise HTTPException(status_code=403, detail=result)
    return {"message": result}
