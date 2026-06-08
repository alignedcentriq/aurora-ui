"""
Langfuse tracing for Centriq AI — enhanced with per-node generation spans.

Provides TracingContext for streaming chat requests:
  - Creates a parent trace at the START of generate()
  - Attaches child generation spans for each LLM call (on_chat_model_start / end)
  - Records tool call spans
  - Finalises trace with output, domain, and latency

Also provides langfuse_event() for one-shot custom events.
"""

import os
import time
from langfuse import Langfuse

# -- Singleton Langfuse Client ------------------------------------------------

_client = None


def get_langfuse_client() -> Langfuse | None:
    """Return a singleton Langfuse client, or None if Langfuse is not configured."""
    global _client
    if _client is not None:
        return _client

    public_key = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
    secret_key = os.environ.get("LANGFUSE_SECRET_KEY", "")
    if not public_key or not secret_key:
        return None

    try:
        _client = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=os.environ.get("LANGFUSE_HOST", "http://localhost:3003"),
        )
        return _client
    except Exception as e:
        return None


# -- TracingContext (per-request lifecycle) ------------------------------------

class TracingContext:
    """Manages a Langfuse trace + child generation spans for one chat request.

    Usage:
        tracing = TracingContext(session_id="abc", user_id="user@co.com",
                                metadata={"message": "hello"})
        # ... during streaming ...
        tracing.start_generation(run_id, node, model)
        tracing.end_generation(run_id, output_msg, usage_metadata)
        # ... after streaming ...
        tracing.finalize(output="response text", domain="hr", latency_ms=1200)
    """

    def __init__(self, session_id: str = None, user_id: str = None,
                 metadata: dict = None, tags: list = None, is_private: bool = False):
        self._generations: dict[str, object] = {}   # run_id → generation span
        self._gen_starts: dict[str, float] = {}      # run_id → start time
        self.trace_id: str | None = None

        if is_private:
            self._client = None
            self._trace = None
            return

        self._client = get_langfuse_client()
        if self._client is None:
            return

        try:
            self._trace = self._client.trace(
                name="chat",
                session_id=session_id,
                user_id=user_id,
                metadata=metadata or {},
                tags=tags or [],
            )
            self.trace_id = self._trace.id
        except Exception as e:
            self._trace = None

    # -- Generation span lifecycle --

    def start_generation(self, run_id: str, node: str, model: str):
        """Called on on_chat_model_start — opens a generation span."""
        if self._trace is None:
            return
        self._gen_starts[run_id] = time.time()
        try:
            gen = self._trace.generation(
                name=node,
                model=model,
                metadata={"run_id": run_id, "node": node},
            )
            self._generations[run_id] = gen
        except Exception as e:
            pass

    def end_generation(self, run_id: str, output=None, usage_metadata: dict = None,
                       tool_calls: list = None):
        """Called on on_chat_model_end — closes the generation span with usage."""
        gen = self._generations.pop(run_id, None)
        start = self._gen_starts.pop(run_id, None)
        if gen is None:
            return

        try:
            usage = None
            if usage_metadata:
                usage = {
                    "input": usage_metadata.get("input_tokens", 0),
                    "output": usage_metadata.get("output_tokens", 0),
                    "total": usage_metadata.get("total_tokens", 0),
                }

            output_text = ""
            if output is not None:
                output_text = output.content if hasattr(output, "content") else str(output)
                # Truncate to avoid oversized payloads
                if len(output_text) > 1000:
                    output_text = output_text[:1000] + "..."

            meta = {}
            if tool_calls:
                meta["tool_calls"] = [tc.get("name", "unknown") if isinstance(tc, dict) else getattr(tc, "name", "unknown") for tc in tool_calls]

            gen.end(
                output=output_text,
                usage=usage,
                metadata=meta if meta else None,
            )
        except Exception as e:
            pass

    # -- Tool spans --

    def add_tool_span(self, name: str, input_data=None, output_data=None):
        """Record a tool call as a span on the trace."""
        if self._trace is None:
            return
        try:
            span = self._trace.span(name=f"tool:{name}")
            span.end(
                input=str(input_data)[:500] if input_data else None,
                output=str(output_data)[:500] if output_data else None,
            )
        except Exception as e:
            pass

    # -- Finalise --

    def finalize(self, output: str = None, domain: str = None, latency_ms: int = None):
        """Called after streaming completes — updates trace with final output."""
        if self._trace is None:
            return
        try:
            meta = {}
            if domain:
                meta["domain"] = domain
            if latency_ms is not None:
                meta["latency_ms"] = latency_ms

            self._trace.update(
                output=output[:2000] if output else None,
                metadata=meta,
            )
        except Exception as e:
            pass
        finally:
            self._flush()

    def score(self, name: str, value, comment: str = None):
        """Attach a score to this trace (e.g. user feedback)."""
        if self._trace is None:
            return
        try:
            self._trace.score(name=name, value=value, comment=comment)
            self._flush()
        except Exception as e:
            pass

    def _flush(self):
        if self._client:
            try:
                self._client.flush()
            except Exception:
                pass


# -- One-shot event (backwards compat) ----------------------------------------

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
        pass
