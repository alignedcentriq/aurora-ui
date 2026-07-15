"""Rolling time-to-first-token (TTFT) so the UI can tell users when the shared
LLM server (CPU-bound, no GPU) is responding slower than usual — a signal the
concurrency gate (`app.concurrency`) can't provide on its own, since inference
can be slow even when a slot is free (active < max_concurrency).

Same Redis-with-in-process-fallback shape as `app.services.background_answers`:
best-effort, never raises, degrades to a single-process view if Redis is down.
"""
import time
from collections import deque
from typing import Optional

_WINDOW = 20             # samples kept for the rolling average
_TTL_SECONDS = 10 * 60   # stale samples (long-idle server) shouldn't count
_KEY = "chat:ttft_ms"

# Mirrors the TTFT watchdog threshold in llm_resilience.py (TTFT_HEDGE_SECONDS)
# — past that point the resilience layer itself is already hedging to a
# fallback model, so it's a reasonable "slow" line for the UI too.
SLOW_MS = 8_000
FAST_MS = 3_000

# In-process fallback when Redis is unavailable (single-worker dev mode).
_mem: deque[tuple[float, int]] = deque(maxlen=_WINDOW)


def _redis():
    try:
        import redis

        from app.config import settings

        client = redis.from_url(
            settings.REDIS_URL,
            socket_connect_timeout=1,
            socket_timeout=1,
            decode_responses=True,
        )
        client.ping()
        return client
    except Exception:  # noqa: BLE001
        return None


def record_ttft(ttft_ms: int) -> None:
    """Best-effort — a failure to record must never break the chat stream."""
    client = _redis()
    if client is not None:
        try:
            pipe = client.pipeline()
            pipe.lpush(_KEY, ttft_ms)
            pipe.ltrim(_KEY, 0, _WINDOW - 1)
            pipe.expire(_KEY, _TTL_SECONDS)
            pipe.execute()
            return
        except Exception:  # noqa: BLE001
            pass
    _mem.append((time.time(), ttft_ms))


def _samples() -> list[int]:
    client = _redis()
    if client is not None:
        try:
            raw = client.lrange(_KEY, 0, _WINDOW - 1)
            return [int(v) for v in raw]
        except Exception:  # noqa: BLE001
            pass
    cutoff = time.time() - _TTL_SECONDS
    return [ms for ts, ms in _mem if ts >= cutoff]


def get_speed_stats() -> dict:
    """{"avg_ttft_ms": int, "speed": "fast"|"normal"|"slow"} or all-None when
    there isn't enough recent traffic yet to say anything meaningful."""
    samples = _samples()
    if not samples:
        return {"avg_ttft_ms": None, "speed": None}

    avg = round(sum(samples) / len(samples))
    speed = "slow" if avg >= SLOW_MS else "fast" if avg <= FAST_MS else "normal"
    return {"avg_ttft_ms": avg, "speed": speed}
