"""One-shot: re-key + ingest the Projects tree, then verify DNA was built.

Runs the (now routing-aware) sync_projects(), which ingests every routed file
under per-file project keys, prunes stale slugs, and builds DNA for each changed
project. Prints a final summary and a DNA count so the foundation run is auditable.

Run from backend/:
    python -m scripts.run_project_foundation
"""

import logging
from app.services.sharepoint_project_sync import sync_projects
from app.database import SessionLocal
from app.models import ProjectProfile

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

print(">>> Starting project foundation sync (re-key + ingest + DNA build)...", flush=True)
result = sync_projects()
print(">>> SYNC RESULT:", flush=True)
for k, v in result.items():
    if k == "errors":
        print(f"    errors: {len(v)}")
        for e in v[:10]:
            print(f"      - {e}")
    else:
        print(f"    {k}: {v}")

db = SessionLocal()
try:
    total = db.query(ProjectProfile).count()
    with_caps = db.query(ProjectProfile).filter(ProjectProfile.embedding.isnot(None)).count()
    sample = db.query(ProjectProfile.name, ProjectProfile.confidence).limit(8).all()
finally:
    db.close()

print(f">>> DNA profiles now in DB: {total}  (with embedding: {with_caps})", flush=True)
print(">>> sample:", flush=True)
for name, conf in sample:
    print(f"      [{conf}] {name}")
print(">>> FOUNDATION_DONE", flush=True)
