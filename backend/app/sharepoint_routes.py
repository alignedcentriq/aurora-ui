from fastapi import APIRouter, Request, Response, BackgroundTasks, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.graph_sync import process_sharepoint_changes
from app.config import settings
from app.sharepoint_transfer_service import sharepoint_transfer_service
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/webhooks/sharepoint")
async def sharepoint_webhook(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # Handle Validation Token Handshake
    validation_token = request.query_params.get("validationToken")
    if validation_token:
        # Must return plain text response with the validation token
        return Response(content=validation_token, media_type="text/plain", status_code=200)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not body or "value" not in body:
        raise HTTPException(status_code=400, detail="Invalid payload")

    for notification in body["value"]:
        client_state = notification.get("clientState")
        if client_state != settings.GRAPH_CLIENT_STATE:
            print("Invalid clientState in webhook notification")
            continue


        resource = notification.get("resource", "")
        # Extract drive_id from resource like /drives/{drive_id}/root
        parts = resource.split("/")
        if len(parts) >= 3 and parts[1] == "drives":
            drive_id = parts[2]
            # Push valid event to async worker
            background_tasks.add_task(process_sharepoint_changes, drive_id)

    return Response(status_code=202)

class TransferRequest(BaseModel):
    site_name: str # e.g. "tenant.sharepoint.com:/sites/SiteName"
    folder_path: str # e.g. "Shared Documents/General"
    minio_prefix: Optional[str] = ""

@router.post("/transfer-to-minio")
async def trigger_transfer(request: TransferRequest, background_tasks: BackgroundTasks):
    """
    Triggers a background task to transfer documents from SharePoint to MinIO.
    """
    background_tasks.add_task(
        sharepoint_transfer_service.transfer_folder_to_minio,
        request.site_name,
        request.folder_path,
        request.minio_prefix
    )
    return {"message": "Transfer started in background", "site": request.site_name, "folder": request.folder_path}


@router.post("/sharepoint/sync-policies")
async def sync_sharepoint_policies(background_tasks: BackgroundTasks):
    """
    Sync all folders from SHAREPOINT_POLICY_FOLDERS directly from SharePoint
    into the DB (no MinIO middleman). Downloads → extracts text → chunks → embeds.
    Runs in background — returns immediately.
    """
    from app.config import settings
    if not settings.SHAREPOINT_SITE_URL:
        raise HTTPException(status_code=400, detail="SHAREPOINT_SITE_URL is not configured.")

    from app.services.sharepoint_policy_sync import sync_all_sharepoint_folders
    background_tasks.add_task(sync_all_sharepoint_folders)
    folders = [f.strip() for f in (settings.SHAREPOINT_POLICY_FOLDERS or "").split(",") if f.strip()]
    return {
        "message": "SharePoint policy sync started in background.",
        "folders": folders,
    }
