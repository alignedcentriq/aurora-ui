// Single source of truth for the deploy path prefix.
//
// Centriq is served under /centriq on the shared host (hackathon.alignedautomation.com),
// where the bare /api path is ALREADY owned by a different app. So every request the
// browser makes to a backend route MUST be prefixed with /centriq, otherwise the host
// nginx routes it to the wrong app. Vite's `base` ("/centriq/") is the one place that
// prefix is configured; BASE_URL mirrors it, so we derive everything from it here.
//
// This module installs a window.fetch shim so all ~60 call sites that use bare
// "/api/..." keep working untouched. For non-fetch cases (e.g. <img src>), use apiUrl().

// "/centriq/" -> "/centriq"  (root deploy -> "")
export const API_PREFIX = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Backend paths that live at the server root and must be prefixed for the shared host.
const PREFIXED_PATHS = /^\/(api|uploads|verify)(\/|$|\?)/;

/** Prefix a root-relative backend path with the deploy base. Idempotent + absolute-URL-safe. */
export function apiUrl(path: string): string {
  if (!API_PREFIX) return path; // root deploy — nothing to prefix
  if (!path.startsWith("/")) return path; // relative or absolute (http…, //…) — leave alone
  if (path.startsWith(API_PREFIX + "/") || path === API_PREFIX) return path; // already prefixed
  if (!PREFIXED_PATHS.test(path)) return path; // not a backend root path (e.g. /assets/…)
  return API_PREFIX + path;
}

// Install the fetch shim exactly once, in the browser only.
declare global {
  interface Window {
    __centriqFetchPatched?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__centriqFetchPatched && API_PREFIX) {
  const originalFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // string URL — the overwhelmingly common case
    if (typeof input === "string") {
      return originalFetch(apiUrl(input), init);
    }
    // URL object with a same-origin path
    if (input instanceof URL) {
      if (input.origin === window.location.origin) {
        const next = apiUrl(input.pathname + input.search + input.hash);
        return originalFetch(next, init);
      }
      return originalFetch(input, init);
    }
    // Request object (defensive — not used in this codebase today)
    if (input instanceof Request) {
      try {
        const u = new URL(input.url);
        if (u.origin === window.location.origin) {
          const next = apiUrl(u.pathname + u.search + u.hash);
          if (next !== u.pathname + u.search + u.hash) {
            return originalFetch(new Request(u.origin + next, input), init);
          }
        }
      } catch {
        // fall through to original on any parse error
      }
      return originalFetch(input, init);
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;

  window.__centriqFetchPatched = true;
}
