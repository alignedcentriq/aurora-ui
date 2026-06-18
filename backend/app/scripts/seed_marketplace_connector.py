"""
Seed script: onboard the AI Xchange / AI-Agents Marketplace backend as a
READ-ONLY connector.

Both the AI Xchange SPA (aixchangehub.azurewebsites.net) and the marketplace UI
are served by this one FastAPI backend. We import its OpenAPI spec but expose
ONLY GET operations to the hub — every POST/PUT/PATCH/DELETE is dropped at parse
time, so no agent/tool can ever add, update, or delete data in that portal.
We also exclude all /users/* routes (PII / auth-only; GET /users dumps the user
list, and /users/me is bearer-gated and useless to the hub).

Result: the hub can answer "what AI tools are approved?", "what's our AI usage
policy?", "what training is scheduled?", "what internal AI platforms exist?" —
all read-only, all citable, all logged via ConnectorCallLog.

Run from backend/:
  venv/Scripts/python.exe -m app.scripts.seed_marketplace_connector

Idempotent: re-running upserts operations and leaves the connector published.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import httpx

from app.database import SessionLocal
from app.models import Connector, ConnectorAuth, ConnectorOperation
from app.connectors.openapi_importer import parse_spec, enrich_with_llm
from app.connectors.registry import invalidate

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = "https://ai-agents-marketplace-backend-ged3hkdbbhe2fqeu.canadacentral-01.azurewebsites.net"
SPEC_URL = f"{BASE_URL}/openapi.json"

SLUG = "ai_xchange_marketplace"
NAME = "AI Xchange Marketplace"
DESCRIPTION = (
    "Read-only catalog of the Aligned Automation AI Xchange: approved AI tools, "
    "AI usage policies, training calendar, newsletters, and the registry of "
    "internal AI platforms/agents. Source of truth for AI-governance questions."
)

# Read-only enforcement: only these HTTP methods are ever imported.
ALLOWED_METHODS = {"GET"}

# Path prefixes to exclude entirely (PII / auth-only — not useful to the hub).
EXCLUDED_PREFIXES = ("/users",)


def _is_allowed(op: dict) -> bool:
    method = (op.get("method") or "").upper()
    path = op.get("path_template") or ""
    if method not in ALLOWED_METHODS:
        return False
    if any(path == p or path.startswith(p + "/") or path == p for p in EXCLUDED_PREFIXES):
        return False
    return True


async def main() -> None:
    # 1. Fetch the live OpenAPI spec
    print(f"Fetching spec: {SPEC_URL}")
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(SPEC_URL)
        resp.raise_for_status()
        spec = resp.json()
        raw = resp.content

    # 2. Parse + READ-ONLY filter
    all_ops = parse_spec(spec)
    ops = [o for o in all_ops if _is_allowed(o)]
    dropped = [
        f"{o.get('method')} {o.get('path_template')}"
        for o in all_ops if not _is_allowed(o)
    ]
    print(f"Parsed {len(all_ops)} ops total; keeping {len(ops)} read-only GET ops.")
    print("  Kept:")
    for o in ops:
        print(f"    GET {o['path_template']}  ({o['name']})")
    print("  Dropped (mutating or excluded):")
    for d in dropped:
        print(f"    {d}")

    # Belt-and-suspenders: these can never require confirmation because they
    # are all GETs, but make the intent explicit.
    for o in ops:
        o["requires_confirmation"] = False

    # 3. Optional offline description enrichment (non-fatal if LLM is down)
    ops = await enrich_with_llm(ops, NAME)

    # 4. Upsert Connector
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.slug == SLUG).first()
        if conn is None:
            conn = Connector(
                slug=SLUG,
                name=NAME,
                description=DESCRIPTION,
                source_type="openapi",
                base_url=BASE_URL,
                spec_url=SPEC_URL,
                status="draft",
                created_by="seed_script",
            )
            db.add(conn)
            db.flush()
            print(f"Created connector id={conn.id} slug={SLUG}")
        else:
            conn.name = NAME
            conn.description = DESCRIPTION
            conn.base_url = BASE_URL
            conn.spec_url = SPEC_URL
            print(f"Found existing connector id={conn.id} slug={SLUG}")
        conn.spec_blob = raw
        connector_id = conn.id

        # 5. Upsert ONLY the read-only operations
        kept_names = {o["name"] for o in ops}
        for op_data in ops:
            existing = db.query(ConnectorOperation).filter(
                ConnectorOperation.connector_id == connector_id,
                ConnectorOperation.name == op_data["name"],
            ).first()
            if existing:
                for k, v in op_data.items():
                    setattr(existing, k, v)
                existing.version = (existing.version or 1) + 1
            else:
                db.add(ConnectorOperation(connector_id=connector_id, **op_data))

        # 5b. Disable any pre-existing op on this connector that is NOT in our
        #     read-only set (protects against an earlier import that included writes).
        stale = db.query(ConnectorOperation).filter(
            ConnectorOperation.connector_id == connector_id,
            ~ConnectorOperation.name.in_(kept_names),
        ).all()
        for s in stale:
            s.enabled = False
            print(f"  Disabled stale/non-readonly op: {s.method} {s.path_template}")

        # 6. Auth = none (the backend's GET catalogs are unauthenticated today)
        auth = db.query(ConnectorAuth).filter(
            ConnectorAuth.connector_id == connector_id
        ).first()
        if auth is None:
            db.add(ConnectorAuth(connector_id=connector_id, auth_type="none", auth_mode="service"))
        else:
            auth.auth_type = "none"
            auth.auth_mode = "service"

        # 7. Publish
        conn.status = "published"
        conn.version = (conn.version or 1) + 1
        db.commit()
        print(f"Published connector id={connector_id} with {len(ops)} read-only operations.")

    # 8. Refresh the in-process registry cache + broadcast to other workers
    await invalidate()
    print("Registry invalidated — operations are now live as agent tools.")
    print(
        "\nNOTE: router utterances were not seeded here. To make the semantic "
        "router dispatch to these ops, call the publish endpoint once:\n"
        f"  POST /api/admin/connectors/{connector_id}/publish  (super-admin)\n"
        "or run seed_router_examples() for this connector."
    )


if __name__ == "__main__":
    asyncio.run(main())
