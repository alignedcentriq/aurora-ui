"""
SharePoint → DB Policy Sync (no MinIO middleman)
-------------------------------------------------
Downloads PDFs/DOCXs directly from SharePoint via Graph API,
extracts text, chunks, embeds, and stores in the Policy / PolicyChunk tables.

Change detection uses the Graph API cTag (content tag) stored in Policy.source_etag,
with a `sp:` prefixed source_key for source tracking.

Folder → category mapping:
    ADMIN       → Admin
    HR          → HR General
    IT SUPPORT  → IT
    PMO         → PMO
"""

import datetime
import logging
import re

from app.config import settings
from app.database import SessionLocal
from app.graph_sync import sp_client
from app.models import Policy

logger = logging.getLogger(__name__)

# ── Folder → category mapping ────────────────────────────────────────────────

_FOLDER_CATEGORY = {
    "admin":      "Admin",
    "hr":         "HR General",
    "it support": "IT",
    "pmo":        "PMO",
}


# Max characters of extracted text to store/chunk per policy. Large policy PDFs
# (e.g. the GHI insurance policy, ~126K chars) carry critical claims/TAT/grievance
# content well past the first 50K, so the cap must be generous enough to chunk it
# all — matches the manual GHI ingestion pipeline. Short docs are unaffected.
_MAX_POLICY_CHARS = 200000


def _category_for_folder(folder: str) -> str:
    return _FOLDER_CATEGORY.get(folder.lower(), "General")


def _sp_key(relative_path: str, folder: str) -> str:
    """Build a unique source_key value for a SharePoint-sourced file.
    e.g. sp:ADMIN/SubDir/Leave Policy.pdf"""
    return f"sp:{folder}/{relative_path}"


# ── Reuse text extraction from PolicyService ─────────────────────────────────

def _extract_text(file_bytes: bytes, ext: str) -> str:
    if ext == "pdf":
        from app.services.policy_service import _extract_text_from_pdf_bytes
        return _extract_text_from_pdf_bytes(file_bytes)
    elif ext == "docx":
        from app.services.policy_service import _extract_text_from_docx_bytes
        return _extract_text_from_docx_bytes(file_bytes)
    return ""


def _extract_images(file_bytes: bytes, ext: str) -> list:
    if ext == "pdf":
        from app.services.policy_service import _extract_images_from_pdf_bytes
        return _extract_images_from_pdf_bytes(file_bytes)
    elif ext == "docx":
        from app.services.policy_service import _extract_images_from_docx_bytes
        return _extract_images_from_docx_bytes(file_bytes)
    return []


def _categorize_file(filename: str, folder_category: str) -> str:
    from app.services.policy_service import _categorize
    cat = _categorize(filename)
    return cat if cat != "General" else folder_category


# ── Core sync function ────────────────────────────────────────────────────────

def sync_folder(folder: str) -> dict:
    """
    Sync a single SharePoint folder into the Policy table.

    1. Resolve site → drive via sp_client
    2. Recursively list all PDF/DOCX files
    3. Compare cTag with stored source_etag → skip unchanged
    4. Download new/changed files → extract text → chunk → embed → DB
    5. Delete policies whose source file no longer exists in SharePoint

    Returns: {"new": int, "updated": int, "skipped": int, "deleted": int, "errors": list}
    """
    from app.services.policy_service import (
        PolicyService, _chunk_text_sentences,
        _upload_policy_images, _assign_images_to_chunks,
    )

    site_url = settings.SHAREPOINT_SITE_URL
    base     = settings.SHAREPOINT_BASE_FOLDER  # e.g. "IQ"
    full_path = f"{base}/{folder}" if base else folder
    folder_category = _category_for_folder(folder)

    new, updated, skipped, deleted, errors = 0, 0, 0, 0, []

    # ── Resolve SharePoint identifiers ────────────────────────────────────
    try:
        site_id  = sp_client.get_site_id(site_url)
        drive_id = sp_client.get_drive_id(site_id)
    except Exception as e:
        msg = f"SharePoint access failed for site={site_url}: {e}"
        logger.error(msg)
        return {"new": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": [msg]}

    # ── List files recursively ────────────────────────────────────────────
    try:
        items = sp_client.list_files_recursive(drive_id, full_path)
    except Exception as e:
        msg = f"Failed listing folder '{full_path}': {e}"
        logger.error(msg)
        return {"new": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": [msg]}

    # Filter to PDF/DOCX only
    valid_items = []
    for item in items:
        name = item.get("name", "")
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext in ("pdf", "docx"):
            item["_ext"] = ext
            valid_items.append(item)

    # ── Build lookup of existing SP-sourced policies for this folder ──────
    db = SessionLocal()
    try:
        sp_prefix = f"sp:{folder}/"
        rows = db.query(Policy.id, Policy.source_key, Policy.source_etag).filter(
            Policy.source_key.like(f"{sp_prefix}%")
        ).all()
        existing = {r.source_key: (r.id, r.source_etag) for r in rows}

        seen_keys = set()

        for item in valid_items:
            rel_path = item.get("relative_path", item["name"])
            sp_k     = _sp_key(rel_path, folder)
            ctag     = item.get("cTag") or item.get("eTag") or ""
            filename = item["name"]
            ext      = item["_ext"]
            file_id  = item["id"]
            seen_keys.add(sp_k)

            is_new     = sp_k not in existing
            is_changed = (not is_new) and (existing[sp_k][1] != ctag)

            if not is_new and not is_changed:
                skipped += 1
                continue

            # Delete stale policy (CASCADE removes chunks)
            if is_changed:
                stale_id = existing[sp_k][0]
                db.query(Policy).filter(Policy.id == stale_id).delete()
                db.flush()
                logger.info(f"  [UPDATE] cTag changed — replacing: {filename}")

            # ── Download from SharePoint ──────────────────────────────────
            try:
                resp = sp_client.download_file(drive_id, file_id)
                file_bytes = resp.content
            except Exception as e:
                errors.append(f"Download failed ({filename}): {e}")
                continue

            # ── Extract text ──────────────────────────────────────────────
            content = _extract_text(file_bytes, ext)
            if not content or len(content) < 50:
                errors.append(f"Empty/too short: {filename}")
                continue

            # ── Create Policy record ──────────────────────────────────────
            title    = filename.rsplit(".", 1)[0].strip()
            category = _categorize_file(filename, folder_category)

            policy = Policy(
                title=title,
                category=category,
                content=content[:_MAX_POLICY_CHARS],
                source_key=sp_k,
                source_etag=ctag,
                updated_at=datetime.datetime.utcnow(),
            )
            db.add(policy)
            db.flush()

            # ── Extract & upload images ───────────────────────────────────
            raw_images = _extract_images(file_bytes, ext)
            chunk_images: dict = {}
            if raw_images:
                img_ids = _upload_policy_images(policy.id, title, raw_images, db, is_docx=(ext == "docx"))
                chunks_preview = _chunk_text_sentences(content[:_MAX_POLICY_CHARS])
                assignment = _assign_images_to_chunks(
                    raw_images, len(chunks_preview), is_docx=(ext == "docx")
                )
                chunk_images = {
                    ci: [img_ids[ii] for ii in idxs if ii < len(img_ids)]
                    for ci, idxs in assignment.items()
                    if idxs
                }

            # ── Chunk & embed ─────────────────────────────────────────────
            PolicyService._chunk_and_embed(policy, db, chunk_images=chunk_images)

            action = "NEW" if is_new else "UPDATED"
            img_count = len(raw_images) if raw_images else 0
            logger.info(f"  [{action}] {title} [{len(content)} chars, {img_count} imgs]")
            if is_new:
                new += 1
            else:
                updated += 1

        # ── Delete policies whose file was removed from SharePoint ────────
        removed_keys = set(existing.keys()) - seen_keys
        if removed_keys:
            db.query(Policy).filter(Policy.source_key.in_(removed_keys)).delete(
                synchronize_session="fetch"
            )
            deleted = len(removed_keys)
            logger.info(f"  [DELETED] {deleted} policies removed (source files gone)")

        db.commit()
    except Exception as e:
        db.rollback()
        errors.append(str(e))
        logger.error(f"[SP sync] Error syncing folder '{folder}': {e}")
    finally:
        db.close()

    result = {"new": new, "updated": updated, "skipped": skipped,
              "deleted": deleted, "errors": errors}
    logger.info(f"[SP sync] Folder '{folder}': {result}")
    return result


# ── Multi-folder sync (called by endpoint + background loop) ──────────────────

def sync_all_sharepoint_folders() -> dict:
    """Sync all configured SHAREPOINT_POLICY_FOLDERS from SharePoint into DB."""
    site_url = settings.SHAREPOINT_SITE_URL
    if not site_url:
        return {"status": "error", "message": "SHAREPOINT_SITE_URL is not configured."}

    folders_raw = settings.SHAREPOINT_POLICY_FOLDERS or ""
    folders = [f.strip() for f in folders_raw.split(",") if f.strip()]
    if not folders:
        return {"status": "error", "message": "SHAREPOINT_POLICY_FOLDERS is empty."}

    results = []
    for folder in folders:
        r = sync_folder(folder)
        results.append({"folder": folder, **r})
        print(f"[SP sync] {folder}: new={r['new']} updated={r['updated']} "
              f"skipped={r['skipped']} deleted={r['deleted']}")

    total_new     = sum(r["new"] for r in results)
    total_updated = sum(r["updated"] for r in results)
    errors = [e for r in results for e in r.get("errors", [])]

    # Trigger a re-embed pass for any chunks still missing vectors
    if total_new or total_updated:
        try:
            from app.services.policy_service import PolicyService
            PolicyService.embed_all_policies()
        except Exception as e:
            logger.error(f"[SP sync] Post-sync embed error: {e}")

    return {
        "status": "partial_error" if errors else "success",
        "folders_synced": len(folders),
        "total_new": total_new,
        "total_updated": total_updated,
        "results": results,
    }


# ── Background loop (started from database.py) ───────────────────────────────

_SP_SYNC_INTERVAL = int(
    settings.SHAREPOINT_SYNC_INTERVAL
    if hasattr(settings, "SHAREPOINT_SYNC_INTERVAL") else 600
)


def sharepoint_sync_loop():
    """Daemon thread: polls SharePoint every SHAREPOINT_SYNC_INTERVAL seconds."""
    import time
    while True:
        time.sleep(_SP_SYNC_INTERVAL)
        try:
            if not settings.SHAREPOINT_SITE_URL:
                continue
            result = sync_all_sharepoint_folders()
            if result.get("total_new") or result.get("total_updated"):
                print(f"[SP sync loop] {result}")
        except Exception as e:
            print(f"[SP sync loop] error: {e}")
