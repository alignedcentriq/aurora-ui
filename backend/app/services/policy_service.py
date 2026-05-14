"""
Policy Ingestion & Search Service for Centriq AI.

Reads PDFs and DOCX files from the OneDrive folder, extracts text,
chunks it, and stores it in the Policy + PolicyChunk tables for
keyword-based search by agents.
"""

import os
import re
import datetime
from pathlib import Path
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Policy

# ── Constants ─────────────────────────────────────────────────────────────────
POLICY_DIR = Path(__file__).resolve().parent.parent.parent / "OneDrive_1_12-5-2026"
CHUNK_SIZE = 800  # characters per chunk (roughly ~200 words)
CHUNK_OVERLAP = 100  # overlap between consecutive chunks

# ── Category mapping based on filename keywords ──────────────────────────────
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
    """Determine the policy category from its filename."""
    lower = filename.lower()
    for keyword, category in CATEGORY_MAP.items():
        if keyword in lower:
            return category
    return "General"


def _extract_text_from_pdf(filepath: str) -> str:
    """Extract text from a PDF file using pdfplumber."""
    try:
        import pdfplumber
        text_parts = []
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        return "\n".join(text_parts)
    except Exception as e:
        print(f"[PolicyService] Error reading PDF {filepath}: {e}")
        return ""


def _extract_text_from_docx(filepath: str) -> str:
    """Extract text from a DOCX file using python-docx."""
    try:
        from docx import Document
        doc = Document(filepath)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        print(f"[PolicyService] Error reading DOCX {filepath}: {e}")
        return ""


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    """Split text into overlapping chunks."""
    if not text:
        return []
    
    # Clean up whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start = end - overlap
    return chunks


class PolicyService:
    @staticmethod
    def ingest_policies_from_folder(folder_path: str = None):
        """
        Scan the OneDrive folder for policy documents, extract text,
        and store them in the Policy table.
        
        Only ingests files that haven't been ingested yet (by title match).
        """
        folder = Path(folder_path) if folder_path else POLICY_DIR
        if not folder.exists():
            print(f"[PolicyService] Policy folder not found: {folder}")
            return {"ingested": 0, "skipped": 0, "errors": []}
        
        db = SessionLocal()
        ingested = 0
        skipped = 0
        errors = []
        
        try:
            existing_titles = {p.title for p in db.query(Policy.title).all()}
            
            for filepath in sorted(folder.iterdir()):
                if filepath.suffix.lower() not in ('.pdf', '.docx'):
                    continue
                
                title = filepath.stem.strip()
                
                if title in existing_titles:
                    skipped += 1
                    continue
                
                # Extract text
                if filepath.suffix.lower() == '.pdf':
                    content = _extract_text_from_pdf(str(filepath))
                elif filepath.suffix.lower() == '.docx':
                    content = _extract_text_from_docx(str(filepath))
                else:
                    continue
                
                if not content or len(content) < 50:
                    errors.append(f"Empty/too short: {filepath.name}")
                    continue
                
                category = _categorize(filepath.name)
                
                # Store the full policy
                policy = Policy(
                    title=title,
                    category=category,
                    content=content[:50000],  # cap at 50k chars
                )
                db.add(policy)
                ingested += 1
                print(f"  ✓ Ingested: {title} ({category}) [{len(content)} chars]")
            
            db.commit()
        except Exception as e:
            db.rollback()
            errors.append(str(e))
            print(f"[PolicyService] Ingestion error: {e}")
        finally:
            db.close()
        
        result = {"ingested": ingested, "skipped": skipped, "errors": errors}
        print(f"[PolicyService] Done: {result}")
        return result

    @staticmethod
    def search_policies(query: str, limit: int = 3) -> str:
        """
        Search policies by keyword matching against title and content.
        Returns the most relevant chunks for the agent to use.
        """
        db = SessionLocal()
        try:
            query_lower = query.lower()
            keywords = [w for w in query_lower.split() if len(w) > 2]
            
            policies = db.query(Policy).all()
            if not policies:
                return "No policies found in the system."
            
            # Score each policy by keyword relevance
            scored = []
            for p in policies:
                score = 0
                title_lower = (p.title or "").lower()
                content_lower = (p.content or "").lower()
                
                for kw in keywords:
                    if kw in title_lower:
                        score += 10  # title match weighted higher
                    if kw in content_lower:
                        score += content_lower.count(kw)
                
                if score > 0:
                    scored.append((score, p))
            
            if not scored:
                return f"No policies found matching '{query}'. Try different keywords."
            
            # Sort by score, take top results
            scored.sort(key=lambda x: x[0], reverse=True)
            top_policies = scored[:limit]
            
            results = []
            for score, p in top_policies:
                # Extract a relevant snippet (first 500 chars around first keyword match)
                content = p.content or ""
                snippet = ""
                for kw in keywords:
                    idx = content.lower().find(kw)
                    if idx >= 0:
                        start = max(0, idx - 100)
                        end = min(len(content), idx + 400)
                        snippet = "..." + content[start:end] + "..."
                        break
                
                if not snippet:
                    snippet = content[:500] + "..."
                
                results.append(f"**{p.title}** ({p.category}):\n{snippet}")
            
            return "\n\n---\n\n".join(results)
        finally:
            db.close()

    @staticmethod
    def list_policies() -> str:
        """List all available policy documents."""
        db = SessionLocal()
        try:
            policies = db.query(Policy).all()
            if not policies:
                return "No policies found."
            
            lines = [f"- {p.title} ({p.category})" for p in policies]
            return f"Available policies ({len(policies)} documents):\n" + "\n".join(lines)
        finally:
            db.close()
