"""
Connector auth strategies — inject auth into outgoing httpx requests.

Secrets are stored Fernet-encrypted in ConnectorAuth.config_enc.
Decrypted on first use, then cached in-process per connector_id for 5 minutes.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Optional

import httpx

from app.models import ConnectorAuth as ConnectorAuthModel
from app.database import SessionLocal

log = logging.getLogger(__name__)

# In-process cache: connector_id → (decrypted_config dict, expiry)
_auth_cache: dict[int, tuple[dict, float]] = {}
# Per-user cache: (connector_id, user_email) → (decrypted_config dict, expiry)
_user_auth_cache: dict[tuple[int, str], tuple[dict, float]] = {}
_AUTH_CACHE_TTL = 300.0  # 5 minutes


def _get_fernet():
    from cryptography.fernet import Fernet
    from app.config import settings
    key = getattr(settings, "FERNET_KEY", None)
    if not key:
        raise RuntimeError("FERNET_KEY not configured — cannot decrypt connector auth secrets")
    return Fernet(key.encode() if isinstance(key, str) else key)


def _load_config(connector_id: int) -> Optional[dict]:
    cached = _auth_cache.get(connector_id)
    if cached and time.monotonic() < cached[1]:
        return cached[0]

    with SessionLocal() as db:
        row = db.query(ConnectorAuthModel).filter(
            ConnectorAuthModel.connector_id == connector_id
        ).first()

    if row is None:
        return None

    cfg = _decrypt_blob(row.config_enc, f"connector {connector_id}")
    if cfg is None:
        return None

    _auth_cache[connector_id] = (cfg, time.monotonic() + _AUTH_CACHE_TTL)
    return cfg


def _decrypt_blob(config_enc: Optional[str], ctx: str) -> Optional[dict]:
    """Decrypt a Fernet config blob → dict. None on failure, {} if empty."""
    if not config_enc:
        return {}
    try:
        f = _get_fernet()
        return json.loads(f.decrypt(config_enc.encode()).decode())
    except Exception as exc:
        log.error("Failed to decrypt auth config for %s: %s", ctx, exc)
        return None


def _load_user_config(connector_id: int, user_email: str) -> Optional[dict]:
    """Load this user's own credential for a per_user connector. None if unlinked."""
    key = (connector_id, user_email)
    cached = _user_auth_cache.get(key)
    if cached and time.monotonic() < cached[1]:
        return cached[0]

    from app.models import ConnectorUserAuth
    with SessionLocal() as db:
        row = db.query(ConnectorUserAuth).filter(
            ConnectorUserAuth.connector_id == connector_id,
            ConnectorUserAuth.user_email == user_email,
        ).first()

    if row is None:
        return None
    cfg = _decrypt_blob(row.config_enc, f"connector {connector_id} user {user_email}")
    if cfg is None:
        return None
    _user_auth_cache[key] = (cfg, time.monotonic() + _AUTH_CACHE_TTL)
    return cfg


def invalidate_auth_cache(connector_id: int) -> None:
    _auth_cache.pop(connector_id, None)
    # Drop every per-user entry for this connector too (auth type/mode may have changed).
    for key in [k for k in _user_auth_cache if k[0] == connector_id]:
        _user_auth_cache.pop(key, None)


def invalidate_user_auth_cache(connector_id: int, user_email: str) -> None:
    _user_auth_cache.pop((connector_id, user_email), None)


def connected_account_provider(connector_id: int) -> str:
    """The SSO provider a connected_account connector is bound to (from its config)."""
    cfg = _load_config(connector_id) or {}
    return cfg.get("provider", "microsoft")


def _has_connected_account(user_email: str, provider: str) -> bool:
    from app.models import ConnectedAccount
    with SessionLocal() as db:
        acc = db.query(ConnectedAccount).filter(
            ConnectedAccount.user_email == user_email,
            ConnectedAccount.provider == provider,
            ConnectedAccount.status == "active",
        ).first()
    return acc is not None


def has_credential(connector_id: int, auth_type: str, auth_mode: str, user_email: Optional[str] = None) -> bool:
    """True if a usable credential exists for this (connector, mode, user)."""
    if auth_type == "none":
        return True
    if auth_type == "connected_account":
        # Uses the caller's own SSO connection (Microsoft/Zoho) — inherently per-user.
        return bool(user_email) and _has_connected_account(user_email, connected_account_provider(connector_id))
    if auth_mode == "per_user":
        return bool(user_email) and _load_user_config(connector_id, user_email) is not None
    return _load_config(connector_id) is not None


def inject_auth(
    connector_id: int,
    auth_type: str,
    headers: dict,
    params: dict,
    auth_mode: str = "service",
    user_email: Optional[str] = None,
) -> None:
    """Mutate headers/params in-place to inject the appropriate credential.

    When auth_mode='per_user', the caller's own stored credential is used;
    otherwise the shared connector-level (service) credential.
    """
    if auth_type == "none":
        return

    if auth_mode == "per_user" and user_email:
        cfg = _load_user_config(connector_id, user_email) or {}
    else:
        cfg = _load_config(connector_id) or {}

    if auth_type == "api_key":
        header_name = cfg.get("header_name", "X-Api-Key")
        headers[header_name] = cfg.get("api_key", "")

    elif auth_type == "bearer":
        headers["Authorization"] = f"Bearer {cfg.get('token', '')}"

    elif auth_type == "basic":
        from base64 import b64encode
        creds = f"{cfg.get('username', '')}:{cfg.get('password', '')}"
        headers["Authorization"] = "Basic " + b64encode(creds.encode()).decode()

    elif auth_type == "oauth2":
        # Expects a pre-fetched access token stored in config (refreshed externally)
        headers["Authorization"] = f"Bearer {cfg.get('access_token', '')}"

    else:
        log.warning("Unknown auth_type %r for connector %s — skipping auth injection", auth_type, connector_id)


def encrypt_config(plain: dict) -> str:
    """Fernet-encrypt a dict for storage in ConnectorAuth.config_enc."""
    f = _get_fernet()
    return f.encrypt(json.dumps(plain).encode()).decode()


# ── OAuth2 (connector-owned) with automatic refresh ───────────────────────────

def _persist_config(connector_id: int, auth_mode: str, user_email: Optional[str], cfg: dict) -> None:
    """Re-encrypt and write a mutated config back (e.g. a freshly refreshed token) + refresh cache."""
    try:
        enc = encrypt_config(cfg)
        with SessionLocal() as db:
            if auth_mode == "per_user" and user_email:
                from app.models import ConnectorUserAuth
                row = db.query(ConnectorUserAuth).filter(
                    ConnectorUserAuth.connector_id == connector_id,
                    ConnectorUserAuth.user_email == user_email,
                ).first()
                if row:
                    row.config_enc = enc
                    db.commit()
                _user_auth_cache[(connector_id, user_email)] = (cfg, time.monotonic() + _AUTH_CACHE_TTL)
            else:
                row = db.query(ConnectorAuthModel).filter(
                    ConnectorAuthModel.connector_id == connector_id
                ).first()
                if row:
                    row.config_enc = enc
                    db.commit()
                _auth_cache[connector_id] = (cfg, time.monotonic() + _AUTH_CACHE_TTL)
    except Exception as exc:
        log.warning("Failed to persist refreshed oauth2 token for connector %s: %s", connector_id, exc)


async def ensure_oauth2_token(
    connector_id: int,
    auth_mode: str = "service",
    user_email: Optional[str] = None,
    force_refresh: bool = False,
) -> Optional[str]:
    """Return a valid OAuth2 access token, refreshing via the token endpoint when needed.

    Config keys (in the connector's encrypted config): token_url, client_id, client_secret,
    refresh_token, scope. Falls back to a static access_token when no refresh material exists.
    """
    if auth_mode == "per_user" and user_email:
        cfg = _load_user_config(connector_id, user_email) or {}
    else:
        cfg = _load_config(connector_id) or {}

    token = cfg.get("access_token")
    if token and not force_refresh:
        try:
            if float(cfg.get("expires_at", 0)) > time.time() + 120:
                return token  # still valid
        except (TypeError, ValueError):
            pass  # no/invalid expiry recorded — fall through and try to refresh

    token_url = cfg.get("token_url")
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")
    refresh_token = cfg.get("refresh_token")

    # No way to fetch a new token — return whatever static token we have (back-compat).
    if not token_url or not client_id or (not refresh_token and not client_secret):
        return token

    if refresh_token:
        data = {"grant_type": "refresh_token", "client_id": client_id,
                "client_secret": client_secret or "", "refresh_token": refresh_token}
    else:
        data = {"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}
    if cfg.get("scope"):
        data["scope"] = cfg["scope"]

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(token_url, data=data)
        if resp.status_code != 200:
            log.warning("oauth2 token fetch failed for connector %s: HTTP %s %s",
                        connector_id, resp.status_code, resp.text[:200])
            return token
        body = resp.json()
    except Exception as exc:
        log.warning("oauth2 token fetch error for connector %s: %s", connector_id, exc)
        return token

    new_token = body.get("access_token")
    if not new_token:
        return token

    cfg["access_token"] = new_token
    cfg["expires_at"] = time.time() + int(body.get("expires_in", 3600)) - 60
    if body.get("refresh_token"):
        cfg["refresh_token"] = body["refresh_token"]  # rotated refresh token
    _persist_config(connector_id, auth_mode, user_email, cfg)
    return new_token


async def resolve_connected_account_token(connector_id: int, user_email: str) -> Optional[str]:
    """Get a valid access token from the caller's own SSO connection (Microsoft/Zoho)."""
    provider = connected_account_provider(connector_id)
    try:
        from app.services import oauth_service
        return await oauth_service.get_valid_token(user_email, provider)
    except Exception as exc:
        log.warning("connected_account token resolve failed (connector %s, %s): %s",
                    connector_id, provider, exc)
        return None


async def apply_auth(
    connector_id: int,
    auth_type: str,
    headers: dict,
    params: dict,
    auth_mode: str = "service",
    user_email: Optional[str] = None,
    force_refresh: bool = False,
) -> None:
    """Async front door for auth injection — handles token-fetching types (oauth2,
    connected_account) and delegates the static ones to inject_auth()."""
    if auth_type == "none":
        return
    if auth_type == "connected_account":
        token = await resolve_connected_account_token(connector_id, user_email or "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return
    if auth_type == "oauth2":
        token = await ensure_oauth2_token(connector_id, auth_mode, user_email, force_refresh)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return
    inject_auth(connector_id, auth_type, headers, params, auth_mode, user_email)
