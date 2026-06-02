"""
SharePoint → DB Project-Deck Sync (AIXChange folder)
-----------------------------------------------------
Ingests the weekly "flash review" project content from the AIXChange folder on
the same CtrlOptimize SharePoint site used for policies. Despite the "deck" name,
the real content is Word docs (per-project summaries + flash-review summaries) and
a few PDFs — PPTX is also supported should decks be added later.

Two project folders are synced into the Project Showcase category:
    General/AIXChange/Transcripts & Summary      (clean per-project docs)
    General/AIXChange/Flash Review Transcripts   (dated weekly summaries)
The raw masked meeting "Transcript" subfolders are excluded (summaries only).

Project content is stored in the same Policy / PolicyChunk / PolicyImage tables as
policies (reusing the hybrid-search + image pipeline), but tagged with
category = PROJECT_DECK_CATEGORY and a `sp:PROJECT/...` source_key prefix.
PolicyService.search_policies excludes that category and
PolicyService.search_project_decks includes only it — so project content and
policy content never bleed into each other's answers.

Separately, the AIXChange/Policy PDFs are real AI-governance policies, so they are
routed into the POLICY pipeline (normal category, found by search_hr_policies),
NOT tagged as project decks.

Config:
    SHAREPOINT_SITE_URL                  — reused (same site as policies)
    SHAREPOINT_PROJECT_FOLDER_PATH       — comma-separated project folder paths
    SHAREPOINT_PROJECT_EXCLUDE_SEGMENTS  — path segments to skip (e.g. "transcript")
    SHAREPOINT_AI_POLICY_FOLDER_PATH     — AIXChange policy folder → policy pipeline
    SHAREPOINT_SYNC_INTERVAL             — reused poll interval (seconds)
"""

import logging
import re

from app.config import settings
from app.services.policy_service import PROJECT_DECK_CATEGORY
from app.services.sharepoint_policy_sync import _sync_files_into_policies, _categorize_file

logger = logging.getLogger(__name__)

# docx/pdf cover the current AIXChange content; pptx kept for future flash-review decks.
_PROJECT_EXTS = ("pdf", "docx", "pptx")


def _parse_paths(raw: str) -> list:
    return [p.strip().strip("/") for p in (raw or "").split(",") if p.strip()]


def _folder_slug(path: str) -> str:
    """Stable, readable key-prefix slug from a folder path's last segment."""
    last = path.rstrip("/").split("/")[-1]
    return re.sub(r"[^A-Za-z0-9]+", "", last) or "root"


def sync_project_decks() -> dict:
    """Sync all configured project folders into the Project Showcase category, and
    route the AIXChange policy folder into the normal policy pipeline.
    Everyone queries project content via the general agent, so the 'general' answer
    cache is invalidated on any change."""
    site_url = settings.SHAREPOINT_SITE_URL
    if not site_url:
        return {"status": "error", "message": "SHAREPOINT_SITE_URL is not configured."}

    paths = _parse_paths(settings.SHAREPOINT_PROJECT_FOLDER_PATH)
    if not paths:
        return {"status": "error", "message": "SHAREPOINT_PROJECT_FOLDER_PATH is not configured."}

    exclude_segments = tuple(
        s.strip() for s in (settings.SHAREPOINT_PROJECT_EXCLUDE_SEGMENTS or "").split(",") if s.strip()
    )

    results = []
    for path in paths:
        r = _sync_files_into_policies(
            label=f"PROJECT:{path}",
            full_path=path,
            key_prefix=f"sp:PROJECT/{_folder_slug(path)}/",
            categorizer=lambda _fn: PROJECT_DECK_CATEGORY,
            exts=_PROJECT_EXTS,
            cache_domains=["general"],
            exclude_segments=exclude_segments,
        )
        results.append({"folder": path, **r})

    # Route AIXChange/Policy PDFs into the policy pipeline (normal, searchable category)
    ai_policy_path = (settings.SHAREPOINT_AI_POLICY_FOLDER_PATH or "").strip().strip("/")
    if ai_policy_path:
        r = _sync_files_into_policies(
            label=f"AI-POLICY:{ai_policy_path}",
            full_path=ai_policy_path,
            key_prefix=f"sp:AIPOLICY/{_folder_slug(ai_policy_path)}/",
            categorizer=lambda fn: _categorize_file(fn, "IT"),
            exts=("pdf", "docx"),
            cache_domains=["general", "it_support"],
        )
        results.append({"folder": ai_policy_path, "as": "policy", **r})

    total_new     = sum(r["new"] for r in results)
    total_updated = sum(r["updated"] for r in results)
    errors = [e for r in results for e in r.get("errors", [])]

    # Re-embed any chunks still missing vectors (mirrors policy sync behaviour)
    if total_new or total_updated:
        try:
            from app.services.policy_service import PolicyService
            PolicyService.embed_all_policies()
        except Exception as e:
            logger.error(f"[Project sync] Post-sync embed error: {e}")

    return {
        "status": "partial_error" if errors else "success",
        "total_new": total_new,
        "total_updated": total_updated,
        "results": results,
    }


# ── Background loop (started from database.py) ───────────────────────────────

def project_deck_sync_loop():
    """Daemon thread: polls the AIXChange folders every SHAREPOINT_SYNC_INTERVAL seconds."""
    import time
    interval = settings.SHAREPOINT_SYNC_INTERVAL
    while True:
        time.sleep(interval)
        try:
            if not settings.SHAREPOINT_SITE_URL or not settings.SHAREPOINT_PROJECT_FOLDER_PATH:
                continue
            result = sync_project_decks()
            if result.get("total_new") or result.get("total_updated"):
                print(f"[Project sync loop] {result}")
        except Exception as e:
            print(f"[Project sync loop] error: {e}")
