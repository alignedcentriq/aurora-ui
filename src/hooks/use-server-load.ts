import { useEffect, useRef, useState } from "react";

// Shape of GET /api/chat/load. On a Redis error the backend returns
// { backend, error } with no counters — treated as "unknown" load.
interface ChatLoad {
  backend?: string;
  active?: number;
  waiting?: number;
  max_concurrency?: number;
  max_queue?: number;
  error?: string;
}

interface ServerLoad {
  /** True only when there is no free slot (requests are starting to queue). */
  serverBusy: boolean;
  /** Requests waiting in the queue ahead of a new one. */
  waiting: number;
  active: number;
  maxConcurrency: number;
}

const IDLE_POLL_MS = 15_000;
const BUSY_POLL_MS = 6_000;

/**
 * Polls the live concurrency-gate stats so the UI can warn the user when the
 * shared LLM server is saturated *before* they send. Fails quiet: any fetch
 * error or Redis-error response leaves load "unknown" and never reports busy,
 * so chat is never blocked on telemetry.
 */
export function useServerLoad(): ServerLoad {
  const [load, setLoad] = useState<ServerLoad>({
    serverBusy: false,
    waiting: 0,
    active: 0,
    maxConcurrency: 0,
  });
  // Keep the latest busy flag in a ref so the interval can re-pace itself
  // (faster while busy) without resubscribing on every poll.
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch("/api/chat/load");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as ChatLoad;

        const max = data.max_concurrency ?? 0;
        const active = data.active ?? 0;
        const waiting = data.waiting ?? 0;
        // Unknown load (Redis error or missing counters) → never report busy.
        const known = data.error == null && max > 0;
        const serverBusy = known && (waiting > 0 || active >= max);

        if (!cancelled) {
          busyRef.current = serverBusy;
          setLoad({ serverBusy, waiting, active, maxConcurrency: max });
        }
      } catch {
        // Backend unreachable / non-JSON — fail quiet, leave state as-is.
        if (!cancelled) busyRef.current = false;
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, busyRef.current ? BUSY_POLL_MS : IDLE_POLL_MS);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return load;
}
