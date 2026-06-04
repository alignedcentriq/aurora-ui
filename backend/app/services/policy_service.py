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
import datetime
from difflib import get_close_matches
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models import Policy

# ── Constants ─────────────────────────────────────────────────────────────────
POLICY_DIR = Path(__file__).resolve().parent.parent.parent / "OneDrive_1_12-5-2026"
CHUNK_SIZE = settings.POLICY_CHUNK_SIZE
CHUNK_OVERLAP = settings.POLICY_CHUNK_OVERLAP

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
    # ── Health insurance / GHI / mediclaim / claims ──────────────────────────
    "tat": "turnaround time claim settlement processing time",
    "ghi": "group health insurance mediclaim floater",
    "gpa": "group personal accident insurance",
    "sum insured": "sum insured coverage amount floater",
    "cashless": "cashless hospitalization network hospital pre-authorization",
    "opd": "outpatient department consultation",
    "ipd": "inpatient hospitalization",
    "ped": "pre-existing disease waiting period",
    "copay": "co-payment cost sharing",
    "co-pay": "co-payment cost sharing",
    "day care": "day care procedure surgery",
    "daycare": "day care procedure surgery",
    "room rent": "room rent limit hospitalization",
    "network hospital": "network hospital cashless empanelled",
    "ncb": "cumulative bonus no claim bonus",
}


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

    # 2. Fuzzy correction — only when no exact synonym matched
    if not extras:
        synonym_keys = list(_QUERY_SYNONYMS.keys())
        for word in words:
            if len(word) < 3:
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
        print(f"[PolicyService] PDF image extraction error: {e}")
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
        print(f"[PolicyService] DOCX image extraction error: {e}")
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
            print(f"[PolicyService] Image save failed (idx={idx}): {e}")
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
        print(f"[PolicyService] PDF read error {filepath}: {e}")
        return ""


def _extract_text_from_docx(filepath: str) -> str:
    try:
        from docx import Document
        doc = Document(filepath)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        print(f"[PolicyService] DOCX read error {filepath}: {e}")
        return ""


def _extract_text_from_pdf_bytes(data: bytes) -> str:
    try:
        import io as _io
        import pdfplumber
        with pdfplumber.open(_io.BytesIO(data)) as pdf:
            parts = [page.extract_text() for page in pdf.pages if page.extract_text()]
        return "\n".join(parts)
    except Exception as e:
        print(f"[PolicyService] PDF bytes read error: {e}")
        return ""


def _extract_text_from_docx_bytes(data: bytes) -> str:
    try:
        import io as _io
        from docx import Document
        doc = Document(_io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        print(f"[PolicyService] DOCX bytes read error: {e}")
        return ""


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
            cls._embedding_client = OpenAI(
                base_url=settings.EMBEDDING_BASE_URL,
                api_key=settings.EMBEDDING_API_KEY,
            )
        return cls._embedding_client

    @classmethod
    def _get_embedding(cls, text: str) -> list | None:
        """Call the configured embedding model. Returns None on any failure."""
        key = text[:2000]
        if key in cls._embedding_cache:
            return cls._embedding_cache[key]
        try:
            import time as _t  # TEMP[phase2-instrumentation]: measure embedding latency
            _t0 = _t.time()      # TEMP[phase2-instrumentation]
            resp = cls._get_embedding_client().embeddings.create(
                input=key,
                model=settings.EMBEDDING_MODEL_NAME,
            )
            # TEMP[phase2-instrumentation]: embedding calls bypass astream_events, so log here.
            print(f"[EMBED] model={settings.EMBEDDING_MODEL_NAME} time={_t.time() - _t0:.2f}s chars={len(key)}")
            result = resp.data[0].embedding
            if len(cls._embedding_cache) >= cls._embedding_cache_max:
                # evict oldest half when full
                drop = list(cls._embedding_cache.keys())[:cls._embedding_cache_max // 2]
                for k in drop:
                    del cls._embedding_cache[k]
            cls._embedding_cache[key] = result
            return result
        except Exception as e:
            print(f"[PolicyService] Embedding skipped ({type(e).__name__}): {e}")
            return None

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
            print(f"[PolicyService] Folder not found (skipping file ingest): {folder}")
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
                    print(f"  [OK] Ingested: {title} [{len(content)} chars, {len(img_ids)} images]")
                else:
                    print(f"  [OK] Ingested: {title} [{len(content)} chars, no images]")

                ingested += 1

            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(str(e))
            print(f"[PolicyService] Ingestion error: {e}")
        finally:
            db.close()

        result = {"ingested": ingested, "skipped": skipped, "errors": errors}
        print(f"[PolicyService] Ingest done: {result}")
        return result


    # ── Chunking & Embedding ──────────────────────────────────────────────────

    @staticmethod
    def _chunk_and_embed(policy: Policy, db, chunk_images: dict = None):
        """
        Internal: chunk one Policy and store PolicyChunk rows in the given session.
        Uses sentence-aware chunking (~400 tokens, 2-sentence overlap).
        Embedding is best-effort — chunks are stored even without embeddings.
        chunk_images: optional {chunk_index: [PolicyImage.id, ...]} mapping
        """
        from app.models import PolicyChunk

        db.query(PolicyChunk).filter(PolicyChunk.policy_id == policy.id).delete()

        chunks = _chunk_text_sentences(policy.content or "")
        for i, chunk_text_val in enumerate(chunks):
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
        return len(chunks)

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
                print(f"  [OK] Chunked '{p.title}': {n} chunks")
            db.commit()
            print(f"[PolicyService] Bootstrap complete — {total_chunks} total chunks stored.")
        except Exception as e:
            db.rollback()
            print(f"[PolicyService] embed_all_policies error: {e}")
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
    def search_policies(query: str, limit: int = 4) -> str:
        """
        Hybrid BM25 + pgvector search with Reciprocal Rank Fusion.

        1. Semantic search (pgvector cosine distance, top-20 candidates)
        2. BM25 keyword search (PostgreSQL tsvector/tsquery, top-20 candidates)
        3. RRF fusion of both ranked lists
        4. Fallback: keyword search on chunks/policies if no embeddings available
        Returns top `limit` (default 4) unique-policy chunks.
        """
        from app.models import PolicyChunk
        from sqlalchemy import text as sql_text
        from app.models import SCHEMA

        query, did_you_mean = _expand_query(query)

        db = SessionLocal()
        try:
            query_keywords = [w for w in query.lower().split() if len(w) > 2]
            policy_title_map = {p.id: (p.title or "").lower() for p in db.query(Policy).all()}

            sem_ids: list = []
            bm25_ids: list = []

            # ── 1. Semantic search via pgvector ───────────────────────────────
            query_emb = PolicyService._get_embedding(query)
            if query_emb:
                dist_expr = PolicyChunk.embedding.cosine_distance(query_emb)
                sem_rows = (
                    db.query(PolicyChunk.id, dist_expr.label("dist"))
                    .filter(
                        PolicyChunk.embedding.isnot(None),
                        dist_expr < 0.65,
                    )
                    .order_by(dist_expr)
                    .limit(20)
                    .all()
                )
                sem_ids = [r.id for r in sem_rows]

            # ── 2. BM25 keyword search via tsvector ───────────────────────────
            try:
                bm25_rows = db.execute(
                    sql_text(
                        f"SELECT id FROM \"{SCHEMA}\".policy_chunks "
                        f"WHERE text_tsv IS NOT NULL "
                        f"AND text_tsv @@ plainto_tsquery('english', :q) "
                        f"ORDER BY ts_rank(text_tsv, plainto_tsquery('english', :q)) DESC "
                        f"LIMIT 20"
                    ),
                    {"q": query},
                ).fetchall()
                bm25_ids = [r[0] for r in bm25_rows]
            except Exception as bm25_err:
                print(f"[PolicyService] BM25 search skipped: {bm25_err}")

            # ── 3. RRF fusion ─────────────────────────────────────────────────
            if sem_ids or bm25_ids:
                fused_scores = PolicyService._rrf_fuse(sem_ids, bm25_ids)
                all_fused_ids = list(fused_scores.keys())

                # Apply title-keyword boost to top-8 candidates
                candidate_ids = all_fused_ids[:8]
                chunks_by_id = {
                    c.id: c for c in db.query(PolicyChunk).filter(PolicyChunk.id.in_(candidate_ids)).all()
                }
                reranked = []
                for cid in candidate_ids:
                    c = chunks_by_id.get(cid)
                    if c is None or PolicyService._is_metadata_chunk(c.text):
                        continue
                    title = policy_title_map.get(c.policy_id, "")
                    title_bonus = sum(
                        0.1 for kw in query_keywords
                        if kw in title and kw not in ("policy", "what", "the", "for", "and")
                    )
                    final_score = fused_scores[cid] + title_bonus
                    reranked.append((final_score, c))

                reranked.sort(key=lambda x: x[0], reverse=True)

                seen_policies: set = set()
                results = []
                all_image_keys: list = []
                for _, c in reranked:
                    if len(results) >= limit:
                        break
                    if c.policy_id in seen_policies:
                        continue
                    policy = db.query(Policy).filter(Policy.id == c.policy_id).first()
                    if policy:
                        seen_policies.add(c.policy_id)
                        clean_text = PolicyService._strip_metadata_lines(c.text)
                        results.append(
                            f"**{policy.title}** ({policy.category}):\n{clean_text}"
                        )
                        if c.image_urls:
                            all_image_keys.extend(c.image_urls)

                if results:
                    text = "\n\n---\n\n".join(results)
                    return PolicyService._append_image_marker(text, all_image_keys)

            # ── 4. Keyword fallback on chunks ──────────────────────────────────
            chunks_all = db.query(PolicyChunk).all()
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
                    results = []
                    all_image_keys: list = []
                    for _, c in scored:
                        if len(results) >= limit:
                            break
                        if c.policy_id in seen_policies:
                            continue
                        policy = db.query(Policy).filter(Policy.id == c.policy_id).first()
                        if policy:
                            seen_policies.add(c.policy_id)
                            clean_text = PolicyService._strip_metadata_lines(c.text)
                            results.append(
                                f"**{policy.title}** ({policy.category}):\n{clean_text}"
                            )
                            if c.image_urls:
                                all_image_keys.extend(c.image_urls)

                    if results:
                        text = "\n\n---\n\n".join(results)
                        return PolicyService._append_image_marker(text, all_image_keys)

            # ── 5. Last resort: keyword search on full Policy.content ──────────
            fallback = PolicyService._fallback_policy_search(query, db, limit)
            if fallback.startswith("No policies found") and did_you_mean:
                return f"I couldn't find a policy matching your query. Did you mean **{did_you_mean}**? Please try again with the correct term."
            return fallback

        finally:
            db.close()

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
    def _fallback_policy_search(query: str, db, limit: int = 2) -> str:
        """Keyword search directly on Policy.content — no chunks needed."""
        keywords = PolicyService._expand_keywords(query)
        policies = db.query(Policy).all()
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
