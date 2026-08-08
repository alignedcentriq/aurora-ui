#!/usr/bin/env python3
"""Generate a Zoho OAuth2 consent URL for a given email using backend/.env settings.

Usage: python scripts/generate_zoho_auth_url.py shivam.sharma@alignedautomation.com
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from urllib.parse import urlencode


def load_env(path: str) -> dict:
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def _state_signing_key(key: str) -> bytes:
    return hashlib.sha256(key.encode() if isinstance(key, str) else key).digest()


def _create_signed_state(email: str, signing_key: bytes) -> str:
    payload = json.dumps({"email": email, "nonce": secrets.token_hex(16), "ts": int(time.time())})
    raw = base64.urlsafe_b64encode(payload.encode()).decode()
    sig = hmac.new(signing_key, raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def build_zoho_auth_url(email: str, env_path: str = "backend/.env") -> str:
    env = load_env(env_path)
    client_id = env.get("ZOHO_CLIENT_ID")
    accounts = env.get("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.com")
    scopes = env.get(
        "ZOHO_OAUTH_SCOPES",
        "ZohoPeople.leave.ALL,ZohoPeople.attendance.ALL,ZohoPeople.employee.ALL,ZohoPeople.forms.ALL",
    )
    redirect_base = env.get("OAUTH_REDIRECT_BASE_URL", "http://localhost:3000").rstrip("/")
    token_key = env.get("TOKEN_ENCRYPTION_KEY") or "dev-fallback-key"

    if not client_id:
        raise SystemExit("ZOHO_CLIENT_ID not found in backend/.env")

    signing_key = _state_signing_key(token_key)
    state = _create_signed_state(email, signing_key)

    redirect_uri = f"{redirect_base}/api/integrations/callback/zoho"

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": scopes,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{accounts}/oauth/v2/auth?{urlencode(params)}"


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate_zoho_auth_url.py user@example.com")
        raise SystemExit(2)
    email = sys.argv[1]
    url = build_zoho_auth_url(email)
    print(url)


if __name__ == "__main__":
    main()
