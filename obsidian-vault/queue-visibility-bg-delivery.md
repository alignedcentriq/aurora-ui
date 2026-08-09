---
name: queue-visibility-bg-delivery
description: "Named live traffic in Model Controls, queue-position SSE, and background completion + answer_ready nudge for abandoned queued chats; built 2026-07-09"
metadata: 
  node_type: memory
  type: project
  originSessionId: a651f3aa-8043-4019-ad43-39076474bc22
---

Built 2026-07-09 on top of [[ml01-load-reject-rescue]]:

1. **Named live traffic** — `chat_gate` (both backends in `concurrency.py`) now supports `annotate(token, {email, snippet, since})`, `queue_position(waiter)`, `detailed_stats()`. `acquire()` yields `("queued", waiter_token)` (was None). `/api/it/llm-controls/capacity` returns `gate.running` / `gate.waiting_list`; ITPortal Model Controls "Request queue" card lists who is running/waiting with snippet + elapsed. Private chats show "(private chat)" as snippet. Position ordering uses insertion order (memory) / (since, token) sort (Redis) — raw timestamps tie within one tick.

2. **Queue position UX** — `/api/chat` SSE `queued` events now carry `position`, refreshed on each 10s keepalive; AssistantView shows "In queue — #N in line…".

3. **Background completion + nudge** — main.py chat endpoint split into worker (`_generate`) + SSE relay via asyncio.Queue with shared `st = {client_gone, streamed}`. Client disconnect BEFORE first token (navigate away / left while queued) → worker keeps generating; on success only (no error, non-refusal via `_REFUSAL_RE`, non-private) stores to `background_answers` service (Redis `bg_answer:{session_id}` TTL 24h, in-proc fallback) + creates `answer_ready` ProactiveNudge (dedup `answer_ready:{session}:{start_ts}`). Disconnect AFTER tokens started = Stop → worker cancelled (old behavior). Known edge: Stop pressed during thinking (pre-token) still background-completes.
   - `GET /api/chat/background-answer/{session_id}` serves it back, owner-email-checked (session ids are guessable).
   - Frontend: unmount abort tagged via `backgroundRef` → placeholder turn `BG_PENDING_PREFIX` ("⏳ Still working on this in the background"); pickup effect polls every 15s while placeholder is the active thread's last turn and swaps in the answer. Chat history is localStorage-only (no server store) — that's why delivery goes through this store+swap, not server history.

Teams/email push for the nudge stays gated OFF per [[teams-notification-model]] — bell feed only (60s poll).
