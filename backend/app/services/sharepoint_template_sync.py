"""
SharePoint → DB Document-Template Sync
--------------------------------------
Pulls plain PDF/DOCX templates from a SharePoint folder, converts each to HTML,
LLM-tags the fill-in fields once, and upserts a DocumentTemplate row per file.

Mirrors the policy sync's cTag change-detection (DocumentTemplate.source_etag, `sp:`
prefixed source_key) but targets its own table and PRESERVES HR configuration
(enabled / requires_approval / label / per-field overrides) across re-syncs.
"""

import datetime
import logging
import re
import time

from app.config import settings
from app.database import SessionLocal
from app.document_generation import template_engine as engine
from app.graph_sync import sp_client
from app.models import DocumentTemplate

logger = logging.getLogger(__name__)

_KEY_PREFIX = "sp:__templates__/"


def _exts() -> tuple:
    return tuple(
        e.strip().lower()
        for e in (settings.SHAREPOINT_TEMPLATES_EXTS or "pdf,docx").split(",")
        if e.strip()
    )


def _doc_type_from_filename(name: str) -> str:
    stem = name.rsplit(".", 1)[0] if "." in name else name
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", stem.strip().lower()).strip("_")
    return slug or "document"


def _humanize_filename(name: str) -> str:
    stem = name.rsplit(".", 1)[0] if "." in name else name
    return re.sub(r"[_\-]+", " ", stem).strip().title() or "Document"


def _merge_fields(old: list | None, new: list | None) -> list:
    """Keep HR's per-field overrides (label/type/required/source/options) for fields whose
    name survives the re-tag; add freshly detected fields; drop fields no longer present."""
    old_by_name = {f.get("name"): f for f in (old or []) if isinstance(f, dict)}
    merged = []
    for f in (new or []):
        if not isinstance(f, dict):
            continue
        prev = old_by_name.get(f.get("name"))
        if prev:
            kept = dict(f)
            for k in ("label", "type", "required", "source", "options"):
                if k in prev:
                    kept[k] = prev[k]
            merged.append(kept)
        else:
            merged.append(f)
    return merged


def sync_templates() -> dict:
    """Sync the configured SharePoint templates folder into DocumentTemplate.

    Returns {"new","updated","skipped","deleted","errors"}.
    """
    if not (settings.SHAREPOINT_SITE_URL and settings.SHAREPOINT_TEMPLATES_FOLDER):
        return {"new": 0, "updated": 0, "skipped": 0, "deleted": 0,
                "errors": ["SHAREPOINT_SITE_URL / SHAREPOINT_TEMPLATES_FOLDER not configured"]}

    # SHAREPOINT_TEMPLATES_FOLDER is a FULL path from the document-library root (like
    # SHAREPOINT_PROJECTS_ROOT) — it is NOT under the policies base folder, so we use it
    # verbatim rather than prefixing SHAREPOINT_BASE_FOLDER.
    full_path = (settings.SHAREPOINT_TEMPLATES_FOLDER or "").strip().strip("/")
    exts = _exts()

    new = updated = skipped = deleted = 0
    errors: list[str] = []

    try:
        site_id = sp_client.get_site_id(settings.SHAREPOINT_SITE_URL)
        drive_id = sp_client.get_drive_id(site_id)
    except Exception as e:  # noqa: BLE001
        msg = f"SharePoint access failed: {e}"
        logger.error(f"[template_sync] {msg}")
        return {"new": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": [msg]}

    try:
        items = sp_client.list_files_recursive(drive_id, full_path)
    except Exception as e:  # noqa: BLE001
        msg = f"Failed listing templates folder '{full_path}': {e}"
        logger.error(f"[template_sync] {msg}")
        return {"new": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": [msg]}

    valid = []
    for item in items:
        name = item.get("name", "")
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext in exts:
            item["_ext"] = ext
            valid.append(item)

    db = SessionLocal()
    try:
        rows = db.query(DocumentTemplate).filter(
            DocumentTemplate.source_key.like(f"{_KEY_PREFIX}%")
        ).all()
        existing = {r.source_key: r for r in rows}
        seen = set()

        for item in valid:
            rel_path = item.get("relative_path", item["name"])
            sp_k = f"{_KEY_PREFIX}{rel_path}"
            ctag = item.get("cTag") or item.get("eTag") or ""
            filename = item["name"]
            ext = item["_ext"]
            file_id = item["id"]
            seen.add(sp_k)

            row = existing.get(sp_k)
            if row is not None and row.source_etag == ctag and row.html_template:
                skipped += 1
                continue

            try:
                resp = sp_client.download_file(drive_id, file_id)
                file_bytes = resp.content
            except Exception as e:  # noqa: BLE001
                errors.append(f"Download failed ({filename}): {e}")
                continue

            html_doc = engine.to_html(file_bytes, ext)
            if not html_doc:
                errors.append(f"Conversion produced no content: {filename}")
                continue

            try:
                tagged_html, fields = engine.tag_fields(html_doc)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[template_sync] tag_fields error for {filename}: {e}")
                tagged_html, fields = html_doc, []

            # Commit each template on its own so a later network/DB blip can't discard
            # templates that already processed successfully.
            now = datetime.datetime.utcnow()
            try:
                if row is None:
                    db.add(DocumentTemplate(
                        doc_type=_doc_type_from_filename(filename),
                        label=_humanize_filename(filename),
                        source_key=sp_k,
                        source_etag=ctag,
                        filename=filename,
                        source_format=ext,
                        html_template=tagged_html,
                        fields=fields,
                        enabled=False,            # HR must opt a new template into the dropdown
                        requires_approval=True,
                        setup_status="needs_review",
                        created_at=now,
                        updated_at=now,
                    ))
                    db.commit()
                    new += 1
                else:
                    # Content changed — refresh content + re-tag, but KEEP HR config.
                    row.source_etag = ctag
                    row.filename = filename
                    row.source_format = ext
                    row.html_template = tagged_html
                    row.fields = _merge_fields(row.fields, fields)
                    row.setup_status = "needs_review"
                    row.updated_at = now
                    db.commit()
                    updated += 1
            except Exception as e:  # noqa: BLE001
                db.rollback()
                errors.append(f"DB write failed ({filename}): {e}")
                logger.error(f"[template_sync] DB write failed ({filename}): {e}")

        # Delete templates whose source file vanished (generated docs stay intact).
        # Only prune when the listing succeeded for at least one file, so a total
        # network failure doesn't wipe a healthy catalogue.
        if valid:
            for key, row in existing.items():
                if key not in seen:
                    try:
                        db.delete(row)
                        db.commit()
                        deleted += 1
                    except Exception as e:  # noqa: BLE001
                        db.rollback()
                        errors.append(f"Delete failed ({key}): {e}")
    except Exception as e:  # noqa: BLE001
        db.rollback()
        errors.append(f"DB error: {e}")
        logger.error(f"[template_sync] DB error: {e}")
    finally:
        db.close()

    result = {"new": new, "updated": updated, "skipped": skipped,
              "deleted": deleted, "errors": errors}
    logger.info(f"[template_sync] {result}")
    return result


def template_sync_loop():
    """Daemon: poll SharePoint for template changes every SHAREPOINT_SYNC_INTERVAL seconds."""
    interval = settings.SHAREPOINT_SYNC_INTERVAL
    while True:
        try:
            sync_templates()
        except Exception as e:  # noqa: BLE001
            logger.error(f"[template_sync] loop error: {e}")
        time.sleep(interval)
