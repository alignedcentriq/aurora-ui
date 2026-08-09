---
name: action-receipts-undo
description: Executed write actions emit a durable ActionReceipt + one-click undo (item 6); built 2026-06-21
metadata:
  type: project
---

Roadmap item 6, built 2026-06-21. Every executed write action emits a durable `ActionReceipt` row (what / which system / when / confirmation id), and — where the downstream still allows it — a one-click undo. The trust/compliance ledger layer.

Design (production-ready, runs on real DB tables — no demo data):
- Model `ActionReceipt` (models.py, after PendingAction). Note: the JSON column is `receipt_metadata = Column("metadata", JSON)` — attribute renamed because `metadata` is reserved on the declarative Base. Table auto-creates via `Base.metadata.create_all` (no Alembic in this repo).
- `app/services/receipt_service.py`: `emit()` (idempotent on idempotency_key, else action_type+confirmation_id — never double-logs retries/dedupe paths), `undo()`, `list_for_user()`, `format_receipt_line()` (the inline markdown line appended to assistant confirmations).
- Undo registry `_UNDO_HANDLERS` — only registered action_types are undoable, and the handler re-checks LIVE downstream state every time (refuses once the row leaves 'Open'). Handlers: `it_ticket` → `ITService.cancel_ticket`, `hr_query` → `HRService.withdraw_hr_query` (both new; ownership-checked, Open-only). Undo window = `settings.RECEIPT_UNDO_WINDOW_MIN` (default 120, 0=until downstream closes).
- Wired into `ITService.create_ticket` (incl. the dedupe path) and `HRService.submit_hr_query`. Each appends "🧾 Logged in <system> · ref **<id>** — [Cancel ticket](url)" to its confirmation.
- API in main.py: `GET /api/receipts` (feed, get_current_user) + undo as a prefetch-safe two-step: `GET /api/receipts/undo/{token}` shows a branded confirm page (read-only via `receipt_service.peek`, never mutates — so SafeLinks/unfurlers can't silently undo), `POST` performs the reversal. Mirrors the approve/reject pattern. Token is the capability; works from chat/email/feed.
- Tests: tests/test_action_receipts.py (DB-backed, 16 checks — emit/idempotency/undo/refusal/record-only).

Scope boundary: wired only the two undoable, immediately-confirmed actions (IT ticket, HR query). Extending to others (grievance, leave decision, software-install RE-#### via the helpdesk-mail external ref) is one `emit()` call each. No frontend receipts feed yet — the `/api/receipts` endpoint exists for a future ProactiveNudgeFeed-style view; the in-chat undo link works without it.

Remaining roadmap (held): item 8 feedback triage UI, item 9 personal/team analytics, manager morning digest (blocked on Zoho — see [[abstention-action-handoff]]). Relates to [[proactive-nudge-layer]].
