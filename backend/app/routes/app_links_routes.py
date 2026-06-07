"""Admin URL Library endpoints — CRUD over the app directory surfaced in chat.

Admin-only (require_super_admin). Mirrors company_settings_routes.py. The underlying service
embeds each app on write and invalidates the answer cache so changed links never serve stale.
"""

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
    return [{"name": r["name"], "url": r["url"]} for r in AppDirectoryService.list_all(include_inactive=False)]


class AppLinkPayload(BaseModel):
    name: str
    url: str
    purpose: str
    capabilities: str = ""


class AppLinkUpdatePayload(BaseModel):
    name: str | None = None
    url: str | None = None
    purpose: str | None = None
    capabilities: str | None = None
    is_active: bool | None = None


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
