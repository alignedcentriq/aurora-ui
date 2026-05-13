import requests
import datetime
import time
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import GraphSubscription, SharePointDeltaToken, SharePointFile, SyncFailureLog, Policy
from app.config import settings


class GraphClient:
    def __init__(self):
        self.tenant_id = settings.GRAPH_TENANT_ID
        self.client_id = settings.GRAPH_CLIENT_ID
        self.client_secret = settings.GRAPH_CLIENT_SECRET
        self.base_url = "https://graph.microsoft.com/v1.0"

        self._access_token = None
        self._token_expires_at = datetime.datetime.min

    def _get_token(self):
        if datetime.datetime.utcnow() < self._token_expires_at:
            return self._access_token

        url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        payload = {
            "client_id": self.client_id,
            "scope": "https://graph.microsoft.com/.default",
            "client_secret": self.client_secret,
            "grant_type": "client_credentials"
        }
        response = requests.post(url, data=payload)
        response.raise_for_status()
        data = response.json()
        self._access_token = data["access_token"]
        self._token_expires_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=data["expires_in"] - 60)
        return self._access_token

    def _headers(self):
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json"
        }

    def create_subscription(self, drive_id: str, webhook_url: str):
        url = f"{self.base_url}/subscriptions"
        expiration = datetime.datetime.utcnow() + datetime.timedelta(days=2) # Max 29 days for drives, but using 2 days for easier testing/renewal
        payload = {
            "changeType": "updated,deleted",
            "notificationUrl": webhook_url,
            "resource": f"/drives/{drive_id}/root",
            "expirationDateTime": expiration.isoformat() + "Z",
            "clientState": settings.GRAPH_CLIENT_STATE
        }

        
        response = requests.post(url, headers=self._headers(), json=payload)
        response.raise_for_status()
        return response.json()

    def renew_subscription(self, subscription_id: str):
        url = f"{self.base_url}/subscriptions/{subscription_id}"
        expiration = datetime.datetime.utcnow() + datetime.timedelta(days=2)
        payload = {
            "expirationDateTime": expiration.isoformat() + "Z"
        }
        response = requests.patch(url, headers=self._headers(), json=payload)
        response.raise_for_status()
        return response.json()

    def get_delta(self, drive_id: str, delta_link: str = None):
        url = delta_link if delta_link else f"{self.base_url}/drives/{drive_id}/root/delta"
        max_retries = 3
        for attempt in range(max_retries):
            response = requests.get(url, headers=self._headers())
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 5))
                print(f"Graph API Throttled (429). Retrying in {retry_after}s...")
                time.sleep(retry_after)
                continue
            if response.status_code == 410:
                # Resync required
                return self.get_delta(drive_id, None)
            
            response.raise_for_status()
            return response.json()
        
        raise Exception("Max retries exceeded for Graph API 429 Throttle")


    def get_file_metadata(self, drive_id: str, item_id: str):
        url = f"{self.base_url}/drives/{drive_id}/items/{item_id}"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        return response.json()

graph_client = GraphClient()

def process_document(file_metadata: dict, session: Session):
    """
    Existing document processing pipeline stub.
    Integrates with the HR Policies / knowledge base logic.
    """
    print(f"Processing document: {file_metadata.get('name')}")
    # Very basic processing: upsert as a policy
    name = file_metadata.get("name", "Unknown")
    path = file_metadata.get("path", "")
    web_url = file_metadata.get("web_url", "")
    
    # Check if policy exists
    policy = session.query(Policy).filter(Policy.title == name).first()
    if not policy:
        policy = Policy(
            title=name,
            category="SharePoint Imported",
            content=f"Document imported from SharePoint.\nURL: {web_url}\nPath: {path}"
        )
        session.add(policy)
    else:
        policy.content = f"Document updated from SharePoint.\nURL: {web_url}\nPath: {path}"
        policy.updated_at = datetime.datetime.utcnow()
    
    session.commit()

def process_sharepoint_changes(drive_id: str):
    session = SessionLocal()
    try:
        token_record = session.query(SharePointDeltaToken).filter_by(drive_id=drive_id).first()
        delta_link = token_record.delta_url if token_record else None
        
        has_more = True
        
        while has_more:
            try:
                result = graph_client.get_delta(drive_id, delta_link)
            except requests.exceptions.RequestException as e:
                # Log failure
                session.add(SyncFailureLog(resource_id=drive_id, error_type="DeltaSyncError", error_message=str(e)))
                session.commit()
                break
                
            values = result.get("value", [])
            
            for item in values:
                item_id = item.get("id")
                
                # Check idempotency/duplicate
                db_file = session.query(SharePointFile).filter_by(file_id=item_id).first()
                if not db_file:
                    db_file = SharePointFile(file_id=item_id, drive_id=drive_id)
                    session.add(db_file)
                
                if "deleted" in item:
                    db_file.is_deleted = True
                    db_file.processing_status = "Processed"
                    db_file.last_processed_at = datetime.datetime.utcnow()
                    
                    # Mark inactive in Policy (dummy implementation)
                    policy = session.query(Policy).filter(Policy.title == item.get("name")).first()
                    if policy:
                        policy.content = "[DELETED] " + policy.content
                else:
                    db_file.name = item.get("name")
                    if "parentReference" in item:
                        db_file.path = item["parentReference"].get("path")
                    db_file.web_url = item.get("webUrl")
                    
                    modified_str = item.get("lastModifiedDateTime")
                    if modified_str:
                         try:
                             db_file.last_modified = datetime.datetime.strptime(modified_str.split(".")[0].replace("Z", ""), "%Y-%m-%dT%H:%M:%S")
                         except Exception:
                             pass
                             
                    db_file.is_deleted = False
                    
                    try:
                        # Call processing integration
                        process_document({
                            "id": item_id,
                            "name": db_file.name,
                            "path": db_file.path,
                            "web_url": db_file.web_url
                        }, session)
                        db_file.processing_status = "Processed"
                        db_file.last_processed_at = datetime.datetime.utcnow()
                    except Exception as e:
                        db_file.processing_status = "Failed"
                        db_file.error_message = str(e)
                        session.add(SyncFailureLog(resource_id=item_id, error_type="ProcessingError", error_message=str(e)))

            if "@odata.nextLink" in result:
                delta_link = result["@odata.nextLink"]
            elif "@odata.deltaLink" in result:
                delta_link = result["@odata.deltaLink"]
                has_more = False
                
            # Update token
            if not token_record:
                token_record = SharePointDeltaToken(drive_id=drive_id)
                session.add(token_record)
                
            token_record.delta_url = delta_link
            token_record.last_sync = datetime.datetime.utcnow()
            session.commit()
            
    finally:
        session.close()

def renew_subscriptions():
    session = SessionLocal()
    try:
        # Renew subscriptions expiring within the next 2 hours
        threshold = datetime.datetime.utcnow() + datetime.timedelta(hours=2)
        subscriptions = session.query(GraphSubscription).filter(
            GraphSubscription.expiration_time <= threshold,
            GraphSubscription.status == "Active"
        ).all()
        
        for sub in subscriptions:
            try:
                res = graph_client.renew_subscription(sub.subscription_id)
                sub.expiration_time = datetime.datetime.strptime(res["expirationDateTime"].split(".")[0].replace("Z", ""), "%Y-%m-%dT%H:%M:%S")
                sub.status = "Active"
            except requests.exceptions.HTTPError as e:
                # If 404, the subscription is gone, need to recreate
                if e.response.status_code == 404:
                     try:
                         res = graph_client.create_subscription(sub.drive_id, sub.webhook_endpoint)
                         sub.subscription_id = res["id"]
                         sub.expiration_time = datetime.datetime.strptime(res["expirationDateTime"].split(".")[0].replace("Z", ""), "%Y-%m-%dT%H:%M:%S")
                         sub.status = "Active"
                     except Exception as ex:
                         sub.status = "Failed"
                         session.add(SyncFailureLog(resource_id=sub.drive_id, error_type="SubscriptionRecreationError", error_message=str(ex)))
                else:
                    sub.status = "Failed"
                    session.add(SyncFailureLog(resource_id=sub.subscription_id, error_type="SubscriptionRenewalError", error_message=str(e)))
            
            session.commit()
            
    finally:
        session.close()
