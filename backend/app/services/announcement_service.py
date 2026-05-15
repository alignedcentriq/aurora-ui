"""
Announcement service — HR, Admin, IT, and Manager can publish announcements.
All employees can read them via the Org agent.
"""

import datetime
from typing import Optional
from app.database import SessionLocal
from app.models import Announcement

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
                expires_at=expires_at,
            )
            db.add(ann)
            db.commit()
            db.refresh(ann)
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
                    "created_at": a.created_at.isoformat(),
                    "expires_at": a.expires_at.isoformat() if a.expires_at else None,
                }
                for a in results
            ]
        finally:
            db.close()
