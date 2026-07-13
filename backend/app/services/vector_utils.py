"""Shared vector math for in-memory similarity scoring.

pgvector does cosine distance in C for DB-side k-NN; these helpers are for the
small, already-in-memory candidate sets (keyword-suggestion mining, feedback
clustering) where pulling rows out and scoring them in Python is simplest.

Single source of truth — previously `_cosine` was copy-pasted byte-for-byte in
app_directory_service and feedback_triage_service, and `_as_list` in several more.
"""

import math
from typing import Optional


def cosine(a: list, b: list) -> float:
    """Cosine similarity of two equal-length vectors. 0.0 on empty/mismatched/zero-norm."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def to_list(emb) -> Optional[list]:
    """pgvector may hand back a numpy array or a list — normalise to a plain list, or None."""
    if emb is None:
        return None
    try:
        return [float(x) for x in list(emb)]
    except Exception:
        return None
