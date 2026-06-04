"""One-off: ingest the GHI policy PDF into the policy store (TEMP, safe to delete).

Uses the SAME pipeline as the SharePoint sync (pdfplumber extract -> Policy ->
_chunk_and_embed). Idempotent: re-running replaces the existing row by source_key.

Usage:
    .\\venv\\Scripts\\python.exe _ingest_ghi.py "C:\\path\\to\\AASPL GHI Policy_2025-26.pdf"
"""
import io
import sys
import datetime
import pdfplumber

from app.database import SessionLocal
from app.models import Policy
from app.services.policy_service import PolicyService

SOURCE_KEY = "manual:ghi-policy-2025-26"
TITLE = "AASPL GHI Policy 2025-26"
CATEGORY = "HR General"


def main(pdf_path: str):
    with open(pdf_path, "rb") as f:
        data = f.read()
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages).strip()
    if len(text) < 100:
        print(f"ERROR: extracted only {len(text)} chars — bad PDF?")
        return
    print(f"Extracted {len(text)} chars from {pdf_path}")

    db = SessionLocal()
    try:
        # Idempotent: drop any prior version (CASCADE removes its chunks)
        db.query(Policy).filter(Policy.source_key == SOURCE_KEY).delete()
        db.flush()

        policy = Policy(
            title=TITLE,
            category=CATEGORY,
            content=text[:200000],   # generous cap so claims/TAT pages are all chunked
            source_key=SOURCE_KEY,
            source_etag="manual",
            updated_at=datetime.datetime.utcnow(),
        )
        db.add(policy)
        db.flush()
        n = PolicyService._chunk_and_embed(policy, db)
        db.commit()
        print(f"Ingested '{TITLE}' -> {n} chunks (id={policy.id})")
    except Exception as e:
        db.rollback()
        print(f"INGEST ERROR: {type(e).__name__}: {e}")
        return
    finally:
        db.close()

    print("\n=== verify: search 'tat for settlement' ===")
    print((PolicyService.search_policies("tat for settlement", limit=2) or "<empty>")[:800])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python _ingest_ghi.py "C:\\path\\to\\AASPL GHI Policy_2025-26.pdf"')
        sys.exit(1)
    main(sys.argv[1])
