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

from app.config import settings
from app.graph_sync import sp_client
from app.services.policy_service import PROJECT_CATEGORY
from app.services.sharepoint_policy_sync import _sync_files_into_policies

logger = logging.getLogger(__name__)

# Demo transcripts are the headline data, so .vtt/.srt are included by default.
_DEFAULT_EXTS = "pdf,docx,pptx,vtt,srt,txt,md,xlsx,csv,html,htm"

_SUMMARY_HINTS = ("summary", "summ", "overview", "abstract")
_TRANSCRIPT_HINTS = ("transcript", "demo", "recording", "meeting", "call")
_TRANSCRIPT_EXTS = ("vtt", "srt")


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


def _make_title_builder(project: str):
    """Self-describing Policy.title so retrieved chunks/answers identify
    themselves, e.g. 'Acme Corp — Transcript: Q2 Demo'."""
    def _build(filename: str, rel_path: str) -> str:
        stem = filename.rsplit(".", 1)[0].strip()
        doc_type = _classify_doc_type(filename, rel_path).capitalize()
        return f"{project} — {doc_type}: {stem}"
    return _build


def _list_project_folders(drive_id: str, root: str) -> list[str]:
    """Immediate sub-folder names under the Projects root (one per project)."""
    children = sp_client.list_folder_contents(drive_id, root)
    return [c["name"] for c in children if "folder" in c and c.get("name")]


def sync_projects() -> dict:
    """Sync every project folder under SHAREPOINT_PROJECTS_ROOT into the
    Project Showcase category. Project content is queried via the general agent,
    so the 'general' answer cache is invalidated on any change."""
    site_url = settings.SHAREPOINT_SITE_URL
    if not site_url:
        return {"status": "error", "message": "SHAREPOINT_SITE_URL is not configured."}

    root = (getattr(settings, "SHAREPOINT_PROJECTS_ROOT", "") or "").strip().strip("/")
    if not root:
        return {"status": "error", "message": "SHAREPOINT_PROJECTS_ROOT is not configured."}

    exts = _exts()

    # Resolve the drive once, then discover the per-project subfolders.
    try:
        site_id = sp_client.get_site_id(site_url)
        drive_id = sp_client.get_drive_id(site_id)
        project_folders = _list_project_folders(drive_id, root)
    except Exception as e:
        msg = f"Failed listing projects root '{root}': {e}"
        logger.error(msg)
        return {"status": "error", "message": msg}

    if not project_folders:
        logger.info(f"[Project sync] No project subfolders found under '{root}'.")
        return {"status": "success", "total_new": 0, "total_updated": 0, "results": []}

    results = []
    for name in project_folders:
        r = _sync_files_into_policies(
            label=f"PROJECT:{name}",
            full_path=f"{root}/{name}",
            key_prefix=f"sp:PROJECT/{_project_slug(name)}/",
            categorizer=lambda _fn: PROJECT_CATEGORY,
            exts=exts,
            cache_domains=["general"],
            title_builder=_make_title_builder(name),
        )
        results.append({"project": name, **r})

    total_new = sum(r["new"] for r in results)
    total_updated = sum(r["updated"] for r in results)
    errors = [e for r in results for e in r.get("errors", [])]

    # Re-embed any chunks still missing vectors (mirrors policy sync behaviour).
    if total_new or total_updated:
        try:
            from app.services.policy_service import PolicyService
            PolicyService.embed_all_policies()
        except Exception as e:
            logger.error(f"[Project sync] Post-sync embed error: {e}")

    return {
        "status": "partial_error" if errors else "success",
        "projects": len(project_folders),
        "total_new": total_new,
        "total_updated": total_updated,
        "results": results,
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
