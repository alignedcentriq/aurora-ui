"""Admin URL Library endpoints — CRUD over the app directory surfaced in chat.

Admin-only (require_super_admin). Mirrors company_settings_routes.py. The underlying service
embeds each app on write and invalidates the answer cache so changed links never serve stale.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, require_super_admin, get_current_user
from app.services.app_directory_service import AppDirectoryService

router = APIRouter(prefix="/api/admin/url-library", tags=["url-library"])

# Public (authenticated) read-only router — returns only {name, url} for active links.
# Used by the frontend to resolve URL Library links without Super Admin access.
public_router = APIRouter(prefix="/api/links", tags=["url-library"])


@public_router.get("")
async def list_active_links(_: CurrentUser = Depends(get_current_user)):
    return [
        {"name": r["name"], "url": r["url"], "purpose": r.get("purpose", ""), "trigger_keywords": r.get("trigger_keywords", "")}
        for r in AppDirectoryService.list_all(include_inactive=False)
    ]


class AppLinkPayload(BaseModel):
    name: str
    url: str
    purpose: str
    capabilities: str = ""
    trigger_keywords: str = ""


class AppLinkUpdatePayload(BaseModel):
    name: str | None = None
    url: str | None = None
    purpose: str | None = None
    capabilities: str | None = None
    trigger_keywords: str | None = None
    is_active: bool | None = None


class GenerateAppRequest(BaseModel):
    description: str = ""
    url: str = ""
    name: str = ""


@router.post("/generate")
async def generate_app_draft(req: GenerateAppRequest, _: CurrentUser = Depends(require_super_admin)):
    """LLM-draft a directory entry (name, purpose, capabilities, trigger keywords) from the
    admin's plain-English description of the app — nothing is fetched. This works for internal
    SSO apps the server can't reach. Returns a DRAFT only; the admin reviews it in the dialog
    and saves through the normal POST create endpoint.
    """
    from app.services import llm_controls_service as llm_controls
    from app.services.llm_json import invoke_json

    description = (req.description or "").strip()
    url = (req.url or "").strip()
    name_hint = (req.name or "").strip()
    if not description and not name_hint:
        raise HTTPException(status_code=422, detail="Describe what the app is for (a sentence is enough).")
    if url and not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url

    model = llm_controls.get_llm("general", default_timeout=60)
    prompt = (
        "You are cataloguing a company app/portal for an employee self-service assistant. "
        "From the admin's notes below, write its directory entry. Do NOT invent capabilities "
        "that aren't implied by the notes.\n\n"
        f"App name (if given): {name_hint or '(none)'}\n"
        f"URL (for naming hints only, not to be visited): {url or '(none)'}\n"
        f"Admin's description: {description or '(none)'}\n\n"
        "Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:\n"
        '{"name": "Short App Name", "purpose": "One or two sentences on what this app is for.", '
        '"capabilities": "comma-separated list of concrete things a user can do here", '
        '"trigger_keywords": "comma-separated specific phrases a user might type"}\n\n'
        "Rules:\n"
        "- name: the product/portal name, short. Use the given name or infer from the URL host.\n"
        "- purpose: plain, factual, employee-facing. No marketing fluff.\n"
        "- capabilities: 3-6 concrete verbs/tasks the description implies, comma-separated.\n"
        "- trigger_keywords: 3-8 SPECIFIC multi-word phrases or distinctive terms a user would type. "
        "Never use generic single words like 'form', 'request', 'status', 'help', or 'portal'."
    )
    draft = invoke_json(model, prompt, attempts=2)
    if draft is None:
        raise HTTPException(status_code=502, detail="Couldn't draft the entry — the model didn't return usable JSON. Try again or rephrase.")

    return {
        "name": str(draft.get("name") or name_hint or "").strip()[:120],
        "url": url,
        "purpose": str(draft.get("purpose") or "").strip()[:500],
        "capabilities": str(draft.get("capabilities") or "").strip()[:500],
        "trigger_keywords": str(draft.get("trigger_keywords") or "").strip()[:300],
    }


@router.get("/keyword-suggestions")
async def keyword_suggestions(window_days: int = 30, _: CurrentUser = Depends(require_super_admin)):
    """Mine recent real chat queries for trigger keywords each app is missing.
    Read-only — nothing is changed; the admin accepts suggestions via the normal PUT."""
    window_days = max(1, min(window_days, 180))
    return AppDirectoryService.suggest_keywords(window_days=window_days)


@router.get("")
async def list_apps(_: CurrentUser = Depends(require_super_admin)):
    return AppDirectoryService.list_all(include_inactive=True)


@router.post("")
async def create_app(payload: AppLinkPayload, user: CurrentUser = Depends(require_super_admin)):
    res = AppDirectoryService.create(
        name=payload.name,
        url=payload.url,
        purpose=payload.purpose,
        capabilities=payload.capabilities,
        trigger_keywords=payload.trigger_keywords,
        created_by=user.email,
    )
    if res.get("status") != "ok":
        raise HTTPException(status_code=400, detail=res.get("message", "Failed to add app."))
    return res


@router.put("/{app_id}")
async def update_app(app_id: int, payload: AppLinkUpdatePayload,
                     _: CurrentUser = Depends(require_super_admin)):
    res = AppDirectoryService.update(
        app_id,
        name=payload.name,
        url=payload.url,
        purpose=payload.purpose,
        capabilities=payload.capabilities,
        trigger_keywords=payload.trigger_keywords,
        is_active=payload.is_active,
    )
    if res.get("status") != "ok":
        raise HTTPException(status_code=404, detail=res.get("message", "Failed to update app."))
    return res


@router.delete("/{app_id}")
async def delete_app(app_id: int, _: CurrentUser = Depends(require_super_admin)):
    res = AppDirectoryService.delete(app_id)
    if res.get("status") != "ok":
        raise HTTPException(status_code=404, detail=res.get("message", "Failed to delete app."))
    return res
