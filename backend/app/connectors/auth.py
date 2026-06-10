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

from app.models import ConnectorAuth as ConnectorAuthModel
from app.database import SessionLocal

log = logging.getLogger(__name__)

# In-process cache: connector_id → (decrypted_config dict, expiry)
_auth_cache: dict[int, tuple[dict, float]] = {}
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

    if not row.config_enc:
        cfg = {}
    else:
        try:
            f = _get_fernet()
            cfg = json.loads(f.decrypt(row.config_enc.encode()).decode())
        except Exception as exc:
            log.error("Failed to decrypt auth config for connector %s: %s", connector_id, exc)
            return None

    _auth_cache[connector_id] = (cfg, time.monotonic() + _AUTH_CACHE_TTL)
    return cfg


def invalidate_auth_cache(connector_id: int) -> None:
    _auth_cache.pop(connector_id, None)


def inject_auth(connector_id: int, auth_type: str, headers: dict, params: dict) -> None:
    """Mutate headers/params in-place to inject the appropriate credential."""
    if auth_type == "none":
        return

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
