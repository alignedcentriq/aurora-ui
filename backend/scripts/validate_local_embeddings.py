"""
Full-corpus validation: local (fastembed) vs. remote (ml01) embeddings.

Per docs/specs/2026-07-21-local-embedding-backend-design.md — before flipping
EMBEDDING_BACKEND to "local" anywhere, every existing PolicyChunk and CachedAnswer row is
re-embedded locally and compared (cosine similarity) against its already-stored (remote-
generated) vector for the exact same text. Reports a similarity distribution and flags rows
below a threshold, so we know whether a full re-embed is needed before cutover — rather than
assuming compatibility.

Read-only: never writes to the DB. Fetches all rows up front and closes the DB session before
the (slow, minutes-long) local-embedding loop, so a long-idle connection is never held open.
Run from backend/: `python -m scripts.validate_local_embeddings`
"""

import sys
import time

from app.database import SessionLocal
from app.models import Policy, PolicyChunk, CachedAnswer
from app.services import local_embedding_service
from app.services.vector_utils import cosine, to_list

SIMILARITY_THRESHOLD = 0.90


def _percentile(sorted_vals: list, pct: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, int(pct * len(sorted_vals)))
    return sorted_vals[idx]


def _print_result(name: str, result: dict):
    print("\n" + "=" * 60)
    print(name)
    print("=" * 60)
    for k, v in result.items():
        if k != "flagged_sample":
            print(f"  {k}: {v}")
    if result.get("flagged_sample"):
        print("  flagged sample:")
        for f in result["flagged_sample"]:
            print(f"    - {f}")
    sys.stdout.flush()


def fetch_policy_chunk_rows() -> list:
    """Fetch everything needed for chunk validation, then close the session immediately —
    the embedding loop takes minutes and must not hold a DB connection open that long."""
    db = SessionLocal()
    try:
        title_by_id = {p.id: p.title for p in db.query(Policy.id, Policy.title).all()}
        chunks = db.query(PolicyChunk).filter(PolicyChunk.embedding.isnot(None)).all()
        rows = [
            {
                "policy_id": c.policy_id,
                "chunk_id": c.id,
                "title": title_by_id.get(c.policy_id, ""),
                "text": c.text,
                "stored_vec": to_list(c.embedding),
            }
            for c in chunks
        ]
        return rows
    finally:
        db.close()


def fetch_cached_answer_rows() -> list:
    db = SessionLocal()
    try:
        rows = db.query(CachedAnswer).filter(CachedAnswer.query_embedding.isnot(None)).all()
        return [
            {"id": r.id, "query_text": r.query_text, "stored_vec": to_list(r.query_embedding)}
            for r in rows
        ]
    finally:
        db.close()


def validate_policy_chunks(rows: list) -> dict:
    print(f"Validating {len(rows)} policy chunks...")
    sims: list = []
    flagged: list = []
    t0 = time.time()
    for i, row in enumerate(rows):
        embed_input = f"{row['title']}\n\n{row['text']}"
        local_vec = local_embedding_service.embed(embed_input)
        if local_vec is None or row["stored_vec"] is None:
            continue
        sim = cosine(local_vec, row["stored_vec"])
        sims.append(sim)
        if sim < SIMILARITY_THRESHOLD:
            flagged.append({"policy_id": row["policy_id"], "chunk_id": row["chunk_id"],
                             "title": row["title"], "similarity": round(sim, 4)})
        if (i + 1) % 500 == 0:
            print(f"  ...{i + 1}/{len(rows)}")
            sys.stdout.flush()

    elapsed = time.time() - t0
    sims_sorted = sorted(sims)
    return {
        "count": len(sims),
        "elapsed_s": round(elapsed, 1),
        "mean": round(sum(sims) / len(sims), 4) if sims else 0.0,
        "min": round(min(sims), 4) if sims else 0.0,
        "max": round(max(sims), 4) if sims else 0.0,
        "p10": round(_percentile(sims_sorted, 0.10), 4),
        "p50": round(_percentile(sims_sorted, 0.50), 4),
        "flagged_count": len(flagged),
        "flagged_pct": round(100 * len(flagged) / len(sims), 2) if sims else 0.0,
        "flagged_sample": flagged[:15],
    }


def validate_cached_answers(rows: list) -> dict:
    print(f"Validating {len(rows)} cached answers...")
    sims: list = []
    flagged: list = []
    for row in rows:
        local_vec = local_embedding_service.embed(row["query_text"])
        if local_vec is None or row["stored_vec"] is None:
            continue
        sim = cosine(local_vec, row["stored_vec"])
        sims.append(sim)
        if sim < SIMILARITY_THRESHOLD:
            flagged.append({"id": row["id"], "query_text": row["query_text"][:80],
                             "similarity": round(sim, 4)})

    return {
        "count": len(sims),
        "mean": round(sum(sims) / len(sims), 4) if sims else 0.0,
        "min": round(min(sims), 4) if sims else 0.0,
        "max": round(max(sims), 4) if sims else 0.0,
        "flagged_count": len(flagged),
        "flagged_sample": flagged,
    }


def main():
    print("Fetching rows from DB...")
    chunk_rows = fetch_policy_chunk_rows()
    cached_rows = fetch_cached_answer_rows()
    print(f"Fetched {len(chunk_rows)} chunks, {len(cached_rows)} cached answers. DB connection closed.")

    print("Preloading local embedding model...")
    if not local_embedding_service.preload():
        print("FATAL: local embedding model failed to load.")
        sys.exit(1)

    chunk_result = validate_policy_chunks(chunk_rows)
    _print_result("POLICY CHUNKS", chunk_result)

    cached_result = validate_cached_answers(cached_rows)
    _print_result("CACHED ANSWERS", cached_result)

    print("\n" + "=" * 60)
    if chunk_result["count"] and chunk_result["mean"] >= SIMILARITY_THRESHOLD and chunk_result["flagged_pct"] < 5:
        print("VERDICT: Vectors are highly comparable — cutover should NOT require a full re-embed.")
    else:
        print("VERDICT: Vectors diverge meaningfully from the remote backend — plan a full")
        print("         re-embed of policy_chunks / cached_answers before or during cutover.")


if __name__ == "__main__":
    main()
