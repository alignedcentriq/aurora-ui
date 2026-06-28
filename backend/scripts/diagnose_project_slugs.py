"""Diagnostic: compare sp:PROJECT/* slugs in the DB against live SharePoint folders.

Prints three groups:
  LIVE      — folders in SharePoint AND chunks in DB (healthy)
  ORPHANED  — chunks in DB with NO matching SharePoint folder (stale, should be pruned)
  NEW       — SharePoint folders with NO chunks in DB yet (need a sync run)

Run from backend/:
    python -m scripts.diagnose_project_slugs
"""

import sys
from app.config import settings
from app.database import SessionLocal
from app.models import Policy, ProjectProfile
from app.services.sharepoint_project_sync import _list_project_folders, _project_slug
from app.graph_sync import sp_client

_KEY_PREFIX = "sp:PROJECT/"


def main():
    site_url = settings.SHAREPOINT_SITE_URL
    root = (getattr(settings, "SHAREPOINT_PROJECTS_ROOT", "") or "").strip().strip("/")

    if not site_url or not root:
        print("ERROR: SHAREPOINT_SITE_URL or SHAREPOINT_PROJECTS_ROOT not configured.")
        sys.exit(1)

    # ── 1. Slugs currently in DB ──────────────────────────────────────────────
    db = SessionLocal()
    try:
        rows = (
            db.query(Policy.source_key)
            .filter(Policy.source_key.like(f"{_KEY_PREFIX}%"))
            .all()
        )
        chunk_slugs: set[str] = set()
        for (sk,) in rows:
            parts = (sk or "").split("/")
            if len(parts) >= 2:
                chunk_slugs.add(parts[1])

        dna_rows = db.query(ProjectProfile.project_slug).all()
        dna_slugs: set[str] = {r[0] for r in dna_rows}
    finally:
        db.close()

    # ── 2. Slugs currently in SharePoint ─────────────────────────────────────
    try:
        site_id = sp_client.get_site_id(site_url)
        drive_id = sp_client.get_drive_id(site_id)
        sp_folders = _list_project_folders(drive_id, root)
    except Exception as e:
        print(f"ERROR reaching SharePoint: {e}")
        sys.exit(1)

    sp_slugs: dict[str, str] = {_project_slug(name): name for name in sp_folders}

    # ── 3. Compare ────────────────────────────────────────────────────────────
    live      = chunk_slugs & sp_slugs.keys()
    orphaned  = chunk_slugs - sp_slugs.keys()
    new_sp    = sp_slugs.keys() - chunk_slugs

    print(f"\n{'='*60}")
    print(f"  Project slug audit")
    print(f"  SharePoint root: {root}")
    print(f"{'='*60}")

    print(f"\n✅ LIVE ({len(live)}) — in SharePoint + have chunks in DB:")
    for slug in sorted(live):
        has_dna = "  [DNA ✓]" if slug in dna_slugs else "  [DNA missing — rebuild needed]"
        print(f"    {slug}{has_dna}")

    print(f"\n⚠️  ORPHANED ({len(orphaned)}) — chunks in DB but folder GONE from SharePoint:")
    for slug in sorted(orphaned):
        has_dna = "  [DNA row exists]" if slug in dna_slugs else ""
        print(f"    {slug}{has_dna}  ← will be pruned on next sync")

    print(f"\n🆕 NEW ({len(new_sp)}) — SharePoint folder exists but NO chunks in DB yet:")
    for slug in sorted(new_sp):
        print(f"    {slug}  (folder: {sp_slugs[slug]})  ← needs a sync run")

    print(f"\n{'='*60}")
    print("Action summary:")
    if orphaned:
        print(f"  Run POST /api/sharepoint/sync-projects (or python -m scripts.sync_projects)")
        print(f"  → will prune {len(orphaned)} orphaned project(s) + their DNA")
    if new_sp:
        print(f"  Same sync will ingest {len(new_sp)} new project(s)")
    if any(slug not in dna_slugs for slug in live):
        missing_dna = [s for s in live if s not in dna_slugs]
        print(f"  Run POST /api/project-iq/rebuild-all to build DNA for {len(missing_dna)} project(s) missing it")
    if not orphaned and not new_sp:
        print("  Everything looks clean!")
    print()


if __name__ == "__main__":
    main()
