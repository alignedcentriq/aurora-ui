---
name: llm-capacity-visibility
description: LLM controls now shows real GPU/CPU residency + real request queue + concurrency capacity validation
metadata: 
  node_type: memory
  type: project
  originSessionId: b3b6a465-dbdc-43b2-9d1e-3740988e4270
---

Built 2026-07-03. The LLM Model Controls page (`ModelControlsTab` in [src/pages/ITPortal.tsx](src/pages/ITPortal.tsx), routed via [src/pages/LLMControlsPage.tsx](src/pages/LLMControlsPage.tsx)) gained a "Server Capacity & Live Queue" card fed by new super-admin endpoint `GET /api/it/llm-controls/capacity` (cached ~3s server-side).

**Key non-obvious facts:**
- The old "GPU Load Throttle" bar only reflected the **app-level admission gate** (`chat_gate` in [backend/app/concurrency.py](backend/app/concurrency.py), surfaced by `/api/chat/load`) — NOT the real Ollama queue. That's why the queue "showed nothing" while ml01 choked: congestion happens downstream at Ollama, invisible to the app gate.
- Real GPU/CPU placement now read from ml01 `/api/ps` via `ollama_residency()` in [backend/app/services/llm_controls_service.py](backend/app/services/llm_controls_service.py): `size_vram==0` → model evicted to CPU (the usual "request never finishes" cause). Diagnosed live on 2026-07-03: `llama3.2:3b` was on CPU; agent tier `llama3.1:8b` not even resident.
- **Misconfiguration found:** `max_concurrency` was overridden to **40** in DB (env default is 8). Way above what shared ml01 can serve → app gate never queues, GPU just piles up. NOT yet lowered — needs approval per [[live-config-needs-approval]].
- **Concurrency validation** added in `_validate_patch`: hard-blocks a `max_concurrency` above the server's real capacity when known; otherwise warns. Capacity source priority in `server_capacity()`: `SERVER_MAX_CONCURRENCY` env (operator hard cap) → `OLLAMA_NUM_PARALLEL × OLLAMA_MAX_LOADED_MODELS` → conservative default `CHAT_MAX_CONCURRENCY`. ml01's true parallelism is NOT visible from our backend (Ollama runs on ml01), so hard enforcement requires setting `SERVER_MAX_CONCURRENCY` in backend env.
- Frontend disables the Apply button + shows red banner when over hard cap; amber banner when over recommended.

Related: [[ml01-llm-environment]], [[backend-runtime-setup]], [[use-shadcn-components]]
