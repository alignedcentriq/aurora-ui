---
name: url-library-ai
description: URL Library AI augments — paste-URL auto-fill + learn trigger keywords from near-miss chat queries; built 2026-06-24
metadata:
  type: project
---

URL Library ([[marketplace-connector]] is a separate read-only connector; this is the admin app directory) got two AI augments, both keeping the existing manual UI as fallback:

1. **Describe-it drafting** — `POST /api/admin/url-library/generate` (Super Admin): takes `{description, url, name}` and `llm_controls.get_llm("general")` drafts `{name, purpose, capabilities, trigger_keywords}` from the admin's description. **No fetching.** Returns a DRAFT only; admin reviews in the Add dialog and saves through the existing POST. UI band = "Describe it, let AI draft it" (description textarea + optional URL).
   - HISTORY: originally built as server-side URL fetch (SSRF-guarded httpx + HTMLParser). Scrapped 2026-06-24 — user correctly noted an enterprise app directory is mostly INTERNAL SSO apps the server can't reach (not on the network + anonymous fetch fails SSO). Server-side fetch only ever worked for public/SaaS pages, so it was dropped entirely in favour of describe-it. NOTE: shared LLM tier is slow (~21s for a trivial prompt → expect 20-60s drafting); the spinner is real wait, not a hang.

2. **Learn keywords from chat** — `GET /api/admin/url-library/keyword-suggestions` + `AppDirectoryService.suggest_keywords()`. Near-miss = a recent `AiRequestLog.user_message` whose embedding matches an app ≥ `APP_DIRECTORY_SIM_THRESHOLD` (0.45) but contains none of that app's trigger keywords (so the direct-link offer never fired). Mines unigram/bigram candidate phrases from those queries, filters via `validate_trigger_keywords`. Re-embedding is cheap because `PolicyService._get_embedding` is LRU+Redis cached (queries already embedded at chat time). UI: "Suggest keywords" dialog with chips; accept appends via existing PUT.

Frontend: [src/pages/UrlLibrary.tsx](src/pages/UrlLibrary.tsx). Backend: app_links_routes.py + app_directory_service.py. No DB/model changes; needs a backend restart to register routes (see [[backend-runtime-setup]]).

**Why:** user wanted a "more modern AI, less manual" direction for URL Library + Forms; chose URL Library first, "augment existing UI" boldness. Forms redesign is the planned next step.
**How to apply:** when extending Forms the same way, reuse the intent-not-mechanics pattern (paste/describe → AI drafts → human reviews) and the cached-embedding near-miss mining approach.
