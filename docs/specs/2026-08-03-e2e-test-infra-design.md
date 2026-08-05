# E2E Test Infrastructure — Core Chat Flow

## Context

Centriq has no automated UI test coverage: no test runner is installed in
`package.json`, no `*.test.tsx` files exist, and there is no `e2e/` folder.
Backend coverage is also thin (two test files against 20+ feature areas). The
request that prompted this was broad — "check every feature" plus "test the
UI" plus "add wow-factor animations" — which bundles three independent
projects (feature-correctness testing, UI test infrastructure, and a UI/UX
animation redesign). This spec covers only the first, foundational piece:
standing up UI test infrastructure and proving it out against the single
highest-traffic path, the core chat flow. Feature-by-feature test coverage and
the animation redesign are each their own follow-up spec.

## Goal

Stand up Playwright as the project's e2e test tool and land a first suite that
exercises real login → ask a question → see a response, against the real
dev stack (real backend, real LLM), asserting on UI behavior rather than
LLM output content.

## Non-goals

- CI wiring (GitHub Actions) — a clean follow-up once the suite is stable
  locally.
- Component/unit tests (Vitest + Testing Library) — a separate decision.
- Coverage of the other 19+ feature areas — a separate, prioritized spec.
- The UI animation/"wow factor" redesign — a separate design-led spec.

## Architecture

- Add `@playwright/test` as a devDependency.
- One `playwright.config.ts` at the repo root.
- Tests live in a new `e2e/` folder, sibling to `src/` and `backend/`.
- `webServer` config runs `npm run start` (the existing
  [run-dev.js](../../run-dev.js), which boots the backend on `:8080` then the
  Vite frontend) with `reuseExistingServer: true` so a dev server already
  running locally is reused instead of double-started.
- `baseURL` points at the Vite dev server's origin.

## Auth

Tests never touch MSAL/SSO. They navigate with
`?mock-email=<persona>@alignedautomation.com`, reusing the existing dev
bypass in [auth-store.tsx:110-134](../../src/lib/auth-store.tsx) (already
gated to `localhost`/`127.0.0.1`). No backend changes needed.

## First test set

1. **Smoke** — app loads to the chat home for a logged-in persona.
2. **Ask → answer** — send a chat message, assert the assistant bubble
   appears and the loading indicator clears. Never assert exact LLM wording
   (non-deterministic output).
3. **Citations** — ask a policy-shaped question, assert at least one citation
   renders.
4. **Degraded backend** — when the model/backend is unavailable, assert the
   UI shows a graceful error state rather than hanging (exercises the
   existing ml01 degraded-mode handling).

## Timeouts

LLM responses can be slow (streaming, possible ml01 queueing under load).
Per-test timeouts are set to 60-90s rather than Playwright's 30s default, so a
real backend delay isn't misread as a test failure.

## npm scripts

- `test:e2e` — headless run.
- `test:e2e:ui` — Playwright's interactive UI mode, for debugging failures.

## Verification

Run `npm run test:e2e` against a locally running dev stack (`npm run start`)
and confirm all four tests pass; run `npm run test:e2e:ui` once to confirm the
interactive debug mode works.
