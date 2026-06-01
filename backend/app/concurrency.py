"""Concurrency gate for AI chat requests.

The shared LLM server (ml01) can only generate for a handful of requests at
once. Without a cap, a burst of concurrent chats overwhelms the GPU and every
user sees minutes-long latency (or timeouts). This gate bounds how many chats
run the LLM chain simultaneously; extra requests wait in a bounded queue, and
once that queue is full new requests are rejected fast with a friendly "busy"
signal instead of piling more load onto the GPU.

Two backends, chosen by CHAT_GATE_BACKEND (auto | redis | memory):

  * redis  — a distributed semaphore using sorted sets with *expiring leases*,
             so the cap is enforced across all uvicorn workers/processes and a
             slot can't leak if a worker dies mid-generation (its lease simply
             expires). This is the multi-worker-safe option.
  * memory — a per-process limiter (fine for a single worker / local dev).

"auto" uses redis unless USE_MEMORY_SAVER is set (mirrors the agent checkpointer).

`acquire()` is an async generator that yields step events so the SSE endpoint
can stream a "queued" notice and periodic keepalives to the client while it
waits:

    slot = None
    async for kind, token in chat_gate.acquire():
        kind in {"queued", "keepalive", "acquired", "busy", "timeout"}
        if kind == "acquired": slot = token
"""
import asyncio
import os
import time
import uuid
from typing import AsyncIterator, Optional, Tuple

from app.config import settings
from app.services import llm_controls_service as llm_controls

# How often a waiting request re-checks for a free slot.
POLL_INTERVAL = 0.4
# How often to emit an SSE keepalive to a queued client (defeats proxy idle timeouts).
KEEPALIVE_INTERVAL = 10.0

Step = Tuple[str, Optional[str]]


class BaseChatGate:
    """Shared wait/queue/keepalive logic; backends implement the primitives."""

    def __init__(self, max_concurrency: int, max_queue: int, acquire_timeout: float):
        # Env values become the fallback defaults; the live caps come from the IT
        # controls (cached ~5s) so IT can throttle GPU load without a restart.
        self._default_max_concurrency = max_concurrency
        self._default_max_queue = max_queue
        self.acquire_timeout = acquire_timeout

    @property
    def max_concurrency(self) -> int:
        try:
            return llm_controls.concurrency_limits()[0]
        except Exception:  # noqa: BLE001 — never let a config blip break the gate
            return self._default_max_concurrency

    @property
    def max_queue(self) -> int:
        try:
            return llm_controls.concurrency_limits()[1]
        except Exception:  # noqa: BLE001
            return self._default_max_queue

    # ── primitives implemented per-backend ──────────────────────────────
    async def _try_acquire(self) -> Optional[str]:
        raise NotImplementedError

    async def _register_waiter(self) -> Optional[str]:
        raise NotImplementedError

    async def _renew_waiter(self, waiter: str) -> None:
        raise NotImplementedError

    async def _remove_waiter(self, waiter: str) -> None:
        raise NotImplementedError

    async def slot_heartbeat(self, slot: str) -> None:
        raise NotImplementedError

    async def release(self, slot: Optional[str]) -> None:
        raise NotImplementedError

    async def stats(self) -> dict:
        raise NotImplementedError

    # ── shared acquire flow ──────────────────────────────────────────────
    async def acquire(self) -> AsyncIterator[Step]:
        slot = await self._try_acquire()
        if slot is not None:
            yield ("acquired", slot)
            return

        waiter = await self._register_waiter()
        if waiter is None:
            yield ("busy", None)  # queue is full — reject fast
            return

        yield ("queued", None)

        removed = False

        async def drop():
            nonlocal removed
            if not removed:
                removed = True
                await self._remove_waiter(waiter)

        loop = asyncio.get_event_loop()
        deadline = loop.time() + self.acquire_timeout
        last_hb = loop.time()
        try:
            while True:
                await asyncio.sleep(POLL_INTERVAL)
                now = loop.time()
                await self._renew_waiter(waiter)
                slot = await self._try_acquire()
                if slot is not None:
                    await drop()
                    yield ("acquired", slot)
                    return
                if now >= deadline:
                    await drop()
                    yield ("timeout", None)
                    return
                if now - last_hb >= KEEPALIVE_INTERVAL:
                    yield ("keepalive", None)
                    last_hb = now
        finally:
            # Safety net if the client disconnects mid-wait.
            await drop()


class InProcessChatGate(BaseChatGate):
    """Per-process limiter. Correct for a single uvicorn worker."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._active = 0
        self._waiting = 0
        self._lock = asyncio.Lock()

    async def _try_acquire(self) -> Optional[str]:
        async with self._lock:
            if self._active < self.max_concurrency:
                self._active += 1
                return uuid.uuid4().hex
        return None

    async def _register_waiter(self) -> Optional[str]:
        async with self._lock:
            if self._waiting < self.max_queue:
                self._waiting += 1
                return uuid.uuid4().hex
        return None

    async def _renew_waiter(self, waiter: str) -> None:
        return  # nothing expires in-process

    async def _remove_waiter(self, waiter: str) -> None:
        async with self._lock:
            self._waiting = max(0, self._waiting - 1)

    async def slot_heartbeat(self, slot: str) -> None:
        # No lease to renew in-process; just park until cancelled.
        while True:
            await asyncio.sleep(3600)

    async def release(self, slot: Optional[str]) -> None:
        async with self._lock:
            self._active = max(0, self._active - 1)

    async def stats(self) -> dict:
        return {
            "backend": "memory",
            "active": self._active,
            "waiting": self._waiting,
            "max_concurrency": self.max_concurrency,
            "max_queue": self.max_queue,
        }


# Atomic "take a lease if under the limit" for a sorted set keyed by expiry.
# Used for both the slot set and the waiter set.
_LEASE_LUA = """
local key   = KEYS[1]
local now   = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local token = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if redis.call('ZCARD', key) < limit then
  redis.call('ZADD', key, now + ttl, token)
  return 1
end
return 0
"""


class RedisChatGate(BaseChatGate):
    """Distributed limiter via Redis sorted sets with expiring leases.

    Members are random tokens; the score is the lease expiry. Crash-safe: a
    holder that dies stops renewing and its lease is purged on the next access.
    Fails OPEN (allows the request) if Redis errors, so a Redis blip degrades
    capping rather than breaking chat.
    """

    SLOT_TTL = 30.0       # a held slot must be renewed within this window
    WAITER_TTL = 30.0     # a queued waiter must be renewed within this window
    SLOTS_KEY = "chat:gate:slots"
    WAITERS_KEY = "chat:gate:waiters"

    def __init__(self, client, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._r = client
        self._lease = client.register_script(_LEASE_LUA)

    async def _take_lease(self, key: str, ttl: float, limit: int) -> Optional[str]:
        token = uuid.uuid4().hex
        try:
            ok = await self._lease(keys=[key], args=[time.time(), ttl, limit, token])
        except Exception as exc:  # noqa: BLE001
            print(f"[chat_gate] Redis lease error on {key}: {exc} — failing open")
            return token  # fail open
        return token if ok == 1 else None

    async def _try_acquire(self) -> Optional[str]:
        return await self._take_lease(self.SLOTS_KEY, self.SLOT_TTL, self.max_concurrency)

    async def _register_waiter(self) -> Optional[str]:
        return await self._take_lease(self.WAITERS_KEY, self.WAITER_TTL, self.max_queue)

    async def _renew_waiter(self, waiter: str) -> None:
        try:
            await self._r.zadd(self.WAITERS_KEY, {waiter: time.time() + self.WAITER_TTL})
        except Exception:  # noqa: BLE001
            pass

    async def _remove_waiter(self, waiter: str) -> None:
        try:
            await self._r.zrem(self.WAITERS_KEY, waiter)
        except Exception:  # noqa: BLE001
            pass

    async def slot_heartbeat(self, slot: str) -> None:
        try:
            while True:
                await asyncio.sleep(self.SLOT_TTL / 2)
                await self._r.zadd(self.SLOTS_KEY, {slot: time.time() + self.SLOT_TTL})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            print(f"[chat_gate] slot heartbeat error: {exc}")

    async def release(self, slot: Optional[str]) -> None:
        if not slot:
            return
        try:
            await self._r.zrem(self.SLOTS_KEY, slot)
        except Exception:  # noqa: BLE001
            pass

    async def stats(self) -> dict:
        try:
            now = time.time()
            await self._r.zremrangebyscore(self.SLOTS_KEY, "-inf", now)
            await self._r.zremrangebyscore(self.WAITERS_KEY, "-inf", now)
            active = await self._r.zcard(self.SLOTS_KEY)
            waiting = await self._r.zcard(self.WAITERS_KEY)
        except Exception as exc:  # noqa: BLE001
            return {"backend": "redis", "error": str(exc)}
        return {
            "backend": "redis",
            "active": active,
            "waiting": waiting,
            "max_concurrency": self.max_concurrency,
            "max_queue": self.max_queue,
        }


def _build_chat_gate() -> BaseChatGate:
    backend = os.getenv("CHAT_GATE_BACKEND", "auto").strip().lower()
    use_redis = backend == "redis" or (backend == "auto" and not settings.USE_MEMORY_SAVER)
    args = (settings.CHAT_MAX_CONCURRENCY, settings.CHAT_MAX_QUEUE, settings.CHAT_QUEUE_TIMEOUT)

    if use_redis:
        try:
            import redis.asyncio as aioredis

            client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            print(
                f"[chat_gate] Redis backend (cross-process cap) "
                f"max_concurrency={args[0]} max_queue={args[1]}"
            )
            return RedisChatGate(client, *args)
        except Exception as exc:  # noqa: BLE001
            print(f"[chat_gate] Redis backend unavailable ({exc}); using in-process gate.")

    print(f"[chat_gate] In-process backend (per-worker cap) max_concurrency={args[0]}")
    return InProcessChatGate(*args)


chat_gate = _build_chat_gate()
