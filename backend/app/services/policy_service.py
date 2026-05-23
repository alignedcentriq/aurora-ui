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


def _safe_title(title: str) -> str:
    """Sanitize a policy title for use in a MinIO object key."""
    return re.sub(r'[^\w\-]', '_', title)[:60]


def _extract_images_from_pdf_bytes(data: bytes) -> list:
    """
    Return list of (page_index, image_bytes, ext) tuples.
    Skips images smaller than 4 KB (likely icons/decorations).
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
                if len(img_bytes) < 4096:
                    continue  # skip tiny decorative images
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
    Skips images smaller than 4 KB.
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
                if len(img_bytes) < 4096:
                    continue
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
                position_ratio = idx / max(total, 1)
                results.append((position_ratio, img_bytes, ext))
        return results
    except Exception as e:
        print(f"[PolicyService] DOCX image extraction error: {e}")
        return []


def _upload_policy_images(policy_id: int, title: str, raw_images: list, is_docx: bool = False) -> list:
    """
    Upload images to MinIO under policy-images/{safe_title}/.
    raw_images: list of (page_or_ratio, bytes, ext)
    Returns list of MinIO object keys.
    """
    from app.minio_client import minio_client
    safe = _safe_title(title)
    keys = []
    content_type_map = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                        "gif": "image/gif", "webp": "image/webp"}
    for idx, (_, img_bytes, ext) in enumerate(raw_images):
        key = f"policy-images/{safe}/{idx}.{ext}"
        ct = content_type_map.get(ext, "image/png")
        try:
            minio_client.upload_bytes(img_bytes, key, content_type=ct)
            keys.append(key)
        except Exception as e:
            print(f"[PolicyService] Image upload failed ({key}): {e}")
    return keys


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
                    img_keys = _upload_policy_images(policy.id, title, raw_images, is_docx=not is_pdf)
                    chunks_preview = _chunk_text_sentences(content[:50000])
                    assignment = _assign_images_to_chunks(
                        raw_images, len(chunks_preview), is_docx=not is_pdf
                    )
                    chunk_images = {
                        ci: [img_keys[ii] for ii in idxs if ii < len(img_keys)]
                        for ci, idxs in assignment.items()
                        if idxs
                    }
                    PolicyService._chunk_and_embed(policy, db, chunk_images=chunk_images)
                    print(f"  [OK] Ingested: {title} [{len(content)} chars, {len(img_keys)} images]")
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

    # Canonical source bucket and prefixes for all policy documents
    POLICIES_BUCKET = "policies-bucket"
    POLICIES_PREFIXES = ("admin/", "it-support/", "hr/")

    # Maps MinIO folder prefix → fallback category when filename keywords don't match
    _PREFIX_CATEGORY = {
        "admin/": "Admin",
        "it-support/": "IT",
        "hr/": "HR General",
    }

    @staticmethod
    def sync_from_minio_buckets() -> dict:
        """
        Incremental sync across all policy bucket prefixes.
        Detects new files (never seen) and changed files (ETag differs) and re-ingests them.
        Returns aggregate counts: new, updated, skipped, errors.
        """
        total: dict = {"new": 0, "updated": 0, "skipped": 0, "errors": []}
        for prefix in PolicyService.POLICIES_PREFIXES:
            result = PolicyService.ingest_from_minio(prefix=prefix, bucket=PolicyService.POLICIES_BUCKET)
            total["new"] += result.get("new", 0)
            total["updated"] += result.get("updated", 0)
            total["skipped"] += result.get("skipped", 0)
            total["errors"] += result.get("errors", [])
        if total["new"] or total["updated"]:
            print(f"[PolicyService] Sync complete — new={total['new']} updated={total['updated']} skipped={total['skipped']}")
            # Embed any chunks that were added without embeddings
            PolicyService.embed_all_policies()
        return total

    @staticmethod
    def ingest_from_minio(prefix: str = "policies/", bucket: str = None) -> dict:
        """
        Incremental ingest from MinIO.
        - New file   (minio_key not in DB)         → ingest + chunk + embed
        - Changed file (ETag differs from stored)  → delete old policy+chunks, re-ingest
        - Unchanged file (same ETag)               → skip
        """
        from app.minio_client import minio_client

        if bucket is None:
            bucket = settings.MINIO_BUCKET_NAME

        prefix_category = PolicyService._PREFIX_CATEGORY.get(prefix)

        db = SessionLocal()
        new_count, updated_count, skipped, errors = 0, 0, 0, []
        try:
            # Build a lookup: minio_key → (policy_id, stored_etag)
            rows = db.query(Policy.id, Policy.minio_key, Policy.minio_etag).filter(
                Policy.minio_key.isnot(None)
            ).all()
            existing: dict = {r.minio_key: (r.id, r.minio_etag) for r in rows}

            objects = minio_client.list_objects(prefix=prefix, bucket=bucket)
            if not objects:
                print(f"[PolicyService] No objects in bucket='{bucket}' prefix='{prefix}'")
                return {"new": 0, "updated": 0, "skipped": 0, "errors": []}

            for obj in objects:
                object_name = obj["Key"]
                etag = obj.get("ETag", "").strip('"')
                filename = object_name.split("/")[-1]
                if not filename:
                    continue
                ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
                if ext not in ("pdf", "docx"):
                    continue

                is_new = object_name not in existing
                is_changed = (not is_new) and (existing[object_name][1] != etag)

                if not is_new and not is_changed:
                    skipped += 1
                    continue

                # Delete stale policy rows before re-ingesting (CASCADE removes chunks)
                if is_changed:
                    stale_id = existing[object_name][0]
                    db.query(Policy).filter(Policy.id == stale_id).delete()
                    db.flush()
                    print(f"  [UPDATE] ETag changed — replacing: {filename}")

                try:
                    file_bytes = minio_client.download_file(object_name, bucket=bucket)
                except Exception as e:
                    errors.append(f"Download failed ({filename}): {e}")
                    continue

                is_pdf = ext == "pdf"
                content = (
                    _extract_text_from_pdf_bytes(file_bytes)
                    if is_pdf
                    else _extract_text_from_docx_bytes(file_bytes)
                )
                if not content or len(content) < 50:
                    errors.append(f"Empty/too short: {filename}")
                    continue

                title = filename.rsplit(".", 1)[0].strip()
                category = _categorize(filename)
                if category == "General" and prefix_category:
                    category = prefix_category

                policy = Policy(
                    title=title,
                    category=category,
                    content=content[:50000],
                    minio_key=object_name,
                    minio_etag=etag,
                    updated_at=datetime.datetime.utcnow(),
                )
                db.add(policy)
                db.flush()

                # Extract images and assign to chunks
                raw_images = (
                    _extract_images_from_pdf_bytes(file_bytes)
                    if is_pdf
                    else _extract_images_from_docx_bytes(file_bytes)
                )
                chunk_images: dict = {}
                if raw_images:
                    img_keys = _upload_policy_images(policy.id, title, raw_images, is_docx=not is_pdf)
                    chunks_preview = _chunk_text_sentences(content[:50000])
                    assignment = _assign_images_to_chunks(
                        raw_images, len(chunks_preview), is_docx=not is_pdf
                    )
                    chunk_images = {
                        ci: [img_keys[ii] for ii in idxs if ii < len(img_keys)]
                        for ci, idxs in assignment.items()
                        if idxs
                    }

                PolicyService._chunk_and_embed(policy, db, chunk_images=chunk_images)
                img_count = len(raw_images) if raw_images else 0
                action = "NEW" if is_new else "UPDATED"
                print(f"  [{action}] {title} [{len(content)} chars, {img_count} images]")

                if is_new:
                    new_count += 1
                else:
                    updated_count += 1

            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(str(e))
            print(f"[PolicyService] MinIO ingest error: {e}")
        finally:
            db.close()

        result = {"new": new_count, "updated": updated_count, "skipped": skipped, "errors": errors}
        print(f"[PolicyService] Ingest '{prefix}': {result}")
        return result

    # ── Chunking & Embedding ──────────────────────────────────────────────────

    @staticmethod
    def _chunk_and_embed(policy: Policy, db, chunk_images: dict = None):
        """
        Internal: chunk one Policy and store PolicyChunk rows in the given session.
        Uses sentence-aware chunking (~400 tokens, 2-sentence overlap).
        Embedding is best-effort — chunks are stored even without embeddings.
        chunk_images: optional {chunk_index: [minio_key, ...]} mapping
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
        Append a [POLICY_IMG:key1||key2] marker to the result string when images exist.
        This marker lives in the ToolMessage (not the final AI response) so main.py
        can extract presigned URLs without them leaking into rendered chat text.
        """
        if not image_keys:
            return text
        return text + "\n\n[POLICY_IMG:" + "||".join(image_keys) + "]"

    # ── Metadata chunk detection ──────────────────────────────────────────────

    _METADATA_MARKERS = ["version", "review date", "owner", "approved by", "effective date", "document no", "document number"]

    @staticmethod
    def _is_metadata_chunk(text: str) -> bool:
        """Return True if the chunk is a document-control table with no real policy content."""
        lower = text.lower()
        hits = sum(1 for m in PolicyService._METADATA_MARKERS if m in lower)
        return hits >= 3 and len(text) < 600

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
                        updated = policy.updated_at.strftime("%d %b %Y") if policy.updated_at else "N/A"
                        results.append(
                            f"**{policy.title}** ({policy.category} · Last updated: {updated}):\n{c.text}"
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
                            updated = policy.updated_at.strftime("%d %b %Y") if policy.updated_at else "N/A"
                            results.append(
                                f"**{policy.title}** ({policy.category} · Last updated: {updated}):\n{c.text}"
                            )
                            if c.image_urls:
                                all_image_keys.extend(c.image_urls)

                    if results:
                        text = "\n\n---\n\n".join(results)
                        return PolicyService._append_image_marker(text, all_image_keys)

            # ── 5. Last resort: keyword search on full Policy.content ──────────
            return PolicyService._fallback_policy_search(query, db, limit)

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
            snippet = content[:500] + "..." if len(content) > 500 else content
            for kw in keywords:
                idx = content.lower().find(kw)
                if idx >= 0:
                    start = max(0, idx - 100)
                    snippet = "..." + content[start:min(len(content), idx + 400)] + "..."
                    break
            updated = p.updated_at.strftime("%d %b %Y") if p.updated_at else "N/A"
            results.append(f"**{p.title}** ({p.category} · Last updated: {updated}):\n{snippet}")

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
