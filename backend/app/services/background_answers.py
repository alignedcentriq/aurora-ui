"""Answers that finished after the requester left the chat screen.

When a user navigates away while their request is still waiting in the
concurrency queue (or thinking, before the first token), the generation is
completed in the background. The finished answer is stashed here (Redis with a
24h TTL, in-process dict fallback) keyed by session_id, an "answer_ready"
nudge points the user at it, and the chat UI picks it up via
GET /api/chat/background-answer/{session_id} when the thread is reopened.

Payloads carry the requester's email so the fetch endpoint can refuse to serve
someone else's answer (session ids are client-generated and guessable).
"""
import json
import time
from typing import Optional

_TTL_SECONDS = 24 * 3600
_KEY_PREFIX = "bg_answer:"

# In-process fallback when Redis is unavailable (single-worker dev mode).
_mem: dict[str, tuple[float, dict]] = {}


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


def store(session_id: str, payload: dict) -> None:
    """Best-effort — a failure to stash must never break the generation path."""
    client = _redis()
    if client is not None:
        try:
            client.set(_KEY_PREFIX + session_id, json.dumps(payload), ex=_TTL_SECONDS)
            return
        except Exception:  # noqa: BLE001
            pass
    _mem[session_id] = (time.time(), payload)
    # Opportunistic sweep so the fallback dict can't grow unbounded.
    cutoff = time.time() - _TTL_SECONDS
    for key in [k for k, (ts, _) in _mem.items() if ts < cutoff]:
        _mem.pop(key, None)


def fetch(session_id: str) -> Optional[dict]:
    client = _redis()
    if client is not None:
        try:
            blob = client.get(_KEY_PREFIX + session_id)
            if blob:
                return json.loads(blob)
        except Exception:  # noqa: BLE001
            pass
    hit = _mem.get(session_id)
    if hit and time.time() - hit[0] < _TTL_SECONDS:
        return hit[1]
    return None


def clear(session_id: str) -> None:
    client = _redis()
    if client is not None:
        try:
            client.delete(_KEY_PREFIX + session_id)
        except Exception:  # noqa: BLE001
            pass
    _mem.pop(session_id, None)


# ── Deliberate-stop flags ─────────────────────────────────────────────────────
# A disconnect alone can't distinguish "user pressed Stop" from "user navigated
# away" — both abort the fetch. The Stop button additionally POSTs
# /api/chat/cancel/{session_id}, which sets this flag; the generation worker
# polls it while orphaned and aborts instead of background-completing.

_CANCEL_TTL_SECONDS = 6 * 3600
_CANCEL_PREFIX = "chat_cancel:"
_cancel_mem: dict[str, float] = {}


def mark_cancelled(session_id: str) -> None:
    client = _redis()
    if client is not None:
        try:
            client.set(_CANCEL_PREFIX + session_id, "1", ex=_CANCEL_TTL_SECONDS)
            return
        except Exception:  # noqa: BLE001
            pass
    _cancel_mem[session_id] = time.time()
    cutoff = time.time() - _CANCEL_TTL_SECONDS
    for key in [k for k, ts in _cancel_mem.items() if ts < cutoff]:
        _cancel_mem.pop(key, None)


def is_cancelled(session_id: str) -> bool:
    client = _redis()
    if client is not None:
        try:
            if client.get(_CANCEL_PREFIX + session_id):
                return True
        except Exception:  # noqa: BLE001
            pass
    ts = _cancel_mem.get(session_id)
    return ts is not None and time.time() - ts < _CANCEL_TTL_SECONDS
