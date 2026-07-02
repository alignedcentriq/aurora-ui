from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.auth import CurrentUser, require_super_admin
from app.config import settings
from app.services.company_settings_service import CompanySettingsService
from app.services.answer_cache_service import AnswerCacheService

router = APIRouter(prefix="/api/admin/company-settings", tags=["company-settings"])


class CompanyContextPayload(BaseModel):
    value: str


class PullContextPayload(BaseModel):
    url: Optional[str] = None


@router.get("")
async def get_company_context(_: CurrentUser = Depends(require_super_admin)):
    return {
        "key": "company_context",
        "value": CompanySettingsService.get_company_context(),
    }


@router.put("")
async def set_company_context(
    payload: CompanyContextPayload,
    user: CurrentUser = Depends(require_super_admin),
):
    old_value = CompanySettingsService.get_company_context()
    CompanySettingsService.set("company_context", payload.value, updated_by=user.email)
    # Drop cached company-info answers so they don't serve the old context.
    # (Policy changes invalidate via the SharePoint sync; company context didn't.)
    AnswerCacheService.invalidate_domain("general")

    from app.services import activity_log_service
    activity_log_service.emit(
        user.email, "settings", "settings_company_context",
        "{actor} updated the company context.",
        target_type="setting", target_id="company_context", target_name="Company Context",
        old_value={"value": (old_value or "")[:5000]}, new_value={"value": (payload.value or "")[:5000]},
    )

    return {"status": "ok", "message": "Company context updated."}


@router.post("/pull")
async def pull_company_context(
    payload: PullContextPayload,
    _: CurrentUser = Depends(require_super_admin),
):
    """Auto-draft the company context from the company website (defaults to COMPANY_WEBSITE_URL).

    Returns a DRAFT only — nothing is saved. The super-admin reviews it in the editor and
    saves through the normal PUT.
    """
    url = (payload.url or "").strip() or settings.COMPANY_WEBSITE_URL
    if not url:
        raise HTTPException(status_code=422, detail="No company website is configured. Enter a URL.")
    try:
        result = CompanySettingsService.draft_context_from_web(url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "Couldn't pull from the company site.")
    return {"status": "ok", "value": result["value"], "sources": result["sources"], "url": url}


@router.get("/cabins")
async def get_cabin_directory(_: CurrentUser = Depends(require_super_admin)):
    return {
        "key": "cabin_directory",
        "value": CompanySettingsService.get("cabin_directory"),
    }


@router.put("/cabins")
async def set_cabin_directory(
    payload: CompanyContextPayload,
    user: CurrentUser = Depends(require_super_admin),
):
    old_value = CompanySettingsService.get("cabin_directory")
    CompanySettingsService.set("cabin_directory", payload.value, updated_by=user.email)

    from app.services import activity_log_service
    activity_log_service.emit(
        user.email, "settings", "settings_cabin_directory",
        "{actor} updated the cabin directory.",
        target_type="setting", target_id="cabin_directory", target_name="Cabin Directory",
        old_value={"value": (old_value or "")[:5000]}, new_value={"value": (payload.value or "")[:5000]},
    )

    return {"status": "ok", "message": "Cabin directory updated."}
