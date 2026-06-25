"""Robust JSON extraction for small-model drafting endpoints.

Local models (llama3.1:8b on the shared tier) intermittently wrap JSON in ``` fences, prepend
chatter, emit a trailing comma, or truncate — so a single invoke + naive ``json.loads`` fails
at random. ``invoke_json`` retries a couple of times and parses tolerantly (fence-strip,
balanced-brace slice, trailing-comma repair) before giving up. Used by the URL Library and Form
Library /generate endpoints.
"""

import json
import re


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


def invoke_json(model, prompt: str, attempts: int = 2) -> dict | None:
    """Invoke ``model`` up to ``attempts`` times, returning the first parseable JSON object,
    or None if every attempt fails (model error or unparseable output). Kept low by default
    because each call on the shared tier costs ~20s+."""
    for _ in range(max(1, attempts)):
        try:
            resp = model.invoke(prompt)
            raw = (resp.content or "").strip()
        except Exception:
            continue
        obj = extract_json(raw)
        if obj is not None:
            return obj
    return None
