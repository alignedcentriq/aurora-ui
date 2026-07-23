"""
Local (in-process) embedding backend — see docs/specs/2026-07-21-local-embedding-backend-design.md.

Runs nomic-embed-text-v1.5 via fastembed (ONNX, CPU) directly in this process instead of
round-tripping to the shared, contended ml01 box. Same model family as the "remote" backend's
EMBEDDING_MODEL_NAME ("nomic-embed-text"), so vectors are expected to land in a comparable space —
validated by scripts/validate_local_embeddings.py before any cutover.

Nomic's model is trained to expect a task-prefixed input ("search_query: " for queries vs.
"search_document: " for passages) for best asymmetric retrieval quality. The existing remote
path (PolicyService._get_embedding via the OpenAI-compatible client) does NOT apply this
distinction today — every caller (policy chunks, cache lookups, feedback matching, router
examples, form/app descriptions, ...) embeds raw text uniformly. Correctly introducing the
query/document distinction would require re-classifying ~20 call sites across the codebase and
re-validating retrieval quality for all of them — out of scope for "move where embedding runs."
So this module deliberately embeds every input the same way (fastembed's document/passage path),
matching today's uniform behavior — a location change, not a semantics change.
"""

import logging
import threading

logger = logging.getLogger(__name__)

_MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"

_model = None
_model_lock = threading.Lock()
_load_failed = False


def _get_model():
    """Lazily create the singleton TextEmbedding instance. Thread-safe."""
    global _model, _load_failed
    if _model is not None:
        return _model
    if _load_failed:
        return None
    with _model_lock:
        if _model is not None:
            return _model
        if _load_failed:
            return None
        try:
            from fastembed import TextEmbedding
            _model = TextEmbedding(model_name=_MODEL_NAME)
        except Exception as e:
            logger.error(f"[local_embedding] Failed to load {_MODEL_NAME}: {e}")
            _load_failed = True
            return None
    return _model


def preload() -> bool:
    """Load the model once at startup so the first request doesn't pay the cold-load cost.
    Returns True on success. Safe to call multiple times (no-op once loaded)."""
    return _get_model() is not None


def is_available() -> bool:
    """True unless the model has failed to load."""
    return not _load_failed


def embed(text: str) -> list | None:
    """Embed arbitrary text (query or document, uniformly). Returns None on failure so callers
    fall back exactly as they do on remote-embedding failure today."""
    model = _get_model()
    if model is None:
        return None
    try:
        vec = next(iter(model.embed([text])))
        return vec.tolist()
    except Exception as e:
        logger.error(f"[local_embedding] embed failed: {e}")
        return None
