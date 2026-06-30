"""
Seeder — on publish, generate 8-12 natural-language utterances per operation
and insert them as RouterExample rows so the semantic router learns to dispatch
to this connector without any manual coding.
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


async def seed_router_examples(
    connector_id: int,
    connector_slug: str,
    connector_name: str,
    ops: list[dict],
    n_per_op: int = 10,
    daily_cap: int = 5,
) -> None:
    """
    Generate utterances for each op and insert as RouterExample rows.
    Called after a connector is published. Failures are non-fatal.
    """
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

            try:
                resp = await llm.ainvoke(prompt)
                content = resp.content if hasattr(resp, "content") else str(resp)
                match = re.search(r"\[.*?\]", content, re.DOTALL)
                if not match:
                    continue
                utterances: list[str] = json.loads(match.group())
            except Exception as exc:
                log.warning("Failed to generate utterances for %s.%s: %s", connector_slug, op["name"], exc)
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

            log.info("Seeded %d utterances for %s.%s", added, connector_slug, op["name"])

    except Exception as exc:
        log.error("seed_router_examples failed for connector %s: %s", connector_slug, exc)
