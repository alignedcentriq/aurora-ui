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

    # ── request identity (who is running / waiting) ──────────────────────
    # Best-effort metadata attached to a slot/waiter token so the Model
    # Controls "live traffic" view can show WHOSE request occupies each slot
    # or queue spot. Never raises; a metadata blip must not affect admission.
    async def annotate(self, token: Optional[str], info: dict) -> None:
        raise NotImplementedError

    async def remove_annotation(self, token: Optional[str]) -> None:
        raise NotImplementedError

    async def queue_position(self, waiter: str) -> Optional[int]:
        """1-based position of *waiter* in the queue (by enqueue time), or None."""
        raise NotImplementedError

    async def detailed_stats(self) -> dict:
        """stats() plus per-request identity: ``running``/``waiting`` lists of
        {token-less} entries {email, snippet, since, position?}."""
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

        # Expose the waiter token so the caller can annotate it with the
        # requesting user and ask for live queue positions while waiting.
        yield ("queued", waiter)

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
        self._slots: dict[str, float] = {}     # slot token → acquired_at
        self._waiters: dict[str, float] = {}   # waiter token → enqueued_at (insertion-ordered)
        self._meta: dict[str, dict] = {}       # token → {email, snippet, ...}
        self._lock = asyncio.Lock()

    async def _try_acquire(self) -> Optional[str]:
        async with self._lock:
            if len(self._slots) < self.max_concurrency:
                token = uuid.uuid4().hex
                self._slots[token] = time.time()
                return token
        return None

    async def _register_waiter(self) -> Optional[str]:
        async with self._lock:
            if len(self._waiters) < self.max_queue:
                token = uuid.uuid4().hex
                self._waiters[token] = time.time()
                return token
        return None

    async def _renew_waiter(self, waiter: str) -> None:
        return  # nothing expires in-process

    async def _remove_waiter(self, waiter: str) -> None:
        async with self._lock:
            self._waiters.pop(waiter, None)
            self._meta.pop(waiter, None)

    async def slot_heartbeat(self, slot: str) -> None:
        # No lease to renew in-process; just park until cancelled.
        while True:
            await asyncio.sleep(3600)

    async def release(self, slot: Optional[str]) -> None:
        if not slot:
            return
        async with self._lock:
            self._slots.pop(slot, None)
            self._meta.pop(slot, None)

    async def stats(self) -> dict:
        return {
            "backend": "memory",
            "active": len(self._slots),
            "waiting": len(self._waiters),
            "max_concurrency": self.max_concurrency,
            "max_queue": self.max_queue,
        }

    async def annotate(self, token: Optional[str], info: dict) -> None:
        if not token:
            return
        async with self._lock:
            self._meta[token] = dict(info)

    async def remove_annotation(self, token: Optional[str]) -> None:
        if not token:
            return
        async with self._lock:
            self._meta.pop(token, None)

    async def queue_position(self, waiter: str) -> Optional[int]:
        async with self._lock:
            # Dict preserves insertion order == true arrival order (timestamps
            # can tie when two requests enqueue in the same tick).
            for i, tok in enumerate(self._waiters):
                if tok == waiter:
                    return i + 1
        return None

    async def detailed_stats(self) -> dict:
        async with self._lock:
            now = time.time()
            running = [
                {**self._meta.get(tok, {}), "since": since, "elapsed_s": round(now - since, 1)}
                for tok, since in sorted(self._slots.items(), key=lambda kv: kv[1])
            ]
            waiting = [
                {**self._meta.get(tok, {}), "since": since, "elapsed_s": round(now - since, 1),
                 "position": i + 1}
                for i, (tok, since) in enumerate(sorted(self._waiters.items(), key=lambda kv: kv[1]))
            ]
        base = await self.stats()
        return {**base, "running": running, "waiting_list": waiting}


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
    META_KEY = "chat:gate:meta"   # hash: token → JSON {email, snippet, since}

    def __init__(self, client, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._r = client
        self._lease = client.register_script(_LEASE_LUA)

    async def _take_lease(self, key: str, ttl: float, limit: int) -> Optional[str]:
        token = uuid.uuid4().hex
        try:
            ok = await self._lease(keys=[key], args=[time.time(), ttl, limit, token])
        except Exception as exc:  # noqa: BLE001
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
            await self._r.hdel(self.META_KEY, waiter)
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
            pass

    async def release(self, slot: Optional[str]) -> None:
        if not slot:
            return
        try:
            await self._r.zrem(self.SLOTS_KEY, slot)
            await self._r.hdel(self.META_KEY, slot)
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

    async def annotate(self, token: Optional[str], info: dict) -> None:
        if not token:
            return
        try:
            import json
            await self._r.hset(self.META_KEY, token, json.dumps(info))
        except Exception:  # noqa: BLE001
            pass

    async def remove_annotation(self, token: Optional[str]) -> None:
        if not token:
            return
        try:
            await self._r.hdel(self.META_KEY, token)
        except Exception:  # noqa: BLE001
            pass

    async def _members_with_meta(self, key: str) -> list[tuple[str, dict]]:
        """(token, entry) pairs for live tokens in *key*, oldest-first by the
        annotation's ``since`` with the token as a deterministic tie-breaker
        (timestamps can tie when two requests enqueue in the same tick;
        un-annotated tokens sort last)."""
        import json
        tokens = await self._r.zrange(key, 0, -1)
        if not tokens:
            return []
        raw = await self._r.hmget(self.META_KEY, tokens)
        now = time.time()
        entries = []
        for tok, blob in zip(tokens, raw):
            try:
                info = json.loads(blob) if blob else {}
            except Exception:  # noqa: BLE001
                info = {}
            since = float(info.get("since") or now)
            entries.append((tok, {**info, "since": since, "elapsed_s": round(now - since, 1)}))
        entries.sort(key=lambda pair: (pair[1]["since"], pair[0]))
        return entries

    async def queue_position(self, waiter: str) -> Optional[int]:
        try:
            entries = await self._members_with_meta(self.WAITERS_KEY)
            for i, (tok, _) in enumerate(entries):
                if tok == waiter:
                    return i + 1
        except Exception:  # noqa: BLE001
            pass
        return None

    async def detailed_stats(self) -> dict:
        base = await self.stats()
        try:
            running = [entry for _, entry in await self._members_with_meta(self.SLOTS_KEY)]
            waiting = [entry for _, entry in await self._members_with_meta(self.WAITERS_KEY)]
            for i, e in enumerate(waiting):
                e["position"] = i + 1
            # GC: drop annotations whose token no longer holds a slot or queue spot.
            live = set(await self._r.zrange(self.SLOTS_KEY, 0, -1)) | set(
                await self._r.zrange(self.WAITERS_KEY, 0, -1)
            )
            stale = [t for t in await self._r.hkeys(self.META_KEY) if t not in live]
            if stale:
                await self._r.hdel(self.META_KEY, *stale)
        except Exception:  # noqa: BLE001
            running, waiting = [], []
        return {**base, "running": running, "waiting_list": waiting}


def _build_chat_gate() -> BaseChatGate:
    backend = os.getenv("CHAT_GATE_BACKEND", "auto").strip().lower()
    use_redis = backend == "redis" or (backend == "auto" and not settings.USE_MEMORY_SAVER)
    args = (settings.CHAT_MAX_CONCURRENCY, settings.CHAT_MAX_QUEUE, settings.CHAT_QUEUE_TIMEOUT)

    if use_redis:
        try:
            import redis as sync_redis
            import redis.asyncio as aioredis

            # Probe synchronously at startup so we fall back before any request hits.
            probe = sync_redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
            probe.ping()
            probe.close()

            client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            return RedisChatGate(client, *args)
        except Exception as exc:  # noqa: BLE001
            pass

    return InProcessChatGate(*args)


chat_gate = _build_chat_gate()
