"""
OpenAPI 2/3 → ConnectorOperation importer.

Flow:
  1. Parse spec (dict already loaded by caller)
  2. Extract operations: method, path, summary, description, parameters, requestBody
  3. Flatten to our params_schema format [{name, type, location, required, description}]
  4. Offline LLM enrichment: fill description gaps, flag requires_confirmation for mutating verbs,
     estimate minutes_saved — runs once at import, never at request time
  5. Return list of dicts ready for bulk-insert as ConnectorOperation rows

Admin reviews/edits before calling publish().
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

log = logging.getLogger(__name__)

_MUTATING_METHODS = {"post", "put", "patch", "delete"}
_SAFE_WORDS = re.compile(r"\b(get|list|fetch|search|read|view|show|retrieve)\b", re.I)


def _resolve_ref(spec: dict, ref: str) -> dict:
    """Resolve a simple local $ref like '#/components/schemas/Foo'."""
    parts = ref.lstrip("#/").split("/")
    node = spec
    for p in parts:
        node = node.get(p, {})
    return node


def _schema_to_type(schema: dict, spec: dict) -> str:
    if "$ref" in schema:
        schema = _resolve_ref(spec, schema["$ref"])
    t = schema.get("type", "string")
    if t == "integer":
        return "integer"
    if t == "number":
        return "number"
    if t == "boolean":
        return "boolean"
    if t == "array":
        return "array"
    if t == "object":
        return "object"
    return "string"


def _extract_params(path_params: list, method_params: list, spec: dict) -> list[dict]:
    seen: set[str] = set()
    result = []
    for p in (path_params or []) + (method_params or []):
        if "$ref" in p:
            p = _resolve_ref(spec, p["$ref"])
        name = p.get("name", "")
        if not name or name in seen:
            continue
        seen.add(name)
        schema = p.get("schema", {})
        result.append({
            "name": name,
            "type": _schema_to_type(schema, spec),
            "location": p.get("in", "query"),
            "required": bool(p.get("required", False)),
            "description": p.get("description", ""),
        })
    return result


def _extract_body_params(request_body: dict, spec: dict) -> list[dict]:
    if not request_body:
        return []
    content = request_body.get("content", {})
    schema = (
        content.get("application/json", {}).get("schema")
        or content.get("application/x-www-form-urlencoded", {}).get("schema")
        or {}
    )
    if "$ref" in schema:
        schema = _resolve_ref(spec, schema["$ref"])

    props: dict = schema.get("properties", {})
    required_set: set = set(schema.get("required", []))
    result = []
    for name, prop in props.items():
        if "$ref" in prop:
            prop = _resolve_ref(spec, prop["$ref"])
        result.append({
            "name": name,
            "type": _schema_to_type(prop, spec),
            "location": "body",
            "required": name in required_set,
            "description": prop.get("description", ""),
        })
    return result


def _infer_confirmation(method: str, summary: str) -> bool:
    if method not in _MUTATING_METHODS:
        return False
    if _SAFE_WORDS.search(summary):
        return False
    return True


def parse_spec(spec: dict) -> list[dict]:
    """
    Parse an OpenAPI 2 or 3 spec dict and return a list of raw operation dicts.
    Each dict contains all fields needed for ConnectorOperation (minus connector_id).
    """
    ops = []
    openapi_version = spec.get("openapi", spec.get("swagger", "2.0"))
    is_v3 = str(openapi_version).startswith("3")

    paths: dict = spec.get("paths", {})
    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        path_level_params = path_item.get("parameters", [])

        for method in ("get", "post", "put", "patch", "delete", "head", "options"):
            op_spec = path_item.get(method)
            if not op_spec or not isinstance(op_spec, dict):
                continue

            op_id = op_spec.get("operationId") or f"{method}_{path.replace('/', '_').strip('_')}"
            # Normalise to snake_case tool name
            name = re.sub(r"[^a-zA-Z0-9]+", "_", op_id).strip("_").lower()[:64]

            summary = op_spec.get("summary", "")
            description = op_spec.get("description", summary)

            params = _extract_params(path_level_params, op_spec.get("parameters", []), spec)

            request_body = op_spec.get("requestBody") if is_v3 else None
            if not is_v3:
                # OAS2: body parameters are in the parameters list with "in": "body"
                body_params_oas2 = [p for p in op_spec.get("parameters", []) if p.get("in") == "body"]
                for bp in body_params_oas2:
                    schema = bp.get("schema", {})
                    params += _extract_body_params({"content": {"application/json": {"schema": schema}}}, spec)
            else:
                params += _extract_body_params(request_body or {}, spec)

            requires_confirmation = _infer_confirmation(method, summary)

            ops.append({
                "name": name,
                "display_name": summary or name,
                "description": description,
                "method": method.upper(),
                "path_template": path,
                "params_schema": params,
                "response_map": None,
                "requires_confirmation": requires_confirmation,
                "minutes_saved": 0.0,
                "response_mode": "passthrough",
                "enabled": True,
                "version": 1,
            })

    return ops


async def enrich_with_llm(ops: list[dict], connector_name: str) -> list[dict]:
    """
    Use the router LLM (llama3.2:3b) to improve descriptions, flag confirmation, estimate
    minutes_saved for each operation. Runs offline at import — never at request time.

    Falls back gracefully: if the LLM is down, returns ops unchanged.
    """
    try:
        from app.services.llm_controls_service import get_llm
        from app.config import settings

        llm = get_llm(settings.ROUTER_MODEL_NAME)

        enriched = []
        for op in ops:
            param_names = [p["name"] for p in (op.get("params_schema") or [])]
            prompt = (
                f"You are enriching an API operation for the {connector_name} system.\n"
                f"Operation: {op['name']} ({op['method']} {op['path_template']})\n"
                f"Current description: {op['description'] or '(none)'}\n"
                f"Parameters: {', '.join(param_names) or 'none'}\n\n"
                f"Return ONLY valid JSON with these keys:\n"
                f"  description: one concise sentence an AI agent can understand\n"
                f"  requires_confirmation: true if this creates/modifies/deletes data, false otherwise\n"
                f"  minutes_saved: average minutes a human would spend doing this manually (integer, 0-30)\n"
            )
            try:
                resp = await llm.ainvoke(prompt)
                content = resp.content if hasattr(resp, "content") else str(resp)
                # Extract JSON blob from response
                match = re.search(r"\{[^{}]+\}", content, re.DOTALL)
                if match:
                    parsed = json.loads(match.group())
                    if parsed.get("description"):
                        op["description"] = parsed["description"]
                    if "requires_confirmation" in parsed:
                        op["requires_confirmation"] = bool(parsed["requires_confirmation"])
                    if "minutes_saved" in parsed:
                        op["minutes_saved"] = float(parsed.get("minutes_saved", 0))
            except Exception as inner:
                log.debug("LLM enrichment failed for op %s: %s", op["name"], inner)
            enriched.append(op)
        return enriched
    except Exception as exc:
        log.warning("LLM enrichment unavailable, skipping: %s", exc)
        return ops
