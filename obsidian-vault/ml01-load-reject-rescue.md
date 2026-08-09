---
name: ml01-load-reject-rescue
description: "ml01 \"AI server busy\" root cause = Ollama instantly rejects loading any non-resident model; resident-model rescue built 2026-07-09"
metadata: 
  node_type: memory
  type: project
  originSessionId: a651f3aa-8043-4019-ad43-39076474bc22
---

Diagnosed 2026-07-09: users got "AI server busy" on a single prompt with zero traffic. Root cause is NOT app-side — the app gate (`chat_gate`) was idle. ml01's Ollama (0.13.0) **instantly rejects (~0.5s) any request for a model not already resident** with `503 server busy, please try again. maximum pending requests exceeded`, while the resident model answers in <1s. Even the 300MB nomic-embed-text is rejected → the scheduler's load queue is wedged/misconfigured (also `size_vram: 0` — GPU occupied by something outside Ollama). Fix requires ml01 admin: restart Ollama, check `OLLAMA_MAX_QUEUE` / free GPU. No SSH key access from this machine (`Permission denied (publickey,password)`).

**App-side mitigation (built, verified E2E):** in [[ml01-llm-environment]] context, `llm_resilience.py` now has `_hot_fallback_model()` — after busy retries exhaust, it reads `ollama_residency()` (/api/ps) and answers on a resident model (degraded, e.g. llama3.2:3b). Guard: if the tier's own primary IS resident, that's real saturation → no rescue (don't pile on). Rescues wired into all three: `resilient_invoke`, `resilient_ainvoke`, `resilient_stream`. Load-rejects tracked via `get_load_reject_status()` → surfaced on `/api/chat/load`, `/api/health/llm` (status becomes "degraded"), and a rose banner in ITPortal Model Controls ("ml01 is rejecting model loads").

Also fixed a latent `resilient_stream` bug: once a fallback stream was active, every empty poll re-inspected the finished primary task — `.exception()` on a hedge-cancelled task raises CancelledError and a failed primary re-entered the error branch → fallback stream killed mid-flight / silent empty responses. Guard: `if not fallback_active and primary_task.done()`.

Local backend restart procedure: `run-backend.js` (node) auto-restarts uvicorn on non-zero exit → `taskkill /PID <uvicorn-tree> /T /F`, back in ~15s.
