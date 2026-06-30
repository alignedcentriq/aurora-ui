"""
SharePoint → DB Company-Project Sync (generalized "Projects" tree)
------------------------------------------------------------------
Ingests the whole **Projects** folder on the SharePoint site. Under the root,
each company/project keeps its data — project summary, demo transcript, project
details — spread across sub-folders whose structure can change over time.

Approach:
    • The top-level folder name under the Projects root IS the project key
      (the most reliable grouping signal as inner structure changes).
    • Each project folder is synced recursively into the same Policy / PolicyChunk
      tables used by policies, tagged with category = PROJECT_CATEGORY and a
      per-project `sp:PROJECT/<slug>/...` source_key so projects never collide and
      stale-row pruning stays scoped to one project.
    • PolicyService.search_policies excludes PROJECT_CATEGORY; search_projects
      includes only it — so project content and policy content never bleed into
      each other's answers.
    • Varied file formats are handled by the shared extract dispatch in
      sharepoint_policy_sync._extract_text (pdf/docx/pptx via the existing
      extractors, .vtt transcripts via a cleaner, and txt/md/xlsx/csv/html/…
      via MarkItDown).

Config:
    SHAREPOINT_SITE_URL       — reused (same site as policies)
    SHAREPOINT_PROJECTS_ROOT  — root folder holding per-project subfolders
    SHAREPOINT_PROJECT_EXTS   — comma-separated extensions to ingest
    SHAREPOINT_SYNC_INTERVAL  — reused poll interval (seconds)
"""

import logging
import re
import threading

from app.config import settings
from app.graph_sync import sp_client
from app.services.policy_service import PROJECT_CATEGORY
from app.services.sharepoint_policy_sync import _sync_files_into_policies

logger = logging.getLogger(__name__)

# Guards against two project syncs running at once (background loop + a manual
# trigger, or overlapping loop ticks). Concurrent syncs deadlock on the shared
# policy/policy_chunk tables, so a second caller skips instead of piling up.
_sync_lock = threading.Lock()

# Demo transcripts are the headline data, so .vtt/.srt are included by default.
_DEFAULT_EXTS = "pdf,docx,pptx,vtt,srt,txt,md,xlsx,csv,html,htm"

_SUMMARY_HINTS = ("summary", "summ", "overview", "abstract")
_TRANSCRIPT_HINTS = ("transcript", "demo", "recording", "meeting", "call")
_TRANSCRIPT_EXTS = ("vtt", "srt")

# ── Project routing ──────────────────────────────────────────────────────────
# The `Projects` tree is organised by document *type*, not one-folder-per-project,
# so the top-level folder name is NOT a reliable project key. We route each file
# to a project by its first path segment (relative to the Projects root):
#
#   Individual Project Data/<Project>/...   → one project per <Project> subfolder
#   Transcripts & Summary/<file>            → one project per summary document
#   Flash Review Transcripts/...             → aggregate: all files → single slug
#   Newsletters / Policy / unknown           → NOT projects, skipped entirely
#
# Everything else (loose files, unknown folders) is skipped so non-project content
# never becomes a bogus "project".
_FOLDER_AS_PROJECT = "individual project data"   # subfolder = project
_DOC_AS_PROJECT = "transcripts & summary"        # each file = project
_AGGREGATE_AS_PROJECT = "flash review transcripts"  # all files → one slug
_AGGREGATE_SLUG = "FlashReviews"
_AGGREGATE_NAME = "Flash Reviews"


def _route_file(rel_path: str) -> tuple[str, str] | None:
    """Map a file's path (relative to the Projects root) to ``(slug, name)`` of the
    project it belongs to, or ``None`` if the file is not project content."""
    segs = [s for s in (rel_path or "").split("/") if s]
    if len(segs) < 2:
        return None  # loose file directly under the root — not a project
    top = segs[0].lower()
    if top == _FOLDER_AS_PROJECT and len(segs) >= 3:
        name = segs[1]
        return (_project_slug(name), name)
    if top == _DOC_AS_PROJECT:
        stem = segs[-1].rsplit(".", 1)[0].strip()
        return (_project_slug(stem), stem)
    if top == _AGGREGATE_AS_PROJECT:
        return (_AGGREGATE_SLUG, _AGGREGATE_NAME)
    return None  # Newsletters, Policy, unknown → skip


def _key_builder(filename: str, rel_path: str) -> str | None:
    """source_key for a file: ``sp:PROJECT/{project_slug}/{rel_path}`` (None = skip).

    The project slug sits at position 1 so the existing ``sp:PROJECT/{slug}/%``
    conventions in project_iq_service keep working unchanged."""
    route = _route_file(rel_path)
    if not route:
        return None
    slug, _name = route
    return f"sp:PROJECT/{slug}/{rel_path}"


def _title_builder(filename: str, rel_path: str) -> str:
    """Self-describing Policy.title, e.g. 'CMDR — Transcript: Kickoff'. The project
    name (segment 0 of the title) is what list_project_slugs reads back."""
    route = _route_file(rel_path)
    name = route[1] if route else filename.rsplit(".", 1)[0].strip()
    stem = filename.rsplit(".", 1)[0].strip()
    doc_type = _classify_doc_type(filename, rel_path).capitalize()
    return f"{name} — {doc_type}: {stem}"


def _exts() -> tuple:
    raw = getattr(settings, "SHAREPOINT_PROJECT_EXTS", "") or _DEFAULT_EXTS
    return tuple(e.strip().lower().lstrip(".") for e in raw.split(",") if e.strip())


def _project_slug(name: str) -> str:
    """Stable, readable key-prefix slug from a project/folder name."""
    return re.sub(r"[^A-Za-z0-9]+", "", name or "") or "project"


def _classify_doc_type(filename: str, rel_path: str = "") -> str:
    """Bucket a file as 'summary' | 'transcript' | 'details' from its name/path.

    Extension wins for transcripts (.vtt/.srt are always transcripts); otherwise
    keyword hints in the filename or any path segment decide, defaulting to
    'details'."""
    name = (filename or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    hay = f"{rel_path} {filename}".lower()
    if ext in _TRANSCRIPT_EXTS or any(h in hay for h in _TRANSCRIPT_HINTS):
        return "transcript"
    if any(h in hay for h in _SUMMARY_HINTS):
        return "summary"
    return "details"


def _list_project_folders(drive_id: str, root: str) -> list[str]:
    """Immediate sub-folder names under the Projects root (one per project)."""
    children = sp_client.list_folder_contents(drive_id, root)
    return [c["name"] for c in children if "folder" in c and c.get("name")]


def _prune_deleted_projects(live_slugs: set[str]) -> dict:
    """Remove Policy rows (+ chunks via CASCADE) and ProjectProfile DNA for project
    slugs that no longer have a matching folder in SharePoint."""
    from app.database import SessionLocal
    from app.models import Policy, ProjectProfile

    db = SessionLocal()
    try:
        # Find all slugs currently in the DB.
        rows = db.query(Policy.source_key).filter(
            Policy.source_key.like("sp:PROJECT/%")
        ).all()
        db_slugs: set[str] = set()
        for (sk,) in rows:
            parts = (sk or "").split("/")
            if len(parts) >= 2:
                db_slugs.add(parts[1])

        orphaned = db_slugs - live_slugs
        if not orphaned:
            return {"pruned_projects": 0, "pruned_dna": 0}

        pruned_policies = 0
        pruned_dna = 0
        for slug in orphaned:
            prefix = f"sp:PROJECT/{slug}/"
            n = db.query(Policy).filter(Policy.source_key.like(f"{prefix}%")).delete(
                synchronize_session="fetch"
            )
            pruned_policies += n
            n2 = db.query(ProjectProfile).filter(
                ProjectProfile.project_slug == slug
            ).delete(synchronize_session="fetch")
            pruned_dna += n2
            logger.info(
                f"[Project sync] Pruned orphaned project '{slug}': "
                f"{n} policy rows, {n2} DNA profile(s)"
            )

        db.commit()
        return {"pruned_projects": len(orphaned), "pruned_policies": pruned_policies,
                "pruned_dna": pruned_dna, "slugs": sorted(orphaned)}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def route_live_projects(drive_id: str, root: str) -> tuple[dict[str, str], list]:
    """List only the project-bearing sub-trees and route every file to a project.

    Only recurses into the relevant top-level folders — Individual Project Data,
    Transcripts & Summary, and Flash Review Transcripts — skipping Newsletters,
    Policy, and any other non-project folders entirely.

    Returns ``(slug -> display name, all_listed_items)``. The raw listing is
    returned so the caller can hand it straight to the sync worker instead of
    re-listing the (large) tree a second time."""
    exts = _exts()
    all_items: list[dict] = []
    live: dict[str, str] = {}

    # List the top-level children to find the right sub-folders.
    top_children = sp_client.list_folder_contents(drive_id, root)
    for child in top_children:
        if "folder" not in child:
            continue
        folder_name = child.get("name", "")
        top_lower = folder_name.lower()

        if top_lower == _FOLDER_AS_PROJECT:
            # Recurse into Individual Project Data recursively (each subfolder = project).
            folder_path = f"{root}/{folder_name}"
            sub_items = sp_client.list_files_recursive(drive_id, folder_path)
            # Reattach relative_path relative to the Projects root.
            for it in sub_items:
                rel = it.get("relative_path", it.get("name", ""))
                it["relative_path"] = f"{folder_name}/{rel}"
            all_items.extend(sub_items)

        elif top_lower == _DOC_AS_PROJECT:
            # List direct children only — each doc file = its own project.
            folder_path = f"{root}/{folder_name}"
            doc_items = sp_client.list_folder_contents(drive_id, folder_path)
            for it in doc_items:
                if "file" not in it:
                    continue
                it["relative_path"] = f"{folder_name}/{it['name']}"
                all_items.append(it)

        elif top_lower == _AGGREGATE_AS_PROJECT:
            # Recurse into Flash Review Transcripts — all files → single aggregate slug.
            folder_path = f"{root}/{folder_name}"
            sub_items = sp_client.list_files_recursive(drive_id, folder_path)
            for it in sub_items:
                rel = it.get("relative_path", it.get("name", ""))
                it["relative_path"] = f"{folder_name}/{rel}"
            all_items.extend(sub_items)
        # else: Newsletters, Policy, unknown → skip entirely

    for it in all_items:
        name = it.get("name", "")
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in exts:
            continue
        route = _route_file(it.get("relative_path", name))
        if route:
            live[route[0]] = route[1]

    return live, all_items


def sync_projects() -> dict:
    """Sync the SHAREPOINT_PROJECTS_ROOT tree into the Project Showcase category.

    Single unified pass over the whole tree: each file is routed to a project by
    _route_file (subfolders of 'Individual Project Data' = projects; each
    'Transcripts & Summary' document = its own project; Newsletters/Policy/Flash
    Review/unknown content is skipped). Project content is queried via the general
    agent, so the 'general' answer cache is invalidated on any change.

    Also prunes Policy chunks and ProjectProfile DNA for any project that no longer
    routes from a live SharePoint file (covers re-keying from the old
    one-folder-per-project scheme).

    Re-entrancy: only one sync runs at a time. A concurrent caller returns
    immediately rather than contending for table locks."""
    if not _sync_lock.acquire(blocking=False):
        logger.info("[Project sync] Another sync is already in progress — skipping this trigger.")
        return {"status": "skipped", "message": "a project sync is already in progress"}
    try:
        return _sync_projects_locked()
    finally:
        _sync_lock.release()


def _sync_projects_locked() -> dict:
    site_url = settings.SHAREPOINT_SITE_URL
    if not site_url:
        return {"status": "error", "message": "SHAREPOINT_SITE_URL is not configured."}

    root = (getattr(settings, "SHAREPOINT_PROJECTS_ROOT", "") or "").strip().strip("/")
    if not root:
        return {"status": "error", "message": "SHAREPOINT_PROJECTS_ROOT is not configured."}

    exts = _exts()

    # Resolve the drive once, then route every file to its project. The listing is
    # reused by the sync worker below so the tree is walked only once per run.
    try:
        site_id = sp_client.get_site_id(site_url)
        drive_id = sp_client.get_drive_id(site_id)
        live, all_items = route_live_projects(drive_id, root)
    except Exception as e:
        msg = f"Failed listing projects root '{root}': {e}"
        logger.error(msg)
        return {"status": "error", "message": msg}

    live_slugs = set(live)

    # Prune stale project data for projects that no longer route from SharePoint
    # (includes old one-folder-per-project slugs being replaced by per-file slugs).
    prune_result: dict = {}
    try:
        prune_result = _prune_deleted_projects(live_slugs)
        if prune_result.get("pruned_projects"):
            logger.info(
                f"[Project sync] Pruned {prune_result['pruned_projects']} stale project(s): "
                f"{prune_result.get('slugs', [])}"
            )
    except Exception as e:
        logger.error(f"[Project sync] Prune step failed: {e}")

    if not live_slugs:
        logger.info(f"[Project sync] No project content routed under '{root}'.")
        return {"status": "success", "total_new": 0, "total_updated": 0,
                "total_deleted_projects": prune_result.get("pruned_projects", 0),
                "projects": 0, "results": []}

    # ── Single unified pass over the whole tree ───────────────────────────────
    r = _sync_files_into_policies(
        label="PROJECTS",
        full_path=root,
        key_prefix="sp:PROJECT/",          # stale-deletion scope for ALL project rows
        categorizer=lambda _fn: PROJECT_CATEGORY,
        exts=exts,
        cache_domains=["general"],
        title_builder=_title_builder,
        key_builder=_key_builder,          # per-file project routing (None = skip)
        prelisted_items=all_items,         # reuse the listing from route_live_projects
    )

    total_new = r.get("new", 0)
    total_updated = r.get("updated", 0)
    total_deleted_files = r.get("deleted", 0)
    errors = r.get("errors", [])
    changed_keys = r.get("changed_keys", [])

    anything_changed = (
        total_new or total_updated or total_deleted_files or prune_result.get("pruned_projects")
    )

    # Re-embed any chunks still missing vectors.
    if total_new or total_updated:
        try:
            from app.services.policy_service import PolicyService
            PolicyService.embed_all_policies()
        except Exception as e:
            logger.error(f"[Project sync] Post-sync embed error: {e}")

    # Rebuild Project IQ DNA only for projects whose content actually changed.
    if changed_keys:
        try:
            from app.services.project_iq_service import extract_project_dna
            changed_slugs = set()
            for k in changed_keys:
                parts = (k or "").split("/")
                if len(parts) >= 2:
                    changed_slugs.add(parts[1])
            for slug in sorted(changed_slugs):
                logger.info(f"[Project sync] Triggering DNA rebuild for '{slug}'")
                extract_project_dna(slug, live.get(slug))
        except Exception as e:
            logger.error(f"[Project sync] DNA rebuild error: {e}")

    return {
        "status": "partial_error" if errors else "success",
        "projects": len(live_slugs),
        "total_new": total_new,
        "total_updated": total_updated,
        "total_deleted_files": total_deleted_files,
        "total_deleted_projects": prune_result.get("pruned_projects", 0),
        "errors": errors,
    }


# ── Background loop (started from database.py) ───────────────────────────────

def project_sync_loop():
    """Daemon thread: polls the Projects tree every SHAREPOINT_SYNC_INTERVAL seconds."""
    import time
    interval = settings.SHAREPOINT_SYNC_INTERVAL
    while True:
        time.sleep(interval)
        try:
            if not settings.SHAREPOINT_SITE_URL or not getattr(settings, "SHAREPOINT_PROJECTS_ROOT", ""):
                continue
            result = sync_projects()
            if result.get("total_new") or result.get("total_updated"):
                pass
        except Exception as e:
            pass
