# Observability — Content Reveal Access via Azure AD Groups

This document describes how access to **revealing raw conversation content** in the `/observability`
dashboard is controlled. Operational metrics (latency, tokens, errors, domain/model/node performance) are
always visible to IT/Admin and contain **no** private content. Reading the actual message/response text of a
logged conversation is a separate, restricted, audited action governed by **Azure AD security group
membership**, with the access token **validated server-side**.

## Model

- **Per-domain groups.** Each conversation domain has its own security group. Membership in a domain's group
  is what grants the ability to reveal that domain's conversations — preserving separation of duties (IT
  cannot read HR/finance content, and vice-versa).
- **Server-side JWT validation.** The frontend sends the Azure access token as `Authorization: Bearer …`. The
  backend verifies the token signature (JWKS), audience, and issuer, and reads the `groups` claim from the
  *validated* token — so a user cannot spoof access by setting a header.
- **Still audited + PII-masked.** Every reveal writes a `ContentRevealAudit` row (who, which log, domain,
  reason, when). Returned content has IDs / contact details / money amounts masked even for the authorized
  reviewer.

## Azure portal prerequisites (one-time, by an Azure admin)

1. **App Registration → Token configuration →** add the optional claim **`groups`** (security groups) to
   **Access tokens** (and ID tokens). Groups are emitted as **object IDs (GUIDs)**.
2. **App Registration → Expose an API →** set Application ID URI `api://<client-id>` and add a delegated scope
   **`access_as_user`**. (The existing SPA registration can expose this scope.)
3. Create per-domain security groups, e.g. `Reveal-HR`, `Reveal-IT`, `Reveal-PMO`, `Reveal-Admin` (and
   optionally `Reveal-General`). Record each group's **object ID**.

> **Group overage:** if a user belongs to >~200 groups, Azure emits an overage claim instead of the array and
> the full list must be fetched via Microsoft Graph `memberOf`. Not handled today — the validator logs a clear
> error if it encounters overage.

## Backend configuration (env vars → `backend/app/config.py`)

| Env var | Purpose |
|---|---|
| `AZURE_TENANT_ID` | Tenant for issuer/JWKS (falls back to `GRAPH_TENANT_ID`). |
| `AZURE_CLIENT_ID` | SPA/app client id. |
| `AZURE_API_AUDIENCE` | Expected token audience (default `api://<AZURE_CLIENT_ID>`). |
| `AZURE_JWT_ENABLED` | `true` to enforce token validation; `false` for local dev bypass. |
| `DEV_REVEAL_DOMAINS` | CSV of domains a dev user may reveal when JWT is disabled. |
| `REVEAL_GROUP_HR` / `_IT` / `_PMO` / `_ADMIN` / `_GENERAL` | CSV of group object IDs mapped to each domain. |

Domain values map to log domains: `hr`, `it_support`, `pmo`, `admin`, `general`.

## How it works at runtime

1. Frontend acquires an access token for `api://<clientId>/access_as_user` (`VITE_MSAL_API_SCOPE`) and sends
   it as a Bearer header on reveal-related calls only (metadata/chart endpoints stay header-based).
2. `GET /api/observability/reveal-scope` returns the set of domains the caller may reveal (derived from their
   validated group membership). The UI shows the reveal affordance only on in-scope rows.
3. `POST /api/observability/logs/{id}/reveal` (with a reason) re-checks scope server-side, writes an audit
   row, and returns PII-masked content. Out-of-scope → 403; missing/invalid token (when enabled) → 401.
4. `GET /api/observability/audit` (admin) lists the full reveal audit trail.

## Local development

Set `AZURE_JWT_ENABLED=false`. The backend falls back to header identity and grants the domains listed in
`DEV_REVEAL_DOMAINS`, so the full reveal flow is testable without Azure configured.

## Access-model note

Dashboard **page** visibility remains role-based (IT/Admin). **Reveal** is governed purely by group
membership. A per-domain reviewer who is not IT/Admin would not currently reach the page; either keep
reviewers within IT/Admin or broaden the page guard to "IT/Admin **or** non-empty reveal-scope".
