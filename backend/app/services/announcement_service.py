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

ALLOWED_CATEGORIES = {
    "Policy Update", "Holiday", "Events", "Hiring", "Training", "General", "IT Alert"
}


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
    ) -> str:
        db = SessionLocal()
        try:
            if category not in ALLOWED_CATEGORIES:
                category = "General"

            expires_at = None
            if expires_days:
                expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=expires_days)

            ann = Announcement(
                title=title,
                body=body,
                category=category,
                created_by=created_by,
                created_by_domain=created_by_domain,
                target_audience=target_audience,
                is_active=True,
                image_url=image_url,
                expires_at=expires_at,
            )
            db.add(ann)
            db.commit()
            db.refresh(ann)

            # Broadcast email notification
            try:
                from app.services.email_service import send_announcement_email
                from app.config import settings
                send_announcement_email(
                    recipients=[settings.ADMIN_EMAIL],
                    title=title,
                    body=body,
                    category=category,
                    sent_by=created_by,
                    image_url=image_url,
                )
            except Exception as e:
                logger.warning(f"Announcement email failed: {e}")

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
    def deactivate(announcement_id: int, requested_by: str) -> str:
        db = SessionLocal()
        try:
            ann = db.query(Announcement).filter(Announcement.id == announcement_id).first()
            if not ann:
                return f"Announcement #{announcement_id} not found."
            ann.is_active = False
            db.commit()
            return f"Announcement '{ann.title}' (#{announcement_id}) has been deactivated."
        finally:
            db.close()

    @staticmethod
    def list_all(include_inactive: bool = False) -> list:
        db = SessionLocal()
        try:
            q = db.query(Announcement)
            if not include_inactive:
                q = q.filter(Announcement.is_active == True)
            results = q.order_by(Announcement.created_at.desc()).all()
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
                    "created_at": a.created_at.isoformat(),
                    "expires_at": a.expires_at.isoformat() if a.expires_at else None,
                }
                for a in results
            ]
        finally:
            db.close()
