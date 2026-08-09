---
name: backend-runtime-setup
description: "How the Centriq backend actually runs locally — port, no hot reload, auto-restarter, venv vs global python"
metadata: 
  node_type: memory
  type: project
  originSessionId: 58529f23-cbb0-4f4b-a303-81804056b98c
---

Centriq backend runtime facts (learned while debugging, 2026-06-11):

- Runs as `backend\venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8080` — **no `--reload`**, so code edits do NOT take effect until restart. Don't assume a fix is live; verify with a real request.
- Something **auto-restarts uvicorn** when the process is killed (watcher or user terminal loop) — killing the PID results in a fresh process grabbing port 8080 within seconds.
- The venv is Python 3.12; the global `python` on PATH is 3.14. Diagnostic scripts run fine on global python (same DB/packages reachable), but the server itself uses the venv.
- DB: PostgreSQL schema `enterprise_ai`, request logs in `ai_request_logs` (has `error`, `llm_call_count`, `route_method` columns — **check these first** when chat returns the generic fallback message; `llm_call_count=0` + error text pinpoints pre-routing crashes).
- Test chat endpoint directly: `curl -N -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" -H "x-user-email: <email>" -d '{"message": "...", "session_id": "..."}'` (SSE stream).
- LLM runtime config (per-tier model/temperature/timeout) is DB-stored via `llm_controls_service.update_config()`, cached 60s — changes apply without restart.

Related: [[ml01-llm-environment]], [[live-config-needs-approval]]
