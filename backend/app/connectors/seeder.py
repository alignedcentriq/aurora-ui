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

_UTTERANCE_PROMPT = """
You are seeding example phrases for a semantic intent router.
For the operation below, generate {n} distinct natural-language questions or commands
that a user might say to invoke this operation. Each utterance should be different in
wording and cover different phrasings (casual, formal, short, long).

Operation name: {name}
Description: {description}
System: {connector_name}

Return ONLY a JSON array of strings, e.g. ["phrase 1", "phrase 2", ...]
"""

MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0  # seconds; doubles each retry (2, 4, 8)


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
            match = re.search(r"\[.*?\]", content, re.DOTALL)
            if not match:
                log.warning(
                    "Attempt %d/%d for %s.%s: LLM returned no JSON array",
                    attempt, MAX_RETRIES, connector_slug, op_name,
                )
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_BASE_DELAY * (2 ** (attempt - 1)))
                continue
            return json.loads(match.group())
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
        from app.config import settings

        llm = get_llm(settings.ROUTER_MODEL_NAME)

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

            utterances = await _generate_utterances_with_retry(llm, prompt, op["name"], connector_slug)

            if utterances is None:
                failed_ops.append(op["name"])
                continue

            added = 0
            for utt in utterances[:n_per_op]:
                if not isinstance(utt, str) or not utt.strip():
                    continue
                try:
                    ok = await asyncio.to_thread(
                        SemanticRouterService.add_example,
                        utt.strip(), domain, sub_intent,
                        None, "connector", None, op.get("id"),
                    )
                    if ok:
                        added += 1
                except Exception as exc:
                    log.debug("add_example failed for %r: %s", utt[:60], exc)

            seeded_total += added
            log.info("Seeded %d utterances for %s.%s", added, connector_slug, op["name"])

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
