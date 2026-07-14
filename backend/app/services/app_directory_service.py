"""
URL Library / App Directory service for Centriq AI.

Admins register external apps/websites (name, URL, purpose, capabilities) via the admin
URL Library page. Each app's combined text is embedded once; at chat time a user's query is
matched against those embeddings by pgvector cosine similarity. This makes a newly-launched
app discoverable the moment an admin adds a row — no code change, no redeploy.

Surfaced two ways (both call `search` here):
  * the general agent's `find_apps` tool — explicit asks ("is there an app for expenses?")
  * a proactive nudge injected into feedback_context — mid-conversation mentions in any domain

Mirrors AnswerCacheService for the embed + cosine-k-NN pattern and reuses the shared,
cached, fail-soft PolicyService._get_embedding (no new embedding client).
"""

import re

from app.config import settings
from app.database import SessionLocal
from app.models import AppLink, AiRequestLog
from app.services.answer_cache_service import AnswerCacheService
from app.services.form_library_service import validate_trigger_keywords, _GENERIC_KW_DENYLIST
from app.services.policy_service import PolicyService

# Answer-cache domains whose stored answers might embed an app link via the nudge; cleared on
# any URL-library change so a renamed/removed/re-pointed app can never be served stale.
_AFFECTED_CACHE_DOMAINS = ("general", "hr", "admin")

# Stopwords dropped when mining candidate keyword phrases from real queries (below).
_KW_STOP = {
    "what", "how", "can", "the", "is", "are", "for", "do", "does", "a", "an", "i", "me", "you",
    "your", "this", "that", "with", "from", "about", "when", "where", "who", "which", "why",
    "and", "or", "but", "not", "get", "got", "show", "tell", "give", "list", "find", "please",
    "want", "need", "any", "there", "have", "has", "would", "could", "should", "will", "to",
    "of", "in", "on", "at", "it", "be", "am", "was", "were", "my", "our", "we", "us",
}


# Shared impl (also re-exported so `from ...app_directory_service import _cosine` keeps working).
from app.services.vector_utils import cosine as _cosine


class AppDirectoryService:
    @staticmethod
    def _embed_text(name: str, purpose: str, capabilities: str | None):
        """Embed the combined descriptive text of an app. Returns a 768-dim list or None."""
        combined = ". ".join(p.strip() for p in (name, purpose, capabilities or "") if p and p.strip())
        return PolicyService._get_embedding(combined)

    @staticmethod
    def _invalidate_answer_cache():
        for d in _AFFECTED_CACHE_DOMAINS:
            try:
                AnswerCacheService.invalidate_domain(d)
            except Exception:
                pass

    # ── CRUD ────────────────────────────────────────────────────────────────────
    @staticmethod
    def create(name: str, url: str, purpose: str, capabilities: str = "",
               trigger_keywords: str = "", created_by: str = "") -> dict:
        name = (name or "").strip()
        url = (url or "").strip()
        purpose = (purpose or "").strip()
        capabilities = (capabilities or "").strip()
        trigger_keywords = (trigger_keywords or "").strip()
        if not name or not url or not purpose:
            return {"status": "error", "message": "name, url and purpose are required."}
        kw_ok, kw_err = validate_trigger_keywords(trigger_keywords)
        if not kw_ok:
            return {"status": "error", "message": kw_err}

        db = SessionLocal()
        try:
            if db.query(AppLink).filter(AppLink.name == name).first():
                return {"status": "error", "message": f"An app named '{name}' already exists."}
            row = AppLink(
                name=name,
                url=url,
                purpose=purpose,
                capabilities=capabilities or None,
                trigger_keywords=trigger_keywords or None,
                embedding=AppDirectoryService._embed_text(name, purpose, capabilities),
                created_by=created_by or None,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            AppDirectoryService._invalidate_answer_cache()
            return {"status": "ok", "id": row.id, "message": f"Added '{name}'."}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    def update(app_id: int, name: str = None, url: str = None, purpose: str = None,
               capabilities: str = None, trigger_keywords: str = None,
               is_active: bool = None) -> dict:
        db = SessionLocal()
        try:
            row = db.query(AppLink).filter(AppLink.id == app_id).first()
            if not row:
                return {"status": "error", "message": "App not found."}
            if name is not None and name.strip():
                row.name = name.strip()
            if url is not None and url.strip():
                row.url = url.strip()
            if purpose is not None and purpose.strip():
                row.purpose = purpose.strip()
            if capabilities is not None:
                row.capabilities = capabilities.strip() or None
            if trigger_keywords is not None:
                kw_ok, kw_err = validate_trigger_keywords(trigger_keywords)
                if not kw_ok:
                    return {"status": "error", "message": kw_err}
                row.trigger_keywords = trigger_keywords.strip() or None
            if is_active is not None:
                row.is_active = is_active
            # Re-embed from the (possibly) updated descriptive text.
            row.embedding = AppDirectoryService._embed_text(row.name, row.purpose, row.capabilities)
            db.commit()
            AppDirectoryService._invalidate_answer_cache()
            return {"status": "ok", "message": f"Updated '{row.name}'."}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    def delete(app_id: int) -> dict:
        db = SessionLocal()
        try:
            row = db.query(AppLink).filter(AppLink.id == app_id).first()
            if not row:
                return {"status": "error", "message": "App not found."}
            db.delete(row)
            db.commit()
            AppDirectoryService._invalidate_answer_cache()
            return {"status": "ok", "message": "Deleted."}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    def list_all(include_inactive: bool = False) -> list[dict]:
        db = SessionLocal()
        try:
            q = db.query(AppLink)
            if not include_inactive:
                q = q.filter(AppLink.is_active.is_(True))
            rows = q.order_by(AppLink.name).all()
            return [
                {
                    "id": r.id,
                    "name": r.name,
                    "url": r.url,
                    "purpose": r.purpose,
                    "capabilities": r.capabilities or "",
                    "trigger_keywords": r.trigger_keywords or "",
                    "is_active": r.is_active,
                    "created_by": r.created_by,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    "has_embedding": r.embedding is not None,
                }
                for r in rows
            ]
        except Exception as e:
            return []
        finally:
            db.close()

    # ── Retrieval ────────────────────────────────────────────────────────────────
    @staticmethod
    def search_raw(query: str, k: int = 3, threshold: float | None = None) -> list[dict]:
        """Return up to k active apps semantically matching the query, as dicts
        {name, url, purpose, similarity}, best first. Fail-soft → []."""
        query = (query or "").strip()
        if not query:
            return []
        if threshold is None:
            threshold = settings.APP_DIRECTORY_SIM_THRESHOLD

        query_emb = PolicyService._get_embedding(query)
        if not query_emb:
            return []  # embedding model unavailable — fall through silently

        max_dist = 1.0 - threshold
        db = SessionLocal()
        try:
            dist_expr = AppLink.embedding.cosine_distance(query_emb)
            rows = (
                db.query(AppLink, dist_expr.label("dist"))
                .filter(
                    AppLink.embedding.isnot(None),
                    AppLink.is_active.is_(True),
                    dist_expr <= max_dist,
                )
                .order_by(dist_expr)
                .limit(k)
                .all()
            )
            return [
                {
                    "name": r.name,
                    "url": r.url,
                    "purpose": r.purpose,
                    "capabilities": r.capabilities or "",
                    "similarity": round(1.0 - float(dist), 4),
                }
                for r, dist in rows
            ]
        except Exception as e:
            return []
        finally:
            db.close()

    @staticmethod
    def search(query: str, k: int = 3, threshold: float | None = None) -> str:
        """find_apps tool entrypoint: returns a markdown bullet list of matching apps with
        clickable links, or a short no-match message."""
        matches = AppDirectoryService.search_raw(query, k=k, threshold=threshold)
        if not matches:
            return "No matching app or portal is registered for that yet."
        lines = ["Here are the company apps that can help:"]
        for m in matches:
            detail = m["purpose"]
            if m.get("capabilities"):
                detail = f"{detail} ({m['capabilities']})"
            lines.append(f"- **{m['name']}** — [{m['url']}]({m['url']}) — {detail}")
        return "\n".join(lines)

    @staticmethod
    def backfill_embeddings() -> int:
        """Embed any active rows missing a vector (e.g. created while the embed model was down).
        Safe to run on every boot; returns rows back-filled."""
        db = SessionLocal()
        try:
            rows = db.query(AppLink).filter(AppLink.embedding.is_(None)).all()
            filled = 0
            for r in rows:
                emb = AppDirectoryService._embed_text(r.name, r.purpose, r.capabilities)
                if emb:
                    r.embedding = emb
                    filled += 1
            if filled:
                db.commit()
            return filled
        except Exception as e:
            db.rollback()
            return 0
        finally:
            db.close()

    # ── Trigger-keyword learning ──────────────────────────────────────────────────
    @staticmethod
    def _candidate_phrases(messages: list[str], existing: set[str], app_name: str) -> dict[str, dict]:
        """From near-miss queries for one app, mine candidate trigger phrases.

        Returns {phrase: {"count": int, "samples": [str, ...]}}. Counts unique-message
        support so a single chatty user can't inflate a phrase. Unigrams that are too
        generic (denylist/stopwords) are dropped; bigrams are kept liberally because a
        two-word phrase is specific enough to be a safe trigger."""
        name_tokens = {t for t in re.findall(r"[a-z0-9]+", (app_name or "").lower()) if len(t) > 2}
        counts: dict[str, int] = {}
        samples: dict[str, list[str]] = {}

        def _bump(phrase: str, msg: str):
            if phrase in existing or phrase in name_tokens:
                return  # already a trigger, or just the app's own name
            counts[phrase] = counts.get(phrase, 0) + 1
            if phrase not in samples:
                samples[phrase] = []
            if msg not in samples[phrase] and len(samples[phrase]) < 3:
                samples[phrase].append(msg)

        for msg in messages:
            toks = [t for t in re.findall(r"[a-z0-9]+", msg.lower()) if len(t) > 2 and t not in _KW_STOP]
            seen_in_msg: set[str] = set()
            # unigrams (drop generic single words the validator would reject anyway)
            for t in toks:
                if t in _GENERIC_KW_DENYLIST or t in seen_in_msg:
                    continue
                seen_in_msg.add(t)
                _bump(t, msg)
            # adjacent bigrams — specific by construction
            for i in range(len(toks) - 1):
                bg = f"{toks[i]} {toks[i + 1]}"
                if bg in seen_in_msg:
                    continue
                seen_in_msg.add(bg)
                _bump(bg, msg)

        return {p: {"count": counts[p], "samples": samples[p]} for p in counts}

    @staticmethod
    def suggest_keywords(window_days: int = 30, max_queries: int = 300,
                         sim_threshold: float | None = None, per_app: int = 6) -> dict:
        """Mine recent real chat queries for trigger keywords each app is *missing*.

        A query is a "near-miss" for app X when it matches X's embedding above the
        chat-time threshold (so X is the right answer) yet contains none of X's existing
        trigger keywords — meaning the fast direct-link offer never fired for it. The
        words people actually used in those queries are the keywords worth adding.

        Returns {"apps": [...], "scanned": int, "window_days": int} where each app entry is
        {app_id, app_name, near_miss_count, suggestions: [{keyword, count, samples}]}.
        Fail-soft: any error yields an empty result rather than raising.
        """
        import datetime

        if sim_threshold is None:
            sim_threshold = settings.APP_DIRECTORY_SIM_THRESHOLD
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=window_days)

        db = SessionLocal()
        try:
            apps = (
                db.query(AppLink)
                .filter(AppLink.is_active.is_(True), AppLink.embedding.isnot(None))
                .all()
            )
            if not apps:
                return {"apps": [], "scanned": 0, "window_days": window_days}

            app_meta = []
            for a in apps:
                kws = {k.strip().lower() for k in (a.trigger_keywords or "").split(",") if k.strip()}
                app_meta.append({
                    "id": a.id,
                    "name": a.name,
                    "embedding": [float(x) for x in a.embedding],
                    "keywords": kws,
                })

            # Recent, non-error queries, newest first; dedupe to distinct phrasings.
            rows = (
                db.query(AiRequestLog.user_message)
                .filter(
                    AiRequestLog.created_at >= cutoff,
                    AiRequestLog.user_message.isnot(None),
                    AiRequestLog.error.is_(None),
                )
                .order_by(AiRequestLog.created_at.desc())
                .limit(max_queries * 5)
                .all()
            )
        except Exception:
            db.close()
            return {"apps": [], "scanned": 0, "window_days": window_days}
        finally:
            try:
                db.close()
            except Exception:
                pass

        seen_norm: set[str] = set()
        distinct: list[str] = []
        for (msg,) in rows:
            msg = (msg or "").strip()
            if len(msg) < 6 or len(msg) > 300:
                continue
            norm = re.sub(r"\s+", " ", msg.lower())
            if norm in seen_norm:
                continue
            seen_norm.add(norm)
            distinct.append(msg)
            if len(distinct) >= max_queries:
                break

        # Bucket each near-miss query under its best-matching app.
        per_app_msgs: dict[int, list[str]] = {}
        for msg in distinct:
            emb = PolicyService._get_embedding(msg)
            if not emb:
                continue
            best, best_sim = None, sim_threshold
            for am in app_meta:
                sim = _cosine(emb, am["embedding"])
                if sim >= best_sim:
                    best, best_sim = am, sim
            if best is None:
                continue
            low = msg.lower()
            # Already triggers (keyword present) → not a near-miss.
            if any(kw in low for kw in best["keywords"]):
                continue
            per_app_msgs.setdefault(best["id"], []).append(msg)

        results = []
        for am in app_meta:
            msgs = per_app_msgs.get(am["id"], [])
            if not msgs:
                continue
            phrases = AppDirectoryService._candidate_phrases(msgs, am["keywords"], am["name"])
            # Keep phrases supported by ≥2 distinct queries, or any bigram seen once;
            # rank by support then phrase length (prefer specific multi-word phrases).
            ranked = sorted(
                (
                    {"keyword": p, "count": d["count"], "samples": d["samples"]}
                    for p, d in phrases.items()
                    if d["count"] >= 2 or " " in p
                ),
                key=lambda x: (x["count"], 1 if " " in x["keyword"] else 0),
                reverse=True,
            )
            # Final guard: never suggest something the validator would reject.
            clean = [r for r in ranked if validate_trigger_keywords(r["keyword"])[0]][:per_app]
            if clean:
                results.append({
                    "app_id": am["id"],
                    "app_name": am["name"],
                    "near_miss_count": len(msgs),
                    "suggestions": clean,
                })

        results.sort(key=lambda r: r["near_miss_count"], reverse=True)
        return {"apps": results, "scanned": len(distinct), "window_days": window_days}
