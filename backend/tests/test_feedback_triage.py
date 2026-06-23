"""Integration test for the feedback-triage flywheel (roadmap item 8).

NEEDS the database. Seeds throwaway 👎 feedback + an escalation and removes them at the end.
The embedding model is stubbed so the test runs offline: seeded ChatFeedback rows carry
hand-built vectors, and PolicyService._get_embedding is patched so the curated-answer /
routing-example writes don't need ml01.

Clusters are identified by the SEEDED ROW IDS (not by marker text) so the assertions are
immune to any real feedback already in the dev DB — and so the marker can't contaminate the
keyword-overlap fallback.

    python -m tests.test_feedback_triage

Covers: clustering + frequency ranking, promote-curated-answer (seeds the cache + clears the
cluster), promote-routing-fix (upserts a RouterExample + clears the cluster), dismiss, and that
+1 feedback is never surfaced.
"""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal, engine
from app.models import SCHEMA, ChatFeedback, Escalation, CachedAnswer, RouterExample
from app.services import policy_service as _ps

_MARK = "DELETE-ME-triage-test"

# Stub embeddings so the curated-answer / routing writes work offline.
_ps.PolicyService._get_embedding = staticmethod(lambda *a, **k: [0.1] * 768)

# Two well-separated unit vectors so cluster A and cluster B never merge.
_EMB_A = [1.0] + [0.0] * 767
_EMB_B = [0.0] * 384 + [1.0] + [0.0] * 383

# Plain questions (no marker → no keyword contamination). Cleaned up by exact text.
_QA = ["how many casual leaves do I get",
       "casual leave count please",
       "my casual leave quota this year"]
_QB = ["reset my vpn token", "vpn token reset"]
_Q_ESC = "relocation allowance policy details"
_ALL_Q = _QA + _QB + [_Q_ESC]


def _ensure():
    settings.ANSWER_CACHE_ENABLED = True
    with engine.connect() as conn:
        for stmt in (
            f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMP',
            f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN IF NOT EXISTS triaged_action VARCHAR',
            f'ALTER TABLE "{SCHEMA}".chat_feedback ADD COLUMN IF NOT EXISTS triaged_by VARCHAR',
        ):
            try:
                conn.execute(text(stmt)); conn.commit()
            except Exception:
                conn.rollback()


def _cleanup():
    db = SessionLocal()
    try:
        db.query(ChatFeedback).filter(ChatFeedback.session_id == _MARK).delete(synchronize_session=False)
        db.query(Escalation).filter(Escalation.user_email == f"{_MARK}@x.com").delete(synchronize_session=False)
        db.query(CachedAnswer).filter(CachedAnswer.query_text.in_(_ALL_Q)).delete(synchronize_session=False)
        db.query(RouterExample).filter(RouterExample.utterance.in_(_ALL_Q)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _seed() -> dict:
    db = SessionLocal()
    try:
        a_ids, b_ids = [], []
        for q in _QA:
            r = ChatFeedback(session_id=_MARK, domain="hr", user_message=q,
                             ai_response="wrong answer", rating=-1, user_message_embedding=_EMB_A)
            db.add(r); db.flush(); a_ids.append(r.id)
        for q in _QB:
            r = ChatFeedback(session_id=_MARK, domain="it_support", user_message=q,
                             ai_response="wrong", rating=-1, user_message_embedding=_EMB_B)
            db.add(r); db.flush(); b_ids.append(r.id)
        # A thumbs-UP that must never appear in triage.
        db.add(ChatFeedback(session_id=_MARK, domain="hr", user_message="good q thanks",
                            ai_response="ok", rating=1, user_message_embedding=_EMB_A))
        esc = Escalation(reference_id=f"ESC-{_MARK}", user_email=f"{_MARK}@x.com",
                         domain="admin", original_query=_Q_ESC, status="Open")
        db.add(esc); db.flush()
        esc_id = esc.id
        db.commit()
        return {"a_ids": set(a_ids), "b_ids": set(b_ids), "esc_id": esc_id}
    finally:
        db.close()


def main():
    import app.services.feedback_triage_service as T
    fails = []

    def ok(cond, msg):
        print(f"  [{'PASS' if cond else 'FAIL'}] {msg}")
        if not cond:
            fails.append(msg)

    _ensure(); _cleanup(); seeded = _seed()
    a_ids, b_ids, esc_id = seeded["a_ids"], seeded["b_ids"], seeded["esc_id"]
    try:
        def find(clusters, ids):
            return next((c for c in clusters if set(c["feedback_ids"]) & ids), None)

        print("clustering + frequency ranking:")
        clusters = T.list_clusters(days=2)
        a = find(clusters, a_ids)
        b = find(clusters, b_ids)
        esc = next((c for c in clusters if esc_id in c["escalation_ids"]), None)
        ok(a is not None and set(a["feedback_ids"]) == a_ids and a["count"] == 3,
           "cluster A groups exactly the 3 HR 👎 by embedding")
        ok(b is not None and set(b["feedback_ids"]) == b_ids,
           "cluster B groups exactly the 2 IT 👎")
        ok(a is not None and all("good q" not in s["question"] for s in a["samples"]),
           "thumbs-up feedback never appears in triage")
        ok(esc is not None, "the open escalation surfaces in the queue")
        order = [c["count"] for c in clusters]
        ok(order == sorted(order, reverse=True), "clusters are ranked by frequency desc")

        print("promote curated answer clears the cluster + seeds the cache:")
        res = T.promote_curated_answer(
            a["representative_question"], "You get 12 casual leaves per year.",
            domain="hr", feedback_ids=a["feedback_ids"], by="admin@x.com")
        ok(res.get("success") and res["triaged_feedback"] == 3, "promote-answer marks 3 triaged")
        db = SessionLocal()
        try:
            seeded_n = db.query(CachedAnswer).filter(
                CachedAnswer.query_text.in_(_QA), CachedAnswer.is_seed.is_(True)).count()
        finally:
            db.close()
        ok(seeded_n == 1, "a curated (is_seed) answer was stored")
        ok(find(T.list_clusters(days=2), a_ids) is None,
           "cluster A is gone from the queue after promotion")

        print("promote routing fix upserts a RouterExample + clears the cluster:")
        res2 = T.promote_routing_fix(
            b["representative_question"], "it_support", "create_ticket",
            feedback_ids=b["feedback_ids"], by="admin@x.com")
        ok(res2.get("success") and res2["triaged_feedback"] == 2, "promote-routing marks 2 triaged")
        db = SessionLocal()
        try:
            ex = db.query(RouterExample).filter(RouterExample.utterance.in_(_QB)).first()
            ok(ex is not None and ex.domain == "it_support" and ex.sub_intent == "create_ticket",
               "a corrected RouterExample was upserted")
            ok(ex is not None and ex.embedding is not None,
               "routing example reused the stored 👎 embedding")
        finally:
            db.close()
        ok(find(T.list_clusters(days=2), b_ids) is None, "cluster B is gone after promotion")

        print("dismiss clears the escalation:")
        res3 = T.dismiss(escalation_ids=[esc_id], by="admin@x.com")
        ok(res3.get("success") and res3["resolved_escalations"] == 1, "escalation resolved")
        ok(not any(esc_id in c["escalation_ids"] for c in T.list_clusters(days=2)),
           "escalation gone from the queue")

        print("stats shape:")
        st = T.stats()
        ok("untriaged_feedback" in st and "open_escalations" in st, "stats shape present")
    finally:
        _cleanup()

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
