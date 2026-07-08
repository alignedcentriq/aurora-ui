"""Backfill vector embeddings for Project IQ DNA profiles.

Each ProjectProfile stores a `dna_summary` (built at extraction time) but the
`embedding` column is NULL whenever the embedding model (ml01) was unavailable
during the build. Without a vector, semantic "Have we built this before?" search
can't rank that profile and silently falls back to keyword matching.

This script embeds each profile's existing `dna_summary` and stores the vector.
It is:
  - idempotent   — only touches profiles whose embedding IS NULL (pass --all to redo)
  - gentle       — sequential, with exponential backoff so it rides out transient
                   503 "server busy" responses instead of hammering a saturated ml01
  - resumable    — re-run any time; it picks up whatever is still missing

Usage (from the backend/ dir, with the venv active):
    venv/Scripts/python.exe backfill_project_iq_embeddings.py
    venv/Scripts/python.exe backfill_project_iq_embeddings.py --all       # re-embed everything
    venv/Scripts/python.exe backfill_project_iq_embeddings.py --retries 8 # ride out a busy window
"""
import argparse
import time

from app.database import SessionLocal
from app.models import ProjectProfile
from app.services.policy_service import PolicyService


def embed_with_backoff(text: str, max_retries: int, base_delay: float = 3.0):
    """Return an embedding, retrying with exponential backoff on failure.

    PolicyService._get_embedding returns None on any failure (incl. 503 busy),
    so we treat None as "try again later" up to max_retries."""
    for attempt in range(1, max_retries + 1):
        emb = PolicyService._get_embedding(text)
        if emb is not None:
            return emb
        if attempt < max_retries:
            delay = base_delay * (2 ** (attempt - 1))
            print(f"      embed server busy (attempt {attempt}/{max_retries}) — waiting {delay:.0f}s")
            time.sleep(delay)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="Re-embed every profile, not just those missing a vector.")
    ap.add_argument("--retries", type=int, default=6,
                    help="Max embed attempts per profile before skipping (default 6).")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        q = db.query(ProjectProfile)
        if not args.all:
            q = q.filter(ProjectProfile.embedding.is_(None))
        profiles = q.order_by(ProjectProfile.name).all()

        total = len(profiles)
        if total == 0:
            print("Nothing to do — all profiles already have embeddings.")
            return

        print(f"Backfilling embeddings for {total} profile(s)"
              f"{' (forced --all)' if args.all else ' missing a vector'}...\n")

        done = 0
        skipped = []
        for i, p in enumerate(profiles, 1):
            summary = (p.dna_summary or "").strip()
            if not summary:
                print(f"[{i}/{total}] {p.name}: no dna_summary — skip (rebuild DNA first)")
                skipped.append(p.name)
                continue
            print(f"[{i}/{total}] {p.name}: embedding {len(summary)} chars...")
            emb = embed_with_backoff(summary, max_retries=args.retries)
            if emb is None:
                print(f"      FAILED — embed server unavailable, leaving NULL")
                skipped.append(p.name)
                continue
            p.embedding = emb
            db.commit()               # commit per-profile so partial progress survives
            done += 1
            print(f"      OK (dim={len(emb)})")

        print(f"\nDone. Embedded {done}/{total}. Still missing: {len(skipped)}")
        if skipped:
            print("  " + ", ".join(skipped))
            print("Re-run this script (optionally with a higher --retries) during a "
                  "quieter window to finish the rest.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
