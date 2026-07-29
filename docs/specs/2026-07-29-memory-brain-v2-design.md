# Memory Brain v2 — short labels, new lobes, cross-links

Date: 2026-07-29
Status: approved, pending implementation

## Context

Memory Brain (Control Hub → System & Ops, Super Admin only) is a read-only 3D
neuron graph over the app's learning flywheel: `GET /api/memory/graph`
([memory_graph_routes.py](../../backend/app/routes/memory_graph_routes.py)) assembles
7 lobes (Capabilities, Knowledge Base, Curated Answers, Router Intelligence,
Apps & Forms, User Memory, Lessons Learned) rendered by
[MemoryBrainTab.tsx](../../src/pages/MemoryBrainTab.tsx) as a deterministic radial
layout (root → lobes on a ring → leaves jittered around their lobe), no physics
sim. No LLM calls, no new data — pure aggregation over existing tables.

Problem: leaf labels for Curated Answers, User Memory, and Lessons Learned are
a truncated slice of raw text (the user's literal question/fact), which reads
as noise rather than a scannable map. Separately, several data sources the app
already computes (insight signals, feature adoption, Project IQ DNA) aren't
represented in the brain at all, and the graph has no way to show that items
across lobes are related to each other.

## 1. Short, meaningful leaf labels

New helper in `capability_registry.py`:

```python
def short_label(domain: str | None, sub_intent: str | None = None) -> str:
    # 1. exact (domain, sub_intent) match against SKILL_REGISTRY -> display_name
    # 2. exact/wildcard match against Capability.usage (same logic as
    #    adoption_service.py's bucket matching) -> category
    # 3. humanize the raw domain string ("it_support" -> "IT Support")
```

Applied at leaf-build time in `memory_graph_routes.py`:

- **Curated Answers**: `short_label(a.domain, a.sub_intent)` — e.g. a Project IQ
  question labels as "Project IQ" instead of a 55-char question fragment.
- **User Memory**: `short_label(m.domain)` — domain-only, so these read as
  "IT Support", "HR", etc. (no sub_intent column on `UserMemory`).
- **Lessons Learned**: `short_label(fb.domain)` — same domain-only ceiling;
  `ChatFeedback` has no `sub_intent` column, so a lesson about Project IQ
  labels as "PMO", not "Project IQ". Not fixable without a schema addition;
  out of scope for this pass.
- **Router Intelligence**: existing domain-grouped labels pass through the
  same humanize step for consistent casing.

The detail side-panel (click to inspect) is unchanged — it still shows the
full raw text. Only the leaf label changes.

## 2. Three new lobes

- **Insight Bus** — reads the existing `insight_signal_log` table (already
  populated by `insight_bus.py`'s `_persist_signal`): `signal_type,
  source_domain, payload, emitted_at`. Leaves = recent signals (capped at
  `_LEAF_CAP`, newest first), labeled via `short_label(source_domain)`.
- **Feature Adoption** — wraps the existing `adoption_service.feature_adoption()`
  call (no new query). Leaves = capabilities, labeled by category, detail
  shows reach % and last-used date.
- **Project IQ DNA** — leaves = `ProjectProfile` rows, labeled by project name,
  detail summarizes counts from `ProjectLesson` / `ProjectReusableAsset` /
  `ProjectExpertise` for that profile.

Same PII redaction (`_redact_pii`) applied to any free-text fields as the
existing lobes.

## 3. Interactions

- **Deep-link on click**: where a real destination tab exists, clicking a
  leaf navigates there instead of only opening the detail panel:
  - Feature Adoption leaf → Observability "Feature Adoption" tab
  - Project IQ DNA leaf → Project IQ tab, scrolled/filtered to that project
  - Apps & Forms leaf → the app's URL (external) or Form Library tab
  - Lessons Learned leaf → Feedback Triage tab, filtered to that feedback id
  - Capabilities, Router Intelligence, User Memory, Knowledge Base, Insight
    Bus: no single natural destination page — keep today's inspect-only panel.
- **Lobe toggle/filter**: a row of checkboxes (one per lobe) to show/hide
  whole lobes and their leaves/links.
- **Cross-lobe links**:
  - Domain-based: any two leaves across lobes that share a `(domain[,
    sub_intent])` key get a link (e.g. an Insight Bus signal and a Feature
    Adoption leaf with the same domain). Computed at request time from data
    already fetched — no new storage.
  - Lesson → Curated Answer: add `resulting_answer_id` (nullable FK to
    `cached_answers.id`) on `ChatFeedback`. Set it in the existing
    triage-promote endpoint (the one that already creates the `CachedAnswer`
    row when an admin promotes a thumbs-down into a curated answer). When
    present, draw a direct link from that Lessons Learned leaf to the
    resulting Curated Answers leaf.
- **Recency view**: bucket each leaf's existing timestamp (`created_at` /
  `emitted_at` / `last_accessed_at` / `updated_at`, whichever the source row
  has) into age tiers client-side; newer leaves pulse faster / glow brighter.
  No new data fetched.

## 4. Layout

No change to the deterministic radial layout (root center, lobes on a fixed
ring, leaves jittered in a shell) — still no per-frame physics sim, same perf
budget. Cross-lobe links render as curved lines arcing through the center,
visually distinct (dimmer, different color) from the existing parent→child
lines, so they read as "related" rather than "same cluster."

## Amendment (same day): closed the Lessons Learned domain-only gap

Originally scoped out (see below), then reopened at the user's request. Added
`ChatFeedback.sub_intent` and threaded the already-computed `routed_sub_intent`
(it was already being logged to `AiRequestLog`, just never reaching the 'done'
SSE event or the feedback write path) through: `main.py`'s four 'done' event
sites → `FeedbackRequest`/`/api/feedback` → `FeedbackService.record()` →
`ChatFeedback.sub_intent`. Frontend: `Turn.subIntent` carries it from the SSE
event to the thumbs-up/down POST. New Lessons Learned rows now label at the
same "Project IQ"-level granularity as Curated Answers; historical rows with
`sub_intent=NULL` still fall back to domain-only.

## Out of scope / deferred

- LLM-generated leaf titles (would add latency, cost, and a schema migration
  for marginal quality gain over the domain/sub_intent lookup above).
- Force-directed / physics-based layout (deliberately skipped previously;
  revisit only if lobe count grows enough that the static ring gets crowded).
