"""
Generic HTTP executor for ConnectorOperation calls.

Each call:
  1. Resolves path, query, body params from the flat params_schema
  2. Injects auth via connectors.auth
  3. Executes with httpx (15s timeout, no redirects by default)
  4. Applies response_map dotted-path picks to trim large payloads
  5. Logs to ConnectorCallLog
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

import httpx

from app.database import SessionLocal
from app.models import ConnectorCallLog, ConnectorOperation, ConnectorAuth as ConnectorAuthModel
from .auth import inject_auth

log = logging.getLogger(__name__)

TIMEOUT = 30.0              # generous timeout to survive Azure App Service cold-starts
MAX_RESPONSE_CHARS = 4000  # trim large responses before returning to the agent


def _dig(obj: Any, path: str) -> Any:
    """Dot-path accessor: 'data.items[0].name' → value or None."""
    for part in path.split("."):
        if obj is None:
            return None
        bracket = part.find("[")
        if bracket != -1:
            key = part[:bracket]
            idx_str = part[bracket + 1:part.index("]")]
            obj = obj.get(key) if isinstance(obj, dict) else None
            try:
                obj = obj[int(idx_str)] if obj is not None else None
            except (IndexError, TypeError):
                obj = None
        elif isinstance(obj, dict):
            obj = obj.get(part)
        else:
            return None
    return obj


def _apply_response_map(data: Any, response_map: Optional[list]) -> Any:
    if not response_map:
        return data
    result = {}
    for mapping in response_map:
        src = mapping.get("src", "")
        dst = mapping.get("dst", src.replace(".", "_"))
        val = _dig(data, src)
        if val is not None:
            result[dst] = val
    return result if result else data


def _split_params(call_args: dict, params_schema: Optional[list]) -> tuple[dict, dict, dict]:
    """Split call_args into (path_vars, query_params, body_params) per schema metadata."""
    path_vars: dict = {}
    query_params: dict = {}
    body_params: dict = {}

    if not params_schema:
        body_params = call_args
        return path_vars, query_params, body_params

    schema_map = {p["name"]: p for p in params_schema}
    for key, val in call_args.items():
        meta = schema_map.get(key, {})
        location = meta.get("location", "body")
        if location == "path":
            path_vars[key] = val
        elif location == "query":
            query_params[key] = val
        else:
            body_params[key] = val

    return path_vars, query_params, body_params


async def execute_operation(
    operation_id: int,
    call_args: dict,
    user_email: str,
    request_log_id: Optional[int] = None,
    flow_run_id: Optional[int] = None,
) -> dict:
    """Execute a ConnectorOperation and return a result dict.

    Returns: {"ok": True, "data": ..., "text": "...", "latency_ms": int}
          or {"ok": False, "error": "...", "latency_ms": int}
    """
    t0 = time.monotonic()
    status = "error"
    error_msg: Optional[str] = None
    result_data: Any = None

    with SessionLocal() as db:
        op: Optional[ConnectorOperation] = db.query(ConnectorOperation).filter(
            ConnectorOperation.id == operation_id,
            ConnectorOperation.enabled == True,
        ).first()

        if op is None:
            return {"ok": False, "error": f"Operation {operation_id} not found or disabled"}

        auth_row: Optional[ConnectorAuthModel] = db.query(ConnectorAuthModel).filter(
            ConnectorAuthModel.connector_id == op.connector_id
        ).first()

        base_url_row = db.execute(
            __import__("sqlalchemy").text(
                f"SELECT base_url FROM enterprise_ai.connectors WHERE id = :cid"
            ),
            {"cid": op.connector_id},
        ).fetchone()
        base_url = base_url_row[0] if base_url_row else ""

    auth_type = auth_row.auth_type if auth_row else "none"
    method = (op.method or "GET").upper()
    path_template = op.path_template or "/"

    path_vars, query_params, body_params = _split_params(call_args, op.params_schema)

    # Fill path variables
    try:
        url_path = path_template.format(**path_vars)
    except KeyError as exc:
        return {"ok": False, "error": f"Missing path variable: {exc}"}

    full_url = base_url.rstrip("/") + "/" + url_path.lstrip("/")

    headers: dict = {"Content-Type": "application/json", "Accept": "application/json"}
    inject_auth(op.connector_id, auth_type, headers, query_params)

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
            if method in ("GET", "DELETE"):
                resp = await client.request(method, full_url, headers=headers, params=query_params)
            else:
                resp = await client.request(
                    method, full_url, headers=headers,
                    params=query_params, json=body_params if body_params else None,
                )

        resp.raise_for_status()

        try:
            result_data = resp.json()
        except Exception:
            result_data = resp.text

        result_data = _apply_response_map(result_data, op.response_map)
        status = "success"

    except httpx.TimeoutException:
        error_msg = f"Connector operation timed out after {TIMEOUT}s"
        status = "timeout"
    except httpx.HTTPStatusError as exc:
        error_msg = f"HTTP {exc.response.status_code}: {exc.response.text[:300]}"
    except Exception as exc:
        error_msg = str(exc)

    latency_ms = int((time.monotonic() - t0) * 1000)

    # Write call log
    try:
        with SessionLocal() as db:
            db.add(ConnectorCallLog(
                connector_id=op.connector_id,
                operation_id=operation_id,
                user_email=user_email,
                request_log_id=request_log_id,
                flow_run_id=flow_run_id,
                status=status,
                latency_ms=latency_ms,
                error=error_msg,
            ))
            db.commit()
    except Exception as log_exc:
        log.warning("Failed to write ConnectorCallLog: %s", log_exc)

    if status == "success":
        text = json.dumps(result_data, default=str)
        if len(text) > MAX_RESPONSE_CHARS:
            text = text[:MAX_RESPONSE_CHARS] + "…[truncated]"
        return {"ok": True, "data": result_data, "text": text, "latency_ms": latency_ms}
    else:
        return {"ok": False, "error": error_msg or "Unknown error", "latency_ms": latency_ms}
