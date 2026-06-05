import re
from app.database import SessionLocal
from app.models import ChatFeedback


def _get_embedding(text: str) -> list | None:
    try:
        from openai import OpenAI
        from app.config import settings
        client = OpenAI(base_url=settings.EMBEDDING_BASE_URL, api_key=settings.EMBEDDING_API_KEY)
        resp = client.embeddings.create(input=text[:2000], model=settings.EMBEDDING_MODEL_NAME)
        return resp.data[0].embedding
    except Exception:
        return None


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
        emb = _get_embedding(user_message) if user_message else None
        db = SessionLocal()
        try:
            entry = ChatFeedback(
                session_id=session_id,
                domain=domain,
                user_message=user_message,
                ai_response=ai_response,
                rating=rating,
                feedback_text=feedback_text or "",
                user_message_embedding=emb,
            )
            db.add(entry)
            db.commit()
        finally:
            db.close()

        # A thumbs-down means the served answer was wrong. If it came from the semantic
        # answer cache, purge it so the bad answer stops being served verbatim next time.
        if rating == -1 and user_message:
            try:
                from app.services.answer_cache_service import AnswerCacheService
                removed = AnswerCacheService.invalidate_by_query(user_message)
                if removed:
                    print(f"[Feedback] thumbs-down purged {removed} cached answer(s) for: {user_message[:60]!r}")
            except Exception as e:
                print(f"[Feedback] cache purge skipped ({type(e).__name__}): {e}")

        return "Feedback recorded. Thank you!"

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
        Find past feedback semantically similar to the current query.
        Uses pgvector cosine distance when embeddings are available;
        falls back to keyword intersection otherwise.
        Returns {"negative": [...], "positive": [...]}
        """
        if not query:
            return {"negative": [], "positive": []}

        db = SessionLocal()
        try:
            base_q = db.query(ChatFeedback)
            if domain and domain not in ("unknown", ""):
                base_q = base_q.filter(ChatFeedback.domain == domain)

            query_emb = _get_embedding(query)
            if query_emb:
                dist_expr = ChatFeedback.user_message_embedding.cosine_distance(query_emb)
                rows = (
                    base_q
                    .filter(
                        ChatFeedback.user_message_embedding.isnot(None),
                        dist_expr < 0.7,
                    )
                    .order_by(dist_expr)
                    .limit(limit * 4)
                    .all()
                )
            else:
                query_kw = _keywords(query)
                all_rows = base_q.all()
                scored = [
                    (len(query_kw & _keywords(fb.user_message or "")), fb)
                    for fb in all_rows
                    if fb.user_message
                ]
                scored = [(s, fb) for s, fb in scored if s > 0]
                scored.sort(key=lambda x: x[0], reverse=True)
                rows = [fb for _, fb in scored[: limit * 4]]

            negative = [
                {
                    "question": fb.user_message,
                    "bad_answer": fb.ai_response,
                    "reason": fb.feedback_text or "User marked this answer as unhelpful",
                }
                for fb in rows
                if fb.rating == -1
            ][:limit]

            positive = [
                {
                    "question": fb.user_message,
                    "good_answer": fb.ai_response,
                }
                for fb in rows
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
