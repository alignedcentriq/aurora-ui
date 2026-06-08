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


def _category_for_folder(folder: str) -> str:
    return _FOLDER_CATEGORY.get(folder.lower(), "General")


# ── Folder → semantic-answer-cache domain (for invalidation on doc change) ────
_FOLDER_CACHE_DOMAIN = {
    "admin":      "admin",
    "hr":         "hr",
    "it support": "it_support",
    "pmo":        "pmo",
}


def _cache_domain_for_folder(folder: str) -> str | None:
    return _FOLDER_CACHE_DOMAIN.get(folder.lower())


def _sp_key(relative_path: str, folder: str) -> str:
    """Build a unique source_key value for a SharePoint-sourced file.
    e.g. sp:ADMIN/SubDir/Leave Policy.pdf"""
    return f"sp:{folder}/{relative_path}"


# ── Reuse text extraction from PolicyService ─────────────────────────────────

def _extract_vtt(file_bytes: bytes) -> str:
    """Clean a WebVTT/SRT transcript into plain spoken text.

    Drops the `WEBVTT` header, NOTE/STYLE blocks, numeric cue indices, and
    `00:00:00.000 --> 00:00:02.000` timestamp lines, then collapses consecutive
    duplicate caption lines (Teams transcripts repeat the rolling caption)."""
    try:
        text = file_bytes.decode("utf-8-sig", errors="replace")
    except Exception:
        return ""
    lines, prev = [], None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        low = line.lower()
        if low == "webvtt" or low.startswith("webvtt ") or low.startswith(("note", "style", "region")):
            continue
        if "-->" in line:  # timestamp cue line
            continue
        if line.isdigit():  # SRT/cue index
            continue
        # Strip inline <v Speaker> / <00:00:00.000> tags VTT may carry.
        line = re.sub(r"<[^>]+>", "", line).strip()
        if not line or line == prev:
            continue
        lines.append(line)
        prev = line
    return "\n".join(lines)


def _extract_via_markitdown(file_bytes: bytes, ext: str) -> str:
    """Convert text-bearing formats (txt/md/xlsx/csv/html/json/...) to plain text
    via MarkItDown. Fail-soft: returns '' on any error, matching the other extractors."""
    try:
        import io
        from markitdown import MarkItDown
        result = MarkItDown().convert_stream(io.BytesIO(file_bytes), file_extension=f".{ext}")
        return (result.text_content or "").strip()
    except Exception as e:
        logger.warning(f"[extract] MarkItDown failed for .{ext}: {e}")
        return ""


def _extract_text(file_bytes: bytes, ext: str) -> str:
    if ext == "pdf":
        from app.services.policy_service import _extract_text_from_pdf_bytes
        return _extract_text_from_pdf_bytes(file_bytes)
    elif ext == "docx":
        from app.services.policy_service import _extract_text_from_docx_bytes
        return _extract_text_from_docx_bytes(file_bytes)
    elif ext == "pptx":
        from app.services.policy_service import _extract_text_from_pptx_bytes
        return _extract_text_from_pptx_bytes(file_bytes)
    elif ext in ("vtt", "srt"):
        return _extract_vtt(file_bytes)
    # txt / md / xlsx / csv / html / htm / json / … → unified MarkItDown conversion
    return _extract_via_markitdown(file_bytes, ext)


def _extract_images(file_bytes: bytes, ext: str) -> list:
    if ext == "pdf":
        from app.services.policy_service import _extract_images_from_pdf_bytes
        return _extract_images_from_pdf_bytes(file_bytes)
    elif ext == "docx":
        from app.services.policy_service import _extract_images_from_docx_bytes
        return _extract_images_from_docx_bytes(file_bytes)
    elif ext == "pptx":
        from app.services.policy_service import _extract_images_from_pptx_bytes
        return _extract_images_from_pptx_bytes(file_bytes)
    return []


# Extensions whose images carry a position_ratio (0-1) rather than a page number,
# so _assign_images_to_chunks must use the ratio-based path (is_docx=True).
_RATIO_IMAGE_EXTS = ("docx", "pptx")


def _categorize_file(filename: str, folder_category: str) -> str:
    from app.services.policy_service import _categorize
    cat = _categorize(filename)
    return cat if cat != "General" else folder_category


# ── Core sync function ────────────────────────────────────────────────────────

def sync_folder(folder: str) -> dict:
    """
    Sync a single SharePoint POLICY folder into the Policy table.

    Thin wrapper around `_sync_files_into_policies` — handles PDF/DOCX only,
    derives the category from filename (falling back to the folder's category),
    and invalidates the folder's answer-cache domain plus 'general'.
    """
    base      = settings.SHAREPOINT_BASE_FOLDER  # e.g. "IQ"
    full_path = f"{base}/{folder}" if base else folder
    folder_category = _category_for_folder(folder)

    cache_domains = ["general"]
    cd = _cache_domain_for_folder(folder)
    if cd:
        cache_domains.append(cd)

    return _sync_files_into_policies(
        label=folder,
        full_path=full_path,
        key_prefix=f"sp:{folder}/",
        categorizer=lambda fn: _categorize_file(fn, folder_category),
        exts=("pdf", "docx"),
        cache_domains=cache_domains,
    )


def _sync_files_into_policies(
    label: str,
    full_path: str,
    key_prefix: str,
    categorizer,
    exts: tuple,
    cache_domains: list,
    exclude_segments: tuple = (),
    title_builder=None,
) -> dict:
    """
    Generic SharePoint-folder → Policy-table sync.

    1. Resolve site → drive via sp_client
    2. Recursively list all files matching `exts`
    3. Compare cTag with stored source_etag → skip unchanged
    4. Download new/changed files → extract text → chunk → embed → DB
    5. Delete policies whose source file no longer exists in SharePoint
    6. Invalidate the given answer-cache domains if anything changed

    `key_prefix` namespaces this source's rows in Policy.source_key (e.g. "sp:HR/")
    so different folders never collide. `categorizer(filename)`
    returns the Policy.category for each file.

    Returns: {"new": int, "updated": int, "skipped": int, "deleted": int, "errors": list}
    """
    from app.services.policy_service import (
        PolicyService, _chunk_text_sentences,
        _upload_policy_images, _assign_images_to_chunks,
    )

    site_url = settings.SHAREPOINT_SITE_URL

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

    # Filter to the requested extensions, skipping any file whose relative path
    # contains an excluded path segment (e.g. raw "Transcript" subfolders).
    excl = {s.strip().lower() for s in exclude_segments if s.strip()}
    valid_items = []
    for item in items:
        name = item.get("name", "")
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in exts:
            continue
        if excl:
            segs = {p.strip().lower() for p in item.get("relative_path", name).split("/")}
            if segs & excl:
                continue
        item["_ext"] = ext
        valid_items.append(item)

    # ── Build lookup of existing rows for this source ─────────────────────
    db = SessionLocal()
    try:
        rows = db.query(Policy.id, Policy.source_key, Policy.source_etag).filter(
            Policy.source_key.like(f"{key_prefix}%")
        ).all()
        existing = {r.source_key: (r.id, r.source_etag) for r in rows}

        seen_keys = set()

        for item in valid_items:
            rel_path = item.get("relative_path", item["name"])
            sp_k     = f"{key_prefix}{rel_path}"
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
            title = (
                title_builder(filename, rel_path).strip()
                if title_builder
                else filename.rsplit(".", 1)[0].strip()
            )
            category = categorizer(filename)
            ratio_imgs = ext in _RATIO_IMAGE_EXTS

            policy = Policy(
                title=title,
                category=category,
                content=content[:50000],
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
                img_ids = _upload_policy_images(policy.id, title, raw_images, db, is_docx=ratio_imgs)
                chunks_preview = _chunk_text_sentences(content[:50000])
                assignment = _assign_images_to_chunks(
                    raw_images, len(chunks_preview), is_docx=ratio_imgs
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
        logger.error(f"[SP sync] Error syncing '{label}': {e}")
    finally:
        db.close()

    # ── Invalidate the semantic answer cache when this source changed ─────
    # Guarantees users never get a cached answer built from now-stale content.
    if (new + updated + deleted) > 0:
        try:
            from app.services.answer_cache_service import AnswerCacheService
            removed = 0
            for dom in dict.fromkeys(cache_domains):  # de-dup, preserve order
                removed += AnswerCacheService.invalidate_domain(dom)
            if removed:
                logger.info(f"  [CACHE] invalidated {removed} cached answers ('{label}' changed)")
        except Exception as e:
            logger.warning(f"  [CACHE] invalidation skipped for '{label}': {e}")

    result = {"new": new, "updated": updated, "skipped": skipped,
              "deleted": deleted, "errors": errors}
    logger.info(f"[SP sync] '{label}': {result}")
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
                pass
        except Exception as e:
            pass
