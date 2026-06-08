"""
Cybersecurity news digest service.

Fetches headlines from public RSS feeds and the CISA Known Exploited
Vulnerabilities catalogue. Only stories published within the last 24 hours
are returned — old news is discarded. All URLs are stripped before returning.

Cache is date-keyed: rolls over at midnight so stale items never bleed into
the next day's digest.

Config (recipients, enabled sources, hour) is stored in CompanySettings under
key "security_news" so IT can manage it from the UI without touching env vars.
Env vars (SECURITY_NEWS_RECIPIENTS / SECURITY_NEWS_HOUR) are used as defaults
when no DB config exists.
"""

import datetime
import email.utils
import html
import json
import logging
import re
import time
import xml.etree.ElementTree as ET

import httpx

from app.config import settings

logger = logging.getLogger("aurora-logger")

# ── CompanySettings key ───────────────────────────────────────────────────────
_SN_KEY = "security_news"

# Cache is keyed to the calendar date so it automatically invalidates at midnight.
_CACHE: dict = {"date": None, "ts": 0.0, "data": None}
_CACHE_TTL = 1800  # 30 minutes — re-fetch within the day if stale

# ── Source catalogue ──────────────────────────────────────────────────────────
# Each entry: key (stable identifier), name (display), url, category
_ALL_FEEDS = [
    {"key": "the_hacker_news",   "name": "The Hacker News",        "url": "https://feeds.feedburner.com/TheHackersNews",                          "category": "General News"},
    {"key": "bleeping_computer", "name": "Bleeping Computer",       "url": "https://www.bleepingcomputer.com/feed/",                               "category": "General News"},
    {"key": "krebs_on_security", "name": "Krebs on Security",       "url": "https://krebsonsecurity.com/feed/",                                    "category": "Threat Intelligence"},
    {"key": "dark_reading",      "name": "Dark Reading",            "url": "https://www.darkreading.com/rss.xml",                                  "category": "Enterprise Security"},
    {"key": "securityweek",      "name": "SecurityWeek",            "url": "https://feeds.feedblitz.com/SecurityWeek",                             "category": "General News"},
    {"key": "sophos_news",       "name": "Sophos Threat Research",  "url": "https://news.sophos.com/en-us/category/threat-research/feed/",         "category": "Malware & Threats"},
    {"key": "security_affairs",  "name": "Security Affairs",        "url": "https://securityaffairs.com/feed",                                     "category": "General News"},
    {"key": "infosecurity_mag",  "name": "Infosecurity Magazine",   "url": "https://www.infosecurity-magazine.com/rss/news/",                      "category": "Enterprise Security"},
    {"key": "unit42",            "name": "Palo Alto Unit 42",       "url": "https://unit42.paloaltonetworks.com/feed/",                            "category": "Threat Intelligence"},
]

_CISA_KEY = "cisa_kev"
_CISA_NAME = "CISA Known Exploited Vulnerabilities"
_CISA_CATEGORY = "Vulnerabilities"
_CISA_KEV_URL = (
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
)

_MAX_PER_SOURCE = 5
_SUMMARY_MAX_CHARS = 380
_HEADERS = {"User-Agent": "CentriqAI/1.0 (internal digest; no scraping)"}
_MAX_AGE_HOURS = 24


# ── Config management ─────────────────────────────────────────────────────────

def _default_config() -> dict:
    recipients_env = [r.strip() for r in settings.SECURITY_NEWS_RECIPIENTS.split(",") if r.strip()]
    return {
        "enabled": settings.SECURITY_NEWS_ENABLED,
        "hour": settings.SECURITY_NEWS_HOUR,
        "recipients": recipients_env,
        "sources": {f["key"]: True for f in _ALL_FEEDS} | {_CISA_KEY: True},
    }


def get_config() -> dict:
    """Return live config from CompanySettings, falling back to env defaults."""
    try:
        from app.services.company_settings_service import CompanySettingsService
        raw = CompanySettingsService.get(_SN_KEY)
        if raw and raw.strip():
            stored = json.loads(raw)
            if isinstance(stored, dict):
                cfg = _default_config()
                cfg.update(stored)
                # Forward-compat: new sources default to enabled
                for feed in _ALL_FEEDS:
                    cfg["sources"].setdefault(feed["key"], True)
                cfg["sources"].setdefault(_CISA_KEY, True)
                return cfg
    except Exception:
        pass
    return _default_config()


def update_config(patch: dict, updated_by: str = "") -> dict:
    """Merge patch into current config and persist."""
    from app.services.company_settings_service import CompanySettingsService
    current = get_config()
    allowed = {"enabled", "hour", "recipients", "sources"}
    for k, v in patch.items():
        if k in allowed:
            current[k] = v
    current["hour"] = max(0, min(23, int(current.get("hour", 9))))
    current["recipients"] = [r.strip() for r in (current.get("recipients") or []) if r.strip()]
    CompanySettingsService.set(_SN_KEY, json.dumps(current), updated_by=updated_by)
    return current


def get_sources_metadata() -> list[dict]:
    """Return all available sources with their keys, names, categories, and enabled state."""
    cfg = get_config()
    sources_enabled = cfg.get("sources", {})
    result = [
        {**f, "enabled": bool(sources_enabled.get(f["key"], True))}
        for f in _ALL_FEEDS
    ]
    result.append({
        "key": _CISA_KEY,
        "name": _CISA_NAME,
        "category": _CISA_CATEGORY,
        "enabled": bool(sources_enabled.get(_CISA_KEY, True)),
    })
    return result


# ── Parsing helpers ───────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_rss_date(date_str: str) -> datetime.datetime | None:
    try:
        return email.utils.parsedate_to_datetime(date_str.strip())
    except Exception:
        return None


def _is_recent(pub_dt: datetime.datetime | None) -> bool:
    if pub_dt is None:
        return False
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        if pub_dt.tzinfo is None:
            pub_dt = pub_dt.replace(tzinfo=datetime.timezone.utc)
        age = now - pub_dt
        return age.total_seconds() <= _MAX_AGE_HOURS * 3600
    except Exception:
        return False


def _friendly_date(pub_dt: datetime.datetime | None, raw: str) -> str:
    if pub_dt is None:
        return raw
    try:
        local = pub_dt.astimezone()
        return local.strftime("%b %d, %Y %H:%M %Z")
    except Exception:
        return raw


# ── Fetchers ──────────────────────────────────────────────────────────────────

def _fetch_rss(source_name: str, url: str, category: str) -> list[dict]:
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
                "category": category,
            })
            if len(items) >= _MAX_PER_SOURCE:
                break
        return items
    except Exception as exc:
        logger.warning("[security_news] RSS fetch failed (%s): %s", source_name, exc)
        return []


def _fetch_cisa() -> list[dict]:
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
                "source": _CISA_NAME,
                "category": _CISA_CATEGORY,
            })
            if len(items) >= _MAX_PER_SOURCE:
                break
        return items
    except Exception as exc:
        logger.warning("[security_news] CISA KEV fetch failed: %s", exc)
        return []


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_digest(config: dict | None = None) -> list[dict]:
    """Return today's cybersecurity news (last 24 h only), cached up to 30 min.

    Pass a config dict to control which sources are fetched. If omitted, the
    live config from CompanySettings is used.
    Returns an empty list if no new stories were published today.
    """
    if config is None:
        config = get_config()

    today = datetime.date.today()
    now = time.time()

    sources_enabled = config.get("sources", {})

    # Cache hit: same calendar day, same source set, not stale
    cache_key = json.dumps(sources_enabled, sort_keys=True)
    if (
        _CACHE["data"] is not None
        and _CACHE["date"] == today
        and now - _CACHE["ts"] < _CACHE_TTL
        and _CACHE.get("sources_key") == cache_key
    ):
        return _CACHE["data"]

    items: list[dict] = []
    for feed in _ALL_FEEDS:
        if sources_enabled.get(feed["key"], True):
            items.extend(_fetch_rss(feed["name"], feed["url"], feed["category"]))
    if sources_enabled.get(_CISA_KEY, True):
        items.extend(_fetch_cisa())

    _CACHE["date"] = today
    _CACHE["ts"] = now
    _CACHE["data"] = items
    _CACHE["sources_key"] = cache_key
    logger.info("[security_news] fetched %d new stories for %s", len(items), today)
    return items
