"""Super Admin-only endpoints for the runtime LLM controls (kill switch, load throttle,
per-tier model params, per-domain disable). Gated by ``require_super_admin``."""
import asyncio
import datetime

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import CurrentUser, require_super_admin
from app.config import settings
from app.services import llm_controls_service as llm_controls

router = APIRouter(prefix="/api/it/llm-controls", tags=["llm-controls"])


@router.get("")
async def get_llm_controls(_: CurrentUser = Depends(require_super_admin)):
    """Current effective config plus the metadata the UI needs to render the
    editor: env defaults, validation bounds, the model allow-list, disableable
    domains, tier names, and who last changed it."""
    live = llm_controls.available_models()
    return {
        "effective": llm_controls.get_config(),
        "defaults": llm_controls.defaults(),
        "bounds": {k: list(v) for k, v in llm_controls.BOUNDS.items()},
        # Authoritative list (what's actually pulled on the server) when reachable;
        # otherwise the static known list so the dropdown is never empty.
        "models": live if live is not None else llm_controls.known_models(),
        "models_live": live is not None,
        "domains": llm_controls.DISABLEABLE_DOMAINS,
        "tiers": list(llm_controls.VALID_TIERS),
        **llm_controls.get_meta(),
    }


@router.put("")
async def update_llm_controls(
    patch: dict = Body(...),
    user: CurrentUser = Depends(require_super_admin),
):
    """Validate + persist a partial update. Bounds are enforced server-side."""
    try:
        new = llm_controls.update_config(patch, updated_by=user.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "effective": new, **llm_controls.get_meta()}


@router.post("/reset")
async def reset_llm_controls(user: CurrentUser = Depends(require_super_admin)):
    """Clear all overrides — revert to env defaults."""
    new = llm_controls.reset_config(updated_by=user.email)
    return {"status": "ok", "effective": new, **llm_controls.get_meta()}


@router.post("/security-news/send-now")
async def send_security_news_now(user: CurrentUser = Depends(require_super_admin)):
    """Immediately trigger the security news digest — for testing and demos.
    Bypasses the daily schedule gate; always sends regardless of the enabled flag."""
    recipients = [r.strip() for r in settings.SECURITY_NEWS_RECIPIENTS.split(",") if r.strip()]
    if not recipients:
        raise HTTPException(
            status_code=400,
            detail="SECURITY_NEWS_RECIPIENTS is not configured. Add it to .env.local.",
        )
    sender = (
        settings.SECURITY_NEWS_SENDER
        or settings.PARKING_REMINDER_SENDER
        or settings.NOTIFY_TO_EMAIL
    )
    if not sender:
        raise HTTPException(
            status_code=400,
            detail="No sender mailbox configured. Set SECURITY_NEWS_SENDER in .env.local.",
        )

    def _send():
        from app.services.security_news_service import fetch_digest
        from app.services.email_service import send_security_news_digest
        items = fetch_digest()
        if not items:
            return False, 0
        date_str = datetime.date.today().strftime("%B %d, %Y")
        ok = send_security_news_digest(sender, recipients, items, date_str)
        return ok, len(items)

    try:
        ok, count = await asyncio.to_thread(_send)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Send failed: {exc}")

    if not ok:
        raise HTTPException(
            status_code=502,
            detail="Email send failed — check that the sender mailbox has a connected MS365 token.",
        )
    return {"status": "sent", "stories": count, "recipients": recipients}
