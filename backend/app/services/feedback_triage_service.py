"""Feedback triage — the human-promotion gate of the eval flywheel (roadmap item 8).

The assistant already captures the *discovery tier*: every 👎 (ChatFeedback.rating == -1) and
every user Escalation. On their own those are a dead archive. This service turns them into a
compounding quality loop:

  1. CLUSTER similar failures (by the message embedding we already stored for each 👎, with a
     normalised-text fallback for items lacking an embedding — e.g. escalations).
  2. RANK clusters by frequency, so the most-repeated failure is triaged first.
  3. One-click PROMOTE a cluster to *curated*:
       • curated answer  → AnswerCacheService.store(is_seed=True): the next near-identical ask
                           is served the correct answer instantly (the semantic cache already
                           serves informational answers by embedding similarity).
       • routing fix     → SemanticRouterService.add_example(source="feedback"): a confirmed
                           misroute inserts the corrected (domain, sub_intent), REUSING the
                           feedback's stored embedding (zero re-embed).
     Promoting (or dismissing) marks the cluster's rows triaged so they leave the queue.

Net effect: every week of real usage auto-generates the next curated answer / router-example
set, gated by one human click. No user-supplied SQL, no model in the write path — promotions
are deterministic writes into stores that already exist.
"""

from __future__ import annotations

import datetime
import re
from typing import Optional

from app.database import SessionLocal
from app.models import ChatFeedback, Escalation

# Two failures land in the same cluster at/above this cosine similarity.
_SIM_THRESHOLD = 0.86
# Cap the working set so the O(n²) greedy clustering stays an admin-snappy operation.
_MAX_ITEMS = 500

_STOP = {
    "what", "how", "can", "the", "is", "are", "my", "for", "do", "a", "an", "i", "me", "you",
    "your", "this", "that", "with", "from", "about", "when", "where", "who", "which", "why",
    "and", "or", "but", "not", "get", "show", "tell", "give", "list", "find", "please", "help",
}


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _keywords(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", (text or "").lower()) if len(w) > 3 and w not in _STOP}


from app.services.vector_utils import cosine as _cosine, to_list as _as_list


# ── Gather the failure signals ───────────────────────────────────────────────

def _collect(db, domain: Optional[str], since: datetime.datetime) -> list[dict]:
    """Untriaged 👎 feedback + open escalations, newest first, as uniform failure items."""
    items: list[dict] = []

    fq = (db.query(ChatFeedback)
          .filter(ChatFeedback.rating == -1,
                  ChatFeedback.triaged_at.is_(None),
                  ChatFeedback.created_at >= since))
    if domain:
        fq = fq.filter(ChatFeedback.domain == domain)
    for fb in fq.order_by(ChatFeedback.created_at.desc()).limit(_MAX_ITEMS).all():
        if not (fb.user_message or "").strip():
            continue
        items.append({
            "kind": "feedback", "id": fb.id, "question": fb.user_message,
            "answer": fb.ai_response or "", "domain": fb.domain or "general",
            "note": fb.feedback_text or "", "embedding": _as_list(fb.user_message_embedding),
            "created_at": fb.created_at,
        })

    eq = db.query(Escalation).filter(Escalation.status == "Open")
    if domain:
        eq = eq.filter(Escalation.domain == domain)
    for es in eq.order_by(Escalation.created_at.desc()).limit(_MAX_ITEMS).all():
        if not (es.original_query or "").strip():
            continue
        items.append({
            "kind": "escalation", "id": es.id, "question": es.original_query,
            "answer": "", "domain": es.domain or "general",
            "note": es.description or "", "embedding": None,
            "created_at": es.created_at,
        })

    return items[:_MAX_ITEMS]


def _cluster(items: list[dict]) -> list[list[dict]]:
    """Greedy single-pass clustering: embedding cosine when both items have one, else a
    keyword-overlap fallback. Order is newest-first so the representative is the latest phrasing."""
    clusters: list[dict] = []  # {rep_emb, rep_kw, members}
    for it in items:
        emb = it.get("embedding")
        kw = _keywords(it["question"])
        placed = False
        for c in clusters:
            if emb and c["rep_emb"] and _cosine(emb, c["rep_emb"]) >= _SIM_THRESHOLD:
                c["members"].append(it); placed = True; break
            if (not emb or not c["rep_emb"]) and kw and c["rep_kw"]:
                overlap = len(kw & c["rep_kw"]) / max(1, min(len(kw), len(c["rep_kw"])))
                if overlap >= 0.6:
                    c["members"].append(it); placed = True; break
        if not placed:
            clusters.append({"rep_emb": emb, "rep_kw": kw, "members": [it]})
    return [c["members"] for c in clusters]


def _summarise(members: list[dict]) -> dict:
    rep = members[0]  # newest phrasing
    domains = [m["domain"] for m in members if m.get("domain")]
    top_domain = max(set(domains), key=domains.count) if domains else "general"
    return {
        "cluster_id": _norm(rep["question"])[:120] or f"cluster-{rep['kind']}-{rep['id']}",
        "representative_question": rep["question"],
        "count": len(members),
        "domain": top_domain,
        "feedback_ids": [m["id"] for m in members if m["kind"] == "feedback"],
        "escalation_ids": [m["id"] for m in members if m["kind"] == "escalation"],
        "samples": [
            {"kind": m["kind"], "question": m["question"], "answer": (m["answer"] or "")[:400],
             "note": m["note"], "when": m["created_at"].isoformat() if m["created_at"] else None}
            for m in members[:6]
        ],
    }


# ── Public API ───────────────────────────────────────────────────────────────

def list_clusters(domain: Optional[str] = None, days: int = 60, min_size: int = 1) -> list[dict]:
    """Ranked failure clusters (most frequent first) awaiting human triage."""
    since = _now() - datetime.timedelta(days=max(1, days))
    db = SessionLocal()
    try:
        items = _collect(db, domain, since)
    finally:
        db.close()
    clusters = [_summarise(m) for m in _cluster(items)]
    clusters = [c for c in clusters if c["count"] >= min_size]
    clusters.sort(key=lambda c: c["count"], reverse=True)
    return clusters


def stats() -> dict:
    db = SessionLocal()
    try:
        untriaged = (db.query(ChatFeedback)
                     .filter(ChatFeedback.rating == -1, ChatFeedback.triaged_at.is_(None)).count())
        open_esc = db.query(Escalation).filter(Escalation.status == "Open").count()
        return {"untriaged_feedback": untriaged, "open_escalations": open_esc}
    finally:
        db.close()


def _mark_feedback(db, feedback_ids: Optional[list[int]], action: str, by: str,
                    resulting_answer_id: Optional[int] = None) -> int:
    if not feedback_ids:
        return 0
    values = {"triaged_at": _now(), "triaged_action": action, "triaged_by": by or ""}
    if resulting_answer_id is not None:
        values["resulting_answer_id"] = resulting_answer_id
    return (db.query(ChatFeedback)
            .filter(ChatFeedback.id.in_(feedback_ids))
            .update(values, synchronize_session=False))


def _resolve_escalations(db, escalation_ids: Optional[list[int]], by: str) -> int:
    if not escalation_ids:
        return 0
    return (db.query(Escalation)
            .filter(Escalation.id.in_(escalation_ids))
            .update({"status": "Resolved", "updated_at": _now()}, synchronize_session=False))


def _embedding_for(db, feedback_ids: Optional[list[int]]) -> Optional[list]:
    """Reuse a stored 👎 embedding (zero re-embed) for the routing-fix upsert."""
    if not feedback_ids:
        return None
    row = (db.query(ChatFeedback)
           .filter(ChatFeedback.id.in_(feedback_ids),
                   ChatFeedback.user_message_embedding.isnot(None))
           .first())
    return _as_list(row.user_message_embedding) if row else None


def promote_curated_answer(query: str, answer: str, domain: Optional[str] = None,
                           feedback_ids: Optional[list[int]] = None,
                           escalation_ids: Optional[list[int]] = None, by: str = "") -> dict:
    """Curate the correct answer for a failure cluster and mark the cluster triaged.

    Stores a seed answer in the semantic cache so the next near-identical question is served
    correctly. Only marks the cluster triaged if the store actually succeeded (so a transient
    embedding-model outage doesn't silently swallow the failures)."""
    query = (query or "").strip()
    answer = (answer or "").strip()
    if not query or not answer:
        return {"success": False, "error": "missing_input",
                "message": "Both a question and a curated answer are required."}

    from app.services.answer_cache_service import AnswerCacheService
    answer_id = AnswerCacheService.store(query, answer, domain=domain, sub_intent=None, is_seed=True)
    if not answer_id:
        return {"success": False, "error": "store_failed",
                "message": "Couldn't store the curated answer (the embedding model may be down). "
                           "The failures were left in the queue."}

    db = SessionLocal()
    try:
        n_fb = _mark_feedback(db, feedback_ids, "curated_answer", by, resulting_answer_id=answer_id)
        n_es = _resolve_escalations(db, escalation_ids, by)
        db.commit()
    finally:
        db.close()
    return {"success": True, "triaged_feedback": n_fb, "resolved_escalations": n_es,
            "message": f"Curated answer promoted — {n_fb + n_es} failure(s) cleared."}


def promote_routing_fix(utterance: str, domain: str, sub_intent: str,
                        feedback_ids: Optional[list[int]] = None,
                        escalation_ids: Optional[list[int]] = None, by: str = "") -> dict:
    """Insert the corrected (domain, sub_intent) routing example for a misrouted cluster and
    mark it triaged. Reuses a stored 👎 embedding when available (zero re-embed)."""
    utterance = (utterance or "").strip()
    if not utterance or not domain or not sub_intent:
        return {"success": False, "error": "missing_input",
                "message": "utterance, domain and sub_intent are all required."}

    db = SessionLocal()
    try:
        emb = _embedding_for(db, feedback_ids)
    finally:
        db.close()

    from app.services.semantic_router_service import SemanticRouterService
    ok = SemanticRouterService.add_example(utterance, domain, sub_intent,
                                           source="feedback", embedding=emb)
    if not ok:
        return {"success": False, "error": "add_failed",
                "message": "Couldn't add the routing example. The failures were left in the queue."}

    db = SessionLocal()
    try:
        n_fb = _mark_feedback(db, feedback_ids, "routing_fix", by)
        n_es = _resolve_escalations(db, escalation_ids, by)
        db.commit()
    finally:
        db.close()
    return {"success": True, "triaged_feedback": n_fb, "resolved_escalations": n_es,
            "message": f"Routing fix promoted to {domain}/{sub_intent} — {n_fb + n_es} failure(s) cleared."}


def dismiss(feedback_ids: Optional[list[int]] = None,
            escalation_ids: Optional[list[int]] = None, by: str = "") -> dict:
    """Clear a cluster from the queue without promoting anything (noise / already-fixed)."""
    db = SessionLocal()
    try:
        n_fb = _mark_feedback(db, feedback_ids, "dismissed", by)
        n_es = _resolve_escalations(db, escalation_ids, by)
        db.commit()
    finally:
        db.close()
    return {"success": True, "triaged_feedback": n_fb, "resolved_escalations": n_es,
            "message": f"Dismissed {n_fb + n_es} failure(s)."}
