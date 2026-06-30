"""DRY RUN: show how the Projects tree routes to Project IQ projects.

Lists every file under SHAREPOINT_PROJECTS_ROOT, applies _route_file, and prints:
  - projects that WILL be built (slug, name, file count), grouped by source area
  - files SKIPPED, grouped by their top-level folder (Newsletters, Policy, ...)
  - DB project slugs that WOULD BE PRUNED (present now, no longer routed)

Writes NOTHING. Run from backend/:
    python -m scripts.dryrun_project_routing
"""

import sys
from collections import defaultdict

from app.config import settings
from app.database import SessionLocal
from app.models import Policy, ProjectProfile
from app.graph_sync import sp_client
from app.services.sharepoint_project_sync import _route_file, _exts


def main():
    site_url = settings.SHAREPOINT_SITE_URL
    root = (getattr(settings, "SHAREPOINT_PROJECTS_ROOT", "") or "").strip().strip("/")
    if not site_url or not root:
        print("ERROR: SHAREPOINT_SITE_URL or SHAREPOINT_PROJECTS_ROOT not configured.")
        sys.exit(1)

    exts = _exts()
    site_id = sp_client.get_site_id(site_url)
    drive_id = sp_client.get_drive_id(site_id)
    items = sp_client.list_files_recursive(drive_id, root)

    routed = defaultdict(lambda: {"name": "", "area": "", "files": 0})
    skipped = defaultdict(int)
    skipped_ext = 0

    for it in items:
        name = it.get("name", "")
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        rel = it.get("relative_path", name)
        top = rel.split("/")[0] if "/" in rel else "(root)"
        if ext not in exts:
            skipped_ext += 1
            continue
        route = _route_file(rel)
        if not route:
            skipped[top] += 1
            continue
        slug, disp = route
        area = "Individual Project Data" if top.lower() == "individual project data" else top
        routed[slug]["name"] = disp
        routed[slug]["area"] = area
        routed[slug]["files"] += 1

    # Group routed projects by source area for readability.
    by_area = defaultdict(list)
    for slug, info in routed.items():
        by_area[info["area"]].append((slug, info["name"], info["files"]))

    print("=" * 70)
    print(f"  PROJECT ROUTING DRY RUN  (root: {root})")
    print(f"  total files listed: {len(items)}   ext-filtered out: {skipped_ext}")
    print("=" * 70)

    for area in sorted(by_area):
        rows = sorted(by_area[area], key=lambda r: r[1].lower())
        print(f"\n>>> {area}  ->  {len(rows)} project(s):")
        for slug, disp, n in rows[:60]:
            print(f"      [{n} file(s)] {disp}   (slug={slug})")
        if len(rows) > 60:
            print(f"      ... and {len(rows) - 60} more")

    print(f"\n>>> SKIPPED (not project content):")
    if skipped:
        for top, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
            print(f"      {n} file(s)  under '{top}'")
    else:
        print("      (none)")

    print(f"\n  TOTAL projects that WILL be built: {len(routed)}")

    # ── What would be pruned ──────────────────────────────────────────────────
    live_slugs = set(routed)
    db = SessionLocal()
    try:
        rows = db.query(Policy.source_key).filter(Policy.source_key.like("sp:PROJECT/%")).all()
        db_slugs = set()
        for (sk,) in rows:
            parts = (sk or "").split("/")
            if len(parts) >= 2:
                db_slugs.add(parts[1])
        dna_slugs = {r[0] for r in db.query(ProjectProfile.project_slug).all()}
    finally:
        db.close()

    pruned = db_slugs - live_slugs
    print(f"\n>>> Policy slugs in DB now: {len(db_slugs)}  |  DNA profiles in DB: {len(dna_slugs)}")
    print(f">>> WOULD BE PRUNED (in DB, no longer routed): {len(pruned)}")
    for s in sorted(pruned):
        print(f"      - {s}")
    seed_only = dna_slugs - db_slugs
    if seed_only:
        print(f"\n>>> DNA profiles with NO Policy rows (e.g. seed data) — purge separately: {len(seed_only)}")
        for s in sorted(seed_only):
            print(f"      - {s}")
    print()


if __name__ == "__main__":
    main()
