"""
Connector Studio API — CRUD, OpenAPI import, test-op, publish, usage.

All write endpoints are super-admin only. Read/invoke endpoints are role-gated
via ConnectorRegistry scope rules.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.auth import CurrentUser, require_admin, require_super_admin, get_current_user
from app.database import SessionLocal
from app.models import (
    Connector, ConnectorAuth, ConnectorUserAuth, ConnectorOperation, ConnectorCallLog, ConnectorScope,
    RouterExample,
)
from app.connectors.registry import ConnectorRegistry, invalidate
from app.connectors.executor import execute_operation
from app.connectors.auth import encrypt_config, invalidate_auth_cache, invalidate_user_auth_cache

router = APIRouter(prefix="/api/admin/connectors", tags=["connectors"])
invoke_router = APIRouter(prefix="/api/connectors", tags=["connectors-invoke"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ConnectorCreate(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None
    source_type: str = "manual"   # openapi | manual | mcp | native
    base_url: Optional[str] = None
    spec_url: Optional[str] = None


class ConnectorUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    base_url: Optional[str] = None
    status: Optional[str] = None


class AuthPayload(BaseModel):
    auth_type: str             # none | api_key | bearer | basic | oauth2
    auth_mode: str = "service" # service | per_user
    config: dict = {}          # plain dict — will be Fernet-encrypted


class OperationUpdate(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    requires_confirmation: Optional[bool] = None
    minutes_saved: Optional[float] = None
    response_mode: Optional[str] = None
    template: Optional[str] = None
    enabled: Optional[bool] = None


class TestOpPayload(BaseModel):
    args: dict = {}


class ScopePayload(BaseModel):
    """Connector-level access rules. Empty across all fields = Global (everyone)."""
    roles: list[str] = []         # e.g. ["hr", "manager"] — matched case-insensitively
    departments: list[str] = []   # e.g. ["Engineering"]
    persona_ids: list[int] = []   # persona / group ids
    user_emails: list[str] = []   # grant to specific people, e.g. ["jane@corp.com"]


class InvokePayload(BaseModel):
    operation_id: int
    args: dict = {}


class MyConnectionPayload(BaseModel):
    """A user's own credential for a per_user connector (plain — Fernet-encrypted server-side)."""
    config: dict = {}


class RouterExampleCreate(BaseModel):
    utterance: str
    operation_id: int


class RouterExampleUpdate(BaseModel):
    utterance: Optional[str] = None
    is_active: Optional[bool] = None


class OpRolesPayload(BaseModel):
    """App-role slugs allowed to invoke one operation. Empty = everyone (global)."""
    roles: list[str] = []


# ── Connector CRUD ────────────────────────────────────────────────────────────

@router.get("")
async def list_connectors(user: CurrentUser = Depends(require_admin)):
    with SessionLocal() as db:
        rows = db.query(Connector).order_by(Connector.created_at.desc()).all()
        return [
            {
                "id": c.id, "slug": c.slug, "name": c.name,
                "description": c.description, "source_type": c.source_type,
                "base_url": c.base_url, "status": c.status, "version": c.version,
                "seeding_status": c.seeding_status, "created_by": c.created_by, "created_at": c.created_at,
            }
            for c in rows
        ]


@router.post("")
async def create_connector(
    payload: ConnectorCreate,
    user: CurrentUser = Depends(require_super_admin),
):
    with SessionLocal() as db:
        existing = db.query(Connector).filter(Connector.slug == payload.slug).first()
        if existing:
            raise HTTPException(400, f"Connector slug '{payload.slug}' already exists")
        conn = Connector(
            slug=payload.slug,
            name=payload.name,
            description=payload.description,
            source_type=payload.source_type,
            base_url=payload.base_url,
            spec_url=payload.spec_url,
            status="draft",
            created_by=user.email,
        )
        db.add(conn)
        db.commit()
        db.refresh(conn)
        return {"id": conn.id, "slug": conn.slug, "status": conn.status}


# ── Template gallery ──────────────────────────────────────────────────────────
# Registered BEFORE the `/{connector_id}` routes below — a literal "/templates"
# segment must win over the int path-param route, not be swallowed by it.

class TemplateInstallPayload(BaseModel):
    slug: str
    name: Optional[str] = None
    base_url: Optional[str] = None


@router.get("/templates")
async def list_templates(user: CurrentUser = Depends(require_admin)):
    from app.connectors import templates as template_catalog
    return template_catalog.list_templates()


@router.post("/templates/{key}/install")
async def install_template(
    key: str,
    payload: TemplateInstallPayload,
    user: CurrentUser = Depends(require_super_admin),
):
    from app.connectors import templates as template_catalog
    tpl = template_catalog.get_template(key)
    if tpl is None:
        raise HTTPException(404, f"Unknown template '{key}'")

    with SessionLocal() as db:
        existing = db.query(Connector).filter(Connector.slug == payload.slug).first()
        if existing:
            raise HTTPException(400, f"Connector slug '{payload.slug}' already exists")
        conn = Connector(
            slug=payload.slug,
            name=payload.name or tpl["name"],
            description=tpl["description"],
            source_type="manual",
            base_url=payload.base_url or tpl["base_url_hint"],
            status="draft",
            created_by=user.email,
        )
        db.add(conn)
        db.commit()
        db.refresh(conn)

        for op_data in tpl["operations"]:
            db.add(ConnectorOperation(connector_id=conn.id, **op_data))
        db.commit()

        return {
            "id": conn.id,
            "slug": conn.slug,
            "auth_type": tpl["auth_type"],
            "auth_mode": tpl["auth_mode"],
            "auth_fields": tpl["auth_fields"],
            "provider": tpl.get("provider"),
            "note": tpl.get("note", ""),
        }


@router.get("/{connector_id}")
async def get_connector(connector_id: int, user: CurrentUser = Depends(require_admin)):
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        ops = db.query(ConnectorOperation).filter(
            ConnectorOperation.connector_id == connector_id
        ).all()
        return {
            "id": conn.id, "slug": conn.slug, "name": conn.name,
            "description": conn.description, "source_type": conn.source_type,
            "base_url": conn.base_url, "spec_url": conn.spec_url,
            "status": conn.status, "version": conn.version,
            "seeding_status": conn.seeding_status,
            "operations": [
                {
                    "id": o.id, "name": o.name, "display_name": o.display_name,
                    "description": o.description, "method": o.method,
                    "path_template": o.path_template, "params_schema": o.params_schema,
                    "requires_confirmation": o.requires_confirmation,
                    "minutes_saved": o.minutes_saved, "response_mode": o.response_mode,
                    "enabled": o.enabled,
                }
                for o in ops
            ],
        }


@router.patch("/{connector_id}")
async def update_connector(
    connector_id: int,
    payload: ConnectorUpdate,
    user: CurrentUser = Depends(require_super_admin),
):
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        for field, val in payload.model_dump(exclude_none=True).items():
            setattr(conn, field, val)
        db.commit()
    await invalidate()
    return {"ok": True}


@router.delete("/{connector_id}")
async def delete_connector(
    connector_id: int,
    user: CurrentUser = Depends(require_super_admin),
):
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        db.delete(conn)
        db.commit()
    await invalidate()
    return {"ok": True}


# ── OpenAPI import ────────────────────────────────────────────────────────────

@router.post("/{connector_id}/import-spec")
async def import_spec(
    connector_id: int,
    file: Optional[UploadFile] = File(None),
    user: CurrentUser = Depends(require_super_admin),
):
    """Upload an OpenAPI 2/3 JSON/YAML spec to extract operations."""
    from app.connectors.openapi_importer import parse_spec, enrich_with_llm
    import yaml

    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        connector_name = conn.name

    if file is None:
        raise HTTPException(400, "No file uploaded")

    raw = await file.read()
    try:
        if file.filename and file.filename.endswith((".yaml", ".yml")):
            spec = yaml.safe_load(raw)
        else:
            spec = json.loads(raw)
    except Exception as exc:
        raise HTTPException(400, f"Failed to parse spec: {exc}")

    ops = parse_spec(spec)
    ops = await enrich_with_llm(ops, connector_name)

    # Upsert operations
    with SessionLocal() as db:
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
        # Save raw spec
        conn_row = db.query(Connector).filter(Connector.id == connector_id).first()
        if conn_row:
            conn_row.spec_blob = raw
        db.commit()

    return {"imported": len(ops), "operations": [o["name"] for o in ops]}


# ── Auth config ───────────────────────────────────────────────────────────────

@router.put("/{connector_id}/auth")
async def set_auth(
    connector_id: int,
    payload: AuthPayload,
    user: CurrentUser = Depends(require_super_admin),
):
    config_enc = encrypt_config(payload.config) if payload.config else None
    with SessionLocal() as db:
        row = db.query(ConnectorAuth).filter(ConnectorAuth.connector_id == connector_id).first()
        if row:
            row.auth_type = payload.auth_type
            row.auth_mode = payload.auth_mode
            row.config_enc = config_enc
        else:
            db.add(ConnectorAuth(
                connector_id=connector_id,
                auth_type=payload.auth_type,
                auth_mode=payload.auth_mode,
                config_enc=config_enc,
            ))
        db.commit()
    invalidate_auth_cache(connector_id)
    return {"ok": True}


# ── Access scopes (who can use the connector) ─────────────────────────────────

@router.get("/{connector_id}/scopes")
async def get_scopes(connector_id: int, user: CurrentUser = Depends(require_admin)):
    """Return the connector-level access rules. mode='global' means everyone."""
    with SessionLocal() as db:
        rows = db.query(ConnectorScope).filter(
            ConnectorScope.connector_id == connector_id,
            ConnectorScope.operation_id.is_(None),
        ).all()
    roles = sorted({r.role for r in rows if r.role})
    departments = sorted({r.department for r in rows if r.department})
    persona_ids = sorted({r.persona_id for r in rows if r.persona_id})
    user_emails = sorted({r.user_email for r in rows if r.user_email})
    return {
        "mode": "restricted" if rows else "global",
        "roles": roles,
        "departments": departments,
        "persona_ids": persona_ids,
        "user_emails": user_emails,
    }


@router.put("/{connector_id}/scopes")
async def set_scopes(
    connector_id: int,
    payload: ScopePayload,
    user: CurrentUser = Depends(require_super_admin),
):
    """Replace the connector-level access rules.

    Passing no roles/departments/persona_ids makes the connector Global (visible to
    everyone) — we simply clear all connector-level scope rows. Otherwise a user must
    match at least one rule (role OR department OR persona) to see the connector's ops.
    """
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        # Wipe existing connector-level scopes (operation_id IS NULL), then re-add.
        db.query(ConnectorScope).filter(
            ConnectorScope.connector_id == connector_id,
            ConnectorScope.operation_id.is_(None),
        ).delete(synchronize_session=False)
        for r in payload.roles:
            r = (r or "").strip().lower()
            if r:
                db.add(ConnectorScope(connector_id=connector_id, role=r))
        for d in payload.departments:
            d = (d or "").strip()
            if d:
                db.add(ConnectorScope(connector_id=connector_id, department=d))
        for pid in payload.persona_ids:
            if pid:
                db.add(ConnectorScope(connector_id=connector_id, persona_id=pid))
        for em in payload.user_emails:
            em = (em or "").strip().lower()
            if em:
                db.add(ConnectorScope(connector_id=connector_id, user_email=em))
        db.commit()
    await invalidate()
    restricted = bool(payload.roles or payload.departments or payload.persona_ids or payload.user_emails)
    return {"ok": True, "mode": "restricted" if restricted else "global"}


@router.get("/users/search")
async def search_users(q: str = "", user: CurrentUser = Depends(require_admin)):
    """Search employees by name or email for the Access "specific user" picker."""
    from sqlalchemy import or_
    from app.models import Employee

    q = (q or "").strip()
    if len(q) < 2:
        return []
    with SessionLocal() as db:
        rows = (
            db.query(Employee.name, Employee.email)
            .filter(
                Employee.email.isnot(None),
                or_(Employee.name.ilike(f"%{q}%"), Employee.email.ilike(f"%{q}%")),
            )
            .order_by(Employee.name)
            .limit(15)
            .all()
        )
    return [{"name": r.name or r.email, "email": r.email} for r in rows if r.email]


# ── Operation management ──────────────────────────────────────────────────────

@router.patch("/{connector_id}/operations/{operation_id}")
async def update_operation(
    connector_id: int,
    operation_id: int,
    payload: OperationUpdate,
    user: CurrentUser = Depends(require_super_admin),
):
    with SessionLocal() as db:
        op = db.query(ConnectorOperation).filter(
            ConnectorOperation.id == operation_id,
            ConnectorOperation.connector_id == connector_id,
        ).first()
        if not op:
            raise HTTPException(404, "Operation not found")
        for field, val in payload.model_dump(exclude_none=True).items():
            setattr(op, field, val)
        op.version = (op.version or 1) + 1
        db.commit()
    await invalidate()
    return {"ok": True}


# ── Test operation (dry-run) ──────────────────────────────────────────────────

@router.post("/{connector_id}/operations/{operation_id}/test")
async def test_operation(
    connector_id: int,
    operation_id: int,
    payload: TestOpPayload,
    user: CurrentUser = Depends(require_super_admin),
):
    """Execute an operation with the provided args and return the raw result (admin dry-run)."""
    result = await execute_operation(
        operation_id=operation_id,
        call_args=payload.args,
        user_email=user.email,
    )
    return result


# ── Publish ───────────────────────────────────────────────────────────────────

@router.post("/{connector_id}/publish")
async def publish_connector(
    connector_id: int,
    user: CurrentUser = Depends(require_super_admin),
):
    """Publish a connector: set status=published, bump version, seed router utterances."""
    from app.connectors.seeder import seed_router_examples
    import asyncio

    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        conn.status = "published"
        conn.seeding_status = "seeding"
        conn.version = (conn.version or 1) + 1
        ops_rows = db.query(ConnectorOperation).filter(
            ConnectorOperation.connector_id == connector_id,
            ConnectorOperation.enabled == True,
        ).all()
        ops = [
            {"id": o.id, "name": o.name, "description": o.description,
             "display_name": o.display_name, "enabled": o.enabled}
            for o in ops_rows
        ]
        slug = conn.slug
        name = conn.name
        db.commit()

    await invalidate()

    # Seed router utterances in background — non-blocking
    asyncio.create_task(seed_router_examples(connector_id, slug, name, ops))

    return {"ok": True, "status": "published", "operations_seeded": len(ops)}


# ── Usage / metrics ───────────────────────────────────────────────────────────

@router.get("/analytics/overview")
async def connectors_analytics_overview(user: CurrentUser = Depends(require_admin)):
    """One row per connector — cross-connector leaderboard for the Studio's Analytics panel.

    Same aggregation shape as /{connector_id}/usage, just grouped by connector_id
    across all connectors instead of by operation_id within one.
    """
    import datetime as _dt
    from sqlalchemy import func as sqlfunc, cast, Integer

    week_ago = _dt.datetime.utcnow() - _dt.timedelta(days=7)

    with SessionLocal() as db:
        totals = {
            r.connector_id: r
            for r in db.query(
                ConnectorCallLog.connector_id,
                sqlfunc.count(ConnectorCallLog.id).label("calls"),
                sqlfunc.avg(ConnectorCallLog.latency_ms).label("avg_latency_ms"),
                sqlfunc.sum(cast(ConnectorCallLog.status == "success", Integer)).label("successes"),
            ).group_by(ConnectorCallLog.connector_id).all()
        }
        recent = {
            r.connector_id: r.calls
            for r in db.query(
                ConnectorCallLog.connector_id,
                sqlfunc.count(ConnectorCallLog.id).label("calls"),
            ).filter(ConnectorCallLog.created_at >= week_ago)
            .group_by(ConnectorCallLog.connector_id).all()
        }
        # Sum minutes_saved per actual call (each log row joined to its operation's
        # minutes_saved), not an average — so ROI reflects which operations were
        # actually invoked, matching how the per-connector /usage endpoint computes it.
        minutes_saved = {
            r.connector_id: r.total_minutes_saved or 0
            for r in db.query(
                ConnectorCallLog.connector_id,
                sqlfunc.sum(ConnectorOperation.minutes_saved).label("total_minutes_saved"),
            )
            .join(ConnectorOperation, ConnectorCallLog.operation_id == ConnectorOperation.id)
            .group_by(ConnectorCallLog.connector_id)
            .all()
        }

        conns = db.query(Connector).order_by(Connector.name).all()

    rows = []
    for c in conns:
        t = totals.get(c.id)
        calls = t.calls if t else 0
        rows.append({
            "connector_id": c.id,
            "name": c.name,
            "status": c.status,
            "calls": calls,
            "calls_last_7d": recent.get(c.id, 0),
            "avg_latency_ms": round((t.avg_latency_ms or 0) if t else 0),
            "success_rate": round((t.successes or 0) / calls, 3) if t and calls else None,
            "total_minutes_saved": round(minutes_saved.get(c.id, 0), 1),
        })
    rows.sort(key=lambda r: r["calls"], reverse=True)
    return {"connectors": rows}


@router.get("/{connector_id}/usage")
async def connector_usage(
    connector_id: int,
    user: CurrentUser = Depends(require_admin),
):
    import datetime as _dt
    from sqlalchemy import func as sqlfunc, cast, Integer

    thirty_days_ago = _dt.datetime.utcnow() - _dt.timedelta(days=30)

    with SessionLocal() as db:
        rows = (
            db.query(
                ConnectorCallLog.operation_id,
                sqlfunc.count(ConnectorCallLog.id).label("calls"),
                sqlfunc.avg(ConnectorCallLog.latency_ms).label("avg_latency_ms"),
                sqlfunc.sum(
                    cast(ConnectorCallLog.status == "success", Integer)
                ).label("successes"),
            )
            .filter(ConnectorCallLog.connector_id == connector_id)
            .group_by(ConnectorCallLog.operation_id)
            .all()
        )
        ops = db.query(ConnectorOperation).filter(
            ConnectorOperation.connector_id == connector_id
        ).all()
        op_names = {o.id: o.name for o in ops}
        minutes_saved_map = {o.id: o.minutes_saved for o in ops}

        daily_rows = (
            db.query(
                sqlfunc.date(ConnectorCallLog.created_at).label("day"),
                sqlfunc.count(ConnectorCallLog.id).label("calls"),
                sqlfunc.sum(cast(ConnectorCallLog.status != "success", Integer)).label("errors"),
            )
            .filter(
                ConnectorCallLog.connector_id == connector_id,
                ConnectorCallLog.created_at >= thirty_days_ago,
            )
            .group_by("day")
            .order_by("day")
            .all()
        )

        error_rows = (
            db.query(
                ConnectorCallLog.error,
                sqlfunc.count(ConnectorCallLog.id).label("count"),
            )
            .filter(
                ConnectorCallLog.connector_id == connector_id,
                ConnectorCallLog.status != "success",
                ConnectorCallLog.error.isnot(None),
            )
            .group_by(ConnectorCallLog.error)
            .order_by(sqlfunc.count(ConnectorCallLog.id).desc())
            .limit(5)
            .all()
        )

        user_rows = (
            db.query(
                ConnectorCallLog.user_email,
                sqlfunc.count(ConnectorCallLog.id).label("calls"),
            )
            .filter(ConnectorCallLog.connector_id == connector_id)
            .group_by(ConnectorCallLog.user_email)
            .order_by(sqlfunc.count(ConnectorCallLog.id).desc())
            .limit(5)
            .all()
        )

    return {
        "connector_id": connector_id,
        "operations": [
            {
                "operation_id": r.operation_id,
                "name": op_names.get(r.operation_id, str(r.operation_id)),
                "calls": r.calls,
                "avg_latency_ms": round(r.avg_latency_ms or 0),
                "success_rate": round((r.successes or 0) / max(r.calls, 1), 3),
                "total_minutes_saved": round((r.calls or 0) * (minutes_saved_map.get(r.operation_id) or 0), 1),
            }
            for r in rows
        ],
        "daily": [
            {"date": str(d.day), "calls": d.calls, "errors": d.errors or 0}
            for d in daily_rows
        ],
        "errors": [
            {"message": (e.error or "")[:200], "count": e.count}
            for e in error_rows
        ],
        "top_users": [
            {"user_email": u.user_email or "unknown", "calls": u.calls}
            for u in user_rows
        ],
    }


# ── Router examples (seeded questions) + per-operation access ─────────────────

@router.get("/{connector_id}/router-examples")
async def list_router_examples(connector_id: int, user: CurrentUser = Depends(require_admin)):
    """The router-seeded questions attached to this connector, grouped by operation,
    plus the app-roles allowed to invoke each operation."""
    from sqlalchemy import or_
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        ops = db.query(ConnectorOperation).filter(
            ConnectorOperation.connector_id == connector_id
        ).all()
        op_ids = [o.id for o in ops]
        domain = f"connector:{conn.slug}"

        rows = db.query(RouterExample).filter(
            or_(
                RouterExample.domain == domain,
                RouterExample.connector_operation_id.in_(op_ids) if op_ids else False,
            )
        ).order_by(RouterExample.created_at).all()

        # Operation-level role scopes (operation_id set, role not null).
        role_scopes = db.query(ConnectorScope).filter(
            ConnectorScope.connector_id == connector_id,
            ConnectorScope.operation_id.isnot(None),
            ConnectorScope.role.isnot(None),
        ).all()
        roles_by_op: dict[int, list[str]] = {}
        for s in role_scopes:
            roles_by_op.setdefault(s.operation_id, []).append(s.role)

        operations = [
            {
                "id": o.id,
                "name": o.name,
                "display_name": o.display_name,
                "allowed_roles": sorted(roles_by_op.get(o.id, [])),
            }
            for o in ops
        ]
        examples = [
            {
                "id": r.id,
                "utterance": r.utterance,
                "operation_id": r.connector_operation_id,
                "is_active": r.is_active,
                "source": r.source,
            }
            for r in rows
        ]
    return {"operations": operations, "examples": examples, "seeding_status": conn.seeding_status}


@router.post("/{connector_id}/router-examples")
async def add_router_example(
    connector_id: int,
    payload: RouterExampleCreate,
    user: CurrentUser = Depends(require_super_admin),
):
    """Manually add one router question for an operation."""
    from app.services.semantic_router_service import SemanticRouterService
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        op = db.query(ConnectorOperation).filter(
            ConnectorOperation.id == payload.operation_id,
            ConnectorOperation.connector_id == connector_id,
        ).first()
        if not op:
            raise HTTPException(404, "Operation not found")
        slug, op_name = conn.slug, op.name
    try:
        ok = await asyncio.to_thread(
            SemanticRouterService.add_example,
            payload.utterance, f"connector:{slug}", op_name, None, "manual", None,
            payload.operation_id, True,  # raise_on_error → surface the real DB reason
        )
    except Exception as exc:
        raise HTTPException(400, f"Could not add example: {exc}")
    if not ok:
        raise HTTPException(400, "Could not add example (empty utterance or missing label)")
    return {"ok": True}


@router.patch("/{connector_id}/router-examples/{example_id}")
async def update_router_example(
    connector_id: int,
    example_id: int,
    payload: RouterExampleUpdate,
    user: CurrentUser = Depends(require_super_admin),
):
    """Edit a question's text and/or enable/disable it."""
    from app.services.semantic_router_service import SemanticRouterService
    if payload.is_active is not None:
        if not await asyncio.to_thread(SemanticRouterService.set_example_active, example_id, payload.is_active):
            raise HTTPException(404, "Example not found")
    if payload.utterance is not None:
        if not await asyncio.to_thread(SemanticRouterService.edit_example, example_id, payload.utterance):
            raise HTTPException(400, "Could not update phrasing (duplicate or not found)")
    return {"ok": True}


@router.delete("/{connector_id}/router-examples/{example_id}")
async def delete_router_example(
    connector_id: int,
    example_id: int,
    user: CurrentUser = Depends(require_super_admin),
):
    from app.services.semantic_router_service import SemanticRouterService
    if not await asyncio.to_thread(SemanticRouterService.delete_example, example_id):
        raise HTTPException(404, "Example not found")
    return {"ok": True}


@router.put("/{connector_id}/operations/{op_id}/roles")
async def set_operation_roles(
    connector_id: int,
    op_id: int,
    payload: OpRolesPayload,
    user: CurrentUser = Depends(require_super_admin),
):
    """Replace the app-roles allowed to invoke one operation. Empty list = everyone."""
    with SessionLocal() as db:
        op = db.query(ConnectorOperation).filter(
            ConnectorOperation.id == op_id,
            ConnectorOperation.connector_id == connector_id,
        ).first()
        if not op:
            raise HTTPException(404, "Operation not found")
        # Clear existing operation-level ROLE scopes for this op, then re-add.
        db.query(ConnectorScope).filter(
            ConnectorScope.connector_id == connector_id,
            ConnectorScope.operation_id == op_id,
            ConnectorScope.role.isnot(None),
        ).delete(synchronize_session=False)
        for r in payload.roles:
            r = (r or "").strip().lower()
            if r:
                db.add(ConnectorScope(connector_id=connector_id, operation_id=op_id, role=r))
        db.commit()
    await invalidate()
    return {"ok": True, "restricted": bool(payload.roles)}


@router.post("/{connector_id}/reseed")
async def reseed_router_examples(
    connector_id: int,
    user: CurrentUser = Depends(require_super_admin),
):
    """Re-run the LLM seeding pass to regenerate router questions for this connector."""
    from app.connectors.seeder import seed_router_examples
    with SessionLocal() as db:
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        if not conn:
            raise HTTPException(404, "Connector not found")
        ops_rows = db.query(ConnectorOperation).filter(
            ConnectorOperation.connector_id == connector_id,
            ConnectorOperation.enabled == True,
        ).all()
        ops = [
            {"id": o.id, "name": o.name, "description": o.description,
             "display_name": o.display_name, "enabled": o.enabled}
            for o in ops_rows
        ]
        slug, name = conn.slug, conn.name
        conn.seeding_status = "seeding"
        db.commit()
    asyncio.create_task(seed_router_examples(connector_id, slug, name, ops))
    return {"ok": True, "operations": len(ops)}


# ── User-facing invoke endpoint ───────────────────────────────────────────────

@invoke_router.post("/invoke")
async def invoke_operation(
    payload: InvokePayload,
    user: CurrentUser = Depends(get_current_user),
):
    """Invoke a connector operation on behalf of the authenticated user.

    Used by DynamicFormWidget when submit_target.connector_slug is set.
    Server-side validates args against the stored params_schema before executing.
    """
    op = await ConnectorRegistry.get_operation(payload.operation_id)
    if not op:
        raise HTTPException(404, "Operation not found or not published")

    # Scope check
    allowed_ops = await ConnectorRegistry.list_operations_for_user(
        user.email, user.role or "employee"
    )
    if not any(o["id"] == payload.operation_id for o in allowed_ops):
        raise HTTPException(403, "You do not have access to this operation")

    result = await execute_operation(
        operation_id=payload.operation_id,
        call_args=payload.args,
        user_email=user.email,
    )
    if not result["ok"]:
        raise HTTPException(502, result.get("error", "Connector operation failed"))
    return {"ok": True, "data": result.get("data"), "text": result.get("text")}


# ── Per-user account linking (for connectors with auth_mode='per_user') ────────

@invoke_router.get("/{connector_id}/my-connection")
async def get_my_connection(connector_id: int, user: CurrentUser = Depends(get_current_user)):
    """Report whether the caller has linked their own credential for this connector."""
    with SessionLocal() as db:
        auth = db.query(ConnectorAuth).filter(ConnectorAuth.connector_id == connector_id).first()
        conn = db.query(Connector).filter(Connector.id == connector_id).first()
        linked = db.query(ConnectorUserAuth).filter(
            ConnectorUserAuth.connector_id == connector_id,
            ConnectorUserAuth.user_email == user.email,
        ).first()
    if conn is None:
        raise HTTPException(404, "Connector not found")
    auth_type = auth.auth_type if auth else "none"
    auth_mode = auth.auth_mode if auth else "service"
    return {
        "connector_id": connector_id,
        "connector_name": conn.name,
        "auth_type": auth_type,
        "auth_mode": auth_mode,
        # Only per_user connectors require an individual link; others run as the service account.
        "requires_link": auth_mode == "per_user" and auth_type != "none",
        "connected": linked is not None,
    }


@invoke_router.put("/{connector_id}/my-connection")
async def set_my_connection(
    connector_id: int,
    payload: MyConnectionPayload,
    user: CurrentUser = Depends(get_current_user),
):
    """Store (or replace) the caller's own credential for a per_user connector."""
    config_enc = encrypt_config(payload.config) if payload.config else None
    with SessionLocal() as db:
        if db.query(Connector).filter(Connector.id == connector_id).first() is None:
            raise HTTPException(404, "Connector not found")
        row = db.query(ConnectorUserAuth).filter(
            ConnectorUserAuth.connector_id == connector_id,
            ConnectorUserAuth.user_email == user.email,
        ).first()
        if row:
            row.config_enc = config_enc
        else:
            db.add(ConnectorUserAuth(
                connector_id=connector_id, user_email=user.email, config_enc=config_enc,
            ))
        db.commit()
    invalidate_user_auth_cache(connector_id, user.email)
    return {"ok": True, "connected": True}


@invoke_router.delete("/{connector_id}/my-connection")
async def delete_my_connection(connector_id: int, user: CurrentUser = Depends(get_current_user)):
    """Unlink the caller's credential for this connector."""
    with SessionLocal() as db:
        db.query(ConnectorUserAuth).filter(
            ConnectorUserAuth.connector_id == connector_id,
            ConnectorUserAuth.user_email == user.email,
        ).delete()
        db.commit()
    invalidate_user_auth_cache(connector_id, user.email)
    return {"ok": True, "connected": False}
