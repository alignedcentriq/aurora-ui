# Action-Safety Audit — write/side-effecting operations

Status: **audit (read-only findings)** — input to the Phase-2 action-safety layer.
Date: 2026-06-19. Scope: every state-changing tool across HR, IT, Admin, PMO, MS365,
Deeplink, + all existing confirmation mechanisms.

## 1. Inventory — ~40 write operations

### HR (`agent.py` + `hr_service.py`)

| Op                               | Side effect                                              | Confirm today     | Idempotent               | Blast             |
| -------------------------------- | -------------------------------------------------------- | ----------------- | ------------------------ | ----------------- |
| apply_leave                      | INSERT Leave + manager approval email + 2 ApprovalTokens | none              | **no** (dup leave+email) | per-user          |
| cancel_leave                     | Leave→Cancelled + restore balance                        | none              | safe-ish                 | per-user          |
| submit_grievance                 | INSERT Grievance + email HR                              | multi-turn (soft) | n/a                      | per-user          |
| submit_grievance_for             | grievance for another employee                           | none              | **no**                   | **cross-user**    |
| submit_hr_query                  | INSERT HRQuery + email HR                                | soft (prompt)     | **no**                   | per-user          |
| create_announcement              | INSERT + email blast + Teams webhook                     | none              | **no**                   | **cross-org**     |
| deactivate_announcement          | is_active=False                                          | none              | safe                     | cross-org         |
| update_hr_prompt                 | new PromptConfig version                                 | none              | safe                     | **system-wide**   |
| generate_hr_document             | render+store PDF                                         | none              | safe                     | per-user          |
| trigger_onboarding / offboarding | emails IT/Admin/HR/manager                               | none              | **no** (dup emails)      | multi-stakeholder |

### PMO

| request_training_license | INSERT + email PMO + tokens | none | **guarded** (open-request check) | per-user |
(approve/reject = DB-backed token endpoints — good.)

### Manager — **read-only, no writes.**

### IT (`it_agent.py` + `it_service.py`)

| create_it_ticket | INSERT ITTicket + helpdesk email | none (prompt only) | **no** | per-user |
| request_software_install | email **draft** → send on confirm | **HARD (regex + pending dict)** | safe | per-user |
| request_asset | INSERT AssetRequest + draft | implicit (draft) | **guarded** (pending check) | per-user |

### Admin (`admin_agent.py` + `admin_service.py`, `travel_service`, `bookshelf_service`)

17 writes: submit_reimbursement, request/surrender_parking_sticker, request_accommodation,
request_visitor_pass, file_facility_complaint, submit_food_complaint, submit_food_feedback,
request_book / borrow_book_by_name / return_my_book / request_book_extension,
post_admin_announcement (**cross-org**), update_admin_prompt (**system-wide**),
request_office_supply (draft), request_desk_key, submit_travel_request, submit_travel_expense.
Guarded: parking_sticker, asset, desk_key (auto-reject on clash). **Unguarded dup risk:**
reimbursement, accommodation, facility/food complaint, food_feedback, travel_request,
travel_expense, book_extension, announcements. Webhooks (reimbursement/facility/food) are
fire-and-forget, failures swallowed.

### MS365 (`ms365_agent.py`)

| send_email (POST /me/sendMail) | soft (docstring) | no | **broadcast (to/cc)** |
| send_channel_message | soft | no | **broadcast (channel)** |
| send_teams_message | soft | no | **broadcast (chat)** |
| book_meeting_room (POST /me/events) | soft | no | per-user + attendees |
| post_to_community (Yammer) | soft | no | **broadcast (community/org)** |

### Deeplink

| submit_zoho_leave | HRService.apply_leave (DB + manager email) | **NONE — zero-LLM regex fast-path** | **no** | per-user |
| submit_powerapps_complaint | PA webhook | soft (location ask) | no | per-user |

## 2. Cross-cutting findings (the real problems)

1. **Confirmation is mostly _soft_.** Outside the IT email-draft and frontend forms, "confirm
   before acting" is a _docstring instruction to the LLM_ (MS365 sends, grievance, HR query,
   PowerApps). On a weak local model that's not a guarantee — it's a hope. MS365 sends are
   **broadcasts** (channel/community/multi-recipient) gated only by a prompt.
2. **The one hard pre-execution gate is non-durable.** `PENDING_IT_EMAIL_DRAFTS` is an
   in-memory dict (`agent.py:169`) keyed by session/email — **lost on restart**, so a
   confirmed action can vanish mid-flow.
3. **Zoho leave fast-path fires with zero confirmation and zero LLM.** A regex match on
   "apply … leave … <dates>" calls `apply_leave` directly → real Leave row + manager email.
   A false-positive files real leave. This is the single highest-risk path.
4. **No idempotency anywhere.** No operation carries a dedupe key. Double-submit =
   double leave, double ticket, double announcement, double email. A few have ad-hoc
   "existing pending?" checks (asset, parking, desk, training); most don't.
5. **Downstream approval tokens are good but late.** Leave/travel/desk/book use DB-backed
   `ApprovalToken` (durable, expiring, single-use) — but they approve _after_ the record is
   created and the notification already sent. They guard the approver, not the submitter.
6. **Blast-radius isn't modeled.** `create_announcement`/`post_admin_announcement` (cross-org),
   `update_*_prompt` (system-wide), MS365 broadcasts — all treated like any per-user write.

## 3. Risk tiers (derived)

- **T3 — irreversible / broadcast / cross-org** (hard confirm + idempotency mandatory):
  apply*leave, submit_zoho_leave, all MS365 sends, create/post announcement, update*\*\_prompt,
  trigger_on/offboarding, submit_grievance(\_for), travel_request.
- **T2 — per-user record + notification** (confirm + dedupe): create*it_ticket, reimbursement,
  visitor_pass, facility/food complaint, accommodation, travel_expense, book*\*, hr_query.
- **T1 — low-risk / already-guarded / draft-only**: asset/parking/desk (guarded),
  software_install & office_supply (draft pattern), generate_document, food_feedback,
  deactivate/surrender (idempotent).

## 4. What the contract must provide (requirements, not yet design)

1. **Tool manifest**: every tool declares `kind: read|write`, and for writes
   `tier: T1|T2|T3`, `idempotency_key(args,user)`, `confirm_template`. Read tools bypass the gate.
2. **Durable pending-action store** (Postgres table, not a dict): one row per pending write,
   keyed by session+idempotency_key, with status (pending/confirmed/executed/cancelled/expired),
   payload, created_at, expires_at. Replaces `PENDING_IT_EMAIL_DRAFTS` and unifies all drafts.
3. **Hard confirm→execute gate** in the action layer: a write _never_ executes on first turn.
   It creates a pending_action, renders the existing confirm UI (email-draft / quick-choice
   markers), and executes only on an explicit confirm that resolves to that pending_action id.
   This replaces the soft docstring confirmations uniformly — including MS365 sends.
4. **Idempotent execution**: execution checks the store + the dedupe key so a retry / double
   confirm / refresh can't double-fire. Each execution writes one audit row.
5. **Fast-path leave must route to confirm, not execute.** `zoho_leave_fastpath` keeps its
   zero-LLM extraction but produces a confirmation card; it must not auto-file. _(behavior change)_
6. **Tier-scaled friction**: T3 (broadcast/cross-org) requires an explicit typed confirm and
   shows blast radius ("this posts to #general, 240 members"); T1 may keep today's lighter flow.
7. **Keep** the downstream ApprovalToken machinery (it's the right pattern) and the
   frontend marker→widget round-trip (it's already a hard gate) — build the new gate in their image.

## 5. Recommended build order (smallest safe slice first)

1. Pending-action table + a `PendingAction` service (create/get/confirm/expire), idempotency key.
2. Migrate the **existing** IT email-draft flow onto it (proves the contract end-to-end, removes
   the in-memory-dict restart bug) — no behavior change, pure hardening.
3. Close the **highest-risk hole**: route `zoho_leave_fastpath` and `apply_leave` through the gate.
4. Bring MS365 sends + announcements (broadcast/T3) under the gate with blast-radius display.
5. Backfill remaining T2 writes; add idempotency keys.
6. Tool manifest + make the gate declarative (the pre-hook in the shared agent pipeline, Phase 4).

Each step is independently shippable and reversible. Steps 1–3 remove the live correctness
risks (restart-loss + zero-confirm leave); 4 removes the broadcast risk.
