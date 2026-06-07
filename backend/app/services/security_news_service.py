"""
Cybersecurity news digest service.

Fetches headlines from public RSS feeds and the CISA Known Exploited
Vulnerabilities catalogue. Only stories published within the last 24 hours
are returned — old news is discarded. All URLs are stripped before returning.

Cache is date-keyed: rolls over at midnight so stale items never bleed into
the next day's digest.
"""

import datetime
import email.utils
import html
import logging
import re
import time
import xml.etree.ElementTree as ET

import httpx

logger = logging.getLogger("aurora-logger")

# Cache is keyed to the calendar date so it automatically invalidates at midnight.
_CACHE: dict = {"date": None, "ts": 0.0, "data": None}
_CACHE_TTL = 1800  # 30 minutes — re-fetch within the day if stale

# Public RSS feeds — no API key required
_FEEDS = [
    ("The Hacker News", "https://feeds.feedburner.com/TheHackersNews"),
    ("Bleeping Computer", "https://www.bleepingcomputer.com/feed/"),
]

_CISA_KEV_URL = (
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
)

_MAX_PER_SOURCE = 5
_SUMMARY_MAX_CHARS = 380
_HEADERS = {"User-Agent": "CentriqAI/1.0 (internal digest; no scraping)"}

# Stories older than this are considered "old news" and discarded.
_MAX_AGE_HOURS = 24


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_rss_date(date_str: str) -> datetime.datetime | None:
    """Parse an RFC 2822 RSS pubDate into a timezone-aware datetime, or None."""
    try:
        return email.utils.parsedate_to_datetime(date_str.strip())
    except Exception:
        return None


def _is_recent(pub_dt: datetime.datetime | None) -> bool:
    """True if the item was published within the last _MAX_AGE_HOURS hours."""
    if pub_dt is None:
        return False
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        # Normalise to UTC if the feed supplies an offset-aware datetime
        if pub_dt.tzinfo is None:
            pub_dt = pub_dt.replace(tzinfo=datetime.timezone.utc)
        age = now - pub_dt
        return age.total_seconds() <= _MAX_AGE_HOURS * 3600
    except Exception:
        return False


def _friendly_date(pub_dt: datetime.datetime | None, raw: str) -> str:
    """Return a human-readable date string for display in the email."""
    if pub_dt is None:
        return raw
    try:
        local = pub_dt.astimezone()
        return local.strftime("%b %d, %Y %H:%M %Z")
    except Exception:
        return raw


def _fetch_rss(source_name: str, url: str) -> list[dict]:
    """Fetch RSS and return only items published in the last 24 hours."""
    try:
        resp = httpx.get(url, timeout=12, follow_redirects=True, headers=_HEADERS)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        items = []
        for item in root.findall(".//item"):
            title = _strip_html(item.findtext("title") or "")
            if not title:
                continue
            pub_raw = item.findtext("pubDate") or ""
            pub_dt = _parse_rss_date(pub_raw)
            if not _is_recent(pub_dt):
                continue
            summary = _strip_html(item.findtext("description") or "")[:_SUMMARY_MAX_CHARS]
            items.append({
                "title": title,
                "summary": summary,
                "date": _friendly_date(pub_dt, pub_raw),
                "source": source_name,
            })
            if len(items) >= _MAX_PER_SOURCE:
                break
        return items
    except Exception as exc:
        logger.warning("[security_news] RSS fetch failed (%s): %s", source_name, exc)
        return []


def _fetch_cisa() -> list[dict]:
    """Return CISA KEV entries added within the last 24 hours."""
    try:
        resp = httpx.get(_CISA_KEV_URL, timeout=12, follow_redirects=True, headers=_HEADERS)
        resp.raise_for_status()
        data = resp.json()
        cutoff = datetime.date.today() - datetime.timedelta(days=1)
        items = []
        for v in reversed(data.get("vulnerabilities") or []):
            raw_date = v.get("dateAdded", "")
            try:
                added = datetime.date.fromisoformat(raw_date)
            except ValueError:
                continue
            if added < cutoff:
                continue
            cve = v.get("cveID", "")
            name = v.get("vulnerabilityName", "")
            title = f"{cve} — {name}".strip(" —")
            summary = _strip_html(v.get("shortDescription") or "")[:_SUMMARY_MAX_CHARS]
            items.append({
                "title": title,
                "summary": summary,
                "date": added.strftime("%b %d, %Y"),
                "source": "CISA Known Exploited Vulnerabilities",
            })
            if len(items) >= _MAX_PER_SOURCE:
                break
        return items
    except Exception as exc:
        logger.warning("[security_news] CISA KEV fetch failed: %s", exc)
        return []


def fetch_digest() -> list[dict]:
    """Return today's cybersecurity news (last 24 h only), cached up to 30 min.

    Returns an empty list if no new stories were published today — callers
    must skip sending in that case.
    """
    today = datetime.date.today()
    now = time.time()

    # Cache hit: same calendar day and not stale
    if _CACHE["data"] is not None and _CACHE["date"] == today and now - _CACHE["ts"] < _CACHE_TTL:
        return _CACHE["data"]

    items: list[dict] = []
    for name, url in _FEEDS:
        items.extend(_fetch_rss(name, url))
    items.extend(_fetch_cisa())

    _CACHE["date"] = today
    _CACHE["ts"] = now
    _CACHE["data"] = items
    logger.info("[security_news] fetched %d new stories for %s", len(items), today)
    return items
