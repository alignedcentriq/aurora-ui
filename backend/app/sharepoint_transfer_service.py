import logging
import threading
import os
from app.graph_sync import sp_client
from app.minio_client import minio_client

logger = logging.getLogger(__name__)


def _normalize_site_name(site_url: str) -> str:
    """Convert a full SharePoint site URL to the format Graph expects.
    e.g. https://tenant.sharepoint.com/sites/Centriq
      → tenant.sharepoint.com:/sites/Centriq
    """
    clean = site_url.replace("https://", "").replace("http://", "").strip()
    if "/" in clean and ":" not in clean:
        host, rest = clean.split("/", 1)
        clean = f"{host}:/{rest}"
    return clean


class SharePointTransferService:
    def transfer_folder_to_minio(self, site_name: str, folder_path: str, minio_prefix: str = ""):
        """
        Recursively pull all documents from a SharePoint folder into MinIO,
        then trigger policy ingest + embedding.

        site_name:    Full SharePoint site URL or Graph-format 'tenant.sharepoint.com:/sites/Name'
        folder_path:  Folder path in the default document library, e.g. 'ADMIN' or 'Shared Documents/HR'
        minio_prefix: MinIO object prefix, e.g. 'policies/ADMIN'
        """
        site_name = _normalize_site_name(site_name)
        try:
            logger.info(f"[SharePoint] Starting sync: site={site_name} folder={folder_path}")

            site_id = sp_client.get_site_id(site_name)
            if not site_id:
                raise Exception(f"Could not find site: {site_name}")

            drive_id = sp_client.get_drive_id(site_id)
            if not drive_id:
                raise Exception(f"Could not find drive for site: {site_name}")

            # Recursively list all files (including subfolders)
            items = sp_client.list_files_recursive(drive_id, folder_path)

            transferred_files = []
            for item in items:
                file_name = item.get("name")
                file_id   = item.get("id")
                rel_path  = item.get("relative_path", file_name)

                logger.info(f"[SharePoint] Transferring: {rel_path}")

                response = sp_client.download_file(drive_id, file_id)

                # Preserve subfolder structure under minio_prefix
                object_name = os.path.join(minio_prefix or "policies", rel_path).replace("\\", "/")
                minio_url = minio_client.upload_file(response.raw, object_name)

                transferred_files.append({"name": rel_path, "minio_url": minio_url})
                logger.info(f"[SharePoint] Uploaded → MinIO: {object_name}")

            if transferred_files:
                ingest_prefix = (minio_prefix.rstrip("/") + "/") if minio_prefix else "policies/"
                threading.Thread(
                    target=self._ingest_and_embed,
                    args=(ingest_prefix,),
                    daemon=True,
                ).start()
                logger.info(f"[SharePoint] Triggered background ingest: prefix={ingest_prefix}")

            return {
                "status": "success",
                "folder": folder_path,
                "transferred_count": len(transferred_files),
                "files": [f["name"] for f in transferred_files],
            }

        except Exception as e:
            logger.error(f"[SharePoint] Transfer error for {folder_path}: {e}")
            return {"status": "error", "folder": folder_path, "message": str(e)}

    def sync_all_policy_folders(self) -> dict:
        """
        Sync all folders configured in SHAREPOINT_POLICY_FOLDERS.
        Delegates to the direct SharePoint → DB sync (no MinIO middleman).
        """
        from app.services.sharepoint_policy_sync import sync_all_sharepoint_folders
        return sync_all_sharepoint_folders()

    @staticmethod
    def _ingest_and_embed(prefix: str):
        try:
            from app.services.policy_service import PolicyService
            PolicyService.ingest_from_minio(prefix=prefix)
            PolicyService.embed_all_policies()
        except Exception as e:
            logger.error(f"[SharePointTransfer] Ingest/embed error: {e}")


sharepoint_transfer_service = SharePointTransferService()
