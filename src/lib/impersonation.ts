/**
 * Super Admin test-impersonation.
 *
 * A real Super Admin can act as any other role to test the app. We persist the chosen
 * role in localStorage and inject it as an `x-impersonate-role` header on every same-origin
 * `/api` request via a one-time fetch patch — so individual components don't each need to
 * thread the header. The backend honours it ONLY when the caller is truly a Super Admin
 * (it never escalates), and the Super Admin's real grant is never modified, so switching
 * back is always available.
 */

const STORAGE_KEY = "centriq-impersonate-role";

/** Lower-cased role slug currently being impersonated, or null. */
export function getImpersonatedRole(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Set (or clear, with null) the impersonated role slug, e.g. "hr". */
export function setImpersonatedRole(roleSlug: string | null): void {
  try {
    if (roleSlug) localStorage.setItem(STORAGE_KEY, roleSlug.toLowerCase());
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage failures */
  }
}

let installed = false;

/** Patch window.fetch once so impersonation rides along on same-origin API calls. */
export function installImpersonationFetch(): void {
  if (installed || typeof window === "undefined" || !window.fetch) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const imp = getImpersonatedRole();
      // Only string URLs (the app's calling convention) and only our own API surface —
      // never attach the header to cross-origin calls (e.g. MS Graph).
      if (imp && typeof input === "string") {
        const isApi =
          input.startsWith("/api") || input.startsWith(`${window.location.origin}/api`);
        if (isApi) {
          const headers = new Headers(init?.headers || {});
          headers.set("x-impersonate-role", imp);
          init = { ...(init || {}), headers };
        }
      }
    } catch {
      /* never let the patch break a request */
    }
    return original(input as RequestInfo, init);
  };
}

// Install on import so the header is attached before any API call fires.
installImpersonationFetch();
