---
name: form-library-ai
description: Form Library AI augments — admin authoring draft/refine + learn trigger keywords from near-miss chat queries; built 2026-06-24
metadata:
  type: project
---

The admin Form Library page ([src/pages/FormLibrary.tsx](src/pages/FormLibrary.tsx)) was 100% manual field-by-field building even though backend `/api/admin/form-library/generate` and `/generate-edit` (both `require_admin`, return `{name, description, category, fields}`) already existed and were unwired.

Augment (frontend-only, NO backend restart needed): a violet AI band at the top of the New/Edit dialog.
- **New form** → "Describe it, let AI build it": textarea → POST `/generate {prompt}` → loads meta + fields into the builder for review.
- **Edit form** → "Refine with AI": POST `/generate-edit {form_id, instruction}` → reloads builder with the revision.
Nothing persists until the admin hits Save (existing POST/PUT). Generated fields map to BuilderField (autofill left blank — endpoints don't return it). Cmd/Ctrl+Enter submits.

Parallels [[url-library-ai]] (intent-not-mechanics). Pattern is the same "AI drafts → human reviews → existing save path."

Reliability: all three drafting endpoints (form /generate + /generate-edit, url /generate) use shared `app/services/llm_json.py` `invoke_json(model, prompt, attempts=2)` — robust JSON extraction (fence-strip, string-aware balanced-brace slice, trailing-comma repair) + 1 retry. Replaced the brittle greedy `re.search(r"\{.*\}")` that intermittently mangled output when the small model (llama3.1:8b) appended chatter containing a brace. Added 2026-06-24 after user hit random "failed JSON/model" errors on form generate.

Second augment (needs backend restart): **learn keywords from chat** — `GET /api/admin/form-library/keyword-suggestions` + `FormLibraryService.suggest_keywords()`. Near-miss = recent `AiRequestLog.user_message` matching a form ≥ `FORM_MATCH_SIM_THRESHOLD` (0.62) but containing none of its trigger keywords (so the inline form never auto-opened). Reuses `AppDirectoryService._candidate_phrases` + `_cosine` (lazy import — app_directory_service imports back from this module). UI: "Suggest keywords" header button + dialog with accept-chips → existing PUT. Direct port of the [[url-library-ai]] keyword learner.

**Why:** user's "more modern AI, less manual" direction; URL Library done first, then Forms; boldness = augment existing UI.
**How to apply:** both URL Library + Form Library now have the full pair (AI authoring/auto-fill + near-miss keyword learning). The near-miss miner is generic — could extend to any embedded+keyworded resource.
