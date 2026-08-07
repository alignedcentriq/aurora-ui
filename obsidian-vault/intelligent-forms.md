---
name: intelligent-forms
description: Form Library made smart — identity pre-fill (item
metadata: 
  node_type: memory
  type: project
  originSessionId: 636ae8fe-8aaf-4387-ba14-fa94c9e8d285
---

Made the Form Library "intelligent" on 2026-06-23 (see [[centriq-replatform-status]]).

**Item #1 — identity pre-fill.** Each form field can carry an optional `autofill` source
(`name/email/employee_id/department/designation/location/manager`, mapped onto Employee columns;
manager via the self-FK). Admin sets it via an "Auto-fill from profile" dropdown per field in the
Form Library builder. `FormLibraryService.build_prefill(fields, email)` resolves it (fail-soft → {}).
`dynamic_form_agent_node` ships a `prefill` map in the widget payload; the `DynamicFormWidget` seeds
inputs and badges them "from your profile" (badge clears on edit). **Skipped for anonymous forms** —
pre-filling identity there would record the submitter and break anonymity. Explicit admin mapping,
NOT name-guessing (field names are free text → heuristics would mis-fill).

**Item #2 — conversational fill.** New `form_fill` domain + `form_fill_agent_node`. Entry: a form
match phrased as fill/complete/submit (`_CONV_FILL_RE`) routes to `form_fill` instead of rendering
the widget. State carried in a `PendingAction` of type `"form_fill"` (payload: form_template_id,
collected, phase). Loop: seed identity prefill → `FormLibraryService.extract_values` (deterministic
select-option match + conservative hard-sanitized LLM JSON pass) pulls what the user stated → ask
only for missing required fields → when complete, show summary + require explicit "yes" → submit via
`FormLibraryService.submit` (same act-layer path as the widget). The explicit-yes gate is deliberate:
matches this codebase's action-safety rule (writes never auto-execute) and de-risks the weak agent
model (llama3.1:8b, see [[ml01-llm-environment]]) — no auto-submit from shaky extraction.
Continuation routing is split for precision: `_form_fill_confirm_strategy` (ROUTER_RESOLVER, after
the yes/no draft strategies) claims only a yes/no while the fill is in the `ready` phase;
`_form_fill_continue_strategy` (MAIN_RESOLVER, after exact/keyword-high/semantic-high/form-library
but before the fuzzy fallbacks) claims a gathering-phase reply only when no confident intent did.
Net effect: a clear new intent mid-fill ("what's my leave balance?") escapes the fill, while a bare
field answer ("Pune") stays in it. "cancel" exits; a fresh "fill … form" supersedes via
sub_intent=="start".

**Residual edge (minor):** an ambiguous reply that no classifier claims is still treated as a field
answer (correct by design); and the followup-resolver could in theory rewrite a bare answer into a
confident match and escape erroneously — rare, bounded by the 30-min TTL and "cancel".

Files: backend `services/form_library_service.py`, `agent.py`, `routes/form_library_routes.py`;
frontend `pages/FormLibrary.tsx`, `components/assistant/DynamicFormWidget.tsx`, `lib/chat-store.ts`.
Remaining from the "intelligent forms" idea set: nothing — #1 and #2 done. Conversational builder
does not yet expose `autofill` (admin adds it in the Form Library UI afterward).
