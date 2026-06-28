"""
Connector Studio API — CRUD, OpenAPI import, test-op, publish, usage.

All write endpoints are super-admin only. Read/invoke endpoints are role-gated
via ConnectorRegistry scope rules.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.auth import CurrentUser, require_admin, require_super_admin, get_current_user
from app.database import SessionLocal
from app.models import (
    Connector, ConnectorAuth, ConnectorOperation, ConnectorCallLog, ConnectorScope,
)
from app.connectors.registry import ConnectorRegistry, invalidate
from app.connectors.executor import execute_operation
from app.connectors.auth import encrypt_config, invalidate_auth_cache

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
                "created_by": c.created_by, "created_at": c.created_at,
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

@router.get("/{connector_id}/usage")
async def connector_usage(
    connector_id: int,
    user: CurrentUser = Depends(require_admin),
):
    with SessionLocal() as db:
        from sqlalchemy import func as sqlfunc
        rows = (
            db.query(
                ConnectorCallLog.operation_id,
                sqlfunc.count(ConnectorCallLog.id).label("calls"),
                sqlfunc.avg(ConnectorCallLog.latency_ms).label("avg_latency_ms"),
                sqlfunc.sum(
                    sqlfunc.cast(ConnectorCallLog.status == "success", sqlfunc.Integer)
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
    }


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
