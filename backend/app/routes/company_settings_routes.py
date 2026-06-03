from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.auth import CurrentUser, require_admin
from app.services.company_settings_service import CompanySettingsService

router = APIRouter(prefix="/api/admin/company-settings", tags=["company-settings"])


class CompanyContextPayload(BaseModel):
    value: str


@router.get("")
async def get_company_context(_: CurrentUser = Depends(require_admin)):
    return {
        "key": "company_context",
        "value": CompanySettingsService.get_company_context(),
    }


@router.put("")
async def set_company_context(
    payload: CompanyContextPayload,
    user: CurrentUser = Depends(require_admin),
):
    CompanySettingsService.set("company_context", payload.value, updated_by=user.email)
    return {"status": "ok", "message": "Company context updated."}
