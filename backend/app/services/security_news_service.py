"""
Cybersecurity news digest service.

Fetches headlines from public RSS feeds and the CISA Known Exploited
Vulnerabilities catalogue. All URLs are stripped before returning — only
title, plain-text summary, publish date, and source name are surfaced.

Results are cached in-process for 30 minutes so the scheduler doesn't
hammer external sources on every check.
"""

import html
import logging
import re
import time
import xml.etree.ElementTree as ET

import httpx

logger = logging.getLogger("aurora-logger")

_CACHE: dict = {"ts": 0.0, "data": None}
_CACHE_TTL = 1800  # 30 minutes

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


def _strip_html(text: str) -> str:
    """Remove HTML tags, decode entities, collapse whitespace."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _fetch_rss(source_name: str, url: str) -> list[dict]:
    try:
        resp = httpx.get(url, timeout=12, follow_redirects=True, headers=_HEADERS)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        items = []
        for item in root.findall(".//item")[:_MAX_PER_SOURCE]:
            title = _strip_html(item.findtext("title") or "")
            summary = _strip_html(item.findtext("description") or "")[:_SUMMARY_MAX_CHARS]
            pub = _strip_html(item.findtext("pubDate") or "")
            if title:
                items.append({
                    "title": title,
                    "summary": summary,
                    "date": pub,
                    "source": source_name,
                })
        return items
    except Exception as exc:
        logger.warning("[security_news] RSS fetch failed (%s): %s", source_name, exc)
        return []


def _fetch_cisa() -> list[dict]:
    """Pull the latest entries from the CISA Known Exploited Vulnerabilities catalogue."""
    try:
        resp = httpx.get(_CISA_KEV_URL, timeout=12, follow_redirects=True, headers=_HEADERS)
        resp.raise_for_status()
        data = resp.json()
        vulns = list(reversed((data.get("vulnerabilities") or [])[-_MAX_PER_SOURCE:]))
        items = []
        for v in vulns:
            cve = v.get("cveID", "")
            name = v.get("vulnerabilityName", "")
            title = f"{cve} — {name}".strip(" —")
            summary = _strip_html(v.get("shortDescription") or "")[:_SUMMARY_MAX_CHARS]
            date = v.get("dateAdded", "")
            items.append({
                "title": title,
                "summary": summary,
                "date": date,
                "source": "CISA Known Exploited Vulnerabilities",
            })
        return items
    except Exception as exc:
        logger.warning("[security_news] CISA KEV fetch failed: %s", exc)
        return []


def fetch_digest() -> list[dict]:
    """Return cybersecurity news items cached for up to 30 minutes.

    Each item has: title, summary (plain text, no URLs), date, source.
    """
    now = time.time()
    if _CACHE["data"] is not None and now - _CACHE["ts"] < _CACHE_TTL:
        return _CACHE["data"]

    items: list[dict] = []
    for name, url in _FEEDS:
        items.extend(_fetch_rss(name, url))
    items.extend(_fetch_cisa())

    _CACHE["ts"] = now
    _CACHE["data"] = items
    logger.info("[security_news] fetched %d items from %d sources", len(items), len(_FEEDS) + 1)
    return items
