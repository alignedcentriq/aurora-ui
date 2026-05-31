"""
Azure AD access-token validation for the observability content-reveal feature.

Unlike the rest of the app (which trusts MSAL-populated `x-user-*` headers), revealing
raw conversation content is a real security boundary. When AZURE_JWT_ENABLED is true the
backend validates the Azure access token (signature via JWKS, audience, issuer) and reads
the *validated* `groups` claim. Group membership → which conversation domains the caller
may reveal, per settings.REVEAL_GROUP_DOMAIN_MAP.

When AZURE_JWT_ENABLED is false (local dev), it falls back to header identity and grants
settings.DEV_REVEAL_DOMAINS so the flow is testable without Azure configured.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from fastapi import Depends, Header, HTTPException

from app.auth import CurrentUser, get_current_user
from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class RevealUser:
    email: str
    oid: Optional[str]
    allowed_domains: set = field(default_factory=set)


# Lazily-built JWKS client (only when JWT validation is enabled).
_jwk_client = None


def _get_jwk_client():
    global _jwk_client
    if _jwk_client is None:
        import jwt  # PyJWT
        url = f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/discovery/v2.0/keys"
        _jwk_client = jwt.PyJWKClient(url)
    return _jwk_client


def _domains_for_groups(groups: list[str]) -> set:
    """Resolve the set of conversation domains the given group IDs may reveal."""
    group_ids = set(groups or [])
    allowed = set()
    for domain, allowed_group_ids in settings.REVEAL_GROUP_DOMAIN_MAP.items():
        if group_ids & allowed_group_ids:
            allowed.add(domain)
    return allowed


def validate_access_token(token: str) -> dict:
    """Verify signature, audience, issuer and expiry; return the decoded claims."""
    import jwt  # PyJWT
    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=settings.AZURE_API_AUDIENCE,
            issuer=f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/v2.0",
        )
        return claims
    except Exception as e:  # invalid signature / aud / iss / expiry
        logger.warning("Azure token validation failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired access token.")


def get_reveal_user(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    header_user: CurrentUser = Depends(get_current_user),
) -> RevealUser:
    """FastAPI dependency yielding the caller and the domains they may reveal."""
    if not settings.AZURE_JWT_ENABLED:
        # Dev bypass — trust header identity, grant configured dev domains.
        return RevealUser(
            email=header_user.email,
            oid=None,
            allowed_domains=set(settings.DEV_REVEAL_DOMAINS),
        )

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer access token required.")

    token = authorization.split(" ", 1)[1].strip()
    claims = validate_access_token(token)

    groups = claims.get("groups")
    if groups is None and (claims.get("_claim_names") or claims.get("hasgroups")):
        # Azure emitted a groups *overage* claim instead of the array (>~200 groups).
        logger.error("Groups overage claim encountered — Graph memberOf lookup not implemented.")
        raise HTTPException(
            status_code=403,
            detail="Group membership could not be resolved (overage). Contact an administrator.",
        )

    email = (
        claims.get("preferred_username")
        or claims.get("upn")
        or claims.get("email")
        or ""
    ).lower()

    return RevealUser(
        email=email,
        oid=claims.get("oid"),
        allowed_domains=_domains_for_groups(groups or []),
    )
