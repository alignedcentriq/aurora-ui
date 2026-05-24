# Connected Accounts — OAuth2 Implementation Blueprint

> **Status**: Shelved — blocked by Azure AD tenant policy disabling user consent.
> **Blocker**: Admin must go to Azure Portal → App registrations → Nerve-Center → API permissions → "Grant admin consent for [org]".
> Once admin grants consent, implement exactly as described below.

---

## What This Feature Does

Allows users to connect their Microsoft 365 (Outlook + Calendar + Teams) and Zoho People accounts from the Settings page. Once connected, the assistant automatically uses their OAuth tokens for mail/calendar/chat operations — no manual token passing needed.

---

## Blockers to Resolve First

1. **Azure AD admin consent** — tenant has user consent disabled. Admin must click "Grant admin consent" on the app's API permissions page in Azure Portal. One-time action, affects all users.
2. **`TOKEN_ENCRYPTION_KEY`** — generate with:
   ```
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
3. **`MICROSOFT_OAUTH_CLIENT_SECRET`** — create in Azure Portal → App registrations → Nerve-Center → Certificates & secrets → New client secret.
4. **Redirect URI** — add `http://localhost:8080/api/integrations/callback/microsoft` as a Web platform redirect URI in Azure Portal.

---

## Environment Variables to Add (backend/.env)

```env
MICROSOFT_OAUTH_CLIENT_ID=<same as VITE_MSAL_CLIENT_ID>
MICROSOFT_OAUTH_CLIENT_SECRET=<new client secret from Azure Portal>
MICROSOFT_OAUTH_TENANT_ID=<same as VITE_MSAL_TENANT_ID>
TOKEN_ENCRYPTION_KEY=<generated Fernet key>
```

---

## Files to Create

### 1. `backend/app/services/oauth_service.py` (NEW)

Full OAuth2 service — Fernet encryption, HMAC-signed state, Microsoft + Zoho flows.

```python
"""
OAuth2 service for Connected Accounts (Microsoft, Zoho).

Handles:
- Fernet encryption / decryption of tokens at rest
- OAuth2 Authorization Code flow for each provider
- Token refresh
- Database CRUD for ConnectedAccount
"""

import base64
import datetime
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet

from app.config import settings
from app.database import SessionLocal
from app.models import ConnectedAccount

log = logging.getLogger("aurora-logger")

# ── CSRF state management ──────────────────────────────────────────────────
# States are HMAC-signed and time-limited (10 min). No server-side store needed.

_STATE_MAX_AGE = 600  # 10 minutes


def _state_signing_key() -> bytes:
    """Derive a signing key from the Fernet encryption key."""
    key = settings.TOKEN_ENCRYPTION_KEY
    if not key:
        key = "dev-fallback-key"
    return hashlib.sha256(key.encode() if isinstance(key, str) else key).digest()


def _create_signed_state(email: str) -> str:
    """Create a time-limited, HMAC-signed state parameter."""
    payload = json.dumps({
        "email": email,
        "nonce": secrets.token_hex(16),
        "ts": int(time.time()),
    })
    raw = base64.urlsafe_b64encode(payload.encode()).decode()
    sig = hmac.new(_state_signing_key(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def _verify_state(state: str) -> dict:
    """Verify HMAC signature and expiry. Returns decoded payload or raises ValueError."""
    if "." not in state:
        raise ValueError("Invalid state format")
    raw, sig = state.rsplit(".", 1)
    expected = hmac.new(_state_signing_key(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise ValueError("State signature mismatch — possible CSRF")
    payload = json.loads(base64.urlsafe_b64decode(raw))
    if int(time.time()) - payload.get("ts", 0) > _STATE_MAX_AGE:
        raise ValueError("State expired — please try connecting again")
    return payload


# ── Fernet encryption helpers ────────────────────────────────────────────────

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet
    key = settings.TOKEN_ENCRYPTION_KEY
    if not key:
        raise RuntimeError(
            "[oauth] TOKEN_ENCRYPTION_KEY is not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
            "and add it to your .env file. Refusing to auto-generate — an ephemeral key "
            "would make stored tokens unrecoverable after restart."
        )
    _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt_token(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()


# ── Provider configs ─────────────────────────────────────────────────────────

PROVIDERS = {"microsoft", "zoho"}

MICROSOFT_AUTHORITY = "https://login.microsoftonline.com"
ZOHO_ACCOUNTS_URL = settings.ZOHO_ACCOUNTS_URL  # https://accounts.zoho.com


def _callback_url(provider: str) -> str:
    base = settings.APP_BASE_URL.rstrip("/")
    return f"{base}/api/integrations/callback/{provider}"


# ── Microsoft OAuth2 ─────────────────────────────────────────────────────────

def microsoft_auth_url(user_email: str) -> str:
    """Build the Microsoft OAuth2 authorization URL."""
    tenant = settings.MICROSOFT_OAUTH_TENANT_ID or "common"
    state = _create_signed_state(user_email)
    params = {
        "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": _callback_url("microsoft"),
        "response_mode": "query",
        "scope": settings.MICROSOFT_OAUTH_SCOPES,
        "state": state,
        "prompt": "consent",
    }
    return f"{MICROSOFT_AUTHORITY}/{tenant}/oauth2/v2.0/authorize?{urlencode(params)}"


async def microsoft_exchange_code(code: str, state: str) -> dict:
    """Exchange authorization code for tokens and save to DB."""
    # Verify HMAC-signed state to prevent CSRF
    state_data = _verify_state(state)
    user_email = state_data["email"].lower().strip()

    tenant = settings.MICROSOFT_OAUTH_TENANT_ID or "common"
    token_url = f"{MICROSOFT_AUTHORITY}/{tenant}/oauth2/v2.0/token"

    payload = {
        "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID,
        "client_secret": settings.MICROSOFT_OAUTH_CLIENT_SECRET,
        "code": code,
        "redirect_uri": _callback_url("microsoft"),
        "grant_type": "authorization_code",
        "scope": settings.MICROSOFT_OAUTH_SCOPES,
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data=payload)
        resp.raise_for_status()
        data = resp.json()

    # Get user profile from Graph
    profile = await _microsoft_profile(data["access_token"])

    _save_tokens(
        user_email=user_email,
        provider="microsoft",
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token", ""),
        expires_in=data.get("expires_in", 3600),
        scopes=data.get("scope", ""),
        provider_user_id=profile.get("id"),
        provider_email=profile.get("mail") or profile.get("userPrincipalName"),
    )
    return {"success": True, "email": profile.get("mail") or profile.get("userPrincipalName")}


async def microsoft_refresh(account: ConnectedAccount) -> str | None:
    """Refresh Microsoft access token. Returns new access_token or None."""
    if not account.refresh_token_enc:
        return None
    tenant = settings.MICROSOFT_OAUTH_TENANT_ID or "common"
    token_url = f"{MICROSOFT_AUTHORITY}/{tenant}/oauth2/v2.0/token"

    payload = {
        "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID,
        "client_secret": settings.MICROSOFT_OAUTH_CLIENT_SECRET,
        "refresh_token": decrypt_token(account.refresh_token_enc),
        "grant_type": "refresh_token",
        "scope": settings.MICROSOFT_OAUTH_SCOPES,
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data=payload)
        if resp.status_code != 200:
            log.warning("[oauth] Microsoft token refresh failed: %s", resp.text)
            return None
        data = resp.json()

    db = SessionLocal()
    try:
        acc = db.query(ConnectedAccount).filter(ConnectedAccount.id == account.id).first()
        if acc:
            acc.access_token_enc = encrypt_token(data["access_token"])
            if data.get("refresh_token"):
                acc.refresh_token_enc = encrypt_token(data["refresh_token"])
            acc.token_expires_at = datetime.datetime.utcnow() + datetime.timedelta(
                seconds=data.get("expires_in", 3600) - 60
            )
            acc.status = "active"
            acc.updated_at = datetime.datetime.utcnow()
            db.commit()
        return data["access_token"]
    finally:
        db.close()


async def _microsoft_profile(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code == 200:
            return resp.json()
    return {}


# ── Zoho OAuth2 ──────────────────────────────────────────────────────────────

ZOHO_SCOPES = os.getenv(
    "ZOHO_OAUTH_SCOPES",
    "ZOHOPEOPLE.forms.ALL,ZOHOPEOPLE.leave.ALL,ZOHOPEOPLE.attendance.ALL",
)


def zoho_auth_url(user_email: str) -> str:
    """Build the Zoho OAuth2 authorization URL."""
    state = _create_signed_state(user_email)
    params = {
        "client_id": settings.ZOHO_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": _callback_url("zoho"),
        "scope": ZOHO_SCOPES,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{ZOHO_ACCOUNTS_URL}/oauth/v2/auth?{urlencode(params)}"


async def zoho_exchange_code(code: str, state: str) -> dict:
    """Exchange authorization code for tokens and save to DB."""
    # Verify HMAC-signed state to prevent CSRF
    state_data = _verify_state(state)
    user_email = state_data["email"].lower().strip()

    token_url = f"{ZOHO_ACCOUNTS_URL}/oauth/v2/token"

    payload = {
        "client_id": settings.ZOHO_CLIENT_ID,
        "client_secret": settings.ZOHO_CLIENT_SECRET,
        "code": code,
        "redirect_uri": _callback_url("zoho"),
        "grant_type": "authorization_code",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data=payload)
        resp.raise_for_status()
        data = resp.json()

    if "error" in data:
        raise ValueError(data.get("error", "Zoho token exchange failed"))

    _save_tokens(
        user_email=user_email,
        provider="zoho",
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token", ""),
        expires_in=data.get("expires_in", 3600),
        scopes=ZOHO_SCOPES,
        provider_user_id=None,
        provider_email=user_email,
    )
    return {"success": True, "email": user_email}


async def zoho_refresh(account: ConnectedAccount) -> str | None:
    """Refresh Zoho access token. Returns new access_token or None."""
    if not account.refresh_token_enc:
        return None
    token_url = f"{ZOHO_ACCOUNTS_URL}/oauth/v2/token"

    payload = {
        "client_id": settings.ZOHO_CLIENT_ID,
        "client_secret": settings.ZOHO_CLIENT_SECRET,
        "refresh_token": decrypt_token(account.refresh_token_enc),
        "grant_type": "refresh_token",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data=payload)
        if resp.status_code != 200:
            log.warning("[oauth] Zoho token refresh failed: %s", resp.text)
            return None
        data = resp.json()

    if "error" in data:
        log.warning("[oauth] Zoho refresh error: %s", data)
        return None

    db = SessionLocal()
    try:
        acc = db.query(ConnectedAccount).filter(ConnectedAccount.id == account.id).first()
        if acc:
            acc.access_token_enc = encrypt_token(data["access_token"])
            acc.token_expires_at = datetime.datetime.utcnow() + datetime.timedelta(
                seconds=data.get("expires_in", 3600) - 60
            )
            acc.status = "active"
            acc.updated_at = datetime.datetime.utcnow()
            db.commit()
        return data["access_token"]
    finally:
        db.close()


# ── Shared helpers ───────────────────────────────────────────────────────────

def _save_tokens(
    user_email: str,
    provider: str,
    access_token: str,
    refresh_token: str,
    expires_in: int,
    scopes: str,
    provider_user_id: str | None,
    provider_email: str | None,
) -> None:
    db = SessionLocal()
    try:
        acc = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_email == user_email,
                ConnectedAccount.provider == provider,
            )
            .first()
        )
        now = datetime.datetime.utcnow()
        expires_at = now + datetime.timedelta(seconds=expires_in - 60)

        if acc:
            acc.access_token_enc = encrypt_token(access_token)
            if refresh_token:
                acc.refresh_token_enc = encrypt_token(refresh_token)
            acc.token_expires_at = expires_at
            acc.scopes = scopes
            acc.provider_user_id = provider_user_id or acc.provider_user_id
            acc.provider_email = provider_email or acc.provider_email
            acc.status = "active"
            acc.updated_at = now
        else:
            acc = ConnectedAccount(
                user_email=user_email,
                provider=provider,
                access_token_enc=encrypt_token(access_token),
                refresh_token_enc=encrypt_token(refresh_token) if refresh_token else None,
                token_expires_at=expires_at,
                scopes=scopes,
                provider_user_id=provider_user_id,
                provider_email=provider_email,
                status="active",
                connected_at=now,
                updated_at=now,
            )
            db.add(acc)
        db.commit()
    finally:
        db.close()


async def get_valid_token(user_email: str, provider: str) -> str | None:
    """Return a valid access token for the user+provider, refreshing if needed."""
    db = SessionLocal()
    try:
        acc = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_email == user_email,
                ConnectedAccount.provider == provider,
                ConnectedAccount.status == "active",
            )
            .first()
        )
        if not acc:
            return None

        # Check if token is still valid (with 2-minute buffer)
        if acc.token_expires_at and acc.token_expires_at > datetime.datetime.utcnow() + datetime.timedelta(minutes=2):
            return decrypt_token(acc.access_token_enc)

        # Token expired — refresh
        if provider == "microsoft":
            return await microsoft_refresh(acc)
        elif provider == "zoho":
            return await zoho_refresh(acc)
        return None
    finally:
        db.close()


def get_connection_status(user_email: str) -> list[dict]:
    """Return connection status for all providers for a given user."""
    db = SessionLocal()
    try:
        accounts = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.user_email == user_email)
            .all()
        )
        connected = {a.provider: a for a in accounts}

        result = []
        for provider in PROVIDERS:
            acc = connected.get(provider)
            if acc and acc.status == "active":
                result.append({
                    "provider": provider,
                    "connected": True,
                    "email": acc.provider_email,
                    "connected_at": acc.connected_at.isoformat() if acc.connected_at else None,
                    "scopes": acc.scopes,
                })
            else:
                result.append({
                    "provider": provider,
                    "connected": False,
                    "email": None,
                    "connected_at": None,
                    "scopes": None,
                })
        return result
    finally:
        db.close()


def disconnect_provider(user_email: str, provider: str) -> bool:
    """Remove a connected account."""
    db = SessionLocal()
    try:
        acc = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_email == user_email,
                ConnectedAccount.provider == provider,
            )
            .first()
        )
        if acc:
            db.delete(acc)
            db.commit()
            return True
        return False
    finally:
        db.close()
```

---

### 2. `backend/app/routes/integration_routes.py` (NEW)

```python
"""
Connected Accounts — OAuth2 integration endpoints.

Flow (popup-based):
1. Frontend opens popup → GET /api/integrations/connect/{provider}?email=...
2. Backend redirects to provider's OAuth consent screen
3. Provider redirects back → GET /api/integrations/callback/{provider}?code=...
4. Backend exchanges code, stores encrypted tokens, returns HTML that closes popup
5. Frontend detects popup closed, refreshes status via GET /api/integrations/status
"""

import html
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse

from app.auth import CurrentUser, get_current_user
from app.config import settings
from fastapi import Depends
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


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/status")
async def integration_status(user: CurrentUser = Depends(get_current_user)):
    """Return connection status for all providers."""
    return get_connection_status(user.email)


# ── Connect (initiates OAuth flow) ───────────────────────────────────────────

@router.get("/connect/{provider}")
async def connect_provider(
    provider: str,
    email: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    """Redirect user to provider's OAuth consent screen."""
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")

    user_email = (email or user.email).lower().strip()

    if provider == "microsoft":
        url = microsoft_auth_url(user_email)
    elif provider == "zoho":
        url = zoho_auth_url(user_email)
    else:
        raise HTTPException(400, f"Provider {provider} not implemented")

    return RedirectResponse(url, status_code=302)


# ── Callback (handles OAuth redirect) ────────────────────────────────────────

def _callback_html(success: bool, provider: str, message: str = "") -> str:
    color = "#16a34a" if success else "#dc2626"
    title = "Connected!" if success else "Connection Failed"
    icon = "&#10003;" if success else "&#10007;"
    # Escape all dynamic content to prevent XSS
    safe_message = html.escape(
        message or (f'{provider.title()} account connected successfully.' if success else 'Something went wrong.')
    )
    safe_provider = html.escape(provider)
    origin = html.escape(settings.APP_BASE_URL.rstrip("/"))
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
        log.warning("[oauth] Microsoft callback error: %s — %s", error, error_description)
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
        result = await zoho_exchange_code(code, state)
        return HTMLResponse(
            _callback_html(True, "zoho", "Zoho People account connected. Leave and attendance features are now active.")
        )
    except Exception as e:
        log.exception("[oauth] Zoho token exchange failed")
        return HTMLResponse(_callback_html(False, "zoho", str(e)))


# ── Disconnect ───────────────────────────────────────────────────────────────

@router.delete("/disconnect/{provider}")
async def disconnect(provider: str, user: CurrentUser = Depends(get_current_user)):
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    removed = disconnect_provider(user.email, provider)
    if not removed:
        raise HTTPException(404, f"No {provider} connection found.")
    return {"status": "disconnected", "provider": provider}
```

---

## Files to Modify

### 3. `backend/app/models.py` — Add ConnectedAccount at the end

```python
class ConnectedAccount(Base):
    """OAuth2 tokens for user-connected external services (Microsoft, Zoho).
    Tokens are Fernet-encrypted at rest. The backend refreshes them transparently.
    """
    __tablename__ = "connected_accounts"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    provider = Column(String, nullable=False)              # "microsoft" | "zoho"
    access_token_enc = Column(Text, nullable=True)         # Fernet-encrypted
    refresh_token_enc = Column(Text, nullable=True)        # Fernet-encrypted
    token_expires_at = Column(DateTime, nullable=True)
    scopes = Column(Text, nullable=True)                   # space-separated scopes granted
    provider_user_id = Column(String, nullable=True)       # e.g. Microsoft OID
    provider_email = Column(String, nullable=True)         # email from the provider
    status = Column(String, default="active")              # active | expired | revoked
    connected_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
```

### 4. `backend/app/config.py` — Add OAuth config vars (before External Portal Automation section)

```python
    # ── Connected Accounts (OAuth2 delegated — per-user token storage) ────────
    # Microsoft: reuses MSAL app registration (add Web platform + client secret)
    MICROSOFT_OAUTH_CLIENT_ID = (
        os.getenv("MICROSOFT_OAUTH_CLIENT_ID")
        or os.getenv("VITE_MSAL_CLIENT_ID", "")
    )
    MICROSOFT_OAUTH_CLIENT_SECRET = os.getenv("MICROSOFT_OAUTH_CLIENT_SECRET", "")
    MICROSOFT_OAUTH_TENANT_ID = (
        os.getenv("MICROSOFT_OAUTH_TENANT_ID")
        or os.getenv("VITE_MSAL_TENANT_ID")
        or os.getenv("GRAPH_TENANT_ID", "")
    )
    MICROSOFT_OAUTH_SCOPES = os.getenv(
        "MICROSOFT_OAUTH_SCOPES",
        "openid profile email offline_access User.Read User.ReadBasic.All "
        "Mail.Read Mail.ReadWrite Mail.Send "
        "Calendars.Read Calendars.Read.Shared Calendars.ReadWrite "
        "Chat.Read Chat.ReadWrite",
    )
    # Fernet key for encrypting tokens at rest (32-byte URL-safe base64)
    TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")
```

### 5. `backend/app/main.py` — Two changes

**a) Add import at top (with other router imports):**
```python
from app.routes.integration_routes import router as integration_router
```

**b) Register router (with other app.include_router calls):**
```python
app.include_router(integration_router)
```

**c) Auto-inject OAuth token in `/api/chat` (inside the try block, before `start_time`):**
```python
        # Auto-fetch stored Microsoft token if none passed explicitly
        effective_graph_token = x_graph_token or None
        if not effective_graph_token:
            try:
                from app.services.oauth_service import get_valid_token
                effective_graph_token = await get_valid_token(
                    (x_user_email or settings.DEFAULT_USER_EMAIL).lower().strip(),
                    "microsoft",
                )
            except Exception:
                pass
```
Then pass `effective_graph_token` instead of `x_graph_token` to `app_agent.ainvoke`.

### 6. `src/routes/_layout.settings.tsx` — Add Connected Accounts section

**a) Add imports:**
```tsx
import { Link2, Unlink, CheckCircle2, Loader2, Mail, Calendar, ExternalLink } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
```

**b) Add after the Appearance card in SettingsPage:**
```tsx
          {/* Connected Accounts */}
          <motion.div variants={item} className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-[var(--border)]">
              <h3 className="text-[14px] sm:text-[15px] font-semibold text-foreground flex items-center gap-2">
                <Link2 className="h-4 w-4 text-blue-500" /> Connected Accounts
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Connect your accounts to enable mail, calendar, and chat features through the assistant.
              </p>
            </div>
            <div className="p-4 sm:p-6">
              <ConnectedAccounts userEmail={user.email} />
            </div>
          </motion.div>
```

**c) Add the full ConnectedAccounts component** — see the complete component in the conversation transcript at `c:\Users\shivam.sharma\.claude\projects\c--Users-shivam-sharma-aurora-ui\d8343c86-14db-4729-aea6-cd567eb31265.jsonl`. The component includes `PROVIDER_META`, `MicrosoftIcon`, `ZohoIcon`, and `ConnectedAccounts` with popup OAuth flow and postMessage origin validation.

---

## Security Details (Already Implemented)

- **XSS prevention**: All dynamic content in callback HTML escaped with `html.escape()`
- **CSRF protection**: State parameter is HMAC-SHA256 signed + 10-minute expiry
- **postMessage origin**: Backend sends to `APP_BASE_URL`, frontend validates `e.origin === window.location.origin`
- **Token encryption**: Fernet (AES-128-CBC + HMAC-SHA256) at rest; fails hard if key not set
- **Token refresh**: Transparent auto-refresh 2 minutes before expiry

---

## Microsoft Graph Scopes

| Scope | Purpose | Admin consent required? |
|-------|---------|------------------------|
| `openid profile email` | Basic OIDC | No |
| `offline_access` | Refresh tokens | No |
| `User.Read` | Read own profile | No |
| `User.ReadBasic.All` | Read other users' basic info | No |
| `Mail.Read` | Read emails | No |
| `Mail.ReadWrite` | Read + manage emails | No |
| `Mail.Send` | Send emails | No |
| `Calendars.Read` | Read own + added calendars | No |
| `Calendars.Read.Shared` | Read calendars shared by others | No* |
| `Calendars.ReadWrite` | Manage calendars | No |
| `Chat.Read` | Read Teams chats | No* |
| `Chat.ReadWrite` | Read + send Teams chats | No* |

*Azure Portal shows "No" but tenant consent policy may block these regardless.
