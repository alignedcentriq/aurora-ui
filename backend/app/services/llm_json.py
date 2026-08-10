"""Robust JSON extraction for small-model drafting endpoints.

Small/fast models intermittently wrap JSON in ``` fences, prepend chatter, emit a
trailing comma, or truncate — so a single invoke + naive ``json.loads`` fails at
random. ``invoke_json`` retries a couple of times and parses tolerantly (fence-strip,
balanced-brace slice, trailing-comma repair) before giving up. Used by the URL Library,
Form Library, and TechElevate /generate endpoints.

Goes through ``resilient_invoke`` (not a bare ``ChatOpenAI.invoke``) so a bad/stale
model configured on the tier automatically falls over to the tier's fallback model
instead of hard-failing every draft request — the same protection the agent/service/
router tiers already get.
"""

import json
import logging
import re

log = logging.getLogger(__name__)


def _strip_trailing_commas(s: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", s)


def _try_load(candidate: str) -> dict | None:
    for attempt in (candidate, _strip_trailing_commas(candidate)):
        try:
            obj = json.loads(attempt)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def extract_json(raw: str) -> dict | None:
    """Pull the first balanced JSON object out of a model response, tolerating code fences,
    surrounding prose, and trailing commas. Returns a dict or None."""
    if not raw:
        return None
    s = raw.strip()
    # Strip a leading ```json / ``` fence and a trailing ``` if present.
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)

    start = s.find("{")
    if start == -1:
        return None
    # Walk braces (ignoring those inside strings) to find the matching close — more reliable
    # than a greedy regex, which spans from the first { to the LAST } across stray text.
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return _try_load(s[start : i + 1])
    # Unbalanced (likely truncated) — last-ditch attempt on the remainder.
    return _try_load(s[start:])


def invoke_json(tier: str, prompt: str, attempts: int = 2, *,
                 default_timeout: float | None = None,
                 default_max_tokens: int | None = None) -> dict | None:
    """Invoke ``tier`` (via resilient_invoke, so a bad primary model falls back
    automatically) up to ``attempts`` times, returning the first parseable JSON
    object, or None if every attempt fails (model error or unparseable output).
    Kept low by default because each call on the shared tier costs ~20s+."""
    from app.services.llm_resilience import resilient_invoke

    for attempt in range(max(1, attempts)):
        try:
            resp = resilient_invoke(tier, prompt, default_timeout=default_timeout,
                                     default_max_tokens=default_max_tokens)
            raw = (resp.content or "").strip()
        except Exception as exc:  # noqa: BLE001
            log.warning("invoke_json attempt %d/%d raised: %s", attempt + 1, attempts, exc)
            continue
        obj = extract_json(raw)
        if obj is not None:
            return obj
        log.warning("invoke_json attempt %d/%d returned unparseable output: %r", attempt + 1, attempts, raw[:300])
    return None
