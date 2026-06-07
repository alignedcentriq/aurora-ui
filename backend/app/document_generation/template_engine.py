"""
Template engine for SharePoint-driven document generation (DOCX mail-merge).

Pipeline:
  1. HR authors each letter/certificate in Microsoft Word with explicit
     ``{{ placeholder }}`` fields (docxtpl / Jinja2 syntax) and drops the ``.docx`` into
     the SharePoint templates folder. The Word layout — letterhead, logo, tables, fonts —
     is the design; we never touch it.
  2. At sync time we store the raw .docx bytes and auto-discover the placeholder names via
     ``discover_fields`` (docxtpl's ``get_undeclared_template_variables``). NO LLM. Employee-
     known names (name, id, dates…) are flagged ``auto``; the rest are ``user`` form fields.
  3. At generation time ``render_docx`` fills the .docx with docxtpl (auto fields from the
     employee record + clock, user fields from the form, plus system vars like the envelope
     id and the ``released`` flag). The filled .docx is the immutable issued artifact.
  4. ``docx_to_pdf`` converts the filled .docx to PDF via Microsoft Word (COM), preserving
     HR's exact layout. ``docx_to_html`` (mammoth) produces an on-screen preview.

Available template variables HR can use in Word:
  Auto (filled from the employee record / clock):
    {{ employee_name }} {{ employee_id }} {{ department }} {{ designation }}
    {{ email }} {{ joining_date }} {{ today_date }} {{ company_name }}
  System (filled by the app):
    {{ envelope_id }}  – the verification id (put it in the Word header for a per-page stamp)
    {{ verify_url }}   – public verification URL
    {{ released }}     – bool; gate the signature block with {% if released %}…{% endif %}
  Anything else (e.g. {{ purpose }}) becomes a form field collected at generation time.
"""

import io
import logging
import os
import tempfile
import threading
import time

from app.config import settings

logger = logging.getLogger(__name__)

# Placeholder names the app fills automatically from the employee record / clock — they
# never become a form field the user has to type.
AUTO_FIELDS = {
    "employee_name", "name", "employee_id", "department", "designation",
    "email", "joining_date", "today_date", "date", "company_name",
}

# Control variables the app always supplies; never shown as fields in the admin/user form.
SYSTEM_FIELDS = {"envelope_id", "verify_url", "released", "status"}

# Word COM is single-threaded-apartment and not safe to call concurrently — serialize all
# conversions through one lock (document generation is low-volume HR letters).
_WORD_LOCK = threading.Lock()


# ── 1. Field discovery (sync-time, no LLM) ────────────────────────────────────

def discover_fields(docx_bytes: bytes) -> list[dict]:
    """Inspect a .docx template and return the list of fill-in fields HR authored.

    Uses docxtpl's undeclared-variable detection (Jinja2 ``{{ }}`` parsing). System control
    variables are excluded; auto/user is decided by name. Fail-soft: returns [] on error."""
    if not docx_bytes:
        return []
    try:
        from docxtpl import DocxTemplate
        tpl = DocxTemplate(io.BytesIO(docx_bytes))
        names = tpl.get_undeclared_template_variables()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[template_engine] discover_fields failed: {e}")
        return []

    fields: list[dict] = []
    for name in sorted(n for n in names if n and n not in SYSTEM_FIELDS):
        source = "auto" if name in AUTO_FIELDS else "user"
        fields.append({
            "name": name,
            "label": _humanize(name),
            "type": _guess_type(name),
            "required": source == "user",
            "source": source,
        })
    return fields


def prepare_template(docx_bytes: bytes) -> tuple[bytes, list[dict]]:
    """Make a SharePoint .docx ready for generation, returning ``(template_bytes, fields)``.

    Two paths, fully automatic for non-technical HR:
      • If HR already wrote ``{{ placeholders }}`` in Word → just discover them (no LLM).
      • Otherwise (an ordinary letter with example data) → ``auto_tag_docx`` uses an LLM to
        find the fill-in values and rewrites them as placeholders IN PLACE, preserving every
        bit of Word formatting. HR does nothing technical — they drop their normal letter."""
    existing = discover_fields(docx_bytes)
    if existing:
        return docx_bytes, existing
    return auto_tag_docx(docx_bytes)


def auto_tag_docx(docx_bytes: bytes) -> tuple[bytes, list[dict]]:
    """LLM-detect the fill-in values in an ordinary Word letter and replace each with a
    ``{{ field }}`` placeholder, editing the runs in place so all formatting is kept.

    The LLM only REPORTS which text spans are fill-in values + their field names; the actual
    replacement is done deterministically in Python (so wording/format stays verbatim). Returns
    ``(tagged_docx_bytes, fields)``. Fail-soft: on any error returns the input unchanged + []."""
    if not docx_bytes:
        return docx_bytes, []
    try:
        from docx import Document
        document = Document(io.BytesIO(docx_bytes))
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[template_engine] auto_tag_docx open failed: {e}")
        return docx_bytes, []

    full_text = "\n".join(p.text for p in _iter_paragraphs(document) if p.text.strip())
    if not full_text.strip():
        return docx_bytes, []

    candidates = _llm_detect_fields(full_text)
    if not candidates:
        return docx_bytes, []

    # Longest literal first so a short span (e.g. "AA") never clobbers a longer one
    # ("AA-2231") that contains it.
    candidates = sorted(candidates, key=lambda c: len((c.get("text") or "")), reverse=True)

    fields: list[dict] = []
    seen: set[str] = set()
    for c in candidates:
        if not isinstance(c, dict):
            continue
        literal = (c.get("text") or "").strip()
        name = _normalize_name(c.get("name") or "")
        if not name or len(literal) < 2:
            continue
        token = "{{ " + name + " }}"
        for p in _iter_paragraphs(document):
            _replace_in_paragraph(p, literal, token)
        if name not in seen:
            seen.add(name)
            source = "auto" if (c.get("source") == "auto" or name in AUTO_FIELDS) else "user"
            ftype = c.get("type") if c.get("type") in ("text", "textarea", "date", "select") else _guess_type(name)
            field = {
                "name": name,
                "label": (c.get("label") or _humanize(name)).strip(),
                "type": ftype,
                "required": bool(c.get("required", source == "user")),
                "source": source,
            }
            if isinstance(c.get("options"), list) and c["options"]:
                field["options"] = [str(o) for o in c["options"]]
            fields.append(field)

    out = io.BytesIO()
    document.save(out)
    tagged = out.getvalue()

    # Keep only fields whose token actually landed in the document.
    present = set(discover_fields_names(tagged))
    fields = [f for f in fields if f["name"] in present]
    return tagged, fields


def discover_fields_names(docx_bytes: bytes) -> list[str]:
    """The raw set of ``{{ }}`` variable names present in a .docx (incl. system vars)."""
    try:
        from docxtpl import DocxTemplate
        return list(DocxTemplate(io.BytesIO(docx_bytes)).get_undeclared_template_variables())
    except Exception:  # noqa: BLE001
        return []


_DETECT_SYSTEM = (
    "You are configuring a reusable document template from an example letter/certificate. "
    "You are given the plain text of one filled-in sample. Identify every span that is a "
    "PER-RECIPIENT fill-in value — the person's name, employee id, department, designation, "
    "dates, addresses, purpose/reason text, reference numbers, amounts, durations — and map "
    "each to a field. Do NOT tag fixed boilerplate, legal wording, or section headings.\n\n"
    "Return STRICT JSON: {\"fields\": [{\"text\": <exact substring copied verbatim from the "
    "document>, \"name\": <snake_case field name>, \"label\": <human label>, \"type\": "
    "'text'|'textarea'|'date'|'select', \"required\": true|false, \"source\": 'auto'|'user'}]}\n\n"
    "Rules:\n"
    "- For values that come from the employee record or the clock use EXACTLY these canonical "
    "names with source='auto': employee_name, employee_id, department, designation, email, "
    "joining_date, today_date, company_name.\n"
    "- The person the document is ABOUT is ALWAYS employee_name. Use employee_name for EVERY "
    "mention of that same person (do not invent recipient_name/applicant_name for the subject). "
    "Use the SAME field name for every occurrence of the same underlying value.\n"
    "- Everything the user must type (purpose, custom amounts/dates, durations) is source='user'.\n"
    "- 'text' MUST be an exact, distinctive substring from the document (prefer the longest/"
    "most complete form, e.g. the full company name, not an abbreviation) so it can be located.\n"
    "- Use type='date' for dates, 'textarea' for long free text, else 'text'.\n"
    "- Return ONLY the JSON object."
)


def _llm_detect_fields(full_text: str) -> list[dict]:
    """Ask the configured LLM which text spans are fill-in values.

    Uses the SERVICE tier (a plain instruction model, e.g. llama3.1:8b) — NOT the agent tier:
    the agent model (gpt-oss) is a reasoning model that burns its token budget thinking and
    returns empty content for this extraction. Retries + defensive JSON parsing handle load
    flakiness. Returns the first non-empty field list, else []."""
    from openai import OpenAI
    client = OpenAI(base_url=settings.AGENT_BASE_URL, api_key=settings.AGENT_API_KEY)
    model = getattr(settings, "SERVICE_MODEL_NAME", None) or settings.AGENT_MODEL_NAME
    messages = [
        {"role": "system", "content": _DETECT_SYSTEM},
        {"role": "user", "content": full_text[:24000]},
    ]
    for attempt in range(3):
        use_json_mode = attempt == 0  # if the model dislikes json mode, drop it on retry
        try:
            kwargs = dict(model=model, messages=messages,
                          temperature=0, max_tokens=2000)
            if use_json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            resp = client.chat.completions.create(**kwargs)
            raw = resp.choices[0].message.content or ""
            fields = _parse_fields_json(raw)
            if fields:
                return fields
            logger.warning(f"[template_engine] field detection empty (attempt {attempt + 1})")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[template_engine] field detection error (attempt {attempt + 1}): {e}")
    return []


def _parse_fields_json(raw: str) -> list[dict]:
    """Extract the fields list from a model response — strict JSON first, then the first
    ``{...}`` block found in free text. Accepts either a wrapper object or a bare list."""
    import json
    raw = (raw or "").strip()
    if not raw:
        return []
    for candidate in (raw, _first_brace_block(raw)):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(data, list):
            return [f for f in data if isinstance(f, dict)]
        if isinstance(data, dict):
            out = data.get("fields") or data.get("data") or []
            if isinstance(out, list):
                return [f for f in out if isinstance(f, dict)]
    return []


def _first_brace_block(text: str) -> str:
    """Return the substring from the first '{' to its matching '}' (handles models that wrap
    JSON in prose or markdown fences)."""
    start = text.find("{")
    if start < 0:
        return ""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return ""


def _iter_paragraphs(container):
    """Yield every paragraph in a docx container — body, table cells (recursively), and
    each section's header/footer — so placeholders are inserted everywhere they occur."""
    from docx.document import Document as _Doc
    from docx.table import _Cell

    def _walk(obj):
        for p in getattr(obj, "paragraphs", []):
            yield p
        for tbl in getattr(obj, "tables", []):
            for row in tbl.rows:
                for cell in row.cells:
                    yield from _walk(cell)

    yield from _walk(container)
    if isinstance(container, _Doc):
        for section in container.sections:
            for hf in (section.header, section.first_page_header, section.even_page_header,
                       section.footer, section.first_page_footer, section.even_page_footer):
                if hf is not None:
                    yield from _walk(hf)


def _replace_in_paragraph(paragraph, literal: str, token: str) -> None:
    """Replace every occurrence of ``literal`` with ``token`` within a paragraph, even when the
    literal spans multiple runs. The token inherits the first matched run's formatting; other
    matched runs are cleared. Other runs (and their formatting) are untouched."""
    if not literal or literal == token:
        return
    guard = 0
    while guard < 200:
        guard += 1
        runs = paragraph.runs
        if not runs:
            return
        full = "".join(r.text for r in runs)
        idx = full.find(literal)
        if idx < 0:
            return
        end = idx + len(literal)
        spans, pos = [], 0
        for i, r in enumerate(runs):
            spans.append((i, pos, pos + len(r.text)))
            pos += len(r.text)
        affected = [(i, s, e) for (i, s, e) in spans if e > idx and s < end]
        if not affected:
            return
        fi, fs, _ = affected[0]
        li, ls, _ = affected[-1]
        prefix = runs[fi].text[: idx - fs]
        suffix = runs[li].text[end - ls:]
        if fi == li:
            runs[fi].text = prefix + token + suffix
        else:
            runs[fi].text = prefix + token
            for (i, _s, _e) in affected[1:-1]:
                runs[i].text = ""
            runs[li].text = suffix


def _normalize_name(name: str) -> str:
    import re
    return re.sub(r"[^a-zA-Z0-9]+", "_", (name or "").strip().lower()).strip("_")


def _guess_type(name: str) -> str:
    n = name.lower()
    if "date" in n:
        return "date"
    if any(k in n for k in ("purpose", "reason", "address", "description", "details", "remarks", "overview", "objectives")):
        return "textarea"
    return "text"


# ── 2. Render (generation-time) ───────────────────────────────────────────────

def render_docx(docx_bytes: bytes, context: dict) -> bytes:
    """Fill a .docx template with ``context`` via docxtpl and return the filled .docx bytes.

    Missing variables render as empty (Jinja2 ``Undefined`` → '') so a template never errors
    on an unfilled optional field."""
    from docxtpl import DocxTemplate
    from jinja2 import Environment

    tpl = DocxTemplate(io.BytesIO(docx_bytes))
    # Undefined → '' so optional placeholders left blank don't blow up rendering.
    env = Environment()
    env.undefined = type("_Blank", (env.undefined,), {"__str__": lambda self: "", "__html__": lambda self: ""})
    tpl.render(context, jinja_env=env)
    out = io.BytesIO()
    tpl.save(out)
    return out.getvalue()


# ── 3. Preview (DOCX → HTML via mammoth) ──────────────────────────────────────

def docx_to_html(docx_bytes: bytes) -> str:
    """Convert a (filled) .docx to HTML for on-screen preview + the public /verify page.

    Mammoth produces clean semantic HTML (headings, bold, tables, lists, inline images).
    It is NOT pixel-identical to the Word→PDF download — it's a faithful readable preview."""
    if not docx_bytes:
        return ""
    try:
        import mammoth
        result = mammoth.convert_to_html(io.BytesIO(docx_bytes))
        return result.value or ""
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[template_engine] docx_to_html failed: {e}")
        return ""


# ── 4. Render (DOCX → PDF via Microsoft Word) ─────────────────────────────────

_WD_EXPORT_FORMAT_PDF = 17  # wdExportFormatPDF


def docx_to_pdf(docx_bytes: bytes) -> bytes:
    """Convert a filled .docx to PDF using Microsoft Word (preserves HR's exact layout).

    Drives Word COM directly with a FRESH dedicated instance (DispatchEx) per call, alerts
    off, so a previously-crashed Word can't wedge conversions. Serialized via a module lock
    and CoInitialize'd per worker thread (FastAPI runs sync routes in a threadpool). On a COM
    error it kills any stray WINWORD and retries once. Raises on final failure → clean 500."""
    if not docx_bytes:
        raise ValueError("empty document")

    workdir = tempfile.mkdtemp(prefix="aa_doc_")
    in_path = os.path.join(workdir, "doc.docx")
    out_path = os.path.join(workdir, "doc.pdf")
    with open(in_path, "wb") as f:
        f.write(docx_bytes)

    try:
        with _WORD_LOCK:
            try:
                _word_export_pdf(in_path, out_path)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[template_engine] Word convert failed ({e}); clearing Word and retrying")
                _kill_stray_word()
                time.sleep(2)  # let the OS release the killed process + any file locks
                _word_export_pdf(in_path, out_path)
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        for p in (in_path, out_path):
            try:
                os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(workdir)
        except OSError:
            pass


def _word_export_pdf(in_path: str, out_path: str) -> None:
    import pythoncom
    import win32com.client as win32

    pythoncom.CoInitialize()
    word = None
    doc = None
    try:
        word = win32.DispatchEx("Word.Application")  # dedicated, isolated instance
        word.Visible = False
        word.DisplayAlerts = 0
        doc = word.Documents.Open(in_path, ReadOnly=True, AddToRecentFiles=False)
        doc.ExportAsFixedFormat(out_path, _WD_EXPORT_FORMAT_PDF)
    finally:
        try:
            if doc is not None:
                doc.Close(False)
        except Exception:  # noqa: BLE001
            pass
        try:
            if word is not None:
                word.Quit()
        except Exception:  # noqa: BLE001
            pass
        pythoncom.CoUninitialize()


def _kill_stray_word() -> None:
    import subprocess
    try:
        subprocess.run(["taskkill", "/F", "/IM", "WINWORD.EXE", "/T"],
                       capture_output=True, timeout=15)
    except Exception:  # noqa: BLE001
        pass


# ── Context helpers ───────────────────────────────────────────────────────────

def classify_fields(fields):
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


# ── helpers ───────────────────────────────────────────────────────────────────

def _humanize(name: str) -> str:
    import re
    return re.sub(r"[_\-]+", " ", (name or "")).strip().title()
