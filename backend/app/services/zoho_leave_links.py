"""Zoho People leave deep-links — the single source of truth for leave navigation.

Product decision (2026-06-19): the assistant does NOT apply or cancel leave itself.
Zoho People owns the leave workflow. The assistant only deep-links the user into the
right Zoho page:
  • apply  → the apply-leave form (user fills + submits in Zoho; we can't prefill —
             Zoho's form takes no URL params and we don't run a headless browser)
  • cancel → the specific leave's view-record page, where Zoho's own Cancel button lives

These are web deep-links built from ZOHO_PEOPLE_URL (e.g.
https://people.zoho.com/alignedautomationservices/zp). Pure string builders — no I/O —
so they're trivially testable.
"""

from app.config import settings

_FALLBACK_BASE = "https://people.zoho.com"


def _base() -> str:
    return (settings.ZOHO_PEOPLE_URL or _FALLBACK_BASE).rstrip("/")


def apply_url() -> str:
    """Deep-link to the Zoho People apply-leave form."""
    return f"{_base()}#leavetracker/applyleave"


def tracker_url() -> str:
    """Deep-link to the user's Zoho People leave tracker (list of their leaves)."""
    return f"{_base()}#leavetracker/mydata"


def record_url(record_id: str) -> str:
    """Deep-link to one leave's view-record page (where Zoho's Cancel button is)."""
    return f"{_base()}#leavetracker/mydata/view-recordId:{record_id}"
