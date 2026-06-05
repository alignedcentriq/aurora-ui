"""
Template engine for SharePoint-driven document generation.

Pipeline:
  1. A plain PDF/DOCX template is synced from SharePoint and converted to HTML
     (``to_html``) — the document's exact wording is preserved.
  2. Once, at sync time, an LLM identifies the fill-in spots and we deterministically
     replace each with a ``{{field_name}}`` token (``tag_fields``). HR reviews the
     detected fields. Employee-known fields (name, id, dates…) are flagged ``auto``;
     the rest are ``user`` fields the generate form collects.
  3. At generation time we do a pure string merge (``merge_html``) — NO LLM — then
     render the filled HTML to a paginated PDF via headless Chromium (``render_pdf``),
     stamping an "envelope id" header on every page and adding the HR signature block
     only once the document is released.

Design rule: the LLM is used ONLY at step 2 (one-off, HR-reviewed). Generation is
deterministic so released wording always matches HR's approved template.
"""

import html as _html
import json
import logging
import re
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

# Placeholder names that the app fills automatically from the employee record / clock,
# so they never become a form field the user has to type. The LLM is told to prefer
# these canonical names when it tags employee/date/company values.
AUTO_FIELDS = {
    "employee_name", "name", "employee_id", "department", "designation",
    "email", "joining_date", "today_date", "date", "company_name",
}

_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


# ── 1. Source → HTML ──────────────────────────────────────────────────────────

def to_html(file_bytes: bytes, ext: str) -> str:
    """Convert a PDF/DOCX template to clean HTML, preserving its wording.

    Uses MarkItDown (already used for policy extraction) to get markdown, then renders
    markdown → HTML. Fail-soft: on any error returns a ``<pre>``-wrapped plain-text
    rendering so the template is never silently lost."""
    md = ""
    try:
        import io
        from markitdown import MarkItDown
        result = MarkItDown().convert_stream(io.BytesIO(file_bytes), file_extension=f".{ext}")
        md = (result.text_content or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[template_engine] MarkItDown failed for .{ext}: {e}")

    if not md:
        return ""

    # markdown → HTML (prefer the `markdown` lib; fall back to a minimal converter).
    try:
        import markdown as _md
        return _md.markdown(md, extensions=["tables", "sane_lists", "nl2br"])
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[template_engine] markdown lib unavailable ({e}); using minimal converter")
        return _minimal_md_to_html(md)


def _minimal_md_to_html(md: str) -> str:
    """Bare-bones markdown → HTML: headings, paragraphs, line breaks. Used only when the
    `markdown` package isn't installed."""
    blocks = re.split(r"\n[ \t]*\n", md.strip())
    out = []
    for block in blocks:
        lines = [ln.rstrip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        first = lines[0].lstrip()
        m = re.match(r"^(#{1,6})\s+(.*)$", first)
        if m and len(lines) == 1:
            level = len(m.group(1))
            out.append(f"<h{level}>{_html.escape(m.group(2).strip())}</h{level}>")
        else:
            joined = "<br>".join(_html.escape(ln) for ln in lines)
            out.append(f"<p>{joined}</p>")
    return "\n".join(out)


# ── 2. LLM field tagging (setup-time only) ────────────────────────────────────

_TAG_SYSTEM = (
    "You are configuring a document template. You are given the HTML of an official "
    "letter/certificate. Identify every spot that should be FILLED IN per recipient — "
    "person names, employee IDs, departments, designations, dates, addresses, purpose/"
    "reason text, and explicit blanks (e.g. '____', '[Name]', '<date>'). Do NOT tag "
    "static boilerplate, company name in the letterhead, or fixed legal wording.\n\n"
    "Return STRICT JSON: {\"fields\": [{\"text\": <exact substring copied verbatim from "
    "the document that should be replaced>, \"name\": <snake_case field name>, "
    "\"label\": <human label>, \"type\": one of 'text'|'textarea'|'date'|'select', "
    "\"required\": true|false, \"source\": 'auto'|'user'}]}.\n\n"
    "Rules:\n"
    "- For values that come from the employee record or the clock, use EXACTLY these "
    "canonical names and set source='auto': employee_name, employee_id, department, "
    "designation, email, joining_date, today_date, company_name.\n"
    "- Everything else (purpose, recipient, custom dates/amounts the user must type) "
    "is source='user'.\n"
    "- 'text' must be an exact, unique substring from the document so it can be located.\n"
    "- Use type='date' for date fields, 'textarea' for long free text (purpose/reason), "
    "else 'text'.\n"
    "- Return ONLY the JSON object, no prose."
)


def tag_fields(html_doc: str) -> tuple[str, list[dict]]:
    """Ask the LLM to locate fill-in spots, then deterministically replace each located
    substring with a ``{{name}}`` token. Returns ``(tagged_html, fields)``.

    The LLM never rewrites the document — it only reports substrings; the replacement is
    done in Python so wording stays verbatim. Fail-soft: on any error returns the original
    HTML and an empty field list (HR can then mark fields manually)."""
    if not html_doc or not html_doc.strip():
        return html_doc, []

    try:
        from openai import OpenAI
        client = OpenAI(base_url=settings.AGENT_BASE_URL, api_key=settings.AGENT_API_KEY)
        resp = client.chat.completions.create(
            model=settings.AGENT_MODEL_NAME,
            messages=[
                {"role": "system", "content": _TAG_SYSTEM},
                {"role": "user", "content": html_doc[:24000]},
            ],
            temperature=0,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        candidates = data.get("fields") or []
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[template_engine] field tagging failed: {e}")
        return html_doc, []

    tagged = html_doc
    fields: list[dict] = []
    seen_names: set[str] = set()

    for c in candidates:
        if not isinstance(c, dict):
            continue
        snippet = (c.get("text") or "").strip()
        name = _normalize_name(c.get("name") or "")
        if not name:
            continue
        source = "auto" if (c.get("source") == "auto" or name in AUTO_FIELDS) else "user"
        ftype = c.get("type") if c.get("type") in ("text", "textarea", "date", "select") else "text"
        field = {
            "name": name,
            "label": (c.get("label") or _humanize(name)).strip(),
            "type": ftype,
            "required": bool(c.get("required", source == "user")),
            "source": source,
        }
        if isinstance(c.get("options"), list) and c["options"]:
            field["options"] = [str(o) for o in c["options"]]

        # Deterministically swap the located substring for the token (preserve wording).
        replaced = _replace_snippet(tagged, snippet, "{{" + name + "}}") if snippet else tagged
        tagged = replaced

        if name not in seen_names:
            seen_names.add(name)
            fields.append(field)

    # Keep only fields whose token actually made it into the HTML (or auto fields, which
    # may legitimately not need a visible token if the doc had none).
    present = set(_TOKEN_RE.findall(tagged))
    fields = [f for f in fields if f["name"] in present]
    return tagged, fields


def _replace_snippet(text: str, snippet: str, token: str) -> str:
    """Replace a located substring with a token. Tries an exact match first, then a
    whitespace-tolerant match. Replaces ALL occurrences so repeated values stay in sync."""
    if not snippet or snippet in token:
        return text
    if snippet in text:
        return text.replace(snippet, token)
    # Whitespace-tolerant fallback.
    pattern = re.compile(re.escape(snippet).replace(r"\ ", r"\s+"))
    return pattern.sub(token, text, count=0)


# ── 3. Merge + classify ───────────────────────────────────────────────────────

def merge_html(html_template: str, values: dict) -> str:
    """Substitute ``{{field}}`` tokens with HTML-escaped values. Unfilled tokens render
    as an empty string."""
    def _sub(m: re.Match) -> str:
        key = m.group(1)
        val = values.get(key)
        return _html.escape(str(val)) if val not in (None, "") else ""
    return _TOKEN_RE.sub(_sub, html_template or "")


def classify_fields(fields: Optional[list]) -> tuple[list, list]:
    """Split a fields list into (user_fields, auto_fields)."""
    fields = fields or []
    user = [f for f in fields if f.get("source") != "auto"]
    auto = [f for f in fields if f.get("source") == "auto"]
    return user, auto


def resolve_auto_fields(employee: dict, today_label: str) -> dict:
    """Build the auto-fill value map from the resolved employee record + clock."""
    name = employee.get("name") or ""
    return {
        "employee_name": name,
        "name": name,
        "employee_id": employee.get("employee_id") or "",
        "department": employee.get("department") or "",
        "designation": employee.get("designation") or "",
        "email": employee.get("email") or "",
        "joining_date": employee.get("joining_date") or "",
        "today_date": today_label,
        "date": today_label,
        "company_name": settings.DOC_COMPANY_NAME,
    }


# ── 4. HTML → PDF (headless Chromium) ─────────────────────────────────────────

_PAGE_CSS = """
  @page { size: A4; }
  body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: #1E293B; font-size: 11pt; line-height: 1.6; }
  h1,h2,h3 { color: #0A2540; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #E2E8F0; padding: 6px 8px; }
  .aa-doc { padding: 8px 4px; }
  .aa-signature { margin-top: 64px; }
  .aa-sig-line { width: 38%; border-bottom: 1px solid #1E293B; height: 0; margin-bottom: 6px; }
  .aa-sig-name { font-weight: 700; color: #0A2540; }
  .aa-sig-dept { color: #64748B; font-size: 10pt; }
"""

_SIGNATURE_HTML = """
  <div class="aa-signature">
    <div class="aa-sig-line"></div>
    <div class="aa-sig-name">Authorised Signatory</div>
    <div class="aa-sig-dept">Human Resources Department</div>
    <div class="aa-sig-dept">{company}</div>
  </div>
"""


def _header_template(envelope_id: str) -> str:
    safe = _html.escape(envelope_id or "")
    return (
        '<div style="font-size:8px;width:100%;padding:0 1.4cm;color:#64748B;'
        'display:flex;justify-content:space-between;">'
        f'<span>Document ID: {safe}</span>'
        '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>'
        '</div>'
    )


def signature_html() -> str:
    """The HR signature block as standalone HTML (for on-screen preview parity)."""
    return _SIGNATURE_HTML.format(company=_html.escape(settings.DOC_COMPANY_NAME))


def render_pdf(merged_html: str, envelope_id: str, include_signature: bool) -> bytes:
    """Render filled HTML to a paginated PDF with an envelope-id header on every page.
    The HR signature block is appended only when ``include_signature`` (released docs).

    Uses Playwright's sync API (safe inside FastAPI's sync threadpool routes). Tries the
    bundled Chromium first, then the system Edge channel as a fallback."""
    from playwright.sync_api import sync_playwright

    body = merged_html or ""
    if include_signature:
        body += _SIGNATURE_HTML.format(company=_html.escape(settings.DOC_COMPANY_NAME))

    full_html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{_PAGE_CSS}</style></head>"
        f"<body><div class='aa-doc'>{body}</div></body></html>"
    )

    pdf_opts = dict(
        format="A4",
        print_background=True,
        display_header_footer=True,
        header_template=_header_template(envelope_id),
        footer_template="<div></div>",
        margin={"top": "1.6cm", "bottom": "1.4cm", "left": "1.6cm", "right": "1.6cm"},
    )

    with sync_playwright() as p:
        browser = None
        try:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[template_engine] chromium launch failed ({e}); trying msedge")
                browser = p.chromium.launch(headless=True, channel="msedge")
            page = browser.new_page()
            page.set_content(full_html, wait_until="networkidle")
            return page.pdf(**pdf_opts)
        finally:
            if browser:
                browser.close()


# ── helpers ───────────────────────────────────────────────────────────────────

def _normalize_name(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", (name or "").strip().lower()).strip("_")
    return s


def _humanize(name: str) -> str:
    return (name or "").replace("_", " ").strip().title()
