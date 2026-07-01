"""
Policy Ingestion & Search Service for Centriq AI.

Pipeline:
  1. Ingest:  PDF/DOCX → extract text → store in Policy table
  2. Chunk:   Policy.content → fixed-size overlapping chunks → PolicyChunk rows
  3. Embed:   PolicyChunk.text → embedding vector (via configured model) → stored as JSON
  4. Search:  query → embedding → cosine similarity over PolicyChunk.embedding
              (falls back to keyword search on chunks if embedding model unavailable)

All policy data lives in the DB — no runtime dependency on the PDF folder.
"""

import os
import re
import time
import threading
import datetime
from difflib import get_close_matches
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models import Policy

# ── Embedding model health tracking ──────────────────────────────────────────
# Tracks the last time the embedding call failed. Cleared on next success.
# Used by main.py to emit a SSE warning event when the model is degraded.
_embedding_failed_at: float | None = None
_embedding_warmup_lock = threading.Lock()
_embedding_warmup_running = False


def is_embedding_unavailable() -> bool:
    """True if the embedding model has failed within the last 120 seconds."""
    return _embedding_failed_at is not None and (time.time() - _embedding_failed_at) < 120.0

# ── Constants ─────────────────────────────────────────────────────────────────
POLICY_DIR = Path(__file__).resolve().parent.parent.parent / "OneDrive_1_12-5-2026"
CHUNK_SIZE = settings.POLICY_CHUNK_SIZE
CHUNK_OVERLAP = settings.POLICY_CHUNK_OVERLAP

# Company project content (summaries, demo transcripts, details) is stored in the
# same Policy/PolicyChunk tables but tagged with this category, so it stays isolated
# from HR/IT/Admin policy answers: search_policies excludes it, search_projects
# includes only it. See sharepoint_project_sync.py.
PROJECT_CATEGORY = "Project Showcase"

# ── Category mapping from filename ───────────────────────────────────────────
CATEGORY_MAP = {
    "leave": "Leave & Attendance",
    "referral": "Recruitment",
    "posh": "Compliance",
    "certificate reimbursement": "Finance",
    "metro travel": "Finance",
    "variable pay": "Finance",
    "diversity": "Compliance",
    "gratuity": "Finance",
    "holiday": "Leave & Attendance",
    "maternity": "Leave & Attendance",
    "sabbatical": "Leave & Attendance",
    "relocation": "Admin",
    "accommodation": "Admin",
    "pf": "Finance",
    "uan": "Finance",
    "salary account": "Finance",
    "practo": "Benefits",
    "hr manual": "HR General",
    "dell": "IT",
    "tech direct": "IT",
    "zoho": "HR General",
    "goal creation": "Performance",
    "labor": "Compliance",
    "human rights": "Compliance",
    "nomination": "Finance",
}


def _categorize(filename: str) -> str:
    lower = filename.lower()
    for keyword, category in CATEGORY_MAP.items():
        if keyword in lower:
            return category
    return "General"


# ── Query synonym expansion ─────────────────────────────────────────────────
# Maps acronyms / shorthand commonly used by Indian enterprise employees to
# their full forms so that both BM25 and embedding search can match policy text.
_QUERY_SYNONYMS: dict[str, str] = {
    "aa": "aligned automation",
    "aaspl": "aligned automation services private limited",
    "posh": "prevention of sexual harassment",
    "pf": "provident fund EPF",
    "epf": "employee provident fund",
    "uan": "universal account number provident fund",
    "wfh": "work from home remote",
    "cl": "casual leave",
    "el": "earned leave privilege leave",
    "sl": "sick leave medical leave",
    "ml": "maternity leave",
    "pl": "paternity leave",
    "comp off": "compensatory off",
    "comp-off": "compensatory off",
    "compoff": "compensatory off",
    "lwd": "last working day resignation",
    "lta": "leave travel allowance",
    "hra": "house rent allowance",
    "ctc": "cost to company compensation",
    "nda": "non-disclosure agreement confidentiality",
    "bgv": "background verification",
    "f&f": "full and final settlement",
    "full and final": "full and final settlement separation",
    "gratuity": "gratuity payment act",
    "esic": "employee state insurance",
    "esi": "employee state insurance",
    "mediclaim": "medical insurance health policy",
    "reimbursement": "reimbursement expense claim",
    "vpn": "virtual private network remote access",
    "it ticket": "IT support helpdesk service request",
    "laptop": "laptop asset hardware",
    "onboarding": "onboarding joining induction",
    "offboarding": "offboarding separation exit",
    "probation": "probation confirmation period",
    "appraisal": "appraisal performance review increment",
    "variable pay": "variable pay bonus incentive",
    "referral": "employee referral recruitment bonus",
    "relocation": "relocation transfer allowance",
    "sabbatical": "sabbatical long leave career break",
}


# Returned by _hybrid_search when the semantic veto fires (embeddings healthy, zero
# in-scope chunks within the cosine floor). Both leading phrases are load-bearing for
# downstream emptiness checks; RETRIEVAL_VETO_SENTINEL is the substring domain agents
# use to recognise the veto in a ToolMessage and offer a re-route instead of a dead end.
RETRIEVAL_VETO_SENTINEL = "no results in the available documents"
RETRIEVAL_VETO_MESSAGE = (
    "No policies found — no results in the available documents are "
    "relevant to this question. Tell the user you couldn't find this "
    "in the policy documents and suggest who to contact; do NOT answer "
    "from unrelated documents or general knowledge."
)


# Common English words that must never be fuzzy-matched to an acronym.
# (e.g. "any"/"can"/"van" share two chars with "uan" → 0.67 similarity.)
_FUZZY_STOPWORDS: frozenset[str] = frozenset({
    "any", "can", "man", "van", "ban", "ran", "tan", "fan", "pan", "san",
    "the", "for", "you", "are", "was", "but", "not", "all", "out", "our",
    "use", "new", "has", "had", "his", "her", "its", "who", "why", "how",
    "may", "say", "way", "day", "get", "got", "let", "set", "see", "two",
    "ten", "one", "now", "off", "own", "per", "via", "yes", "and", "any",
    "have", "this", "that", "with", "what", "when", "your", "from", "they",
    "them", "then", "than", "some", "such", "into", "over", "more", "most",
    "will", "want", "need", "does", "done", "make", "made", "many", "much",
})


def _expand_query(query: str) -> tuple[str, str | None]:
    """Expand known acronyms and fuzzy-correct near-misses.

    Returns (expanded_query, suggestion | None).
    - suggestion is set when a word *almost* matches a known term (e.g. "polish" → "posh")
      but isn't an exact hit. The caller can surface it as "Did you mean …?"
    """
    lower = query.lower()
    words = re.findall(r'\b[a-z]{2,}\b', lower)
    extras: list[str] = []
    suggestion: str | None = None

    # 1. Exact matches
    for term, expansion in _QUERY_SYNONYMS.items():
        if re.search(r'\b' + re.escape(term) + r'\b', lower):
            extras.append(expansion)

    # 2. Fuzzy correction — only when no exact synonym matched.
    # Require length >= 4 and skip common English words so everyday words
    # ("any", "can", "what") don't collide with short acronyms ("uan").
    if not extras:
        synonym_keys = list(_QUERY_SYNONYMS.keys())
        for word in words:
            if len(word) < 4 or word in _FUZZY_STOPWORDS:
                continue
            # Only compare against keys of similar length (±1 char) to avoid
            # common words like "tell" fuzzy-matching short acronyms like "el".
            candidate_keys = [k for k in synonym_keys if abs(len(k) - len(word)) <= 1]
            matches = get_close_matches(word, candidate_keys, n=1, cutoff=0.65)
            if matches and matches[0] != word:
                best = matches[0]
                expansion = _QUERY_SYNONYMS[best]
                extras.append(expansion)
                full_form = expansion.split()[0:4]  # first few words of expansion
                suggestion = f"{best.upper()} ({' '.join(full_form).title()})"

    expanded = query + " " + " ".join(extras) if extras else query
    return expanded, suggestion


def _safe_title(title: str) -> str:
    """Sanitize a policy title for use as a safe filename."""
    return re.sub(r'[^\w\-]', '_', title)[:60]


_MIN_IMAGE_BYTES = 20_000  # 20 KB — filters logos, headers, icons; keeps charts/diagrams/tables

# Phrases that mark a chunk as carrying exclusion / "not covered" language. When a
# char_budget trims retrieval, any chunk matching one of these is kept IN FULL and never
# budget-dropped — the answering LLM's "exclusions override coverage" rule depends on
# seeing the exclusion text, so silently trimming it would flip a correct "not covered"
# answer into a wrong "covered" one.
_EXCLUSION_KEYWORDS = (
    "exclusion", "not covered", "not payable",
    "shall not", "is not eligible", "are excluded",
)


def _has_exclusion(t: str) -> bool:
    """True if the text carries exclusion language that must survive any budget trim."""
    low = (t or "").lower()
    return any(k in low for k in _EXCLUSION_KEYWORDS)


def _extract_images_from_pdf_bytes(data: bytes) -> list:
    """
    Return list of (page_index, image_bytes, ext) tuples.
    Skips images smaller than 20 KB (logos, headers, decorations).
    Requires pymupdf (pip install pymupdf).
    """
    try:
        import fitz  # pymupdf
        images = []
        doc = fitz.open(stream=data, filetype="pdf")
        for page_num in range(len(doc)):
            page = doc[page_num]
            for img in page.get_images(full=True):
                xref = img[0]
                base = doc.extract_image(xref)
                img_bytes = base["image"]
                if len(img_bytes) < _MIN_IMAGE_BYTES:
                    continue
                images.append((page_num, img_bytes, base.get("ext", "png")))
        doc.close()
        return images
    except Exception as e:
        return []


def _extract_images_from_docx_bytes(data: bytes) -> list:
    """
    Return list of (position_ratio, image_bytes, ext) tuples.
    position_ratio is 0.0–1.0 indicating where in the document the image sits.
    Skips images smaller than 20 KB (logos, headers, decorations).
    """
    try:
        import zipfile
        import io as _io
        results = []
        with zipfile.ZipFile(_io.BytesIO(data)) as z:
            media = [n for n in z.namelist() if n.startswith("word/media/")]
            total = len(media)
            for idx, name in enumerate(sorted(media)):
                img_bytes = z.read(name)
                if len(img_bytes) < _MIN_IMAGE_BYTES:
                    continue
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
                position_ratio = idx / max(total, 1)
                results.append((position_ratio, img_bytes, ext))
        return results
    except Exception as e:
        return []


def _extract_images_from_pptx_bytes(data: bytes) -> list:
    """
    Return list of (position_ratio, image_bytes, ext) tuples — same shape as the
    DOCX extractor, so the ratio-based chunk assignment path is reused.
    position_ratio = slide_index / num_slides (0.0–1.0).
    Skips images smaller than 20 KB (logos, headers, decorations).
    """
    try:
        import io as _io
        from pptx import Presentation
        from pptx.enum.shapes import MSO_SHAPE_TYPE

        prs = Presentation(_io.BytesIO(data))
        slides = list(prs.slides)
        total = len(slides)
        results = []
        for s_idx, slide in enumerate(slides):
            position_ratio = s_idx / max(total, 1)
            for shape in slide.shapes:
                if shape.shape_type != MSO_SHAPE_TYPE.PICTURE:
                    continue
                try:
                    blob = shape.image.blob
                except Exception:
                    continue
                if len(blob) < _MIN_IMAGE_BYTES:
                    continue
                ext = (shape.image.ext or "png").lower()
                results.append((position_ratio, blob, ext))
        return results
    except Exception as e:
        return []


def _upload_policy_images(policy_id: int, title: str, raw_images: list, db, is_docx: bool = False) -> list:
    """
    Store extracted images in the PolicyImage table.
    raw_images: list of (page_or_ratio, bytes, ext)
    Returns list of PolicyImage IDs.
    """
    from app.models import PolicyImage
    _EXT_CT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
               "gif": "image/gif", "webp": "image/webp"}
    ids = []
    for idx, (_, img_bytes, ext) in enumerate(raw_images):
        try:
            img = PolicyImage(
                policy_id=policy_id,
                content_type=_EXT_CT.get(ext.lower(), "image/png"),
                image_data=img_bytes,
            )
            db.add(img)
            db.flush()
            ids.append(img.id)
        except Exception as e:
            pass
    return ids


def _assign_images_to_chunks(raw_images: list, num_chunks: int, is_docx: bool = False) -> dict:
    """
    Map chunk_index → list of raw_image list indices.
    For PDFs: images are keyed by page_num; we distribute chunks proportionally across pages.
    For DOCXs: images carry a position_ratio; we use that directly.
    Returns {chunk_index: [image_list_idx, ...]}
    """
    assignment: dict = {i: [] for i in range(num_chunks)}
    if num_chunks == 0 or not raw_images:
        return assignment

    if is_docx:
        for img_idx, (ratio, _, _) in enumerate(raw_images):
            chunk_idx = min(int(ratio * num_chunks), num_chunks - 1)
            assignment[chunk_idx].append(img_idx)
    else:
        # PDF: assume pages are distributed evenly across chunks
        max_page = max(p for p, _, _ in raw_images) if raw_images else 0
        for img_idx, (page_num, _, _) in enumerate(raw_images):
            ratio = page_num / max(max_page, 1)
            chunk_idx = min(int(ratio * num_chunks), num_chunks - 1)
            assignment[chunk_idx].append(img_idx)

    return assignment


def _extract_text_from_pdf(filepath: str) -> str:
    try:
        import pdfplumber
        parts = []
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    parts.append(t)
        return "\n".join(parts)
    except Exception as e:
        return ""


def _extract_text_from_docx(filepath: str) -> str:
    try:
        from docx import Document
        doc = Document(filepath)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        return ""


def _extract_text_from_pdf_bytes(data: bytes) -> str:
    try:
        import io as _io
        import pdfplumber
        with pdfplumber.open(_io.BytesIO(data)) as pdf:
            parts = [page.extract_text() for page in pdf.pages if page.extract_text()]
        return "\n".join(parts)
    except Exception as e:
        return ""


def _extract_text_from_docx_bytes(data: bytes) -> str:
    try:
        import io as _io
        from docx import Document
        doc = Document(_io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        return ""


def _extract_text_from_pptx_bytes(data: bytes) -> str:
    """Extract text from a PowerPoint deck: per slide, pull shape text frames,
    table cells, and speaker notes. Slides are separated by blank lines so the
    sentence chunker keeps slide boundaries reasonably intact."""
    try:
        import io as _io
        from pptx import Presentation

        prs = Presentation(_io.BytesIO(data))
        parts = []
        for slide in prs.slides:
            slide_lines = []
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        line = "".join(run.text for run in para.runs).strip()
                        if line:
                            slide_lines.append(line)
                if shape.has_table:
                    for row in shape.table.rows:
                        cells = [c.text.strip() for c in row.cells if c.text.strip()]
                        if cells:
                            slide_lines.append(" | ".join(cells))
            # Speaker notes often carry the real narrative of a slide deck
            if slide.has_notes_slide:
                notes = (slide.notes_slide.notes_text_frame.text or "").strip()
                if notes:
                    slide_lines.append(notes)
            if slide_lines:
                parts.append("\n".join(slide_lines))
        return "\n\n".join(parts)
    except Exception as e:
        return ""


def _chunk_text_structured(text: str, max_tokens: int = 400, overlap_sentences: int = 2) -> list[dict]:
    """Structure-aware chunker — ARB #30.

    Respects document structure (Markdown/Word headings, numbered sections, bullet lists)
    so that retrieval chunks always contain their section heading as context. This avoids
    the common failure mode where a fixed-size chunk starts mid-paragraph and the model
    has no idea what topic it belongs to.

    Algorithm:
      1. Split the document on heading / section boundaries.
      2. Within each section, apply the sentence-aware chunker.
      3. Prepend the section heading to every chunk produced from that section.
      4. Return list of dicts: {text, heading, section_index}

    The caller (``_chunk_and_embed``) can join ``heading + "\\n\\n" + text`` to form
    the embedding input and store the heading for citation display (#31).
    """
    if not text:
        return []

    # ── Heading detection ────────────────────────────────────────────────────
    # Match: Markdown headings (#, ##, ###), numbered sections (1. / 1.1 / A.),
    # ALL-CAPS lines (often section titles in plain-text Word exports), and
    # lines ending with a colon that are short (≤60 chars → likely a label).
    _HEADING_RE = re.compile(
        r"^(#{1,4}\s+.+|"           # Markdown headings
        r"\d+(\.\d+)*\.?\s+[A-Z].+|"  # "1." / "1.1" / "A." numbered sections
        r"[A-Z][A-Z\s&/,\-]{4,59}|"   # ALL-CAPS lines (Word-export titles)
        r".{5,60}:)\s*$",              # Short line ending with colon
        re.MULTILINE,
    )

    lines = text.split("\n")
    sections: list[tuple[str, str]] = []   # [(heading, body), ...]
    current_heading = ""
    current_body_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped and _HEADING_RE.match(stripped) and len(stripped) < 120:
            # Flush current section
            if current_body_lines:
                sections.append((current_heading, "\n".join(current_body_lines).strip()))
            current_heading = stripped.rstrip(":")
            current_body_lines = []
        else:
            current_body_lines.append(line)

    if current_body_lines:
        sections.append((current_heading, "\n".join(current_body_lines).strip()))

    # If no sections detected fall back to sentence chunker
    if not sections or all(body == "" for _, body in sections):
        plain = _chunk_text_sentences(text, max_tokens=max_tokens, overlap_sentences=overlap_sentences)
        return [{"text": c, "heading": "", "section_index": i} for i, c in enumerate(plain)]

    result: list[dict] = []
    for sec_idx, (heading, body) in enumerate(sections):
        if not body:
            continue
        sub_chunks = _chunk_text_sentences(body, max_tokens=max_tokens,
                                           overlap_sentences=overlap_sentences)
        for chunk_text in sub_chunks:
            # Prepend heading so every chunk is self-contained
            full_text = f"{heading}\n\n{chunk_text}" if heading else chunk_text
            result.append({"text": full_text, "heading": heading, "section_index": sec_idx})

    return result or [{"text": text[:max_tokens * 4], "heading": "", "section_index": 0}]


def _rerank_chunks(query: str, chunks: list[dict], top_k: int | None = None) -> list[dict]:
    """Lightweight query-chunk reranker — ARB #29.

    Uses query-term frequency in the chunk (normalised TF overlap) as a fast,
    zero-LLM relevance signal to re-order the candidates after hybrid retrieval.
    This is NOT a cross-encoder but materially improves precision for keyword-dense
    queries on a weak 8B model (the top chunk matters most for the grounded answer).

    Each chunk dict must have a 'text' key.  Returns the list re-sorted by relevance
    (highest first), with a '_rerank_score' key added for observability.
    """
    if not chunks or not query:
        return chunks

    query_tokens = set(re.findall(r"[a-z0-9']{2,}", query.lower()))
    if not query_tokens:
        return chunks

    def _score(chunk: dict) -> float:
        text_tokens = re.findall(r"[a-z0-9']{2,}", (chunk.get("text") or "").lower())
        if not text_tokens:
            return 0.0
        total = len(text_tokens)
        matches = sum(1 for t in text_tokens if t in query_tokens)
        # Normalised TF: fraction of chunk tokens that are query tokens,
        # scaled by query recall: fraction of query tokens present in chunk.
        recall = sum(1 for qt in query_tokens if any(qt in t for t in text_tokens)) / max(len(query_tokens), 1)
        tf = matches / max(total, 1)
        return 0.6 * tf + 0.4 * recall

    scored = [dict(c, _rerank_score=_score(c)) for c in chunks]
    scored.sort(key=lambda x: x["_rerank_score"], reverse=True)
    return scored[:top_k] if top_k else scored


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    """Character-based chunker (legacy — kept for backward compatibility)."""
    if not text:
        return []
    text = re.sub(r'\s+', ' ', text).strip()
    chunks, start = [], 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap
    return chunks


def _chunk_text_sentences(text: str, max_tokens: int = 400, overlap_sentences: int = 2) -> list:
    """Sentence-aware chunker that respects natural sentence boundaries.

    - Splits on sentence-ending punctuation followed by whitespace + capital letter
    - Groups sentences into chunks of ~max_tokens (1 token ≈ 4 chars)
    - Adds overlap_sentences-sentence overlap between consecutive chunks
    """
    if not text:
        return []
    text = re.sub(r'\s+', ' ', text).strip()

    # Split on sentence boundaries: . ! ? followed by space and uppercase
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z\"\'])', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    if not sentences:
        return [text] if text else []

    chunks: list = []
    current: list = []
    current_len = 0

    for sent in sentences:
        sent_len = len(sent) // 4  # approximate token count
        if current_len + sent_len > max_tokens and current:
            chunks.append(" ".join(current))
            # Keep last overlap_sentences for continuity
            current = current[-overlap_sentences:] if overlap_sentences else []
            current_len = sum(len(s) // 4 for s in current)
        current.append(sent)
        current_len += sent_len

    if current:
        chunks.append(" ".join(current))

    return chunks


class PolicyService:

    # ── Synonym expansion for keyword fallback ────────────────────────────────
    _SYNONYMS: dict = {
        "hotel": ["accommodation", "hotel", "lodge", "stay", "lodging"],
        "hotels": ["accommodation", "hotel", "hotels", "lodge", "stay", "lodging"],
        "accommodation": ["accommodation", "hotel", "lodge", "stay"],
        "travel": ["travel", "trip", "journey", "relocation"],
        "reimburse": ["reimburse", "reimbursement", "claim", "expense"],
        "reimbursement": ["reimburse", "reimbursement", "claim", "expense"],
        "claim": ["claim", "reimburse", "reimbursement", "expense"],
        "medical": ["medical", "health", "practo", "doctor"],
        "cert": ["certification", "certificate", "training", "course"],
        "certification": ["certification", "certificate", "cert", "training", "course"],
        "certificate": ["certificate", "certification", "cert", "training", "course"],
    }

    # ── Embedding helpers ─────────────────────────────────────────────────────

    _embedding_client = None
    _embedding_cache: dict = {}
    _embedding_cache_max: int = 512

    @classmethod
    def _get_embedding_client(cls):
        if cls._embedding_client is None:
            from openai import OpenAI
            # Fail fast on a busy/unavailable embed server: the default client retries
            # 503s with backoff, which AMPLIFIES load against a saturated ml01 (the
            # "maximum pending requests exceeded" feedback loop) and holds DB locks
            # for the duration when called mid-transaction. One quick attempt, then
            # the caller falls back to keyword search / stores the chunk unembedded.
            cls._embedding_client = OpenAI(
                base_url=settings.EMBEDDING_BASE_URL,
                api_key=settings.EMBEDDING_API_KEY,
                max_retries=0,
                timeout=15.0,
            )
        return cls._embedding_client

    @classmethod
    def _get_embedding(cls, text: str) -> list | None:
        """Call the configured embedding model. Returns None on any failure.

        Cache hierarchy: L1 in-process LRU (512 entries) → L2 Redis (14 days) → Ollama.
        The same text is embedded for answer-cache lookup, semantic router, form match,
        and policy search — so a Redis hit on repeated questions avoids multiple ml01 calls.
        """
        global _embedding_failed_at
        import hashlib
        import struct

        key = text[:2000]
        # L1: in-process LRU
        if key in cls._embedding_cache:
            return cls._embedding_cache[key]

        # L2: Redis (packed float32 bytes for storage efficiency)
        _text_hash = hashlib.sha256(key.encode()).hexdigest()[:32]
        _redis_key = f"emb:{settings.EMBEDDING_MODEL_NAME}:{_text_hash}"
        try:
            from app.redis_config import get_redis_client
            rc = get_redis_client()
            if rc:
                cached_bytes = rc.get(_redis_key)
                if cached_bytes:
                    # Stored as hex string for Redis compatibility
                    raw = bytes.fromhex(cached_bytes)
                    n = len(raw) // 4
                    result = list(struct.unpack(f"{n}f", raw))
                    cls._embedding_cache[key] = result
                    return result
        except Exception:
            pass

        # L3: actual embedding call
        try:
            resp = cls._get_embedding_client().embeddings.create(
                input=key,
                model=settings.EMBEDDING_MODEL_NAME,
            )
            result = resp.data[0].embedding
            if len(cls._embedding_cache) >= cls._embedding_cache_max:
                # evict oldest half when full
                drop = list(cls._embedding_cache.keys())[:cls._embedding_cache_max // 2]
                for k in drop:
                    del cls._embedding_cache[k]
            cls._embedding_cache[key] = result
            # Store in Redis L2 as packed float32 hex (fail-soft)
            try:
                from app.redis_config import get_redis_client
                rc = get_redis_client()
                if rc:
                    packed = struct.pack(f"{len(result)}f", *result)
                    rc.setex(_redis_key, 86400 * 14, packed.hex())
            except Exception:
                pass
            _embedding_failed_at = None  # success — clear any stale failure flag
            return result
        except Exception:
            _embedding_failed_at = time.time()
            cls._try_warmup_embedding()
            return None

    @classmethod
    def _try_warmup_embedding(cls):
        """Fire-and-forget: ask Ollama to reload the embedding model in the background."""
        global _embedding_warmup_running
        with _embedding_warmup_lock:
            if _embedding_warmup_running:
                return  # warmup already in progress
            _embedding_warmup_running = True

        def _do():
            global _embedding_warmup_running
            try:
                import time as _t
                _t.sleep(2)  # let the current request flow through first
                from openai import OpenAI
                client = OpenAI(
                    base_url=settings.EMBEDDING_BASE_URL,
                    api_key=settings.EMBEDDING_API_KEY,
                    max_retries=0,
                    timeout=60.0,  # longer timeout for cold-load
                )
                client.embeddings.create(input="warmup", model=settings.EMBEDDING_MODEL_NAME)
            except Exception:
                pass
            finally:
                with _embedding_warmup_lock:
                    _embedding_warmup_running = False

        threading.Thread(target=_do, daemon=True).start()

    # ── Ingestion ─────────────────────────────────────────────────────────────

    @staticmethod
    def ingest_policies_from_folder(folder_path: str = None):
        """
        Read PDFs/DOCXs from the OneDrive folder, store full text in Policy table,
        then chunk + embed each new policy.
        Only run when the folder exists (dev / first-time setup).
        """
        folder = Path(folder_path) if folder_path else POLICY_DIR
        if not folder.exists():
            return {"ingested": 0, "skipped": 0, "errors": []}

        db = SessionLocal()
        ingested, skipped, errors = 0, 0, []
        try:
            existing_titles = {p.title for p in db.query(Policy.title).all()}

            for filepath in sorted(folder.iterdir()):
                if filepath.suffix.lower() not in ('.pdf', '.docx'):
                    continue
                title = filepath.stem.strip()
                if title in existing_titles:
                    skipped += 1
                    continue

                is_pdf = filepath.suffix.lower() == '.pdf'
                if is_pdf:
                    content = _extract_text_from_pdf(str(filepath))
                    file_bytes = filepath.read_bytes()
                else:
                    content = _extract_text_from_docx(str(filepath))
                    file_bytes = filepath.read_bytes()

                if not content or len(content) < 50:
                    errors.append(f"Empty/too short: {filepath.name}")
                    continue

                policy = Policy(
                    title=title,
                    category=_categorize(filepath.name),
                    content=content[:50000],
                )
                db.add(policy)
                db.flush()

                raw_images = (
                    _extract_images_from_pdf_bytes(file_bytes)
                    if is_pdf
                    else _extract_images_from_docx_bytes(file_bytes)
                )
                if raw_images:
                    img_ids = _upload_policy_images(policy.id, title, raw_images, db, is_docx=not is_pdf)
                    chunks_preview = _chunk_text_sentences(content[:50000])
                    assignment = _assign_images_to_chunks(
                        raw_images, len(chunks_preview), is_docx=not is_pdf
                    )
                    chunk_images = {
                        ci: [img_ids[ii] for ii in idxs if ii < len(img_ids)]
                        for ci, idxs in assignment.items()
                        if idxs
                    }
                    PolicyService._chunk_and_embed(policy, db, chunk_images=chunk_images)
                else:
                    pass

                ingested += 1

            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(str(e))
        finally:
            db.close()

        result = {"ingested": ingested, "skipped": skipped, "errors": errors}
        return result


    # ── Chunking & Embedding ──────────────────────────────────────────────────

    @staticmethod
    def _chunk_and_embed(policy: Policy, db, chunk_images: dict = None):
        """Internal: chunk one Policy and store PolicyChunk rows in the given session.

        Uses structure-aware chunking (ARB #30) — respects headings/sections so
        every chunk carries its section context for better retrieval and citation.
        Embedding is best-effort — chunks are stored even without embeddings.
        chunk_images: optional {chunk_index: [PolicyImage.id, ...]} mapping
        """
        from app.models import PolicyChunk

        db.query(PolicyChunk).filter(PolicyChunk.policy_id == policy.id).delete()

        # Structure-aware chunking: each item is {text, heading, section_index}
        structured_chunks = _chunk_text_structured(policy.content or "")
        for i, chunk_info in enumerate(structured_chunks):
            chunk_text_val = chunk_info["text"]
            embed_input = f"{policy.title}\n\n{chunk_text_val}"
            emb = PolicyService._get_embedding(embed_input)
            img_keys = (chunk_images or {}).get(i) or None
            db.add(PolicyChunk(
                policy_id=policy.id,
                chunk_index=i,
                text=chunk_text_val,
                embedding=emb,
                image_urls=img_keys if img_keys else None,
            ))
        return len(structured_chunks)

    @staticmethod
    def embed_all_policies():
        """
        Chunk and embed every Policy whose chunks are missing embeddings.
        Called once on startup. Tolerates embedding failures — chunks stored regardless.
        """
        from app.models import PolicyChunk
        db = SessionLocal()
        try:
            policies = db.query(Policy).all()
            total_chunks = 0
            for p in policies:
                total = db.query(PolicyChunk).filter(PolicyChunk.policy_id == p.id).count()
                embedded = db.query(PolicyChunk).filter(
                    PolicyChunk.policy_id == p.id,
                    PolicyChunk.embedding.isnot(None),
                ).count()
                if total > 0 and embedded == total:
                    continue  # all chunks already embedded
                # Delete chunks without embeddings and re-chunk+embed from scratch
                db.query(PolicyChunk).filter(PolicyChunk.policy_id == p.id).delete()
                n = PolicyService._chunk_and_embed(p, db)
                total_chunks += n
            db.commit()
        except Exception as e:
            db.rollback()
        finally:
            db.close()

    # ── Image helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _append_image_marker(text: str, image_keys: list) -> str:
        """
        Append a [POLICY_IMG:id1||id2] marker to the result string when images exist.
        This marker lives in the ToolMessage (not the final AI response) so main.py
        can build serving URLs without them leaking into rendered chat text.
        """
        if not image_keys:
            return text
        return text + "\n\n[POLICY_IMG:" + "||".join(str(k) for k in image_keys) + "]"

    # ── Metadata chunk detection ──────────────────────────────────────────────

    _METADATA_MARKERS = [
        "version", "review date", "next review", "owner", "approved by",
        "effective date", "document no", "document number", "prepared by",
        "reviewed by", "confidential", "authored by", "revision history",
        "document control", "change log",
    ]

    @staticmethod
    def _is_metadata_chunk(text: str) -> bool:
        """Return True if the chunk is a document-control table with no real policy content."""
        lower = text.lower()
        hits = sum(1 for m in PolicyService._METADATA_MARKERS if m in lower)
        # Pure metadata block (3+ markers in a short chunk)
        if hits >= 3 and len(text) < 800:
            return True
        # Even in longer chunks, if metadata dominates (4+ markers), skip
        if hits >= 4:
            return True
        return False

    @staticmethod
    def _strip_metadata_lines(text: str) -> str:
        """Remove lines that are purely document-control metadata from a chunk."""
        _META_LINE_RE = re.compile(
            r'^.*(prepared by|reviewed by|approved by|authored by|document owner|'
            r'next review|review date|effective date|version\s*:\s*\d|'
            r'document no|revision history|confidential).*$',
            re.IGNORECASE | re.MULTILINE,
        )
        cleaned = _META_LINE_RE.sub('', text)
        # Collapse multiple blank lines
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
        return cleaned.strip()

    # ── Search ────────────────────────────────────────────────────────────────

    @staticmethod
    def _rrf_fuse(sem_ids: list, bm25_ids: list, k: int = 60) -> dict:
        """Reciprocal Rank Fusion: combines two ranked lists into a single score dict.
        Returns {chunk_id: rrf_score} sorted by score descending."""
        scores: dict = {}
        for rank, cid in enumerate(sem_ids):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        for rank, cid in enumerate(bm25_ids):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        return dict(sorted(scores.items(), key=lambda x: x[1], reverse=True))

    @staticmethod
    def search_policies(query: str, limit: int = 4, char_budget: int | None = None) -> str:
        """Hybrid search over policy documents (excludes company-project content).

        `char_budget` (opt-in) caps the total characters of the joined non-exclusion
        excerpts to bound the context fed to the answering LLM; chunks containing
        exclusion language are always kept in full (see `_has_exclusion`)."""
        return PolicyService._hybrid_search(
            query, limit, category_not_in=[PROJECT_CATEGORY], char_budget=char_budget
        )

    @staticmethod
    def search_policies_with_citations(
        query: str, limit: int = 4, char_budget: int | None = None
    ) -> dict:
        """Like search_policies() but returns a structured result with inline citations.

        ARB #31 — Surface citations consistently.

        Returns::

            {
                "context": "<combined text for LLM prompt>",
                "citations": [
                    {"title": "Leave Policy", "category": "Leave & Attendance",
                     "excerpt": "first 120 chars of the matching chunk"},
                    ...
                ]
            }

        The caller can append a ``[CITATIONS] ...`` block at the end of the LLM
        prompt so the model knows to reference the sources, and the frontend can
        render clickable citation chips.
        """
        from app.models import PolicyChunk
        from app.database import SessionLocal

        context_str = PolicyService._hybrid_search(
            query, limit, category_not_in=[PROJECT_CATEGORY], char_budget=char_budget
        )

        # Re-run a lightweight DB query to fetch the top matching Policy titles
        # (the text is already in context_str; we just need the metadata).
        citations: list[dict] = []
        try:
            db = SessionLocal()
            try:
                # Parse out the policy titles from the formatted context string.
                # Format is "**Title** (Category):\n<text>\n\n---\n\n..."
                import re as _re
                for m in _re.finditer(r"\*\*(.+?)\*\*\s*\((.+?)\):\n([\s\S]*?)(?=\n\n---|\Z)",
                                      context_str):
                    title, category, excerpt = m.group(1), m.group(2), m.group(3).strip()
                    citations.append({
                        "title": title,
                        "category": category,
                        "excerpt": excerpt[:150].strip(),
                    })
            finally:
                db.close()
        except Exception:
            pass

        return {"context": context_str, "citations": citations}

    @staticmethod
    def search_projects(query: str, limit: int = 6) -> str:
        """Hybrid search scoped to company-project content (summaries, demo
        transcripts, project details) — never touches HR/IT/Admin policies."""
        return PolicyService._hybrid_search(query, limit, category_in=[PROJECT_CATEGORY])

    @staticmethod
    def list_project_names() -> list[str]:
        """Return sorted unique project names from SharePoint-ingested project content.

        Project titles are stored as '{ProjectName} — {type}: {stem}'; we split on
        ' — ' and deduplicate to get the canonical project name list."""
        from app.database import SessionLocal
        from app.models import Policy
        db = SessionLocal()
        try:
            rows = (
                db.query(Policy.title)
                .filter(Policy.category == PROJECT_CATEGORY)
                .all()
            )
            names: set[str] = set()
            for (title,) in rows:
                if title and " — " in title:
                    names.add(title.split(" — ", 1)[0].strip())
                elif title:
                    names.add(title.strip())
            return sorted(names)
        finally:
            db.close()

    @staticmethod
    def search_it_docs(query: str, limit: int = 3) -> str:
        """Hybrid search scoped to IT support documents (VPN, wifi, printer, email setup, etc.)."""
        return PolicyService._hybrid_search(query, limit, category_in=["IT"])

    @staticmethod
    def search_pmo_docs(query: str, limit: int = 3) -> str:
        """Hybrid search scoped to PMO process / governance documents.
        Empty until PMO-category docs are ingested (future-ready)."""
        return PolicyService._hybrid_search(query, limit, category_in=["PMO"])

    @staticmethod
    def search_admin_docs(query: str, limit: int = 3) -> str:
        """Hybrid search scoped to admin-owned documents: Admin (relocation, travel, parking,
        accommodation) + Finance (reimbursement, expense, PF) — the categories the admin agent owns."""
        return PolicyService._hybrid_search(query, limit, category_in=["Admin", "Finance"])

    @staticmethod
    def _hybrid_search(
        query: str,
        limit: int = 4,
        category_in: list | None = None,
        category_not_in: list | None = None,
        char_budget: int | None = None,
    ) -> str:
        """
        Hybrid BM25 + pgvector search with Reciprocal Rank Fusion.

        1. Semantic search (pgvector cosine distance, top-20 candidates)
        2. BM25 keyword search (PostgreSQL tsvector/tsquery, top-20 candidates)
        3. RRF fusion of both ranked lists
        4. Fallback: keyword search on chunks/policies if no embeddings available
        Returns top `limit` (default 4) unique-policy chunks.

        `category_in` / `category_not_in` scope the candidate set by Policy.category
        at the SQL level (so excluded categories never steal candidate slots).
        """
        from app.models import PolicyChunk
        from sqlalchemy import text as sql_text
        from app.models import SCHEMA

        query, did_you_mean = _expand_query(query)

        db = SessionLocal()
        try:
            query_keywords = [w for w in query.lower().split() if len(w) > 2]
            policy_title_map = {p.id: (p.title or "").lower() for p in db.query(Policy).all()}

            def _apply_cat(q):
                """Apply category filters to an ORM query already joined to Policy."""
                if category_in:
                    q = q.filter(Policy.category.in_(category_in))
                if category_not_in:
                    q = q.filter(Policy.category.notin_(category_not_in))
                return q

            sem_ids: list = []
            bm25_ids: list = []

            # ── 1. Semantic search via pgvector ───────────────────────────────
            query_emb = PolicyService._get_embedding(query)
            if query_emb:
                dist_expr = PolicyChunk.embedding.cosine_distance(query_emb)
                sem_q = (
                    db.query(PolicyChunk.id, dist_expr.label("dist"))
                    .join(Policy, Policy.id == PolicyChunk.policy_id)
                    .filter(
                        PolicyChunk.embedding.isnot(None),
                        dist_expr < 0.65,
                    )
                )
                sem_rows = _apply_cat(sem_q).order_by(dist_expr).limit(20).all()
                sem_ids = [r.id for r in sem_rows]

                # ── Retrieval validator: semantic veto ─────────────────────────
                # Embeddings are healthy and NOT ONE in-scope chunk is within the
                # 0.65 cosine floor → the corpus has nothing relevant to this query.
                # The BM25 and keyword fallbacks below match on bare word overlap
                # ("wifi not WORKING" → "WORKING hours policy") and would hand the
                # agent plausible-but-wrong excerpts to answer from. An honest
                # "not found" beats a confident answer from the wrong document.
                # Both fallbacks remain available when the embedding model is down
                # (query_emb is None) — availability over strictness in that mode.
                if not sem_ids:
                    if did_you_mean:
                        return (
                            f"I couldn't find a policy matching your query. Did you mean "
                            f"**{did_you_mean}**? Please try again with the correct term."
                        )
                    # Phrasing is load-bearing: callers detect emptiness via
                    # '"No policies found" in result' (agent.py, hr_agent, skill routes)
                    # and '"no results" in result.lower()' (pmo tools) — keep both.
                    return RETRIEVAL_VETO_MESSAGE

            # ── 2. BM25 keyword search via tsvector ───────────────────────────
            try:
                bm25_params = {"q": query}
                cat_sql = ""
                if category_in:
                    cat_sql += " AND p.category = ANY(:cat_in)"
                    bm25_params["cat_in"] = list(category_in)
                if category_not_in:
                    cat_sql += " AND p.category <> ALL(:cat_not_in)"
                    bm25_params["cat_not_in"] = list(category_not_in)
                bm25_rows = db.execute(
                    sql_text(
                        f"SELECT pc.id FROM \"{SCHEMA}\".policy_chunks pc "
                        f"JOIN \"{SCHEMA}\".policies p ON p.id = pc.policy_id "
                        f"WHERE pc.text_tsv IS NOT NULL "
                        f"AND pc.text_tsv @@ plainto_tsquery('english', :q)"
                        f"{cat_sql} "
                        f"ORDER BY ts_rank(pc.text_tsv, plainto_tsquery('english', :q)) DESC "
                        f"LIMIT 20"
                    ),
                    bm25_params,
                ).fetchall()
                bm25_ids = [r[0] for r in bm25_rows]
            except Exception as bm25_err:
                pass

            # ── 3. RRF fusion ─────────────────────────────────────────────────
            if sem_ids or bm25_ids:
                fused_scores = PolicyService._rrf_fuse(sem_ids, bm25_ids)
                all_fused_ids = list(fused_scores.keys())

                # Apply title-keyword boost to top-8 candidates
                candidate_ids = all_fused_ids[:8]
                chunks_by_id = {
                    c.id: c for c in db.query(PolicyChunk).filter(PolicyChunk.id.in_(candidate_ids)).all()
                }
                # Build candidate list: apply title-keyword boost + token-overlap rerank (ARB #29)
                candidate_dicts = []
                for cid in candidate_ids:
                    c = chunks_by_id.get(cid)
                    if c is None or PolicyService._is_metadata_chunk(c.text):
                        continue
                    title = policy_title_map.get(c.policy_id, "")
                    title_bonus = sum(
                        0.1 for kw in query_keywords
                        if kw in title and kw not in ("policy", "what", "the", "for", "and")
                    )
                    candidate_dicts.append({
                        "text": c.text, "chunk_obj": c,
                        "_rrf_score": fused_scores[cid] + title_bonus,
                    })

                # Reranker: re-score by query-token overlap, then blend with RRF score
                reranked_dicts = _rerank_chunks(query, candidate_dicts, top_k=len(candidate_dicts))
                reranked = []
                for d in reranked_dicts:
                    combined = 0.7 * d["_rrf_score"] + 0.3 * d["_rerank_score"]
                    reranked.append((combined, d["chunk_obj"]))

                reranked.sort(key=lambda x: x[0], reverse=True)

                seen_policies: set = set()
                seen_titles: set = set()
                results = []
                all_image_keys: list = []
                for _, c in reranked:
                    if len(results) >= limit:
                        break
                    if c.policy_id in seen_policies:
                        continue
                    policy = db.query(Policy).filter(Policy.id == c.policy_id).first()
                    if policy:
                        # Dedup duplicate-ingested docs that share a title under different
                        # policy_ids (e.g. "GHI Policy_2025-26" vs "GHI Policy 2025-26"),
                        # so copies don't crowd out other relevant policies.
                        norm = PolicyService._norm_title(policy.title)
                        if norm and norm in seen_titles:
                            seen_policies.add(c.policy_id)
                            continue
                        seen_policies.add(c.policy_id)
                        seen_titles.add(norm)
                        clean_text = PolicyService._strip_metadata_lines(c.text)
                        piece = f"**{policy.title}** ({policy.category}):\n{clean_text}"
                        if char_budget is not None and not _has_exclusion(clean_text):
                            remaining = char_budget - sum(len(r) for r in results)
                            if remaining <= 0:
                                continue
                            if len(piece) > remaining:
                                piece = piece[:remaining].rsplit("\n\n", 1)[0]
                        results.append(piece)  # exclusion chunks always kept in full
                        if c.image_urls:
                            all_image_keys.extend(c.image_urls)

                if results:
                    text = "\n\n---\n\n".join(results)
                    return PolicyService._append_image_marker(text, all_image_keys)

            # ── 4. Keyword fallback on chunks ──────────────────────────────────
            chunks_all = _apply_cat(
                db.query(PolicyChunk).join(Policy, Policy.id == PolicyChunk.policy_id)
            ).all()
            if chunks_all:
                keywords = PolicyService._expand_keywords(query)
                scored = []
                for c in chunks_all:
                    if PolicyService._is_metadata_chunk(c.text):
                        continue
                    lower = c.text.lower()
                    title = policy_title_map.get(c.policy_id, "")
                    title_score = sum(10 if kw in title else 0 for kw in keywords)
                    content_score = sum(lower.count(kw) for kw in keywords)
                    score = title_score + content_score
                    if score > 0:
                        scored.append((score, c))

                scored.sort(key=lambda x: x[0], reverse=True)

                if scored:
                    seen_policies: set = set()
                    seen_titles: set = set()
                    results = []
                    all_image_keys: list = []
                    for _, c in scored:
                        if len(results) >= limit:
                            break
                        if c.policy_id in seen_policies:
                            continue
                        policy = db.query(Policy).filter(Policy.id == c.policy_id).first()
                        if policy:
                            norm = PolicyService._norm_title(policy.title)
                            if norm and norm in seen_titles:
                                seen_policies.add(c.policy_id)
                                continue
                            seen_policies.add(c.policy_id)
                            seen_titles.add(norm)
                            clean_text = PolicyService._strip_metadata_lines(c.text)
                            piece = f"**{policy.title}** ({policy.category}):\n{clean_text}"
                            if char_budget is not None and not _has_exclusion(clean_text):
                                remaining = char_budget - sum(len(r) for r in results)
                                if remaining <= 0:
                                    continue
                                if len(piece) > remaining:
                                    piece = piece[:remaining].rsplit("\n\n", 1)[0]
                            results.append(piece)  # exclusion chunks always kept in full
                            if c.image_urls:
                                all_image_keys.extend(c.image_urls)

                    if results:
                        text = "\n\n---\n\n".join(results)
                        return PolicyService._append_image_marker(text, all_image_keys)

            # ── 5. Last resort: keyword search on full Policy.content ──────────
            fallback = PolicyService._fallback_policy_search(
                query, db, limit, category_in=category_in, category_not_in=category_not_in
            )
            if fallback.startswith("No policies found") and did_you_mean:
                return f"I couldn't find a policy matching your query. Did you mean **{did_you_mean}**? Please try again with the correct term."
            return fallback

        finally:
            db.close()

    @staticmethod
    def _norm_title(title: str | None) -> str:
        """Normalize a policy title for dedup: lowercase, strip all non-alphanumerics.
        Collapses duplicate-ingested docs like 'GHI Policy_2025-26' / 'GHI Policy 2025-26'."""
        import re as _re
        return _re.sub(r"[^a-z0-9]+", "", (title or "").lower())

    @staticmethod
    def _expand_keywords(query: str) -> list:
        query_lower = query.lower()
        base = [w for w in query_lower.split() if len(w) > 2]
        expanded = set(base)
        for kw in base:
            for syn in PolicyService._SYNONYMS.get(kw, []):
                expanded.add(syn)
        return list(expanded)

    @staticmethod
    def _fallback_policy_search(
        query: str, db, limit: int = 2,
        category_in: list | None = None, category_not_in: list | None = None,
    ) -> str:
        """Keyword search directly on Policy.content — no chunks needed."""
        keywords = PolicyService._expand_keywords(query)
        pq = db.query(Policy)
        if category_in:
            pq = pq.filter(Policy.category.in_(category_in))
        if category_not_in:
            pq = pq.filter(Policy.category.notin_(category_not_in))
        policies = pq.all()
        if not policies:
            return "No policies found in the system."

        scored = []
        for p in policies:
            title_lower = (p.title or "").lower()
            content_lower = (p.content or "").lower()
            score = sum(10 if kw in title_lower else 0 for kw in keywords)
            score += sum(content_lower.count(kw) for kw in keywords)
            if score > 0:
                scored.append((score, p))

        if not scored:
            return f"No policies found matching '{query}'."

        scored.sort(key=lambda x: x[0], reverse=True)
        results = []
        for _, p in scored[:limit]:
            content = p.content or ""
            snippet = content[:3000] if len(content) > 3000 else content
            for kw in keywords:
                idx = content.lower().find(kw)
                if idx >= 0:
                    start = max(0, idx - 200)
                    snippet = content[start:min(len(content), idx + 2800)]
                    break
            snippet = PolicyService._strip_metadata_lines(snippet)
            results.append(f"**{p.title}** ({p.category}):\n{snippet}")

        return "\n\n---\n\n".join(results)

    # ── Utility ───────────────────────────────────────────────────────────────

    @staticmethod
    def list_policies() -> str:
        db = SessionLocal()
        try:
            policies = db.query(Policy).all()
            if not policies:
                return "No policies found."
            lines = [f"- {p.title} ({p.category})" for p in policies]
            return f"Available policies ({len(policies)} documents):\n" + "\n".join(lines)
        finally:
            db.close()
