import logging
from app.graph_sync import graph_client
from app.minio_client import minio_client
import os

logger = logging.getLogger(__name__)

class SharePointTransferService:
    def transfer_folder_to_minio(self, site_name: str, folder_path: str, minio_prefix: str = ""):
        """
        Pulls documents from a SharePoint folder and transfers them to MinIO.
        site_name: e.g. 'tenant.sharepoint.com:/sites/SiteName'
        folder_path: e.g. 'Shared Documents/General'
        minio_prefix: prefix for the objects in MinIO
        """
        try:
            logger.info(f"Starting transfer from SharePoint site: {site_name}, folder: {folder_path}")
            
            # 1. Get Site ID
            site_id = graph_client.get_site_id(site_name)
            if not site_id:
                raise Exception(f"Could not find site: {site_name}")

            # 2. Get Drive ID
            drive_id = graph_client.get_drive_id(site_id)
            if not drive_id:
                raise Exception(f"Could not find drive for site: {site_name}")

            # 3. List folder contents
            items = graph_client.list_folder_contents(drive_id, folder_path)
            
            transferred_files = []
            for item in items:
                # Skip folders for now, only transfer files
                if "file" in item:
                    file_name = item.get("name")
                    file_id = item.get("id")
                    
                    logger.info(f"Transferring file: {file_name}")
                    
                    # 4. Download file from SharePoint
                    response = graph_client.download_file(drive_id, file_id)
                    
                    # 5. Upload to MinIO
                    object_name = os.path.join(minio_prefix, file_name).replace("\\", "/")
                    minio_url = minio_client.upload_file(response.raw, object_name)
                    
                    transferred_files.append({
                        "name": file_name,
                        "minio_url": minio_url
                    })
                    logger.info(f"Successfully transferred {file_name} to MinIO")
            
            return {
                "status": "success",
                "transferred_count": len(transferred_files),
                "files": transferred_files
            }

        except Exception as e:
            logger.error(f"Error during SharePoint to MinIO transfer: {str(e)}")
            return {
                "status": "error",
                "message": str(e)
            }

sharepoint_transfer_service = SharePointTransferService()
