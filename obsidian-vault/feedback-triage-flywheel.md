---
name: feedback-triage-flywheel
description: Admin UI to cluster 👎/escalations and one-click promote to curated answer/routing (item 8); built 2026-06-22
metadata:
  type: project
---

Roadmap item 8, built 2026-06-22. The human-promotion gate of the eval flywheel: turns the discovery tier (👎 ChatFeedback.rating=-1 + Escalations) into compounding quality.

- `app/services/feedback_triage_service.py`: clusters failures by the stored ChatFeedback embedding (cosine ≥0.86) with a keyword-overlap fallback for embedding-less items (escalations), ranks clusters by frequency, and promotes:
  • `promote_curated_answer` → AnswerCacheService.store(is_seed=True) so the next near-identical ask is served the correct answer from the semantic cache.
  • `promote_routing_fix` → SemanticRouterService.add_example(source="feedback") reusing the stored 👎 embedding (zero re-embed) for confirmed misroutes.
  • `dismiss` → clears noise. All three mark the cluster triaged so it leaves the queue.
- Triage state: added `chat_feedback.triaged_at/triaged_action/triaged_by` columns (model + ADD COLUMN IF NOT EXISTS in database.py); escalations reuse status="Resolved".
- API: super-admin gated, in observability_routes.py under `/api/observability/feedback-triage/{clusters,promote-answer,promote-routing,dismiss}`.
- UI: third tab "Feedback Triage" in ObservabilityDashboard → `src/pages/FeedbackTriageTab.tsx` (curate-answer textarea, routing domain+sub_intent form, dismiss).
- Tests: tests/test_feedback_triage.py (15 checks; identifies clusters by seeded IDs, stubs embeddings offline). NOTE: the keyword fallback can over-merge when items share tokens — tests must NOT put a shared marker in question text.

Relates to [[abstention-action-handoff]] (item 3), [[action-receipts-undo]] (item 6). Remaining roadmap: manager morning digest (blocked on Zoho).
