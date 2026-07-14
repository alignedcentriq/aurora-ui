"""
Morning Briefing (ARB #39)
--------------------------
A personalized, proactive digest that fuses the signals the platform already
produces into one "here's your day" card:

  • Attention items  — the user's top proactive nudges (expiring leaves, stale
    approvals, onboarding next-steps …) from ``nudge_service``.
  • Leave balance     — a one-line snapshot of remaining leave from the CSV/Zoho
    source via ``leave_balance_sync``.
  • Highlights        — a couple of self-scoped personal metrics (e.g. leave
    requests in the last 30 days) from the whitelisted ``analytics_service``.

It is read-only and additive: every section is best-effort and degrades to
empty rather than failing the whole briefing. The frontend renders it on the
assistant home so a user "arrives" to their briefing each morning.
"""

from __future__ import annotations

import datetime
import logging

logger = logging.getLogger(__name__)

# Cap on attention items so the card stays a glance, not a backlog.
_MAX_ATTENTION = 4


def _greeting(hour: int) -> str:
    if hour < 12:
        return "Good morning"
    if hour < 17:
        return "Good afternoon"
    return "Good evening"


def _first_name(email: str, name: str = "") -> str:
    if name:
        return name.split(" ")[0]
    local = (email or "").split("@")[0]
    # "shivam.sharma" -> "Shivam"
    return (local.split(".")[0] or "there").capitalize()


def _attention_items(email: str) -> list[dict]:
    """Top proactive nudges, normalised to briefing items."""
    from app.services import nudge_service
    try:
        nudges = nudge_service.list_for_user(email)
    except Exception:
        logger.exception("[briefing] nudge lookup failed")
        return []
    # answer_ready nudges are ephemeral toasts (see ProactiveNudgeFeed), not
    # briefing items — their title is a status message, not a prompt.
    nudges = [n for n in nudges if n.get("nudge_type") != "answer_ready"]
    items = []
    for n in nudges[:_MAX_ATTENTION]:
        items.append({
            "id": n.get("id"),
            "title": n.get("title"),
            "body": n.get("body"),
            "severity": n.get("severity") or "info",
            "action_type": n.get("action_type"),
            "action_payload": n.get("action_payload") or {},
        })
    return items


def _leave_snapshot(email: str) -> dict | None:
    """One-line remaining-leave summary + per-type rows."""
    from app.services import leave_balance_sync
    try:
        res = leave_balance_sync.get_or_refresh(email)
    except Exception:
        logger.exception("[briefing] leave balance lookup failed")
        return None
    if not res or not res.get("success"):
        return None
    balances = res.get("balances") or []
    if not balances:
        return None
    total_remaining = round(sum(float(b.get("balance") or 0) for b in balances), 1)
    # Show the few leave types with a remaining balance, most first.
    rows = sorted(
        [b for b in balances if float(b.get("balance") or 0) > 0],
        key=lambda b: float(b.get("balance") or 0),
        reverse=True,
    )[:4]
    unit = "day" if total_remaining == 1 else "days"
    return {
        "summary": f"{total_remaining:g} {unit} available",
        "total_remaining": total_remaining,
        "items": [
            {"type": b.get("type"), "balance": float(b.get("balance") or 0)}
            for b in rows
        ],
        "source": res.get("source"),
    }


def _highlights(db, email: str, role: str) -> list[dict]:
    """Self-scoped personal metrics — best-effort, never raises out."""
    from app.services import analytics_service
    out: list[dict] = []
    try:
        r = analytics_service.run_query(
            db, metric="leaves_taken", dimension="leave_type", period="30d",
            role=role, person_scope="me", user_email=email,
        )
        total = round(sum(s["value"] for s in r.get("series", [])))
        out.append({
            "label": "Leave requests · last 30 days",
            "value": str(int(total)),
            "unit": "count",
        })
    except Exception:
        # Metric/scope not available for this user — silently skip.
        pass
    return out


def build_briefing(db, email: str, role: str, name: str = "") -> dict:
    """Assemble the full briefing payload for one user."""
    now = datetime.datetime.now()
    attention = _attention_items(email)
    leave = _leave_snapshot(email)
    highlights = _highlights(db, email, role)

    has_anything = bool(attention or leave or highlights)

    return {
        "greeting": f"{_greeting(now.hour)}, {_first_name(email, name)}",
        "date_label": now.strftime("%A, %d %B %Y"),
        "generated_at": now.isoformat(),
        "attention": attention,
        "leave_balance": leave,
        "highlights": highlights,
        "has_anything": has_anything,
    }
