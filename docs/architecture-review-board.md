# Architecture Review Board — Centriq AI Enterprise Intelligence Platform

*Review date: 2026-06-27 · Branch: `dev_shivam` · Scope: full repository (452 tracked files; 213 Python, 159 TSX)*

> **Method note:** This review read the team's own architecture docs ([architecture-redesign.md](architecture-redesign.md), [target-architecture.md](target-architecture.md)) before the code, then verified them against the implementation. Several of the strongest conclusions *agree* with what the team already wrote — that self-diagnosis is itself a maturity signal.

---

## 1. Executive Summary

**What this is.** A single-tenant, on-prem-style **Enterprise Intelligence Platform** built on FastAPI + LangGraph (Python) and TanStack Start + React 19 (TypeScript), running against **local Ollama models** (agent tier `llama3.1:8b`, per [config.py:101](../backend/app/config.py#L101)). It already spans an enormous functional surface: HR, IT, Admin, PMO, MS365, Manager domains; RAG policy Q&A; a closed-catalog Analytics Builder; Project IQ; Resource/skill matching; onboarding; an action-registry with confirm→execute + receipts/undo; nudges; observability; connectors. This is **not a chatbot** — it is a genuine multi-domain assistant platform with real write-side actions into Zoho/Teams/ITSM.

**Current maturity: ~Series-A startup quality with pockets of staff-level engineering.** The AI/orchestration thinking (the two architecture docs, the routing eval harness, the action-safety design) is **principal-engineer grade**. The platform engineering around it (auth, migrations, secrets, module structure, testing breadth, deployment) is **prototype/demo grade**. The gap between those two is the central story of this review.

**Biggest strengths**
1. **Exceptional architectural self-awareness.** The strangler plan, `ConversationState`/Resolver/shared-pipeline abstractions, and the "actions are sacred, ground-or-abstain" principles are correct.
2. **The Analytics Builder is the *right* design** — a closed catalog of parameterized SQLAlchemy ORM queries keyed by an intent enum ([analytics_builder_service.py:148-538](../backend/app/services/analytics_builder_service.py#L148)), **not** free-form NL→SQL. This eliminates an entire class of injection and hallucination risk.
3. **Deterministic-first routing** (exact → keyword → semantic pgvector → LLM fallback) with a real regression harness (62 curated + 291 golden cases). Correct instinct for weak local models.
4. **Action safety primitives exist**: action registry + catalog, idempotency, pending-action, receipts/undo ([services/actions/](../backend/app/services/actions/)).

**Biggest weaknesses**
1. **Authentication is effectively absent.** Identity and role come from spoofable `x-user-email` / `x-user-role` HTTP headers ([auth.py:31-57](../backend/app/auth.py#L31)). Any user can become Super Admin with one header. This single issue makes the platform **not deployable to 1,000 employees** as-is.
2. **The `agent.py` god-module: 5,144 lines** ([agent.py](../backend/app/agent.py)) holding tools, routing strategies, *and* all domain agent nodes. `main.py` is 2,501 lines, `models.py` is 2,106 lines (102 tables).
3. **No database migration system.** Schema is `Base.metadata.create_all` + hand-written `CREATE TABLE IF NOT EXISTS` raw SQL in [database.py:154-304](../backend/app/database.py#L154). 102 tables with no Alembic = no safe schema evolution at scale.
4. **Testing breadth is narrow** — ~20 backend test files, almost entirely routing/actions; zero frontend tests, zero E2E, zero load/RAG-groundedness eval.

**Biggest opportunities**
- The "modes" should become a **capability/skill registry** (already ~70% there with `capability_registry.py` and `_MODE_ROUTES`). This is the unlock for cross-mode intelligence — the thing that would make this beat Glean/Copilot for *this* org.
- **Project IQ + Resource Finder + Analytics share a latent knowledge graph** that nobody has built yet. Building it is the difference between "good internal tool" and "organizational brain."

**Biggest risks**
- **Security/compliance**: header-trust auth + `CORS allow_origins=["*"]` + committed `centriq.db` containing `payroll`/`leaves`/`attendance` tables = a data-breach and audit-failure waiting to happen.
- **Operational fragility**: single shared 8B model behind a concurrency gate of 8 ([config.py:218](../backend/app/config.py#L218)); no migrations; no HA story. Will not survive 1,000 daily actives without redesign.

---

## 2. Architecture Review

**The intended architecture is excellent; the realized architecture has drifted into accretion** — and [architecture-redesign.md §2](architecture-redesign.md) says exactly this ("heuristics layered on heuristics, cross-cutting concerns copy-pasted per agent").

| Dimension | Assessment | Evidence |
|---|---|---|
| Clean Architecture / layering | **Partial.** Target doc defines Channel → Orchestration → Capability/Services → Cross-cutting. Reality: orchestration + tools + services bleed into `agent.py`. | [agent.py](../backend/app/agent.py) defines tools, routing, *and* agent nodes |
| Separation of concerns | **Weak at the brain, good at the edges.** | 78 services vs. 1 monolithic agent |
| Modularity | **Service layer yes, agent layer no.** | — |
| Coupling | **High in `main.py`** — 60+ router imports + business logic + warmup + CORS in one module. | [main.py:35-87](../backend/app/main.py#L35) |
| Plugin/event architecture | **Mostly absent.** No event bus; cross-mode signals can't flow. Connectors are the one real plugin surface. | — |
| Future extensibility | **Data-driven control plane is a real strength** (forms, connectors, semantic seeds, prompts are data). New *domains* still require code branches. | [target-architecture.md §9](target-architecture.md) |

**Verdict:** The redesign docs already prescribe the fix (typed `ConversationState`, ordered-strategy `Resolver`, shared pre/post-hook pipeline). Phase 0/1 landed and the Resolver strategies are *partially* extracted — `_clarify_reply_strategy`, `_pending_action_strategy`, `_keyword_high_strategy`, etc. exist as discrete functions at [agent.py:2771-3057](../backend/app/agent.py#L2771). **Finish the strangler migration.** The biggest single architectural win is mechanical: split `agent.py` into `orchestration/` (resolver, pipeline, state), `tools/` (per-domain tool modules), and keep `agents/` for the thin domain bodies.

**One challenge to the plan:** the docs treat LangGraph as load-bearing and non-negotiable. For a platform that wants *cross-mode orchestration* and *durable multi-step workflows*, pressure-test whether LangGraph's checkpointer is the right durability substrate vs. a proper workflow engine (Temporal/durable-task) for the *Act* layer specifically. Not a rewrite — a question to answer before the action layer hardens.

---

## 3. Repository Structure

**Strengths:** clear `backend/app/{routes,services,agents,connectors}` split; frontend `src/{pages,components,routes,lib,hooks}`. Naming is consistent and descriptive.

**Problems:**
- **`backend/app/` root is a junk drawer**: `agent.py`, `main.py`, `models.py`, `hr_service.py`, `graph_sync.py`, `pmo_routes.py`, `sharepoint_routes.py`, `router.py` all sit at top level alongside the package dirs. Routes live in *both* `app/routes/*` and `app/*_routes.py`. Pick one.
- **78 services is too flat.** `zoho_*` (7 files), `sharepoint_*` (3), `udemy_*` (2) should be packages (`services/zoho/`, `services/integrations/`).
- **Frontend pages are not decomposed**: [AdminPortal.tsx](../src/pages/AdminPortal.tsx) is **3,532 lines**, [AssistantView.tsx](../src/components/assistant/AssistantView.tsx) 2,578, [ManagerPortal.tsx](../src/pages/ManagerPortal.tsx) 2,395.

**Recommendation:** group services into domain packages; collapse the dual routes convention; enforce a max-file-size lint (~600 lines).

---

## 4. Backend Review

**Good:** FastAPI dependency-injection for auth guards ([auth.py](../backend/app/auth.py) `require_*`), a concurrency gate protecting the shared GPU ([config.py:213-220](../backend/app/config.py#L218)), an LLM resilience layer with circuit breaker (`llm_resilience.py`), SSE streaming, structured `ai_request_logs` observability.

**Anti-patterns / risks:**
1. **`main.py` does everything** — 60+ imports, model warmup, CORS, route registration, and chat business logic in 2,501 lines.
2. **Bare `except Exception: pass`** swallowing — the role-override lookup in [auth.py:51-52](../backend/app/auth.py#L51) silently ignores DB errors on the *authorization* path.
3. **No migrations** (see §15) — the single largest backend-ops liability.
4. **In-memory mutable state** in an async, potentially multi-worker server: the docs flag `PENDING_IT_EMAIL_DRAFTS`. Verify it's fully migrated to durable `pending_action` before any multi-worker deploy — module-level dicts break the moment you run >1 uvicorn worker.
5. **Validation is thin** — Pydantic request models exist ([main.py:219-264](../backend/app/main.py#L219)) but free-text `message` flows straight into the LLM with no length cap, rate limit, or injection screen.

---

## 5. Frontend Review

**Stack is modern and correct**: TanStack Start/Router (file-based routing), React Query for server state, Zustand for client state, React 19.

**Problems:**
- **Mega-components.** 3,500-line pages mean no reuse, slow renders, impossible review. Decompose into feature folders with hooks + presentational components.
- **Auth headers set client-side** (`x-user-role`) — the frontend is *asserting* its own role. This is the client side of the §1 critical auth flaw.
- **No frontend tests at all** — 0 of 20 test files are frontend.
- **Accessibility/i18n unverified.** Targeting "multiple countries" but no i18n framework, no RTL, no locale/timezone handling. A real adoption blocker for a global rollout.
- **Bundle/perf:** with pages this large and no evident code-splitting beyond route-level, initial load will suffer. Verify lazy-loading of heavy pages.

---

## 6. AI Architecture

The strongest part of the platform.

| Area | State | Notes |
|---|---|---|
| Routing | **Strong.** Tiered exact→keyword→semantic(pgvector)→LLM, regression-tested. | [semantic_router_service.py](../backend/app/services/semantic_router_service.py), [config.py:166-185](../backend/app/config.py#L166) |
| RAG retrieval | **Mixed.** Policy chunks store embeddings **as JSON**, cosine computed in Python with BM25 hybrid fallback ([policy_service.py:7-9](../backend/app/services/policy_service.py#L7)); semantic router uses **pgvector**. Two vector backends, inconsistent. JSON-cosine is O(n) per query → won't scale past a few thousand chunks. |
| Chunking | Fixed 800/100 ([config.py:130](../backend/app/config.py#L130)). Not structure-aware. |
| Re-ranking | **Absent.** On an 8B model, rerank would meaningfully improve groundedness. |
| Groundedness / abstention | **Designed and partially built** — abstention-handoff card ([agent.py:4151](../backend/app/agent.py#L4151)). Not yet measured by eval. |
| Prompt versioning | **Yes** — `prompt_configs` table + `prompt_service`. |
| Memory / state | `Focus` + `state_tracker` landed (Phase 1); 5 parallel carry-over mechanisms being consolidated. |
| Confidence / clarify | **Yes** — `CLARIFY_CONF_THRESHOLD` gate ([config.py:137](../backend/app/config.py#L137)) shows a choice card instead of guessing. |
| Guardrails / injection | **Weak.** No structured prompt-injection defense for RAG-ingested content. |
| AI observability | **Strong** — `ai_request_logs`, Langfuse tracing, SLO/token capture. |
| AI evaluation | **Routing only.** No groundedness eval, no action-correctness eval. |

**Top AI recommendations:** (1) unify on pgvector for *all* embeddings incl. policy chunks; (2) add a rerank stage; (3) build the RAG groundedness + action-correctness eval tiers; (4) add prompt-injection screening on RAG-ingested content.

---

## 7. Mode Architecture

**Current state:** "modes" pin a backend domain via `_MODE_ROUTES`; the frontend skips heuristic interceptors when `activeMode` is set. Each mode ≈ a domain agent with its own prompt/tools/retrieval.

**Verdict: modes-as-isolated-domains is the wrong long-term abstraction.** It's why cross-mode intelligence (§12) is impossible today, and why each new mode is code, not config.

**Recommended target: a Capability/Skill registry + dynamic context.** `capability_registry.py` already exists. The model should be:
- **Skills** = declarative units `{name, retrieval_scope, tools[], prompt_fragment, permissions, risk_class}` registered as **data**.
- **A single orchestration pipeline** (Abstraction C) selects a *set* of skills per turn rather than hard-switching to one mode.
- **Workspaces** (UI) compose skills for a role/context.
- **Shared substrate**: memory, retrieval, entity `focus` shared across skills, scoped by permission — not duplicated per mode.

This makes modes a *view* over a shared brain rather than N brains — the precondition for §12.

---

## 8. Project IQ Review (treat as its own product)

**Today:** Project DNA extraction over a SharePoint project corpus + find-similar/lessons/experts/assets ([project_iq_service.py](../backend/app/services/project_iq_service.py), 662 lines), with a verified-vs-inferred gate. Solid, document-centric foundation.

**To become a product, the missing layer is a project knowledge graph + time series.**
- **Now:** Decision History & Lessons Learned, Meeting Intelligence (transcripts already ingested per [config.py:506](../backend/app/config.py#L505) — extract decisions/action-items/risks), Executive Summaries, Expert/Asset discovery.
- **Next (needs structured data you already have tables for — `sprints`, `milestones`, `team_capacity`):** Project Health Score, Delivery Risk Prediction, Dependency Mapping.
- **Later (needs the graph):** Requirement Traceability, Timeline Forecasting, Architecture Evolution, cross-project Knowledge Graph.

**Highest-value feature:** a **Project Health Score** fusing delivery (milestones/sprints) + people (allocation/attrition) + sentiment (meeting transcripts). A board-level artifact no competitor gives out of the box.

---

## 9. Resource Finder Review

**Today:** skills from Alchemy + availability from DB allocations, joined **by employee name** ([agent.py:1247](../backend/app/agent.py#L1247) `match_resources`). BUY/TRAIN/REDEPLOY skill-supply overlay exists.

**Architectural weakness: name-based joins** (homonyms, formatting, contractors). This is a **graph problem wearing a relational disguise.**

**Recommended architecture:**
- **Canonical employee identity** (employee_code as the join key everywhere).
- **A skills/org knowledge graph** (people → skills → projects → clients → managers). Embeddings for *fuzzy* skill matching, graph for *structural* queries.
- **Availability prediction** from monthly allocation snapshots + LWD/attrition signals.

A graph layer would also serve Project IQ and Org intelligence — **build it once, three products consume it.**

---

## 10. Learning Helper Review

**Today:** TechElevate local LMS + Udemy Business connector + `recommend_training` closing the Alchemy→train→verified-skill flywheel. The **flywheel concept is genuinely strong.**

**Missing:** skill-gap detection isn't personalized to career path; no assessments/quizzes/certification tracking surfaced to the employee; no coding coach; onboarding learning isn't connected to the LMS. **Highest-value add:** personalized skill-gap → curated learning path → assessment → verified-skill, tied to the resource graph so completion *immediately* updates staffing availability.

---

## 11. Analytics & Dashboard Builder

**Best-architected AI feature.** The closed-catalog ORM approach ([analytics_builder_service.py](../backend/app/services/analytics_builder_service.py)) is exactly right for a weak local model: no NL→SQL hallucination, no injection, governed metrics, predictable performance. The NL layer only picks an *intent*; the SQL is hand-written and parameterized. Charts stream inline via `[CHART_START]` markers.

**Gaps to make it enterprise-grade:**
- **It's a metric catalog, not a semantic layer.** Promote to a **declarative semantic layer** (metrics as data: dimensions, measures, grain, RBAC scope).
- **No caching** of computed series. Add a short-TTL cache keyed by (intent, scope, filters).
- **Permissions on metrics** aren't centrally governed — fold into the semantic layer's RBAC.
- **Export** (PPT/PDF/scheduled email) is absent — a top-requested enterprise feature.

The NL questions listed ("which projects are delayed?", "compare department utilization", "engineering velocity") are mostly answerable *if* the underlying project/sprint data is wired (§8). Leave/training/attendance ones already work.

---

## 12. Cross-Mode Intelligence

**The single biggest product opportunity, architecturally blocked today** by mode isolation (§7). The example chain (Project IQ risk → Analytics velocity → Learning rec → Resource expert → Workflow task → Announcement) is exactly right and would be category-defining.

**Build an internal event/signal bus + shared insight store:**
```
Signal producers (per skill) → Insight Bus → Insight Store (typed, scoped, time-stamped)
                                    ↓
              Reactors (rules + LLM) → proposed actions (via existing action registry)
                                    ↓
              Surfaced in nudge feed / workspace / announcement — with human gate
```
**Three of five pieces already exist**: a nudge layer with deterministic detectors, an action registry with confirm→execute, and per-domain services that produce signals. Missing: **the bus + insight store + cross-domain reactors.** Start narrow: one chain (delivery-risk → training rec) end-to-end, human-gated. **Never auto-execute** cross-mode actions — propose only.

---

## 13. Enterprise Readiness

**The weakest dimension and the gating one for production.**

| Requirement | State | Evidence |
|---|---|---|
| Entra ID / SSO | **Frontend only (MSAL).** Backend does **not** validate the token except on observability-reveal. | [auth.py:31-57](../backend/app/auth.py#L31), [azure_auth.py](../backend/app/azure_auth.py) `AZURE_JWT_ENABLED=false` default |
| RBAC | Role strings + guards exist, but role is **client-asserted** → trivially bypassed. | [auth.py:54](../backend/app/auth.py#L54) |
| ABAC / country/dept policy | **Absent.** No country-aware policy, no timezone, no data-residency. | — |
| Org hierarchy | Present (MS Graph sync). | — |
| Audit logs | **Partial** — reveal audits + action receipts; no comprehensive write audit. | — |
| Encryption / secrets | Fernet token encryption (good); secrets via `.env`; default DB creds `postgres:postgres`. | — |
| Backup / DR / HA | **No evidence.** Single Postgres, Redis, model server, uvicorn. | — |
| Compliance | Awareness present, but committed `centriq.db` with a `payroll` table contradicts it. | — |

**Bottom line:** SSO token validation, real RBAC, audit, and DR must be built before 1,000 employees. The shape is right (MSAL frontend, Entra app exists) — **validate the JWT server-side and derive role from validated `groups` claims**, exactly as `azure_auth.py` already does for reveal. Generalize that to all requests.

---

## 14. Security Review

| # | Issue | Severity | Evidence |
|---|---|---|---|
| 1 | **Broken authentication — identity & role from spoofable headers.** Any caller sets `x-user-role: super admin` and owns the platform. `DEFAULT_USER_EMAIL` fallback means no header = a valid user. | **CRITICAL** | [auth.py:31-57](../backend/app/auth.py#L31) |
| 2 | **Broken authorization** follows from #1 — every `require_*` guard is bypassable. | **CRITICAL** | [auth.py:60-114](../backend/app/auth.py#L60) |
| 3 | **CORS `allow_origins=["*"]` with `allow_credentials=True`.** Misconfigured and permissive. | **HIGH** | [main.py:211-216](../backend/app/main.py#L211) |
| 4 | **Sensitive data committed to git** — `centriq.db` (`payroll`, `leaves`, `attendance`, `reimbursements`) and `nexus_library.db` tracked. | **HIGH** | `git ls-files` |
| 5 | **Hardcoded real employee emails + default secrets** (`ALLOWED_EMAILS` lists 5 real people; `MANAGE_ENGINE_API_KEY="mock-api-key"`; DB `postgres:postgres`). | **MEDIUM** | [config.py:235-244](../backend/app/config.py#L235), [config.py:476](../backend/app/config.py#L476) |
| 6 | **Prompt injection via RAG content.** SharePoint docs/transcripts ingested with no injection screening. | **MEDIUM/HIGH** | [config.py:478-507](../backend/app/config.py#L478) |
| 7 | **No rate limiting / input-size cap** on `/api/chat` → DoS + token-cost abuse. | **MEDIUM** | [main.py:232](../backend/app/main.py#L232) |
| 8 | **Silent exception swallowing on auth path** hides authz failures. | **MEDIUM** | [auth.py:51-52](../backend/app/auth.py#L51) |
| 9 | **SSRF surface** — website pull, SharePoint, connectors fetch URLs; verify allowlisting. | **LOW/MEDIUM** | [config.py:225](../backend/app/config.py#L225) |
| 10 | SQL injection | **LOW (well-handled)** — ORM + closed analytics catalog. | [analytics_builder_service.py](../backend/app/services/analytics_builder_service.py) |
| 11 | Command injection (deeplink subprocess) | **LOW (safe)** — fixed args, `sys.executable`. | [deeplink_agent.py:82](../backend/app/agents/deeplink_agent.py#L82) |

**#1 and #2 are release-blocking.** Everything else is secondary to fixing server-side token validation.

---

## 15. Database Review

- **102 tables, 56 relationships, 243 index references** ([models.py](../backend/app/models.py)) — rich, reasonably indexed.
- **No migration framework.** `Base.metadata.create_all` + hand-rolled `CREATE TABLE IF NOT EXISTS` and additive `CREATE INDEX` in [database.py:154-304](../backend/app/database.py#L154). At 102 tables: no column renames, no safe drops, no rollback, no environment parity. **Adopt Alembic immediately** — highest-leverage backend fix after auth.
- **Two vector stores**: pgvector (semantic router, HNSW) vs. JSON-column embeddings (policy chunks). Consolidate on pgvector.
- **`models.py` is a 2,106-line single file** — split per domain.
- **SQLite legacy (`centriq.db`) coexists with Postgres** — remove from repo; document the single source of truth.

---

## 16. Performance Review

- **LLM latency dominates.** Local `llama3.1:8b` on a *shared* `ml01` box. Concurrency gate = 8, queue = 50, 90s timeout ([config.py:218](../backend/app/config.py#L218)). At 1,000 employees with bursty mornings, **8 concurrent generations is a hard ceiling.**
- **Mitigations present (good):** model warm-up/keep-alive ([main.py:99-155](../backend/app/main.py#L99)), semantic answer cache (0.93 sim, zero-LLM), deterministic fast-paths, execute-first prefetch.
- **Gaps:** no GPU autoscaling/dedicated capacity plan; JSON-cosine RAG scan; no series caching; mega React bundles.
- **TTFT metric is pending** — can't optimize latency you don't measure.

---

## 17. DevOps Review

- **Present:** Dockerfiles (root, backend, nginx), `docker-compose.yml` + `docker-compose.infra.yml`, `deploy.sh`, `first-deploy.sh`, nginx configs, `scripts/rotate-secrets.sh`.
- **Missing:** **no CI/CD** (no pipeline found). No automated test/lint/security gate, no image scanning, no rollback automation beyond a shell script.
- **Secrets** in `.env`; no vault/secret-manager.
- **Single-host topology** implied — no HA, no blue/green.

---

## 18. Observability

**A genuine strength.** `ai_request_logs` (domain/model/tokens/latency), Langfuse tracing ([langfuse_tracing.py](../backend/app/langfuse_tracing.py)), Observability dashboard with Feedback Triage and Feature Adoption tabs, SLO metric capture.

**Gaps:** no infra metrics/alerts (Prometheus/Grafana), no distributed tracing across services, no cost dashboard ($/team), no alerting on circuit-breaker trips or queue saturation. *AI* observability strong; *systems* observability thin.

---

## 19. Testing

- **~20 backend test files**, concentrated on highest-risk areas: routing regression/golden (62 curated + 291 snapshot), resolver, action registry, idempotency, receipts, access control, semantic router. The routing/action discipline and the Appendix B testing taxonomy are principal-grade.
- **Critical gaps:** **zero frontend tests**, **zero E2E**, **no RAG groundedness eval**, **no action-correctness eval**, no load/chaos testing.

**Priority:** build groundedness + action-correctness eval tiers; add a thin E2E smoke suite (Playwright) over the top 5 journeys.

---

## 20. Product Review

**Impressive:** breadth for the team size; real product instinct in confidence-gated clarification, abstention-with-handoff, action receipts+undo, proactive nudges, adoption analytics, the skill flywheel.

**Missing / adoption risks:**
- **Trust & transparency UI** — citations designed but inconsistently surfaced.
- **Unified search** — "enterprise search" is a mode but the platform is domain-routed, not search-first.
- **No mobile/Teams-native entry point** — the assistant must live *inside Teams* for 1,000 employees.
- **Cross-session personalization/memory** is thin.
- **Platform onboarding** — capability discovery exists; a new employee needs a guided "what can this do for me."

**Top delight features:** in-Teams assistant, cited answers, "my morning briefing," one-click "turn this answer into an action."

---

## 21. Competitive Analysis

| Platform | Where Centriq **wins** | Where it **falls behind** |
|---|---|---|
| **M365 Copilot** | Deep custom workflows; on-prem/local-model control; governed analytics | Native Office/Teams surface, model quality, scale, polish |
| **Glean** | Action-taking; domain workflows; governed metrics | Unified search, connector breadth, ranking quality |
| **Atlassian Rovo** | Broader than dev-tooling | Agent maturity, native graph |
| **ServiceNow AI** | Cheaper/faster to extend; broader domain | ITSM depth, workflow engine, RBAC/audit |
| **Agentforce / Notion AI / Slack AI** | Org-specific intelligence (Project IQ, flywheel) | Robustness, model power |

**Adopt:** Glean's search-first + cited answers; Copilot's in-Teams presence; ServiceNow's workflow durability. **Avoid:** generic NL→SQL (already correctly avoided), over-broad autonomous actions, multi-tenant complexity you don't need.

**Unique wedge:** *org-specific, action-taking intelligence with a skills/project knowledge graph* — the moat. Lean into the graph, not into competing on model quality.

---

## 22. Innovation (3–5 year horizon)

Ranked by feasibility on this foundation:
1. **Organization Knowledge Graph** — the substrate that turns 10 modes into one brain. *Build first.*
2. **AI Chief of Staff / Morning Briefing** — proactive, personalized; fuses existing nudge + analytics + approvals.
3. **Meeting & Decision Intelligence** — transcripts already ingested.
4. **Predictive Enterprise Intelligence** — delivery/attrition/skill-supply forecasting on data already snapshotted.
5. **Enterprise Reasoning Engine / Cross-project Learning** — once the graph + insight bus exist.
6. **AI-generated reports/presentations** (doc-gen infra exists) and **Executive Dashboard / Org Timeline**.

Through-line: **a shared knowledge graph + an insight bus.**

---

## 23. Technical Debt

**Immediate (0–2 weeks)**
- Server-side token validation + role-from-`groups` (kills CRITICAL auth).
- Lock down CORS; rate-limit `/api/chat`; remove `centriq.db`/`nexus_library.db` from git + rotate creds.
- Adopt Alembic; freeze further raw-SQL DDL.

**Short term (1–3 months)**
- Split `agent.py` / `main.py` / `models.py`; finish Resolver + shared-pipeline migration.
- Unify vector storage on pgvector; add rerank + groundedness eval.
- Build CI pipeline.
- Decompose mega-frontend pages; add component + E2E tests.

**Long term (3–12 months)**
- Capability/skill registry replacing isolated modes.
- Knowledge graph + insight bus.
- Semantic layer for analytics; Teams-native surface; i18n.
- HA/DR topology + dedicated/autoscaled model capacity.

---

## 24. Scalability

| Scale | Verdict | Bottleneck |
|---|---|---|
| 250 | OK with auth fix | concurrency gate fine |
| 500 | Strained at peak | 8-concurrent LLM ceiling, JSON-cosine RAG |
| **1,000 (target)** | **Not ready** | auth, no migrations, single model/Redis/Postgres, no HA, mega-pages |
| 2,500 | Requires redesign | dedicated GPU fleet + queueing, pgvector everywhere, multi-worker, read replicas |
| 5,000 | Requires platform investment | horizontal API scale, sharded retrieval, async action workers, full alerting |

**Biggest bottleneck: the shared 8B model behind a gate of 8** — a hardware ceiling no code change fixes. Second: multi-worker will break module-level mutable state. Third: JSON-cosine RAG.

---

## 25. Developer Experience

**Good:** `run-dev.js`/`run-backend.js` orchestration, docker-compose infra, clear service naming, `.env.example`, backend auto-restarter, and *excellent internal architecture docs*.

**Friction:** 5,000-line files; dual route conventions; no migrations (schema reproduction is folklore); no top-level architecture README; no CI; intricate Windows/WSL/local-model setup. **Add a top-level architecture README** → docs/, and the CI gate.

---

## 26. Final Scores (1–10)

| Dimension | Score | Justification |
|---|---:|---|
| Architecture | 6 | Excellent intent, accreted reality |
| AI Architecture | 8 | Tiered routing, closed-catalog analytics, abstention, observability |
| Enterprise Readiness | 3 | Header-trust auth, no migrations, no DR |
| Security | 2 | Release-blocking auth/authz; CORS; committed DBs |
| Maintainability | 5 | Clean services, monolithic brain + mega-pages |
| Scalability | 4 | Hard model ceiling, single-instance, in-memory state |
| Product Vision | 8 | Breadth + the right bets |
| Performance | 5 | Smart caching, but model-bound + JSON RAG |
| Developer Experience | 6 | Great docs, painful files, no CI |
| Code Quality | 6 | Good service hygiene; god-modules drag it down |
| Innovation | 8 | Clear, achievable path to an org brain |
| User Experience | 6 | Trust-aware UX, but mega-pages, no i18n, no Teams |
| Technical Debt | 4 | Concentrated in auth, migrations, `agent.py` |

**Overall: ~5.3/10 today — with an unusually high ceiling.** Vision and AI architecture are 8s; platform fundamentals are 2–4s. Close the fundamentals and this is a 7.5–8 platform.

---

## 27. Top Recommendations

*Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low. Effort: S(<1wk) M(1–4wk) L(1–3mo) XL(3mo+).*

**Security & Enterprise (1–12)**
1. 🔴 **Server-side Entra token validation** — validate JWT (sig/aud/iss) on every request; derive identity from validated claims. *Impl:* generalize [azure_auth.py](../backend/app/azure_auth.py) into default `get_current_user`. *M.*
2. 🔴 **Role/RBAC from validated `groups`**, not `x-user-role`. *M.*
3. 🔴 **Remove `DEFAULT_USER_EMAIL` prod fallback** — fail closed. *S.*
4. 🟠 **Fix CORS** to an explicit origin allowlist. *S.*
5. 🟠 **Purge `centriq.db`/`nexus_library.db` from git**, gitignore, rotate secrets. *S.*
6. 🟠 **Move secrets to a vault**; remove hardcoded emails/keys. *M.*
7. 🟠 **Rate-limit + input-size cap** on `/api/chat`. *S.*
8. 🟠 **RAG ingestion injection screening.** *M.*
9. 🟡 **Comprehensive audit trail** for all writes. *M.*
10. 🟡 **Remove silent `except: pass` on auth path.** *S.*
11. 🟡 **SSRF allowlist** for server-side fetches. *S.*
12. 🟡 **Country/timezone/data-residency policy model (ABAC).** *L.*

**Data & Platform (13–22)**
13. 🔴 **Adopt Alembic migrations**; freeze raw DDL. *M.*
14. 🟠 **Unify on pgvector** for all embeddings. *M.*
15. 🟠 **Build CI/CD** (test+lint+security+migration gate). *M.*
16. 🟠 **Split `models.py`** per domain. *M.*
17. 🟠 **HA topology plan** (Postgres replica, Redis HA, multi-worker). *L.*
18. 🟠 **GPU capacity/queueing plan.** *L.*
19. 🟡 **Series caching** in analytics. *S.*
20. 🟡 **Infra metrics + alerting.** *M.*
21. 🟡 **Cost dashboard.** *S.*
22. 🟢 **Top-level architecture README.** *S.*

**Orchestration / AI (23–34)**
23. ✅ **Split `agent.py`** into `orchestration/`, `tools/`, thin `agents/`. *L.* — Done 2026-06-27 (`backend/app/orchestration/` package: resolver.py, state.py, pipeline.py; `tools/__init__.py` scaffold; services/resolver.py is now a re-export shim)
24. ✅ **Finish Resolver extraction (Phase 2).** *M.* — Done 2026-06-27 (Resolver/Decision/RouteContext canonical home = `orchestration/resolver.py`; agent.py imports from there)
25. ✅ **Shared agent pipeline (Phase 3).** *L.* — Done 2026-06-27 (`orchestration/pipeline.py` — `SharedPipeline` with pre/post hook engine; built-in hooks: context_inject, session_load, nudge_check; `SHARED_PIPELINE` singleton)
26. ✅ **Complete action-safety layer** — durable pending_action, idempotency, expiry. *M.* — Done 2026-06-27 (`list_pending()`, `expire_session()`, `expire_stale()`, `purge_expired()` added to pending_action_service; hourly background cleaner wired in main.py)
27. ✅ **RAG groundedness eval tier.** *M.* — Done 2026-06-27 (`backend/tests/eval/eval_rag_groundedness.py` — 8 cases, keyword-overlap judge, `--live`/`--save` flags)
28. ✅ **Action-correctness eval tier.** *M.* — Done 2026-06-27 (`backend/tests/eval/eval_action_correctness.py` — 7 cases covering routing, entity extraction, confirm-gate; `run_all.py` combined scorecard)
29. ✅ **Add reranking** to RAG. *M.* — Done 2026-06-27 (`_rerank_chunks()` TF-overlap reranker in policy_service.py; blended 70% RRF + 30% rerank in `_hybrid_search`)
30. ✅ **Structure-aware policy chunking.** *S.* — Done 2026-06-27 (`_chunk_text_structured()` — heading/section-aware chunker, prepends section heading to every chunk; `_chunk_and_embed()` now uses it)
31. ✅ **Surface citations consistently.** *M.* — Done 2026-06-27 (`search_policies_with_citations()` in policy_service.py returns `{context, citations[{title,category,excerpt}]}`)
32. ✅ **Verify no module-level mutable state survives to multi-worker.** *S.* — Done 2026-06-27 (TTL caches documented with MULTI-WORKER NOTE; startup warning fires if `WEB_CONCURRENCY > 1`)
33. ✅ **TTFT metric.** *S.* — Done 2026-06-27 (`time_to_first_token_ms` captured on first SSE token, written to `AiRequestLog`)
34. 🟢 **Retire characterization snapshot after Phase 2.** *S.* — Pending (blocked on full Phase 2 Resolver completion)

**Product / Frontend (35–44)**
35. 🟠 **Decompose mega-pages.** *L.* — Pending (not started)
36. 🟠 **Teams-native assistant surface.** *L.* — Deferred (blocked on server-side auth #1–3 + Azure tenant config)
37. 🟠 **Frontend + E2E test suite.** *L.* — Pending (not started; zero frontend tests today)
38. 🟡 **Search-first unified entry.** *L.* — Pending (not started)
39. ✅ **"Morning briefing" digest.** *M.* — Done 2026-06-27 (`briefing_service.py` fuses nudges + leave balance + self-scoped personal metrics; `GET /api/briefing/me`; `MorningBriefing.tsx` card on the assistant home, dismiss-for-the-day)
40. 🟡 **i18n + locale/timezone.** *L.* — Pending (not started)
41. ✅ **Cited-answer trust UI.** *M.* — Done 2026-06-27 (`_extract_citations()` parses RAG tool outputs in `_postprocess`; threaded through SSE `done` → `Turn.citations`; `CitationsCard.tsx` collapsible "Grounded in N sources" trust card. Note: cache-replayed answers don't carry citations — tools don't re-run)
42. ✅ **Analytics export (PPT/PDF/scheduled).** *M.* — Done 2026-06-27 for on-demand PDF + PPTX (`analytics_export_service.py` — reportlab vector chart + native python-pptx editable chart; `POST /api/analytics/export/{pdf,pptx}`; PDF/PPTX buttons in Chart Builder). **Scheduled email export deferred** (needs a durable schedule table + email delivery, which is gated/inert today)
43. ✅ **Lazy-load heavy routes.** *S.* — Done 2026-06-27 (route components already auto-split by TanStack Start; remaining win was Control Hub statically bundling all 23 portal pages into one chunk → converted to `React.lazy` + `Suspense`, so each portal loads on demand)
44. 🟢 **Accessibility audit.** *M.* — Pending (not started)

**Strategic (45–52)**
45. ✅ **Capability/Skill registry** replacing isolated modes. *XL.* — Done 2026-06-27 (`SkillSpec` dataclass + `SKILL_REGISTRY` (analytics/training/project/resource) + `route_for_mode()` in capability_registry.py; `_active_mode_strategy` reads registry first, `_MODE_ROUTES` is fallback)
46. ✅ **Canonical employee identity** (employee_code joins). *M.* — Done 2026-06-27 (`backend/app/services/employee_identity.py`: `normalize_name()`, `name_similarity()`, `resolve_identity()`, `resolve_identities_batch()`; resource_matching_service updated)
47. 🟠 **Organization knowledge graph.** *XL.* — Pending (not started; XL effort)
48. ✅ **Insight/event bus** (one chain first). *L.* — Done 2026-06-27 (`backend/app/services/insight_bus.py`: `DeliveryRiskSignal`, `SkillGapSignal`, `AttritionRiskSignal`; 3 reactors; delivery-risk→training chain live; `InsightSignalLog` + `InsightNudgeLog` models added; human-gated, never auto-execute)
49. 🟡 **Semantic layer** for analytics. *L.* — Pending (not started)
50. 🟡 **Project Health Score product.** *L.* — Pending (not started)
51. 🟡 **Meeting/Decision Intelligence.** *L.* — Pending (not started)
52. ✅ **Personalized learning → verified-skill → staffing loop.** *M.* — Done 2026-06-27 (`_apply_verified_skills()` emits `SkillGapSignal(gap_count=-1)` to InsightBus after skill verification; reactors notify Resource Finder / managers)

---

## 28. Implementation Roadmap

**Next 30 days — "Make it safe & survivable" (non-negotiable before rollout)**
- Server-side token validation + RBAC from `groups` (#1–3); fix CORS (#4); rate-limit (#7).
- Purge committed DBs + rotate secrets (#5–6).
- Adopt Alembic (#13).
- Stand up CI with a test gate (#15).
- *Exit criteria: a non-admin cannot escalate; schema changes go through migrations; secrets aren't in git; tests run on every push.*

**Next Quarter — "De-accrete the brain & harden data"**
- Split `agent.py`/`main.py`/`models.py` (#16, #23); finish Resolver + shared pipeline (#24–25); complete action-safety layer (#26).
- Unify pgvector + rerank + groundedness/action eval (#14, #27–29).
- Decompose top 5 mega-pages + E2E smoke (#35, #37).
- Audit trail + infra alerting (#9, #20).
- *Exit criteria: a new domain/skill needs no new cross-cutting code; RAG groundedness measured; auth + actions covered by eval.*

**Next 6 Months — "From modes to a brain"**
- Capability/Skill registry (#45); canonical identity (#46); semantic analytics layer (#49).
- Teams-native surface (#36); search-first entry (#38); Morning Briefing (#39).
- HA topology + GPU capacity plan (#17–18).
- *Exit criteria: cross-mode signal flows for one real chain; assistant lives in Teams; survives a model-server failover.*

**Next Year — "Organizational intelligence"**
- Knowledge graph + insight bus (#47–48); Project Health Score, Meeting/Decision Intelligence, Predictive Intelligence (#50–51).
- i18n/global rollout (#40); learning→staffing loop (#52).
- *Exit criteria: Project IQ + Resource Finder + Analytics read from one shared graph; a delivery-risk signal autonomously proposes (human-gated) a training + staffing action.*

---

## Closing Verdict (as the Board)

**Would I recommend this architecture for my own engineering org?** *Not in its current security/platform state — but the trajectory is one of the most promising reviewed.* The team has written the right destination down ([target-architecture.md](target-architecture.md)) and is executing a disciplined strangler migration toward it. The AI architecture is genuinely strong; the product bets are right; the moat (org-specific, action-taking, graph-backed intelligence) is real and defensible *for this organization*.

The blocker is not vision or AI — it's **fundamentals**: fix authentication, add migrations, tame the god-modules, and build the knowledge graph. Do the 30-day safety work first (it is release-blocking), then execute the roadmap. This can become the organization's AI operating layer. It cannot ship to 1,000 employees until item #1 is done.

---

### Open questions / context needed
- Production deployment topology (is it really single-host?).
- Whether `PENDING_IT_EMAIL_DRAFTS` is fully migrated to durable `pending_action` (not confirmed end-to-end).
- Actual peak concurrent-user numbers (to size the GPU plan).
- Whether `centriq.db` contains real or synthetic PII.
