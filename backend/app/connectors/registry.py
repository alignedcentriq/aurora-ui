"""
Connector registry — DB-backed cache of Connector + ConnectorOperation rows.

The cache is rebuilt every POLL_INTERVAL seconds (via asyncio background task)
and also invalidated immediately on Redis pub/sub message "connector:invalidate".

Usage (inside async request handlers):
    ops = await ConnectorRegistry.list_operations_for_user(email, role, persona_id)
    op  = await ConnectorRegistry.get_operation(operation_id)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Connector, ConnectorOperation, ConnectorScope
from app.database import SessionLocal
from app.redis_config import get_redis_client

log = logging.getLogger(__name__)

POLL_INTERVAL = 30          # seconds between full cache refreshes
REDIS_CHANNEL = "connector:invalidate"


class _Cache:
    connectors:  dict[int, dict] = {}
    operations:  dict[int, dict] = {}
    scopes:      list[dict] = []
    built_at: float = 0.0
    _lock = asyncio.Lock()


_cache = _Cache()


def _row_to_dict(obj) -> dict:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def _build_cache_sync() -> None:
    with SessionLocal() as db:
        connectors = db.query(Connector).filter(Connector.status == "published").all()
        operations = (
            db.query(ConnectorOperation)
            .filter(ConnectorOperation.enabled == True)
            .all()
        )
        scopes = db.query(ConnectorScope).all()

    _cache.connectors = {c.id: _row_to_dict(c) for c in connectors}
    _cache.operations = {o.id: _row_to_dict(o) for o in operations}
    _cache.scopes = [_row_to_dict(s) for s in scopes]
    _cache.built_at = time.monotonic()

    # Keep tool_registry in sync so the summarizer uses the right response_mode
    try:
        from app.services.tool_registry import ToolRegistry
        ToolRegistry.register_connector_ops(list(_cache.operations.values()))
    except Exception:
        pass


async def _build_cache() -> None:
    async with _cache._lock:
        await asyncio.to_thread(_build_cache_sync)


async def start_background_refresh() -> None:
    """Call once at startup (e.g. from main.py lifespan) to start the poll loop."""
    await _build_cache()

    async def _poll_loop():
        while True:
            await asyncio.sleep(POLL_INTERVAL)
            try:
                await _build_cache()
            except Exception as exc:
                log.warning("connector registry refresh failed: %s", exc)

    async def _pubsub_loop():
        try:
            # app.redis_config only provides a sync client — use an async client here
            # so pubsub.listen() doesn't block the event loop.
            import redis.asyncio as aioredis
            from app.config import settings as _settings
            redis = aioredis.from_url(_settings.REDIS_URL, decode_responses=True, socket_connect_timeout=2)
            pubsub = redis.pubsub()
            await pubsub.subscribe(REDIS_CHANNEL)
            async for message in pubsub.listen():
                if message.get("type") == "message":
                    log.debug("connector cache invalidated via pubsub")
                    try:
                        await _build_cache()
                    except Exception as exc:
                        log.warning("connector cache rebuild after invalidate failed: %s", exc)
        except Exception as exc:
            log.warning("connector pubsub loop exited: %s", exc)

    asyncio.create_task(_poll_loop())
    asyncio.create_task(_pubsub_loop())


async def invalidate(redis=None) -> None:
    """Force cache rebuild and broadcast to other workers."""
    await _build_cache()
    try:
        r = redis or get_redis_client()  # sync client — publish is a quick fire-and-forget
        if r is not None:
            r.publish(REDIS_CHANNEL, "invalidate")
    except Exception:
        pass


class ConnectorRegistry:

    @staticmethod
    async def _ensure_fresh() -> None:
        if time.monotonic() - _cache.built_at > POLL_INTERVAL * 2:
            await _build_cache()

    @staticmethod
    async def get_operation(operation_id: int) -> Optional[dict]:
        await ConnectorRegistry._ensure_fresh()
        return _cache.operations.get(operation_id)

    @staticmethod
    async def get_connector(connector_id: int) -> Optional[dict]:
        await ConnectorRegistry._ensure_fresh()
        return _cache.connectors.get(connector_id)

    @staticmethod
    async def list_operations_for_user(
        user_email: str,
        role: str,
        department: str = "",
        persona_id: Optional[int] = None,
    ) -> list[dict]:
        """Return operations the caller is allowed to use.

        Scoping rules (any match grants access):
        - No scopes at all → visible to everyone
        - Scope with matching role OR department OR persona_id → granted
        - Explicit user-level persona override → use that persona_id
        """
        await ConnectorRegistry._ensure_fresh()

        # Build per-operation scope index
        op_scopes: dict[int, list[dict]] = {}
        for s in _cache.scopes:
            oid = s.get("operation_id")
            if oid:
                op_scopes.setdefault(oid, []).append(s)

        result = []
        for op in _cache.operations.values():
            scopes = op_scopes.get(op["id"], [])
            if not scopes:
                result.append(op)
                continue
            for s in scopes:
                if (
                    (s.get("role") and s["role"].lower() == role.lower())
                    or (s.get("department") and s["department"].lower() == (department or "").lower())
                    or (persona_id and s.get("persona_id") == persona_id)
                ):
                    result.append(op)
                    break
        return result

    @staticmethod
    async def list_published_connectors() -> list[dict]:
        await ConnectorRegistry._ensure_fresh()
        return list(_cache.connectors.values())

    @staticmethod
    async def get_connector_by_slug(slug: str) -> Optional[dict]:
        await ConnectorRegistry._ensure_fresh()
        for c in _cache.connectors.values():
            if c["slug"] == slug:
                return c
        return None

    @staticmethod
    async def list_operations_for_connector(connector_id: int) -> list[dict]:
        await ConnectorRegistry._ensure_fresh()
        return [o for o in _cache.operations.values() if o["connector_id"] == connector_id]
