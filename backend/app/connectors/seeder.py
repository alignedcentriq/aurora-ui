"""
Seeder — on publish, generate 8-12 natural-language utterances per operation
and insert them as RouterExample rows so the semantic router learns to dispatch
to this connector without any manual coding.

Retry-hardened: each operation's LLM call retries up to 3 times with exponential
backoff (2s → 4s → 8s).  The connector's seeding_status column is updated
throughout the lifecycle (seeding → seeded | failed).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Optional

log = logging.getLogger(__name__)

_UTTERANCE_PROMPT = """You are seeding example phrases for a semantic intent router.
For the operation below, generate {n} distinct natural-language questions or commands
that a user might say to invoke this operation. Each utterance should be different in
wording and cover different phrasings (casual, formal, short, long).

Operation name: {name}
Description: {description}
System: {connector_name}

Respond with ONLY a raw JSON array of {n} strings and nothing else — no prose, no
markdown fences, no explanation. Example: ["show me the categories", "list categories"]"""

MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0  # seconds; doubles each retry (2, 4, 8)

# Enough headroom for ~12 utterances so the array is never truncated mid-string.
_GEN_MAX_TOKENS = 1024


def _extract_json_array(content: str) -> Optional[list]:
    """Best-effort extraction of a JSON array of strings from a raw LLM response.

    Small/local models wrap output in markdown fences, reasoning tags, or stray
    prose containing bracket tokens (``[INST]``, ``[1]``). A naive non-greedy
    ``\\[.*?\\]`` grabs the first tiny pair and blows up in json.loads. Instead we
    strip the noise, then scan for the first *balanced* bracket span (quote-aware so
    brackets inside strings don't confuse the depth counter).
    """
    if not content:
        return None

    # Drop reasoning/thinking blocks emitted by reasoning-tuned models.
    text = re.sub(r"<think(?:ing)?>.*?</think(?:ing)?>", "", content, flags=re.DOTALL | re.IGNORECASE)
    # Drop markdown code fences (```json ... ``` or bare ```).
    text = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE)

    def _coerce(obj) -> Optional[list]:
        return obj if isinstance(obj, list) else None

    # 1) Cleaned text may already be exactly the array.
    stripped = text.strip()
    try:
        arr = _coerce(json.loads(stripped))
        if arr is not None:
            return arr
    except (json.JSONDecodeError, ValueError):
        pass

    # 2) Scan for the first balanced [...] span, respecting string literals.
    start = stripped.find("[")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(stripped)):
            ch = stripped[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    candidate = stripped[start:i + 1]
                    try:
                        arr = _coerce(json.loads(candidate))
                        if arr is not None:
                            return arr
                    except (json.JSONDecodeError, ValueError):
                        pass
                    break  # this span didn't parse; try the next '['
        start = stripped.find("[", start + 1)

    return None


def _fallback_utterances(op: dict, connector_name: str) -> list[str]:
    """Deterministic starter phrasings, used when the LLM is unavailable so a connector
    is still routable + discoverable even if the model can't be reached at seed time."""
    label = (op.get("display_name") or op.get("name") or "").replace("_", " ").strip()
    desc = (op.get("description") or "").strip()
    candidates = []
    if label:
        candidates += [label, f"{label} in {connector_name}", f"use {connector_name} to {label.lower()}"]
    if desc:
        candidates.append(desc)
    seen, result = set(), []
    for c in candidates:
        k = c.lower()
        if c and k not in seen:
            seen.add(k)
            result.append(c)
    return result[:4]


def _update_seeding_status(connector_id: int, status: str) -> None:
    """Write seeding_status to the connector row.  Fire-and-forget safe."""
    try:
        from app.database import SessionLocal
        from app.models import Connector
        with SessionLocal() as db:
            conn = db.query(Connector).filter(Connector.id == connector_id).first()
            if conn:
                conn.seeding_status = status
                db.commit()
    except Exception as exc:
        log.warning("Failed to update seeding_status for connector %s: %s", connector_id, exc)


async def _generate_utterances_with_retry(llm, prompt: str, op_name: str, connector_slug: str) -> Optional[list[str]]:
    """Call the LLM up to MAX_RETRIES times with exponential backoff.

    Returns a list of utterance strings on success, or None if all retries fail.
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = await llm.ainvoke(prompt)
            content = resp.content if hasattr(resp, "content") else str(resp)
            arr = _extract_json_array(content)
            if arr is None:
                log.warning(
                    "Attempt %d/%d for %s.%s: LLM returned no JSON array (got: %r)",
                    attempt, MAX_RETRIES, connector_slug, op_name, (content or "")[:200],
                )
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_BASE_DELAY * (2 ** (attempt - 1)))
                continue
            return arr
        except Exception as exc:
            log.warning(
                "Attempt %d/%d for %s.%s failed: %s",
                attempt, MAX_RETRIES, connector_slug, op_name, exc,
            )
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_BASE_DELAY * (2 ** (attempt - 1)))
    return None


async def seed_router_examples(
    connector_id: int,
    connector_slug: str,
    connector_name: str,
    ops: list[dict],
    n_per_op: int = 10,
    daily_cap: int = 5,
) -> dict:
    """
    Generate utterances for each op and insert as RouterExample rows.
    Called after a connector is published. Failures are non-fatal.

    Returns: {"seeded": int, "failed": [str, ...]}
    """
    _update_seeding_status(connector_id, "seeding")

    seeded_total = 0
    failed_ops: list[str] = []

    try:
        from app.services.llm_controls_service import get_llm
        from app.services.semantic_router_service import SemanticRouterService

        # get_llm expects a TIER name (agent/service/router/general/summarizer), not a
        # model id. Use the "general" tier for this — the "router" tier is a tiny,
        # temperature-0 model tuned for intent *classification* (bind_tools), and is
        # unreliable at freely generating a JSON array of phrases. If the tier can't be
        # built (misconfig / model down) we still seed deterministic fallbacks below
        # rather than failing the whole connector.
        try:
            llm = get_llm("general", default_max_tokens=_GEN_MAX_TOKENS)
        except Exception as exc:
            log.warning("general LLM unavailable (%s) — seeding %s with deterministic fallbacks", exc, connector_slug)
            llm = None

        for op in ops:
            if not op.get("enabled", True):
                continue
            domain = f"connector:{connector_slug}"
            sub_intent = op["name"]

            prompt = _UTTERANCE_PROMPT.format(
                n=n_per_op,
                name=op["name"],
                description=op.get("description") or op.get("display_name") or op["name"],
                connector_name=connector_name,
            )

            utterances = (
                await _generate_utterances_with_retry(llm, prompt, op["name"], connector_slug)
                if llm is not None else None
            )

            # LLM unavailable → fall back to deterministic phrasings so the op is never
            # left with zero examples (which would make it unroutable + undiscoverable).
            source = "connector"
            if utterances is None:
                failed_ops.append(op["name"])
                utterances = _fallback_utterances(op, connector_name)
                source = "kw"
                if not utterances:
                    continue

            added = 0
            for utt in utterances[:n_per_op]:
                if not isinstance(utt, str) or not utt.strip():
                    continue
                try:
                    ok = await asyncio.to_thread(
                        SemanticRouterService.add_example,
                        utt.strip(), domain, sub_intent,
                        None, source, None, op.get("id"),
                    )
                    if ok:
                        added += 1
                except Exception as exc:
                    log.debug("add_example failed for %r: %s", utt[:60], exc)

            seeded_total += added
            log.info("Seeded %d utterances (%s) for %s.%s", added, source, connector_slug, op["name"])

    except Exception as exc:
        log.error("seed_router_examples failed for connector %s: %s", connector_slug, exc)
        _update_seeding_status(connector_id, "failed")
        return {"seeded": seeded_total, "failed": failed_ops}

    # Final status: seeded if at least some ops succeeded, failed if ALL ops failed
    if failed_ops and seeded_total == 0:
        _update_seeding_status(connector_id, "failed")
    else:
        _update_seeding_status(connector_id, "seeded")

    if failed_ops:
        log.warning(
            "Seeding partially failed for %s: %d ops seeded, %d ops failed (%s)",
            connector_slug, seeded_total, len(failed_ops), ", ".join(failed_ops),
        )

    return {"seeded": seeded_total, "failed": failed_ops}
