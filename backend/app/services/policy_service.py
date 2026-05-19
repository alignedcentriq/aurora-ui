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


class PolicyService:

    # ── Synonym expansion for keyword fallback ────────────────────────────────
    _SYNONYMS: dict = {
        "hotel": ["accommodation", "hotel", "lodge", "stay", "lodging"],
        "hotels": ["accommodation", "hotel", "hotels", "lodge", "stay", "lodging"],
        "accommodation": ["accommodation", "hotel", "lodge", "stay"],
        "travel": ["travel", "trip", "journey", "relocation"],
        "reimburse": ["reimburse", "reimbursement", "claim", "expense", "certification", "certificate"],
        "reimbursement": ["reimburse", "reimbursement", "claim", "expense", "certification", "certificate"],
        "claim": ["claim", "reimburse", "reimbursement", "expense"],
        "medical": ["medical", "health", "practo", "doctor"],
        "cert": ["certification", "certificate", "training", "reimbursement", "reimburse"],
        "certification": ["certification", "certificate", "cert", "training", "reimbursement", "reimburse"],
        "certificate": ["certificate", "certification", "cert", "training", "reimbursement", "reimburse"],
    }

    # ── Embedding helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _get_embedding(text: str) -> list | None:
        """Call the configured embedding model. Returns None on any failure."""
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=settings.EMBEDDING_BASE_URL,
                api_key=settings.EMBEDDING_API_KEY,
            )
            resp = client.embeddings.create(
                input=text[:2000],
                model=settings.EMBEDDING_MODEL_NAME,
            )
            return resp.data[0].embedding
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

                if filepath.suffix.lower() == '.pdf':
                    content = _extract_text_from_pdf(str(filepath))
                else:
                    content = _extract_text_from_docx(str(filepath))

                if not content or len(content) < 50:
                    errors.append(f"Empty/too short: {filepath.name}")
                    continue

                policy = Policy(
                    title=title,
                    category=_categorize(filepath.name),
                    content=content[:50000],
                )
                db.add(policy)
                db.flush()  # get policy.id before committing
                ingested += 1
                print(f"  [OK] Ingested: {title} [{len(content)} chars]")

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

    @staticmethod
    def ingest_from_minio(prefix: str = "policies/") -> dict:
        """
        List all PDF/DOCX objects under `prefix` in MinIO, download each,
        extract text, and upsert as Policy rows.
        Skips files already ingested (matched by title).
        Does not chunk/embed — call embed_all_policies() after.
        """
        from app.minio_client import minio_client

        db = SessionLocal()
        ingested, skipped, errors = 0, 0, []
        try:
            existing_titles = {p.title for p in db.query(Policy.title).all()}
            objects = minio_client.list_objects(prefix=prefix)

            if not objects:
                print(f"[PolicyService] No objects found in MinIO under '{prefix}'")
                return {"ingested": 0, "skipped": 0, "errors": []}

            for obj in objects:
                object_name = obj["Key"]
                filename = object_name.split("/")[-1]
                if not filename:
                    continue
                ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
                if ext not in ("pdf", "docx"):
                    continue

                title = filename.rsplit(".", 1)[0].strip()
                if title in existing_titles:
                    skipped += 1
                    continue

                try:
                    file_bytes = minio_client.download_file(object_name)
                except Exception as e:
                    errors.append(f"Download failed ({filename}): {e}")
                    continue

                content = (
                    _extract_text_from_pdf_bytes(file_bytes)
                    if ext == "pdf"
                    else _extract_text_from_docx_bytes(file_bytes)
                )
                if not content or len(content) < 50:
                    errors.append(f"Empty/too short: {filename}")
                    continue

                db.add(Policy(
                    title=title,
                    category=_categorize(filename),
                    content=content[:50000],
                ))
                db.flush()
                existing_titles.add(title)
                ingested += 1
                print(f"  [OK] Ingested from MinIO: {title} [{len(content)} chars]")

            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(str(e))
            print(f"[PolicyService] MinIO ingest error: {e}")
        finally:
            db.close()

        result = {"ingested": ingested, "skipped": skipped, "errors": errors}
        print(f"[PolicyService] MinIO ingest done: {result}")
        return result

    # ── Chunking & Embedding ──────────────────────────────────────────────────

    @staticmethod
    def _chunk_and_embed(policy: Policy, db):
        """
        Internal: chunk one Policy and store PolicyChunk rows in the given session.
        Embedding is best-effort — chunks are stored even without embeddings.
        """
        from app.models import PolicyChunk

        db.query(PolicyChunk).filter(PolicyChunk.policy_id == policy.id).delete()

        chunks = _chunk_text(policy.content or "")
        for i, chunk_text in enumerate(chunks):
            # Prepend the title so the embedding captures document context
            embed_input = f"{policy.title}\n\n{chunk_text}"
            emb = PolicyService._get_embedding(embed_input)
            db.add(PolicyChunk(
                policy_id=policy.id,
                chunk_index=i,
                text=chunk_text,
                embedding=emb,
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
    def search_policies(query: str, limit: int = 2) -> str:
        """
        Search policy chunks.
        1. Try semantic search via cosine similarity on stored embeddings,
           with a title-keyword boost so the best-named policy wins.
        2. Fall back to keyword search on chunk text (synonyms expanded).
        3. Last resort: keyword search on full Policy.content.
        All data comes from the database — no file system access.
        """
        from app.models import PolicyChunk
        db = SessionLocal()
        try:
            query_keywords = [w for w in query.lower().split() if len(w) > 2]
            # Pre-load policy titles for cheap title-boost scoring
            policy_title_map = {p.id: (p.title or "").lower() for p in db.query(Policy).all()}

            # ── 1. Semantic search via pgvector ───────────────────────────────
            query_emb = PolicyService._get_embedding(query)
            if query_emb:
                dist_expr = PolicyChunk.embedding.cosine_distance(query_emb)
                candidates = (
                    db.query(PolicyChunk, dist_expr.label("dist"))
                    .filter(
                        PolicyChunk.embedding.isnot(None),
                        dist_expr < 0.7,
                    )
                    .order_by(dist_expr)
                    .limit(limit * 10)
                    .all()
                )
                scored = []
                for c, distance in candidates:
                    if PolicyService._is_metadata_chunk(c.text):
                        continue
                    title = policy_title_map.get(c.policy_id, "")
                    title_bonus = sum(0.2 for kw in query_keywords if kw in title)
                    scored.append((1 - distance + title_bonus, c))

                scored.sort(key=lambda x: x[0], reverse=True)

                if scored:
                    seen_policies: set = set()
                    results = []
                    for _, c in scored:
                        if len(results) >= limit:
                            break
                        if c.policy_id in seen_policies:
                            continue
                        policy = db.query(Policy).filter(Policy.id == c.policy_id).first()
                        if policy:
                            seen_policies.add(c.policy_id)
                            updated = policy.updated_at.strftime("%d %b %Y") if policy.updated_at else "N/A"
                            results.append(f"**{policy.title}** ({policy.category} · Last updated: {updated}):\n{c.text}")

                    if results:
                        return "\n\n---\n\n".join(results)

            # ── 2. Keyword search on chunks ───────────────────────────────────
            chunks_all = db.query(PolicyChunk).all()
            if chunks_all:
                keywords = PolicyService._expand_keywords(query)
                scored = []
                for c in chunks_all:
                    if PolicyService._is_metadata_chunk(c.text):
                        continue
                    lower = c.text.lower()
                    # Title match counts heavily here too
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
                    for _, c in scored:
                        if len(results) >= limit:
                            break
                        if c.policy_id in seen_policies:
                            continue
                        policy = db.query(Policy).filter(Policy.id == c.policy_id).first()
                        if policy:
                            seen_policies.add(c.policy_id)
                            updated = policy.updated_at.strftime("%d %b %Y") if policy.updated_at else "N/A"
                            results.append(f"**{policy.title}** ({policy.category} · Last updated: {updated}):\n{c.text}")

                    if results:
                        return "\n\n---\n\n".join(results)

            # ── 3. Last resort: keyword search on full Policy.content ─────────
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
