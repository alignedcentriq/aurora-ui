"""
Build LangChain StructuredTools from ConnectorOperation rows at runtime.

Compiled pydantic models are cached per (operation_id, version) so repeated
requests pay zero construction overhead. Cache is invalidated when the registry
version bumps (connector is re-published).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional, Type

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from .executor import execute_operation

log = logging.getLogger(__name__)

# Cache: (operation_id, version) → StructuredTool
_tool_cache: dict[tuple[int, int], StructuredTool] = {}


_TYPE_MAP = {
    "string": str,
    "str": str,
    "integer": int,
    "int": int,
    "number": float,
    "float": float,
    "boolean": bool,
    "bool": bool,
    "array": list,
    "object": dict,
}


def _build_args_model(op: dict) -> Type[BaseModel]:
    """Turn a flat params_schema list into a Pydantic model class."""
    params_schema = op.get("params_schema") or []
    fields: dict[str, Any] = {}
    for param in params_schema:
        name = param["name"]
        raw_type = _TYPE_MAP.get(param.get("type", "string"), str)
        description = param.get("description", name)
        required = param.get("required", False)
        if required:
            fields[name] = (raw_type, Field(..., description=description))
        else:
            fields[name] = (Optional[raw_type], Field(None, description=description))
    if not fields:
        fields["__dummy"] = (Optional[str], Field(None, description="(no parameters)"))
    return create_model(f"Op{op['id']}Args", **fields)


def build_tool(op: dict, user_email: str, request_log_id: Optional[int] = None) -> StructuredTool:
    """Return a LangChain StructuredTool for the given operation dict."""
    cache_key = (op["id"], op.get("version", 1))
    if cache_key in _tool_cache:
        cached = _tool_cache[cache_key]
        # Rebuild with fresh closure (user_email / request_log_id differ per request)
        # but reuse the args_schema from cache
        args_model = cached.args_schema
    else:
        args_model = _build_args_model(op)

    op_id = op["id"]
    op_name = op.get("name", f"connector_op_{op_id}")
    description = (op.get("description") or op.get("display_name") or op_name).strip()

    async def _run(**kwargs) -> str:
        result = await execute_operation(
            operation_id=op_id,
            call_args={k: v for k, v in kwargs.items() if v is not None and k != "__dummy"},
            user_email=user_email,
            request_log_id=request_log_id,
        )
        if result["ok"]:
            return result["text"]
        return f"Error calling {op_name}: {result['error']}"

    def _run_sync(**kwargs) -> str:
        return asyncio.get_event_loop().run_until_complete(_run(**kwargs))

    tool = StructuredTool(
        name=op_name,
        description=description,
        args_schema=args_model,
        coroutine=_run,
        func=_run_sync,
    )

    _tool_cache[cache_key] = tool
    return tool


def build_tools_for_request(
    ops: list[dict],
    user_email: str,
    request_log_id: Optional[int] = None,
    max_tools: int = 8,
) -> list[StructuredTool]:
    """Build up to max_tools StructuredTools for the given operation list."""
    return [build_tool(op, user_email, request_log_id) for op in ops[:max_tools]]
