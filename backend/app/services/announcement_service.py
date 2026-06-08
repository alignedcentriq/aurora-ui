"""
Announcement service — HR, Admin, IT, and Manager can publish announcements.
All employees can read them via the Org agent.
"""

import datetime
import logging
from typing import Optional
from app.database import SessionLocal
from app.models import Announcement

logger = logging.getLogger("aurora-logger")

class AnnouncementService:

    @staticmethod
    def create(
        title: str,
        body: str,
        category: str,
        created_by: str,
        created_by_domain: str,
        target_audience: str = "all",
        expires_days: Optional[int] = None,
        image_url: Optional[str] = None,
        image_action: Optional[dict] = None,
        email_recipients: Optional[list] = None,
    ) -> str:
        db = SessionLocal()
        try:
            expires_at = None
            if expires_days:
                expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=expires_days)

            ann = Announcement(
                title=title,
                body=body,
                category=category or "General",
                created_by=created_by,
                created_by_domain=created_by_domain,
                target_audience=target_audience,
                is_active=True,
                image_url=image_url,
                image_action=image_action,
                email_recipients=email_recipients or [],
                expires_at=expires_at,
            )
            db.add(ann)
            db.commit()
            db.refresh(ann)

            # Email blast: use explicit recipients if provided, else ADMIN_EMAIL
            try:
                from app.services.email_service import send_announcement_email
                from app.config import settings
                recipients = email_recipients if email_recipients else [settings.ADMIN_EMAIL]
                recipients = [r for r in recipients if r]
                if recipients:
                    send_announcement_email(
                        user_email=created_by,
                        recipients=recipients,
                        title=title,
                        body=body,
                        category=category,
                        sent_by=created_by,
                        image_url=image_url,
                    )
            except Exception as e:
                logger.warning(f"Announcement email failed: {e}")

            # Notify PA monitoring mailbox
            try:
                from app.services.email_service import send_notification_event
                send_notification_event(
                    "announcement_created",
                    f"[{category}] {title}",
                    {
                        "announcement_id": ann.id,
                        "title": title,
                        "body_preview": body[:300],
                        "category": category,
                        "target_audience": target_audience,
                        "created_by": created_by,
                    }
                )
            except Exception:
                pass

            # Notify PA — triggers Teams channel post
            try:
                from app.services.admin_service import AdminService
                from app.config import settings as _s
                AdminService._fire_webhook(_s.PA_WEBHOOK_ANNOUNCEMENT_CREATED, {
                    "event": "announcement_created",
                    "announcement_id": ann.id,
                    "title": title,
                    "body": body[:300],
                    "category": category,
                    "target_audience": target_audience,
                    "created_by": created_by,
                    "image_url": image_url or "",
                    "created_at": ann.created_at.isoformat() + "Z",
                })
            except Exception:
                pass

            return (
                f"Announcement '{title}' published successfully (ID: {ann.id}). "
                f"Category: {category} | Audience: {target_audience}."
            )
        finally:
            db.close()

    @staticmethod
    def get_active(domain_filter: Optional[str] = None, limit: int = 10) -> str:
        db = SessionLocal()
        try:
            now = datetime.datetime.utcnow()
            q = db.query(Announcement).filter(
                Announcement.is_active == True,
                (Announcement.expires_at == None) | (Announcement.expires_at > now),
            )
            if domain_filter:
                q = q.filter(Announcement.created_by_domain == domain_filter)

            results = q.order_by(Announcement.created_at.desc()).limit(limit).all()
            if not results:
                return "No active announcements at this time."

            lines = [f"**Latest Announcements ({len(results)}):**\n"]
            for a in results:
                date_str = a.created_at.strftime("%d %b %Y")
                lines.append(
                    f"### [{a.category}] {a.title}\n"
                    f"{a.body}\n"
                    f"*Posted by {a.created_by} on {date_str}*\n"
                )
            return "\n---\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def update(
        announcement_id: int,
        updated_by: str,
        title: Optional[str] = None,
        body: Optional[str] = None,
        category: Optional[str] = None,
        expires_days: Optional[int] = None,
    ) -> str:
        db = SessionLocal()
        try:
            ann = db.query(Announcement).filter(Announcement.id == announcement_id).first()
            if not ann:
                return f"Announcement #{announcement_id} not found."
            if title is not None:
                ann.title = title
            if body is not None:
                ann.body = body
            if category is not None and category in ALLOWED_CATEGORIES:
                ann.category = category
            if expires_days is not None:
                ann.expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=expires_days)
            db.commit()
            return f"Announcement #{announcement_id} updated."
        finally:
            db.close()

    @staticmethod
    def deactivate(announcement_id: int, requested_by: str, recall: bool = False) -> str:
        db = SessionLocal()
        try:
            ann = db.query(Announcement).filter(Announcement.id == announcement_id).first()
            if not ann:
                return f"Announcement #{announcement_id} not found."

            if recall:
                try:
                    from app.services.email_service import send_announcement_recall_email
                    from app.config import settings
                    recipients = list(ann.email_recipients or []) or [settings.ADMIN_EMAIL]
                    recipients = [r for r in recipients if r]
                    if recipients:
                        send_announcement_recall_email(
                            user_email=requested_by,
                            recipients=recipients,
                            title=ann.title,
                            category=ann.category,
                            recalled_by=requested_by,
                        )
                except Exception as e:
                    logger.warning(f"Recall email failed: {e}")

            ann.is_active = False
            db.commit()
            return f"Announcement '{ann.title}' (#{announcement_id}) has been deactivated."
        finally:
            db.close()

    @staticmethod
    def list_all(include_inactive: bool = False, user_role: Optional[str] = None) -> list:
        db = SessionLocal()
        try:
            q = db.query(Announcement)
            if not include_inactive:
                q = q.filter(Announcement.is_active == True)
            results = q.order_by(Announcement.created_at.desc()).all()

            role_lower = (user_role or "employee").strip().lower()
            filtered_results = []
            for a in results:
                aud = (a.target_audience or "all").strip().lower()
                if aud in ("all", ""):
                    filtered_results.append(a)
                elif aud == "admin":
                    if role_lower in ("admin", "super admin"):
                        filtered_results.append(a)
                elif aud in ("super_admin", "super admin"):
                    if role_lower == "super admin":
                        filtered_results.append(a)
                elif aud == "non-employee":
                    if role_lower != "employee":
                        filtered_results.append(a)
                elif aud == role_lower:
                    filtered_results.append(a)

            return [
                {
                    "id": a.id,
                    "title": a.title,
                    "body": a.body,
                    "category": a.category,
                    "created_by": a.created_by,
                    "created_by_domain": a.created_by_domain,
                    "target_audience": a.target_audience,
                    "is_active": a.is_active,
                    "image_url": a.image_url,
                    "image_action": a.image_action,
                    "email_recipients": a.email_recipients or [],
                    "created_at": a.created_at.isoformat(),
                    "expires_at": a.expires_at.isoformat() if a.expires_at else None,
                }
                for a in filtered_results
            ]
        finally:
            db.close()
