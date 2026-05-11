"""
Lightweight Langfuse tracing wrapper for Centriq AI.

This replaces the broken langfuse.callback.CallbackHandler which requires
an old version of langchain that is incompatible with our stack.

Instead, we use the Langfuse Python SDK directly to create traces
around each chat invocation.
"""

import os
import time
from contextlib import contextmanager
from langfuse import Langfuse

# ── Singleton Langfuse Client ────────────────────────────────────────────────

_client = None


def get_langfuse_client() -> Langfuse | None:
    """Return a singleton Langfuse client, or None if unavailable."""
    global _client
    if _client is not None:
        return _client

    try:
        _client = Langfuse(
            public_key=os.environ.get("LANGFUSE_PUBLIC_KEY", "pk-lf-1234567890"),
            secret_key=os.environ.get("LANGFUSE_SECRET_KEY", "sk-lf-1234567890"),
            host=os.environ.get("LANGFUSE_HOST", "http://localhost:3002"),
        )
        return _client
    except Exception as e:
        print(f"[Langfuse] Client init failed: {e}")
        return None


@contextmanager
def langfuse_trace(name: str, session_id: str = None, metadata: dict = None):
    """
    Context manager that creates a Langfuse trace for a chat request.

    Usage:
        with langfuse_trace("chat", session_id="abc") as trace:
            # ... do work ...
            trace.update(output="response text")

    If Langfuse is unavailable, yields a no-op object.
    """
    client = get_langfuse_client()

    if client is None:
        yield _NoopTrace()
        return

    try:
        trace = client.trace(
            name=name,
            session_id=session_id,
            metadata=metadata or {},
        )
        yield trace
        client.flush()
    except Exception as e:
        print(f"[Langfuse] Trace error: {e}")
        yield _NoopTrace()


def langfuse_event(name: str, data: dict = None):
    """Fire a one-shot event to Langfuse (e.g., for custom tracking)."""
    client = get_langfuse_client()
    if client is None:
        return

    try:
        trace = client.trace(name=f"event-{name}")
        trace.event(name=name, metadata=data or {})
        client.flush()
    except Exception as e:
        print(f"[Langfuse] Event error: {e}")


class _NoopTrace:
    """A no-op trace object for when Langfuse is unavailable."""
    def update(self, **kwargs):
        pass

    def event(self, **kwargs):
        pass

    def span(self, **kwargs):
        return self

    def generation(self, **kwargs):
        return self

    def end(self, **kwargs):
        pass

    def score(self, **kwargs):
        pass
