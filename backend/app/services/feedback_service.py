import re
from app.database import SessionLocal
from app.models import ChatFeedback


_STOP_WORDS = {
    "what", "how", "can", "the", "is", "are", "my", "for", "do", "a", "an",
    "i", "me", "you", "your", "this", "that", "was", "were", "will", "have",
    "has", "had", "been", "be", "with", "from", "about", "when", "where",
    "who", "which", "why", "and", "or", "but", "not", "get", "show", "tell",
    "give", "list", "find", "please", "help", "want", "need", "like",
}


def _keywords(text: str) -> set[str]:
    return {
        w.lower()
        for w in re.findall(r"\w+", text or "")
        if len(w) > 3 and w.lower() not in _STOP_WORDS
    }


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
        """Return highest-rated AI responses for a domain (used to seed future context)."""
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
                {"question": r.user_message, "answer": r.ai_response}
                for r in rows
                if r.user_message and r.ai_response
            ]
        finally:
            db.close()

    @staticmethod
    def get_relevant_feedback(domain: str, query: str, limit: int = 3) -> dict:
        """
        Find past feedback whose user_message overlaps with the current query.
        Uses keyword intersection (no embeddings required).
        Returns {"negative": [...], "positive": [...]}
        """
        query_kw = _keywords(query)
        if not query_kw:
            return {"negative": [], "positive": []}

        db = SessionLocal()
        try:
            q = db.query(ChatFeedback)
            if domain and domain not in ("unknown", ""):
                q = q.filter(ChatFeedback.domain == domain)

            rows = q.all()

            def overlap_score(fb: ChatFeedback) -> int:
                return len(query_kw & _keywords(fb.user_message or ""))

            scored = [(overlap_score(fb), fb) for fb in rows]
            scored = [(s, fb) for s, fb in scored if s > 0]
            scored.sort(key=lambda x: x[0], reverse=True)

            negative = [
                {
                    "question": fb.user_message,
                    "bad_answer": fb.ai_response,
                    "reason": fb.feedback_text or "User marked this answer as unhelpful",
                }
                for _, fb in scored
                if fb.rating == -1
            ][:limit]

            positive = [
                {
                    "question": fb.user_message,
                    "good_answer": fb.ai_response,
                }
                for _, fb in scored
                if fb.rating == 1
            ][:limit]

            return {"negative": negative, "positive": positive}
        finally:
            db.close()

    @staticmethod
    def build_feedback_prompt(feedback: dict) -> str:
        """
        Convert get_relevant_feedback() output into a text block to inject into system prompts.
        Returns empty string when there is no relevant feedback.
        """
        negative = feedback.get("negative", [])
        positive = feedback.get("positive", [])
        if not negative and not positive:
            return ""

        lines: list[str] = ["\n\n--- FEEDBACK CONTEXT (from previous user ratings) ---"]

        if negative:
            lines.append(
                "CAUTION: Users previously rated similar answers as UNHELPFUL. "
                "Do NOT repeat these mistakes:"
            )
            for i, item in enumerate(negative, 1):
                lines.append(f"  [{i}] Question: \"{item['question']}\"")
                lines.append(f"      Bad answer given: \"{item['bad_answer'][:300]}\"")
                lines.append(f"      Reason it was wrong: \"{item['reason']}\"")
            lines.append(
                "If your answer differs from a previous bad answer, start with: "
                "\"Based on user feedback, here is an updated and corrected answer:\""
            )

        if positive:
            lines.append(
                "REFERENCE: Users previously rated these answers as HELPFUL for similar questions:"
            )
            for i, item in enumerate(positive, 1):
                lines.append(f"  [{i}] Question: \"{item['question']}\"")
                lines.append(f"      Good answer: \"{item['good_answer'][:300]}\"")
            lines.append("Use these as style and accuracy references.")

        lines.append("--- END FEEDBACK CONTEXT ---")
        return "\n".join(lines)

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
