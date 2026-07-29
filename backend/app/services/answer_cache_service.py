"""
Semantic Answer Cache for Centriq AI.

Repeat / near-identical informational questions are the biggest avoidable latency: each one
re-runs a generation call on the shared GPU (~2-5s) even when the same thing was asked seconds
ago. This service returns a stored answer instantly (~50ms, zero LLM calls) when the incoming
question is semantically near-identical to one already answered.

Design notes:
  * Lookup is by embedding similarity (pgvector HNSW), reusing PolicyService._get_embedding
    (same model + in-memory embedding cache — no duplicate client).
  * SAFETY: only informational answers are ever stored (see main.py store gate). Actions,
    drafts, and widget responses never enter the cache, so a lookup can never trigger a side
    effect or serve a stale action.
  * FRESHNESS: policy-derived rows carry source_keys and are invalidated the moment the
    underlying SharePoint doc changes; a max-age also caps every row as a safety net.
"""

import datetime

from app.config import settings
from app.database import SessionLocal
from app.models import CachedAnswer
from app.services.policy_service import PolicyService


class AnswerCacheService:
    @staticmethod
    def lookup(query: str, domain: str | None = None):
        """Return a dict {answer, domain, sub_intent, cached_id} for a near-identical prior
        question, or None. Only returns a hit above the configured similarity threshold and
        within the max-age window. Bumps hit_count / last_used_at on a hit.
        """
        if not settings.ANSWER_CACHE_ENABLED:
            return None

        query = (query or "").strip()
        if not query:
            return None

        query_emb = PolicyService._get_embedding(query)
        if not query_emb:
            return None  # embedding model unavailable — fall through to normal path

        # similarity >= threshold  <=>  cosine_distance <= (1 - threshold)
        max_dist = 1.0 - settings.ANSWER_CACHE_SIM_THRESHOLD
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=settings.ANSWER_CACHE_MAX_AGE_DAYS)

        db = SessionLocal()
        try:
            dist_expr = CachedAnswer.query_embedding.cosine_distance(query_emb)
            q = (
                db.query(CachedAnswer, dist_expr.label("dist"))
                .filter(
                    CachedAnswer.query_embedding.isnot(None),
                    CachedAnswer.created_at >= cutoff,
                    dist_expr <= max_dist,
                )
            )
            if domain:
                q = q.filter(CachedAnswer.domain == domain)
            row = q.order_by(dist_expr).limit(1).first()
            if row is None:
                return None

            cached, dist = row
            cached.hit_count = (cached.hit_count or 0) + 1
            cached.last_used_at = datetime.datetime.utcnow()
            result = {
                "answer": cached.answer_text,
                "domain": cached.domain,
                "sub_intent": cached.sub_intent,
                "cached_id": cached.id,
                "similarity": round(1.0 - float(dist), 4),
            }
            db.commit()
            return result
        except Exception as e:
            db.rollback()
            return None
        finally:
            db.close()

    @staticmethod
    def store(query: str, answer: str, domain: str | None = None,
              sub_intent: str | None = None, source_keys: list | None = None,
              is_seed: bool = False) -> int | None:
        """Store an informational answer, returning its id (or None on failure). Caller is
        responsible for the safety gate (only call this for non-action, non-widget,
        informational responses)."""
        if not settings.ANSWER_CACHE_ENABLED:
            return None

        query = (query or "").strip()
        answer = (answer or "").strip()
        if not query or not answer:
            return None

        query_emb = PolicyService._get_embedding(query)
        if not query_emb:
            return None

        db = SessionLocal()
        try:
            row = CachedAnswer(
                query_text=query,
                query_embedding=query_emb,
                answer_text=answer,
                domain=domain,
                sub_intent=sub_intent,
                source_keys=source_keys or [],
                is_seed=is_seed,
                hit_count=0,
            )
            db.add(row)
            db.commit()
            return row.id
        except Exception as e:
            db.rollback()
            return None
        finally:
            db.close()

    @staticmethod
    def invalidate_by_source_key(source_key: str) -> int:
        """Delete cached answers built from the given policy source_key. Returns rows deleted."""
        if not source_key:
            return 0
        db = SessionLocal()
        try:
            deleted = 0
            # source_keys is a JSON list; match any row that referenced this key.
            for row in db.query(CachedAnswer).filter(CachedAnswer.source_keys.isnot(None)).all():
                keys = row.source_keys or []
                if source_key in keys:
                    db.delete(row)
                    deleted += 1
            if deleted:
                db.commit()
            return deleted
        except Exception as e:
            db.rollback()
            return 0
        finally:
            db.close()

    @staticmethod
    def invalidate_by_query(query: str, min_similarity: float = 0.95) -> int:
        """Delete cached answer(s) whose stored question is near-identical to `query`.
        Called when a user thumbs-downs an answer so the bad cached response stops being
        served verbatim on the next ask. Tight similarity so unrelated answers are untouched."""
        if not settings.ANSWER_CACHE_ENABLED:
            return 0
        query = (query or "").strip()
        if not query:
            return 0
        query_emb = PolicyService._get_embedding(query)
        if not query_emb:
            return 0
        max_dist = 1.0 - min_similarity
        db = SessionLocal()
        try:
            dist_expr = CachedAnswer.query_embedding.cosine_distance(query_emb)
            rows = (
                db.query(CachedAnswer)
                .filter(CachedAnswer.query_embedding.isnot(None), dist_expr <= max_dist)
                .all()
            )
            deleted = len(rows)
            for r in rows:
                db.delete(r)
            if deleted:
                db.commit()
            return deleted
        except Exception as e:
            db.rollback()
            return 0
        finally:
            db.close()

    @staticmethod
    def invalidate_by_subintent(sub_intents: list[str]) -> int:
        """Delete all cached answers for the given sub_intents (e.g. dynamic
        directory lookups that should never have been cached). Returns rows deleted."""
        if not sub_intents:
            return 0
        db = SessionLocal()
        try:
            deleted = (
                db.query(CachedAnswer)
                .filter(CachedAnswer.sub_intent.in_(sub_intents))
                .delete(synchronize_session=False)
            )
            db.commit()
            return deleted
        except Exception as e:
            db.rollback()
            return 0
        finally:
            db.close()

    @staticmethod
    def invalidate_domain(domain: str) -> int:
        """Delete all cached answers for a domain (e.g. when a doc's category changed)."""
        if not domain:
            return 0
        db = SessionLocal()
        try:
            deleted = db.query(CachedAnswer).filter(CachedAnswer.domain == domain).delete()
            db.commit()
            return deleted
        except Exception as e:
            db.rollback()
            return 0
        finally:
            db.close()
