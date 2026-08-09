---
name: centriq-path-prefix-deploy
description: Centriq runs under /centriq (incl /centriq/api) on shared host hackathon.alignedautomation.com; how routing works and why
metadata:
  type: project
---

Centriq is deployed on the SHARED host `hackathon.alignedautomation.com` where bare `/api` is already owned by another app (Synora backend on :8000) and `/` is Synora's catch-all. So ALL Centriq traffic — including its API — must live under the `/centriq` path prefix. Fixed 2026-07-02 (was fully broken: /centriq fell through to Synora → wrong title, blank page, JS MIME errors).

Routing chain (prod):
- Host nginx `/etc/nginx/sites-available/hackathon.alignedautomation.com` (443 vhost) has `location /centriq { proxy_pass http://127.0.0.1:8090; }` (no trailing slash → full URI preserved). Additive only; does NOT touch `/api`, `/auraai`, `/nextchat`, or Synora `/`.
- Container (`centriq_ai` compose at `/data/optimize/centriq_ai`) nginx maps `8090:80`; internal nginx serves the SPA at `/centriq/` and has `location /centriq/api/` `/centriq/uploads/` `/centriq/verify` that STRIP the `/centriq` prefix (`set $var; rewrite ^/centriq(/api/.*)$ $1 break; proxy_pass $var;` — set MUST come before rewrite/break or the var is uninitialised) → backend:8080 sees normal `/api/...`.

Frontend: `src/lib/api-base.ts` installs a `window.fetch` shim (imported at top of `src/router.tsx`) that prefixes any `/api|/uploads|/verify` path with `import.meta.env.BASE_URL` (`/centriq`). Non-fetch cases use `apiUrl()` (3 `<img src>` in EmployeeDirectory/ManagerPortal/PeoplePage). vite `base:"/centriq/"`, PWA patterns are `/^\/centriq\/api\//` etc. MSAL redirectUri = `origin + BASE_URL`.

Connectors (Alchemy/Udemy/Marketplace/Zoho/Graph) are UNAFFECTED — they're server-side calls to absolute URLs; the shim only touches browser→own-backend and leaves absolute URLs alone. Caveat: inbound OAuth/Graph webhook callbacks at root `/api/...` would still collide on this host (demo/inert today).

Deploy: `SSH_HOST=optimize@hackathon.alignedautomation.com bash deploy.sh` (branch B; copies nginx.nossl.conf→nginx.conf on remote). nginx.conf is a VOLUME MOUNT so conf-only changes just need push + `docker compose restart nginx` (no rebuild); bundle changes need `--build`. SSH is PASSWORD auth (SSH_PWD in backend .env / main .env), sudo is passwordless. See [[backend-runtime-setup]].

TODO for local dev login: add SPA redirect URI `http://localhost:3000/centriq/` in the Azure app registration (prod `https://hackathon.alignedautomation.com/centriq/` already registered).
