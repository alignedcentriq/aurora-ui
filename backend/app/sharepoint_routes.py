from fastapi import APIRouter, Request, Response, BackgroundTasks, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.graph_sync import process_sharepoint_changes
from app.config import settings

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
