"""PHASE 7 — RAG store evidence (read-only, TEMP, safe to delete).

Answers, with evidence: is the policy store empty, partially embedded, or fine?
And what does the REAL search return for the failing TAT query?
"""
from app.database import SessionLocal
from app.models import Policy, PolicyChunk
from app.services.policy_service import PolicyService

db = SessionLocal()
try:
    n_pol = db.query(Policy).count()
    n_chunk = db.query(PolicyChunk).count()
    n_embed = db.query(PolicyChunk).filter(PolicyChunk.embedding.isnot(None)).count()

    print("=== STORE COUNTS ===")
    print(f"  policies      : {n_pol}")
    print(f"  policy_chunks : {n_chunk}")
    print(f"  with embedding: {n_embed}")

    print("\n=== POLICY TITLES (up to 30) ===")
    for p in db.query(Policy).limit(30).all():
        clen = len(p.content or "")
        ch = db.query(PolicyChunk).filter(PolicyChunk.policy_id == p.id).count()
        print(f"  - {p.title!r}  (content={clen} chars, chunks={ch})")
    if n_pol == 0:
        print("  (no policies in DB)")
finally:
    db.close()

print("\n=== REAL SEARCH OUTPUT (what the agent's tool actually receives) ===")
for q in ["tat for settlement",
          "turnaround time for claim settlement",
          "health insurance claim settlement days"]:
    print(f"\n--- query: {q!r} ---")
    try:
        res = PolicyService.search_policies(q, limit=4)
        print((res or "<empty>")[:700])
    except Exception as e:
        print(f"  SEARCH ERROR: {type(e).__name__}: {e}")
