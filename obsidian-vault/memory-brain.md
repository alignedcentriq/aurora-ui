---
name: memory-brain
description: "Control Hub \"Memory Brain\" tab — glowing neuron graph of everything the app knows + learned"
metadata: 
  node_type: memory
  type: project
  originSessionId: ce3d355e-6821-4f7b-b0fb-4101d2005018
  modified: 2026-07-23T11:29:27.787Z
---

Control Hub → "Memory Brain" tab (System & Ops; Super Admin only): an Obsidian-style
brain graph of everything Centriq knows and has learned from chat. Root "Centriq Mind" →
7 lobes (Capabilities, Knowledge Base/policies, Curated Answers, Router Intelligence,
Apps & Forms, User Memory, Lessons Learned) → clickable neuron leaves showing the actual
remembered content. Built 2026-07-17.

- Backend: one read-only aggregation endpoint `GET /api/memory/graph`
  ([memory_graph_routes.py](backend/app/routes/memory_graph_routes.py)) over existing tables
  (Policy/PolicyChunk, CachedAnswer, RouterExample, AppLink/FormTemplate, UserMemory,
  ChatFeedback triaged=curated/routing_fix as "lessons") + capability_registry. Leaves capped
  at 30/lobe; hub labels carry true totals. Reuses observability's `_redact_pii` on user
  facts + feedback text. No LLM/external calls — free by construction. Gated to
  Super Admin only (2026-07-23: was previously open to any Super Admin/IT/Admin plus an
  extra frontend-only email hardcode restricting it to shivam.sharma; both replaced with
  a plain role==="Super Admin" check, front and back, so it's available to every Super
  Admin but no other role).
- Frontend: [MemoryBrainTab.tsx](src/pages/MemoryBrainTab.tsx) — hand-rolled canvas
  force-graph (O(n²) repulsion, fine at ~200-node cap), glow via shadowBlur + radial
  gradient + per-node pulse, signal pulses along links, pan/zoom/drag, click-to-inspect
  side panel, search-dims. NO new dependency added.
- Fetch pattern matches [AdoptionTab.tsx](src/pages/AdoptionTab.tsx): plain
  `fetch("/api/...")` + x-user-email/x-user-role headers (the api-base.ts shim adds /centriq).

Verified: endpoint 200 w/ live data (468 policies, 299 router ex, 27 caps…), employee→403,
canvas render smoke-tested. Relates to [feedback-triage-flywheel]], [[adoption-mechanics]],
[[arb-orchestration-strategic]].
