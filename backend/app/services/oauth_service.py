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

# -- CSRF state management ----------------------------------------------------
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


# -- Fernet encryption helpers ------------------------------------------------

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet
    key = settings.TOKEN_ENCRYPTION_KEY
    if not key:
        raise RuntimeError(
            "[oauth] TOKEN_ENCRYPTION_KEY is not set. "
            'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" '
            "and add it to your .env file. Refusing to auto-generate — an ephemeral key "
            "would make stored tokens unrecoverable after restart."
        )
    _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt_token(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()


# -- Provider configs ---------------------------------------------------------

PROVIDERS = {"microsoft", "zoho"}

MICROSOFT_AUTHORITY = "https://login.microsoftonline.com"
ZOHO_ACCOUNTS_URL = settings.ZOHO_ACCOUNTS_URL  # https://accounts.zoho.com


def _callback_url(provider: str) -> str:
    base = settings.APP_BASE_URL.rstrip("/")
    return f"{base}/api/integrations/callback/{provider}"


# -- Microsoft OAuth2 ---------------------------------------------------------

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
        "prompt": "select_account",
    }
    return f"{MICROSOFT_AUTHORITY}/{tenant}/oauth2/v2.0/authorize?{urlencode(params)}"


async def microsoft_exchange_code(code: str, state: str) -> dict:
    """Exchange authorization code for tokens and save to DB."""
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
        if not resp.is_success:
            log.error(
                "[oauth] Microsoft token exchange %s — redirect_uri=%s — body=%s",
                resp.status_code,
                payload["redirect_uri"],
                resp.text,
            )
        resp.raise_for_status()
        data = resp.json()

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


# -- Zoho OAuth2 --------------------------------------------------------------

ZOHO_SCOPES = os.getenv(
    "ZOHO_OAUTH_SCOPES",
    # Zoho uses ONE unified OAuth (accounts.zoho.com) across all products, so a single
    # connection can carry People + Expense + Recruit scopes. Exact scope names depend on
    # the org's Zoho edition; these are the read-only defaults. After changing this, the
    # user must RECONNECT Zoho so the new scopes are consented (existing tokens won't have
    # them — they return OAUTH_SCOPE_MISMATCH / code 57).
    "ZohoPeople.forms.ALL,ZohoPeople.leave.ALL,ZohoPeople.attendance.ALL,ZohoPeople.timetracker.ALL,ZohoPeople.performance.ALL,ZohoPeople.employee.ALL,"
    "ZohoExpense.expensereport.READ,ZohoExpense.reports.READ,ZohoExpense.organizations.READ,"
    "ZohoRecruit.modules.READ,ZohoRecruit.settings.READ",
)


def zoho_auth_url(user_email: str) -> str:
    """Build the Zoho OAuth2 authorization URL."""
    if not settings.ZOHO_CLIENT_ID or not settings.ZOHO_CLIENT_SECRET:
        raise ValueError("ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in .env to connect Zoho")
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


# -- Shared helpers -----------------------------------------------------------

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

        # Token expired -- refresh
        if provider == "microsoft":
            return await microsoft_refresh(acc)
        elif provider == "zoho":
            return await zoho_refresh(acc)
        return None
    finally:
        db.close()


async def get_alchemy_token(user_email: str) -> str | None:
    """Exchange stored Microsoft refresh token for an Alchemy-scoped access token.

    Alchemy is secured with Azure AD (App ID: 4a7dad8b-1372-499d-ade0-a91fe84ae4d6).
    The token is fetched on-demand and not persisted separately.
    """
    db = SessionLocal()
    try:
        acc = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_email == user_email,
                ConnectedAccount.provider == "microsoft",
                ConnectedAccount.status == "active",
            )
            .first()
        )
        if not acc or not acc.refresh_token_enc:
            return None

        tenant = settings.MICROSOFT_OAUTH_TENANT_ID or "common"
        token_url = f"{MICROSOFT_AUTHORITY}/{tenant}/oauth2/v2.0/token"

        payload = {
            "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID,
            "client_secret": settings.MICROSOFT_OAUTH_CLIENT_SECRET,
            "refresh_token": decrypt_token(acc.refresh_token_enc),
            "grant_type": "refresh_token",
            "scope": "api://4a7dad8b-1372-499d-ade0-a91fe84ae4d6/access_as_user",
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(token_url, data=payload)
            if resp.status_code != 200:
                log.warning("[oauth] Alchemy token exchange failed: %s", resp.text)
                return None
            data = resp.json()

        if "error" in data:
            log.warning("[oauth] Alchemy token error: %s", data)
            return None

        return data.get("access_token")
    finally:
        db.close()


async def get_yammer_token(user_email: str) -> str | None:
    """Exchange stored Microsoft refresh token for a Yammer-scoped access token.

    Yammer uses a different token audience than Graph API, so we exchange
    the same refresh token with scope=https://api.yammer.com/user_impersonation.
    The token is fetched on-demand and not persisted separately.
    """
    db = SessionLocal()
    try:
        acc = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_email == user_email,
                ConnectedAccount.provider == "microsoft",
                ConnectedAccount.status == "active",
            )
            .first()
        )
        if not acc or not acc.refresh_token_enc:
            return None

        tenant = settings.MICROSOFT_OAUTH_TENANT_ID or "common"
        token_url = f"{MICROSOFT_AUTHORITY}/{tenant}/oauth2/v2.0/token"

        payload = {
            "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID,
            "client_secret": settings.MICROSOFT_OAUTH_CLIENT_SECRET,
            "refresh_token": decrypt_token(acc.refresh_token_enc),
            "grant_type": "refresh_token",
            "scope": "https://api.yammer.com/user_impersonation",
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(token_url, data=payload)
            if resp.status_code != 200:
                log.warning("[oauth] Yammer token exchange failed: %s", resp.text)
                return None
            data = resp.json()

        if "error" in data:
            log.warning("[oauth] Yammer token error: %s", data)
            return None

        return data.get("access_token")
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
