"""
Connected Accounts -- OAuth2 integration endpoints.

Flow (popup-based):
1. Frontend opens popup -> GET /api/integrations/connect/{provider}?email=...
2. Backend redirects to provider's OAuth consent screen
3. Provider redirects back -> GET /api/integrations/callback/{provider}?code=...
4. Backend exchanges code, stores encrypted tokens, returns HTML that closes popup
5. Frontend detects popup closed, refreshes status via GET /api/integrations/status
"""

import html
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.services.oauth_service import (
    PROVIDERS,
    disconnect_provider,
    get_connection_status,
    microsoft_auth_url,
    microsoft_exchange_code,
    zoho_auth_url,
    zoho_exchange_code,
)

log = logging.getLogger("aurora-logger")
router = APIRouter(prefix="/api/integrations", tags=["integrations"])


# -- Status --------------------------------------------------------------------

@router.get("/status")
async def integration_status(user: CurrentUser = Depends(get_current_user)):
    """Return connection status for all providers."""
    return get_connection_status(user.email)


# -- Connect (initiates OAuth flow) --------------------------------------------

@router.get("/connect/{provider}")
async def connect_provider(
    provider: str,
    email: Optional[str] = Query(None),
):
    """Redirect user to provider's OAuth consent screen.

    NOTE: This is a top-level browser navigation (the popup is pointed straight
    at this URL), so the SPA's x-user-email / x-user-role headers are NOT sent
    and get_current_user cannot be used here. We authenticate from the ?email=
    query param instead and validate it against ALLOWED_EMAILS.
    """
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")

    user_email = (email or "").lower().strip()
    if not user_email or (settings.ALLOWED_EMAILS and user_email not in settings.ALLOWED_EMAILS):
        raise HTTPException(403, "Access denied.")

    try:
        if provider == "microsoft":
            url = microsoft_auth_url(user_email)
        elif provider == "zoho":
            url = zoho_auth_url(user_email)
        else:
            raise HTTPException(400, f"Provider {provider} not implemented")
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    return RedirectResponse(url, status_code=302)


# -- Callback (handles OAuth redirect) ----------------------------------------

def _callback_html(success: bool, provider: str, message: str = "") -> str:
    color = "#16a34a" if success else "#dc2626"
    title = "Connected!" if success else "Connection Failed"
    icon = "&#10003;" if success else "&#10007;"
    safe_message = html.escape(
        message or (f'{provider.title()} account connected successfully.' if success else 'Something went wrong.')
    )
    safe_provider = html.escape(provider)
    origin = html.escape(settings.OAUTH_REDIRECT_BASE_URL.rstrip("/"))
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center;
         height: 100vh; margin: 0; background: #f8fafc; }}
  .card {{ background: #fff; border-radius: 16px; padding: 48px;
           max-width: 420px; text-align: center;
           box-shadow: 0 4px 24px rgba(0,0,0,.08); }}
  .icon {{ font-size: 48px; color: {color}; margin-bottom: 16px; }}
  h1 {{ color: {color}; font-size: 22px; margin: 0 0 8px; }}
  p {{ color: #64748b; font-size: 14px; line-height: 1.6; margin: 0; }}
  .close {{ margin-top: 24px; font-size: 12px; color: #94a3b8; }}
</style>
</head><body>
<div class="card">
  <div class="icon">{icon}</div>
  <h1>{title}</h1>
  <p>{safe_message}</p>
  <p class="close">This window will close automatically...</p>
</div>
<script>
  window.opener?.postMessage({{
    type: 'oauth-callback',
    provider: '{safe_provider}',
    success: {'true' if success else 'false'}
  }}, '{origin}');
  setTimeout(() => window.close(), 1500);
</script>
</body></html>"""


@router.get("/callback/microsoft", response_class=HTMLResponse)
async def callback_microsoft(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
):
    if error:
        log.warning("[oauth] Microsoft callback error: %s -- %s", error, error_description)
        return HTMLResponse(_callback_html(False, "microsoft", error_description or error))

    if not code or not state:
        return HTMLResponse(_callback_html(False, "microsoft", "Missing authorization code."))

    try:
        result = await microsoft_exchange_code(code, state)
        email = result.get("email", "")
        return HTMLResponse(
            _callback_html(True, "microsoft", f"Microsoft account ({email}) connected. You can now use mail, calendar, and Teams features.")
        )
    except Exception as e:
        log.exception("[oauth] Microsoft token exchange failed")
        return HTMLResponse(_callback_html(False, "microsoft", str(e)))


@router.get("/callback/zoho", response_class=HTMLResponse)
async def callback_zoho(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    if error:
        log.warning("[oauth] Zoho callback error: %s", error)
        return HTMLResponse(_callback_html(False, "zoho", error))

    if not code or not state:
        return HTMLResponse(_callback_html(False, "zoho", "Missing authorization code."))

    try:
        await zoho_exchange_code(code, state)
        return HTMLResponse(
            _callback_html(True, "zoho", "Zoho People account connected. Leave and attendance features are now active.")
        )
    except Exception as e:
        log.exception("[oauth] Zoho token exchange failed")
        return HTMLResponse(_callback_html(False, "zoho", str(e)))


# -- Zoho People leave form ----------------------------------------------------

@router.get("/zoho/leave-form")
async def zoho_leave_form(user: CurrentUser = Depends(get_current_user)):
    """Return the Zoho People apply-leave form URL for the embedded leave widget.

    The user fills and submits the leave directly in Zoho People (we don't
    auto-submit), so this just hands back the deep-link to the apply-leave page.
    """
    base = (settings.ZOHO_PEOPLE_URL or "").rstrip("/")
    if base:
        url = f"{base}#leavetracker/applyleave"
    else:
        # Sensible default so the widget still works before ZOHO_PEOPLE_URL is set.
        url = "https://people.zoho.com/#leavetracker/applyleave"
    return {"url": url, "configured": bool(settings.ZOHO_PEOPLE_URL)}


# -- Zoho People document / letter generation ----------------------------------

@router.get("/zoho/document-form")
async def zoho_document_form(user: CurrentUser = Depends(get_current_user)):
    """Return the Zoho People document/letter generation URL for the embedded widget.

    Zoho People handles document generation natively (letter templates, mail-merge,
    e-sign), so we deep-link the user into it rather than generating documents in-app.
    """
    if settings.ZOHO_PEOPLE_DOCS_URL:
        url = settings.ZOHO_PEOPLE_DOCS_URL
    elif settings.ZOHO_PEOPLE_URL:
        # Land on the Zoho People dashboard; the user navigates to the document area.
        url = settings.ZOHO_PEOPLE_URL.rstrip("/")
    else:
        url = "https://people.zoho.com"
    return {"url": url, "configured": bool(settings.ZOHO_PEOPLE_DOCS_URL)}


# -- Disconnect ----------------------------------------------------------------

@router.delete("/disconnect/{provider}")
async def disconnect(provider: str, user: CurrentUser = Depends(get_current_user)):
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    removed = disconnect_provider(user.email, provider)
    if not removed:
        raise HTTPException(404, f"No {provider} connection found.")
    return {"status": "disconnected", "provider": provider}
