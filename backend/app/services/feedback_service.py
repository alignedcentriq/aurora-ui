from app.database import SessionLocal
from app.models import ChatFeedback


class FeedbackService:

    @staticmethod
    def record(
        session_id: str,
        domain: str,
        user_message: str,
        ai_response: str,
        rating: int,
        feedback_text: str = "",
    ) -> str:
        db = SessionLocal()
        try:
            entry = ChatFeedback(
                session_id=session_id,
                domain=domain,
                user_message=user_message,
                ai_response=ai_response,
                rating=rating,
                feedback_text=feedback_text or "",
            )
            db.add(entry)
            db.commit()
            return "Feedback recorded. Thank you!"
        finally:
            db.close()

    @staticmethod
    def get_top_responses(domain: str, limit: int = 5) -> list[dict]:
        """Return the highest-rated AI responses for a domain (used to seed future context)."""
        db = SessionLocal()
        try:
            rows = (
                db.query(ChatFeedback)
                .filter(ChatFeedback.domain == domain, ChatFeedback.rating == 1)
                .order_by(ChatFeedback.created_at.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "question": r.user_message,
                    "answer": r.ai_response,
                }
                for r in rows
                if r.user_message and r.ai_response
            ]
        finally:
            db.close()

    @staticmethod
    def get_stats(domain: str = "") -> dict:
        db = SessionLocal()
        try:
            q = db.query(ChatFeedback)
            if domain:
                q = q.filter(ChatFeedback.domain == domain)
            total = q.count()
            helpful = q.filter(ChatFeedback.rating == 1).count()
            unhelpful = q.filter(ChatFeedback.rating == -1).count()
            return {
                "total": total,
                "helpful": helpful,
                "unhelpful": unhelpful,
                "score_pct": round(helpful / total * 100) if total else 0,
            }
        finally:
            db.close()
