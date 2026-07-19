import { useChatStore, type Thread } from "./chat-store";

// Syncs chat threads to the server so Recent Chats is tied to the logged-in account,
// not the browser's localStorage — the same fix `chat-store.ts`'s persist middleware
// can't provide on its own. localStorage stays as the fast, offline-first local cache;
// this module keeps it mirrored to `ChatSession` rows server-side (see backend/app/main.py
// GET/PUT /api/chat/sessions).

let currentUserEmail: string | null = null;
// threadId -> updatedAt already confirmed in sync (either pushed or just pulled), so the
// subscriber below doesn't re-push a thread on every unrelated store change.
const lastSynced: Record<string, number> = {};
let knownIds = new Set<string>();

let pending: Record<string, Thread> = {};
let pendingDeletes = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function stripForSync(thread: Thread) {
  return {
    turns: thread.turns.map(({ images: _images, ...turn }) => turn),
    updated_at: thread.updatedAt,
  };
}

function flush() {
  flushTimer = null;
  const email = currentUserEmail;
  const toSync = pending;
  const toDelete = pendingDeletes;
  pending = {};
  pendingDeletes = new Set();
  if (!email) return;

  for (const thread of Object.values(toSync)) {
    lastSynced[thread.id] = thread.updatedAt;
    fetch(`/api/chat/sessions/${encodeURIComponent(thread.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-email": email },
      body: JSON.stringify(stripForSync(thread)),
    }).catch(() => {});
  }
  for (const id of toDelete) {
    fetch(`/api/chat/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-user-email": email },
    }).catch(() => {});
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 1500);
}

/** Call once auth resolves (or on logout, with null) so the subscriber below knows who to sync as. */
export function setChatSyncUser(email: string | null) {
  currentUserEmail = email;
}

/** Pull this user's server-saved threads once at login and merge into the local store —
 * newer `updatedAt` wins per thread, so a stale local copy never clobbers a newer server one
 * (or vice versa). This is what makes Recent Chats match across devices. */
export async function hydrateChatFromServer(email: string) {
  try {
    const res = await fetch("/api/chat/sessions", { headers: { "x-user-email": email } });
    if (!res.ok) return;
    const serverThreads: Thread[] = await res.json();
    const local = useChatStore.getState().threads;
    const merged = { ...local };
    for (const t of serverThreads) {
      const existing = merged[t.id];
      if (!existing || existing.updatedAt < t.updatedAt) {
        merged[t.id] = t;
      }
      // Either way, what the server just gave us is in sync — don't push it right back.
      lastSynced[t.id] = merged[t.id].updatedAt;
    }
    knownIds = new Set(Object.keys(merged));
    useChatStore.setState({ threads: merged });
  } catch {
    // offline / server unreachable — local cache is still usable
  }
}

useChatStore.subscribe((state) => {
  if (!currentUserEmail) return;
  const nowIds = new Set(Object.keys(state.threads));

  for (const id of knownIds) {
    if (!nowIds.has(id)) pendingDeletes.add(id);
  }
  for (const thread of Object.values(state.threads)) {
    if (thread.isPrivate || thread.turns.length === 0) continue;
    if (lastSynced[thread.id] === thread.updatedAt) continue;
    pending[thread.id] = thread;
  }
  knownIds = nowIds;
  if (Object.keys(pending).length || pendingDeletes.size) scheduleFlush();
});
