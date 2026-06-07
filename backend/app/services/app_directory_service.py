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

from app.config import settings
from app.database import SessionLocal
from app.models import AppLink
from app.services.answer_cache_service import AnswerCacheService
from app.services.policy_service import PolicyService

# Answer-cache domains whose stored answers might embed an app link via the nudge; cleared on
# any URL-library change so a renamed/removed/re-pointed app can never be served stale.
_AFFECTED_CACHE_DOMAINS = ("general", "hr", "admin")


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
            print(f"[AppDirectory] list_all skipped ({type(e).__name__}): {e}")
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
            print(f"[AppDirectory] search skipped ({type(e).__name__}): {e}")
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
            print(f"[AppDirectory] backfill skipped ({type(e).__name__}): {e}")
            return 0
        finally:
            db.close()
