import datetime
import html
import json
import re
from urllib.parse import urljoin, urlparse

from app.database import SessionLocal
from app.models import CompanySettings

# Pages we probe for "about the company" content, in addition to the homepage.
_ABOUT_PATHS = ("", "/about", "/about-us", "/company", "/who-we-are", "/services")
# Per-page text cap and overall cap fed to the LLM, so a huge marketing site stays in budget.
_PER_PAGE_CHARS = 6000
_TOTAL_CHARS = 14000


def _html_to_text(raw: str) -> str:
    """Strip a page to readable text using only the stdlib (no bs4 dependency)."""
    if not raw:
        return ""
    raw = re.sub(r"(?is)<(script|style|noscript|svg|head|template)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<!--.*?-->", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|li|h[1-6]|section|article|tr)>", "\n", raw)
    text = re.sub(r"(?s)<[^>]+>", " ", raw)
    text = html.unescape(text)
    text = re.sub(r"[ \t\x0b\f\r]+", " ", text)
    text = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", text)
    return text.strip()


class CompanySettingsService:
    @staticmethod
    def get(key: str) -> str:
        db = SessionLocal()
        try:
            row = db.query(CompanySettings).filter(CompanySettings.key == key).first()
            return row.value if row else ""
        finally:
            db.close()

    @staticmethod
    def set(key: str, value: str, updated_by: str = "") -> None:
        db = SessionLocal()
        try:
            row = db.query(CompanySettings).filter(CompanySettings.key == key).first()
            if row:
                row.value = value
                row.updated_by = updated_by
                row.updated_at = datetime.datetime.utcnow()
            else:
                db.add(CompanySettings(key=key, value=value, updated_by=updated_by))
            db.commit()
        finally:
            db.close()

    @staticmethod
    def get_company_context() -> str:
        return CompanySettingsService.get("company_context")

    @staticmethod
    def fetch_site_text(url: str) -> tuple[str, list[str]]:
        """Fetch the homepage + a few about-style pages and return (combined_text, pages_used).

        Best-effort: failures on individual pages are skipped. Raises ValueError if nothing
        could be fetched at all.
        """
        import httpx

        parsed = urlparse(url if "://" in url else f"https://{url}")
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Enter a valid http(s) website URL.")
        base = f"{parsed.scheme}://{parsed.netloc}"

        chunks: list[str] = []
        used: list[str] = []
        total = 0
        headers = {"User-Agent": "Mozilla/5.0 (CentriqAI company-context puller)"}
        with httpx.Client(timeout=20, follow_redirects=True, headers=headers) as client:
            for path in _ABOUT_PATHS:
                if total >= _TOTAL_CHARS:
                    break
                page_url = urljoin(base + "/", path.lstrip("/")) if path else base
                try:
                    r = client.get(page_url)
                    if r.status_code != 200 or "text/html" not in r.headers.get("content-type", "text/html"):
                        continue
                    text = _html_to_text(r.text)
                except Exception:
                    continue
                if len(text) < 120:
                    continue
                snippet = text[:_PER_PAGE_CHARS]
                chunks.append(f"--- {page_url} ---\n{snippet}")
                used.append(page_url)
                total += len(snippet)

        if not chunks:
            raise ValueError("Couldn't read any readable content from that site.")
        return ("\n\n".join(chunks)[:_TOTAL_CHARS], used)

    @staticmethod
    def draft_context_from_web(url: str) -> dict:
        """Pull the company website and distill it into a factual Company Context draft.

        Returns {"value": <draft text>, "sources": [urls]}. Nothing is persisted — the
        super-admin reviews the draft in the editor and saves it through the normal PUT.
        """
        from app.services import llm_controls_service as llm_controls

        site_text, sources = CompanySettingsService.fetch_site_text(url)

        model = llm_controls.get_llm("agent", default_timeout=90, default_max_tokens=700)
        prompt = (
            "You are writing the COMPANY CONTEXT that is injected into every internal "
            "AI assistant's system prompt. Using ONLY the website content below, write a "
            "concise, factual company profile.\n\n"
            "Cover, when present in the source: what the company does, its headquarters and "
            "office locations, key products/services, industries it serves, and any notable "
            "facts (founding, scale, partnerships).\n\n"
            "RULES:\n"
            "- 4 to 10 short lines or bullet points (-). Plain text only — no markdown tables, "
            "no headings, no marketing fluff or superlatives.\n"
            "- State only facts present in the source. Do NOT invent figures, dates, or claims.\n"
            "- Output ONLY the profile text, ready to paste. No preamble.\n\n"
            f"WEBSITE CONTENT:\n{site_text}"
        )
        try:
            resp = model.invoke(prompt)
            value = (resp.content or "").strip()
            value = re.sub(r"^```[a-zA-Z]*\s*\n?", "", value)
            value = re.sub(r"\n?```$", "", value).strip()
        except Exception as exc:
            raise RuntimeError(f"The model couldn't summarize the site: {exc}")
        if len(value) < 40:
            raise RuntimeError("Couldn't produce a usable company profile from that site.")
        return {"value": value, "sources": sources}

    @staticmethod
    def get_cabin_info(location: str) -> str:
        """Return formatted cabin info for the given office location (city name)."""
        raw = CompanySettingsService.get("cabin_directory")
        if not raw:
            return "No cabin directory has been set up. Please contact your Super Admin."
        try:
            offices: list[dict] = json.loads(raw)
            loc_lower = location.lower().strip()
            # Exact match first, then partial
            match = next(
                (o for o in offices if o.get("name", "").lower() == loc_lower),
                None,
            )
            if not match:
                match = next(
                    (o for o in offices
                     if loc_lower in o.get("name", "").lower()
                     or o.get("name", "").lower() in loc_lower),
                    None,
                )
            if not match:
                names = ", ".join(o["name"] for o in offices if o.get("name"))
                return (
                    f"No cabin info found for '{location}'. "
                    f"Configured offices: {names or 'none'}."
                )
            lines = [f"**{match['name']} Office — Department Cabins**"]
            dept_labels = [("admin", "Admin"), ("hr", "HR"), ("it", "IT Support"), ("pmo", "PMO")]
            for key, label in dept_labels:
                val = (match.get(key) or "").strip()
                if val:
                    lines.append(f"- {label}: {val}")
            if len(lines) == 1:
                return f"Cabin info for {match['name']} is not filled in yet. Contact Admin."
            return "\n".join(lines)
        except Exception:
            return "Cabin directory data is unavailable. Please contact Super Admin."
