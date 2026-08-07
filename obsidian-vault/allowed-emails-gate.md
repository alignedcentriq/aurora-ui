---
name: allowed-emails-gate
description: Only allowed emails (backend allowlist via /api/me 403) can access the app — never remove or bypass this gate
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 166a0b1e-7ebc-463d-adee-a56ea624aa0b
---

The app has a backend email allowlist enforced via `/api/me` returning 403 for unknown users. The frontend checks this in `src/lib/auth-store.tsx` (real MSAL path) and blocks access by setting `accessDenied=true` if the response is 403.

**Why:** Only specific emails should be able to access the app at all. This is a hard gate — not a feature flag.

**How to apply:** Never remove, comment out, or bypass the `/api/me` 403 check. Never add code that falls through on a 403. The mock/dev path (localhost) bypasses this for developer convenience only.
