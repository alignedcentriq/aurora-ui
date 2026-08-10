"""Tiny shared "did you mean X?" helper for fixed-vocabulary lookups (project names,
room names, book titles, etc.) — stdlib difflib, no new dependency. Complements the
bespoke acronym/typo handling in policy_service._expand_query, which is tuned for
short domain-jargon words rather than arbitrary proper nouns."""

from difflib import get_close_matches


def best_fuzzy_match(query: str, candidates: list[str], cutoff: float = 0.6) -> str | None:
    """Case-insensitive nearest match from `candidates` for `query`, or None if nothing
    clears `cutoff`. Returns the candidate in its original casing."""
    if not query or not candidates:
        return None
    lower_map = {c.lower(): c for c in candidates if c}
    matches = get_close_matches(query.lower(), lower_map.keys(), n=1, cutoff=cutoff)
    return lower_map[matches[0]] if matches else None
