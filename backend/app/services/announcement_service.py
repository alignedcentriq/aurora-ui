"""
Announcement service — HR, Admin, IT, and Manager can publish announcements.
All employees can read them via the Org agent.
"""

import datetime
import logging
from typing import Optional
from app.database import SessionLocal
from app.models import Announcement, AnnouncementReceipt

logger = logging.getLogger("aurora-logger")

# Engagement mechanics — the fixed reaction set and valid RSVP values.
ALLOWED_REACTIONS = {"👍", "🎉", "❤️"}
ALLOWED_RSVP = {"yes", "no", "maybe"}

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
        allow_reactions: bool = False,
        allow_rsvp: bool = False,
        require_ack: bool = False,
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
                allow_reactions=allow_reactions,
                allow_rsvp=allow_rsvp,
                require_ack=require_ack,
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
    def list_all(
        include_inactive: bool = False,
        user_role: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> list:
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

            # The caller's own receipt for each visible announcement (their reaction /
            # rsvp / ack state) so the feed can render the right initial UI.
            my_receipts = {}
            if user_email and filtered_results:
                ids = [a.id for a in filtered_results]
                rows = (
                    db.query(AnnouncementReceipt)
                    .filter(
                        AnnouncementReceipt.user_email == user_email,
                        AnnouncementReceipt.announcement_id.in_(ids),
                    )
                    .all()
                )
                my_receipts = {r.announcement_id: r for r in rows}

            out = []
            for a in filtered_results:
                mine = my_receipts.get(a.id)
                out.append({
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
                    "allow_reactions": bool(a.allow_reactions),
                    "allow_rsvp": bool(a.allow_rsvp),
                    "require_ack": bool(a.require_ack),
                    "created_at": a.created_at.isoformat(),
                    "expires_at": a.expires_at.isoformat() if a.expires_at else None,
                    # Caller's own engagement state (null if never seen/interacted).
                    "my_reaction": mine.reaction if mine else None,
                    "my_rsvp": mine.rsvp if mine else None,
                    "my_acknowledged": bool(mine and mine.acknowledged_at) if mine else False,
                })
            return out
        finally:
            db.close()

    # ── Read-tracking spine ──────────────────────────────────────────────────
    @staticmethod
    def _upsert_receipt(db, announcement_id: int, user_email: str) -> "AnnouncementReceipt":
        """Fetch-or-create the (announcement, user) receipt row. Caller commits."""
        r = (
            db.query(AnnouncementReceipt)
            .filter(
                AnnouncementReceipt.announcement_id == announcement_id,
                AnnouncementReceipt.user_email == user_email,
            )
            .first()
        )
        if r is None:
            r = AnnouncementReceipt(announcement_id=announcement_id, user_email=user_email)
            db.add(r)
        return r

    @staticmethod
    def record_seen(announcement_id: int, user_email: str) -> dict:
        """Record that a user has seen an announcement (idempotent)."""
        if not user_email:
            return {"ok": False}
        db = SessionLocal()
        try:
            AnnouncementService._upsert_receipt(db, announcement_id, user_email)
            db.commit()
            return {"ok": True}
        finally:
            db.close()

    @staticmethod
    def set_reaction(announcement_id: int, user_email: str, reaction: Optional[str]) -> dict:
        """Set or clear (reaction=None / not in set) the caller's reaction."""
        db = SessionLocal()
        try:
            r = AnnouncementService._upsert_receipt(db, announcement_id, user_email)
            # Tapping the same reaction again toggles it off.
            if reaction not in ALLOWED_REACTIONS or reaction == r.reaction:
                r.reaction = None
            else:
                r.reaction = reaction
            db.commit()
            return {"ok": True, "reaction": r.reaction}
        finally:
            db.close()

    @staticmethod
    def set_rsvp(announcement_id: int, user_email: str, rsvp: Optional[str]) -> dict:
        db = SessionLocal()
        try:
            r = AnnouncementService._upsert_receipt(db, announcement_id, user_email)
            r.rsvp = rsvp if rsvp in ALLOWED_RSVP else None
            db.commit()
            return {"ok": True, "rsvp": r.rsvp}
        finally:
            db.close()

    @staticmethod
    def acknowledge(announcement_id: int, user_email: str) -> dict:
        db = SessionLocal()
        try:
            r = AnnouncementService._upsert_receipt(db, announcement_id, user_email)
            if r.acknowledged_at is None:
                r.acknowledged_at = datetime.datetime.utcnow()
            db.commit()
            return {"ok": True, "acknowledged_at": r.acknowledged_at.isoformat()}
        finally:
            db.close()

    @staticmethod
    def get_receipts(announcement_id: int) -> dict:
        """Aggregate roll-up for an announcement — for authors / reach analytics.

        Returns seen count, reaction tallies, the RSVP roster (who said yes/no/maybe),
        and the acknowledgment list. Names are resolved best-effort from Employee.
        """
        from app.models import Employee
        db = SessionLocal()
        try:
            rows = (
                db.query(AnnouncementReceipt)
                .filter(AnnouncementReceipt.announcement_id == announcement_id)
                .all()
            )
            emails = {r.user_email for r in rows}
            name_by_email = {}
            if emails:
                for e in db.query(Employee.email, Employee.name).filter(Employee.email.in_(emails)).all():
                    name_by_email[e.email] = e.name or e.email

            reactions: dict = {}
            rsvp_roster: dict = {"yes": [], "no": [], "maybe": []}
            acknowledged = []
            for r in rows:
                who = {"email": r.user_email, "name": name_by_email.get(r.user_email, r.user_email)}
                if r.reaction:
                    reactions[r.reaction] = reactions.get(r.reaction, 0) + 1
                if r.rsvp in rsvp_roster:
                    rsvp_roster[r.rsvp].append(who)
                if r.acknowledged_at:
                    acknowledged.append({**who, "at": r.acknowledged_at.isoformat()})

            return {
                "announcement_id": announcement_id,
                "seen_count": len(rows),
                "reactions": reactions,
                "rsvp": rsvp_roster,
                "acknowledged": acknowledged,
                "acknowledged_count": len(acknowledged),
            }
        finally:
            db.close()
