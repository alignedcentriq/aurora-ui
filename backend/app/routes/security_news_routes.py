"""IT-only endpoints for the Security News Digest — config management and manual trigger."""
import asyncio
import datetime

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import CurrentUser, require_super_admin
from app.config import settings

router = APIRouter(prefix="/api/it/security-news", tags=["security-news"])


@router.get("/config")
async def get_security_news_config(_: CurrentUser = Depends(require_super_admin)):
    """Return current digest config plus all available source metadata."""
    from app.services.security_news_service import get_config, get_sources_metadata
    return {
        "config": get_config(),
        "sources_catalog": get_sources_metadata(),
    }


@router.put("/config")
async def update_security_news_config(
    patch: dict = Body(...),
    user: CurrentUser = Depends(require_super_admin),
):
    """Persist a partial update to the digest config (enabled, hour, recipients, sources)."""
    from app.services.security_news_service import update_config
    try:
        new = update_config(patch, updated_by=user.email)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "config": new}


@router.post("/send-now")
async def send_security_news_now(user: CurrentUser = Depends(require_super_admin)):
    """Immediately trigger the digest — bypasses the daily schedule gate."""
    from app.services.security_news_service import get_config, fetch_digest
    cfg = get_config()

    recipients = cfg.get("recipients") or []
    if not recipients:
        raise HTTPException(
            status_code=400,
            detail="No recipients configured. Add recipient emails in the Security Digest settings.",
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
        from app.services.email_service import send_security_news_digest
        items = fetch_digest(cfg)
        if not items:
            return "no_news", 0
        date_str = datetime.date.today().strftime("%B %d, %Y")
        ok = send_security_news_digest(sender, recipients, items, date_str)
        return "sent" if ok else "failed", len(items)

    try:
        status, count = await asyncio.to_thread(_send)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Send failed: {exc}")

    if status == "no_news":
        return {"status": "no_news", "stories": 0, "recipients": recipients,
                "message": "No new cybersecurity stories in the last 24 hours — nothing to send."}
    if status == "failed":
        raise HTTPException(
            status_code=502,
            detail="Email send failed — check that the sender mailbox has a connected MS365 token.",
        )
    return {"status": "sent", "stories": count, "recipients": recipients}
