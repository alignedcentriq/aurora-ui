"""
Native Python connectors — wraps existing service functions as ConnectorOperation-compatible
callables. These are registered in NATIVE_OPS and looked up by python_ref at runtime.

Adding a new native op requires only:
  1. Write the async function below (or import it from its service module)
  2. Add an entry to NATIVE_OPS
  3. Create a Connector + ConnectorOperation row (source_type="native", python_ref="<key>")

No HTTP round-trip, no auth injection — the function runs in-process.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Coroutine

log = logging.getLogger(__name__)


async def _noop(**kwargs) -> dict:
    return {"result": "native op placeholder — implement me"}


# Registry: python_ref key → async callable(**kwargs) -> dict
NATIVE_OPS: dict[str, Callable[..., Coroutine[Any, Any, dict]]] = {
    "noop": _noop,
}


async def call_native(python_ref: str, **kwargs) -> dict:
    fn = NATIVE_OPS.get(python_ref)
    if fn is None:
        return {"ok": False, "error": f"Native op {python_ref!r} not registered"}
    try:
        result = await fn(**kwargs)
        if isinstance(result, dict) and "ok" not in result:
            result["ok"] = True
        return result
    except Exception as exc:
        log.error("Native op %s raised: %s", python_ref, exc)
        return {"ok": False, "error": str(exc)}
