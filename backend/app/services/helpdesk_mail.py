"""Read the IT helpdesk's lifecycle emails to learn the real status of a request.

The software-install flow is email-only: we email the helpdesk and ManageEngine ServiceDesk
auto-creates a request, then emails the user at each lifecycle step. The user receives, for one
request id (e.g. RE-7964), a sequence like:

    logged    Subject: Your request has been logged with request id ##RE-7964##
              Body:    ...created with id 7964. The title of the request is : <title>
    assigned  Subject: Your request with id ##RE-7964## has been assigned to Vyas Verma
              Body:    ...assigned to technician - Vyas Verma            (NOTE: no title, id only)
    approved  Subject: Request Id ##RE-7964## has been Approved
              Body:    ...Title : <title>
    resolved  Subject: Your Request with ID :##RE-7964## has been Resolved.
              Body:    ...Title : <title>

These mails are the AUTHORITATIVE state of a request (they cross sessions, survive a DB reset,
and carry the real RE-#### id + assigned technician). We use them to:
  * detect that a request for a given software is still OPEN (so we don't draft a duplicate),
  * tell the user the real id, status, and who it's assigned to,
  * recognise a RESOLVED request so a genuinely-new request is allowed through.

Because the 'assigned' mail has no title, software<->request mapping is done by request id:
the title comes from the logged/approved/resolved mail; the live status is the latest mail for
that id. Everything fails soft (returns None) when the token is missing, the call errors, or
nothing matches — callers then fall back to the durable pending-action window.
"""

import re
import logging
import datetime

from app.services import ms365_service

log = logging.getLogger("aurora-logger")

# Request id appears in every subject as ##RE-7964## (the surrounding ':'/spaces vary).
_SUBJECT_ID_RE = re.compile(r'##\s*(RE-?\d+)\s*##', re.I)
_BODY_ID_RE = re.compile(r'\b(?:created|logged)\s+with\s+id\s*[:#]?\s*(\d+)', re.I)
# Title: "The title of the request is : <t>" (logged) OR "Title : <t>" (approved/resolved).
_TITLE_RE = re.compile(
    r'(?:title\s+of\s+the\s+request\s+is|\btitle)\s*:?\s*'
    r'(.+?)\s*(?:\.\s|\bDescription\b|View\s+Request|Please\s+get\s+back|[\r\n]|$)', re.I
)
# Technician: subject "...assigned to Vyas Verma" / body "...assigned to technician - Vyas Verma".
_TECH_RE = re.compile(
    r'assigned\s+to\s+(?:technician\s*[-:]?\s*)?(.+?)\s*(?:View\s+Request|[\r\n]|$)', re.I
)
# Any helpdesk lifecycle mail (used as a sender fallback when the address is masked/forwarded).
_HELPDESK_SUBJECT_RE = re.compile(
    r'request\s+id|request\s+has\s+been|request\s+with\s+id|has\s+been\s+(?:logged|assigned|approved|resolved|closed)',
    re.I,
)

# Status detected from the subject (then body), most-specific first — 'logged' is the generic
# catch-all and must be checked last.
_STATUS_PATTERNS = [
    ("resolved", re.compile(r'\bresolved\b', re.I)),
    ("closed",   re.compile(r'\bclosed\b', re.I)),
    ("approved", re.compile(r'\bapproved\b', re.I)),
    ("assigned", re.compile(r'\bassigned\b', re.I)),
    ("logged",   re.compile(r'has\s+been\s+logged|created\s+with\s+id|request\s+id', re.I)),
]

# A request in one of these is still in progress; the others are terminal (done).
_OPEN_STATUSES = {"logged", "assigned", "approved"}
_CLOSED_STATUSES = {"resolved", "closed"}


def _normalize_id(raw: str) -> str:
    """'RE7964' / 're-7964' / '7964' -> 'RE-7964'."""
    digits = re.sub(r'\D', '', (raw or ""))
    return f"RE-{digits}" if digits else (raw or "").strip().upper()


def _looks_like_helpdesk(from_email: str, from_name: str, subject: str) -> bool:
    fe, fn = (from_email or "").lower(), (from_name or "").lower()
    if "helpdesk" in fe or "servicedesk" in fe or fn == "helpdesk" or "service desk" in fn:
        return True
    return bool(_HELPDESK_SUBJECT_RE.search(subject or "") and _SUBJECT_ID_RE.search(subject or ""))


def _detect_status(blob: str) -> str | None:
    for name, rx in _STATUS_PATTERNS:
        if rx.search(blob):
            return name
    return None


def _parse_event(subject: str, preview: str, received: str = "") -> dict | None:
    """Parse one helpdesk mail into {request_id, status, title, technician, received} or None."""
    blob = f"{subject}\n{preview}"
    status = _detect_status(blob)
    if not status:
        return None
    m_id = _SUBJECT_ID_RE.search(subject or "") or _BODY_ID_RE.search(preview or "")
    if not m_id:
        return None
    m_title = _TITLE_RE.search(preview or "")
    m_tech = _TECH_RE.search(blob) if status == "assigned" else None
    return {
        "request_id": _normalize_id(m_id.group(1)),
        "status": status,
        "title": (m_title.group(1).strip() if m_title else ""),
        "technician": (m_tech.group(1).strip() if m_tech else ""),
        "received": received,
    }


def _title_matches_software(title: str, software_name: str) -> bool:
    t, s = (title or "").lower(), (software_name or "").strip().lower()
    return bool(s) and s in t


def _received_dt(received_iso: str) -> datetime.datetime:
    """Parse an ISO timestamp; on failure return min (so it sorts oldest)."""
    try:
        return datetime.datetime.fromisoformat((received_iso or "").replace("Z", "+00:00"))
    except Exception:
        return datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)


def _is_recent(received_iso: str, within_days: int | None) -> bool:
    """True if within the window (permissive when the date is missing/unparseable)."""
    if within_days is None or not (received_iso or "").strip():
        return True
    try:
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=within_days)
        return _received_dt(received_iso) >= cutoff
    except Exception:
        return True


async def find_request_status(
    graph_token: str, software_name: str, top: int = 50, within_days: int = 14
) -> dict | None:
    """Return the live status of the most recent request whose title names `software_name`.

    Correlates the lifecycle mails by request id: the title comes from a logged/approved/
    resolved mail; the current status is that id's latest mail. Returns
        {request_id, status, title, technician, received, is_open}
    or None if no token / API error / nothing matches (caller falls back to the window).

    within_days bounds which lifecycle mails we consider, so a long-closed request's old mails
    don't linger forever.
    """
    if not graph_token or not (software_name or "").strip():
        return None
    try:
        res = await ms365_service.fetch_my_emails(graph_token, top=top)
    except Exception:
        log.exception("helpdesk_mail: fetch_my_emails raised")
        return None
    if not res or not res.get("success"):
        return None

    # 1) Parse all helpdesk lifecycle mails (within the window) into events.
    events: list[dict] = []
    for m in res.get("emails", []):
        subject = m.get("subject", "")
        if not _looks_like_helpdesk(m.get("from_email", ""), m.get("from_name", ""), subject):
            continue
        if not _is_recent(m.get("received", ""), within_days):
            continue
        ev = _parse_event(subject, m.get("preview", ""), m.get("received", ""))
        if ev:
            events.append(ev)
    if not events:
        return None

    # 2) Title<->id map (from the title-bearing mails) and the latest event per id.
    title_by_id: dict[str, str] = {}
    latest_by_id: dict[str, dict] = {}
    for ev in events:
        rid = ev["request_id"]
        if ev["title"] and rid not in title_by_id:
            title_by_id.setdefault(rid, ev["title"])
        cur = latest_by_id.get(rid)
        if cur is None or _received_dt(ev["received"]) >= _received_dt(cur["received"]):
            latest_by_id[rid] = ev

    # 3) Request ids whose (known) title names the software; pick the most recent request.
    matched_ids = [rid for rid, title in title_by_id.items()
                   if _title_matches_software(title, software_name)]
    if not matched_ids:
        return None
    rid = max(matched_ids, key=lambda r: _received_dt(latest_by_id[r]["received"]))

    latest = latest_by_id[rid]
    return {
        "request_id": rid,
        "status": latest["status"],
        "title": title_by_id.get(rid, latest.get("title", "")),
        "technician": latest.get("technician", ""),
        "received": latest.get("received", ""),
        "is_open": latest["status"] in _OPEN_STATUSES,
    }
