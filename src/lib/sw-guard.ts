/**
 * Dev-only service-worker self-heal.
 *
 * VitePWA only ships a service worker in production builds. But if you ever ran
 * `vite preview` or the built app on this same origin (e.g. localhost:3000), the
 * browser registered that production SW — and it keeps intercepting requests
 * afterwards. Against the dev server it serves the *cached* production
 * index.html, which references hashed asset URLs (/centriq/assets/index-*.js)
 * that don't exist in dev → the page loads nothing (blank screen).
 *
 * In dev, proactively unregister any lingering worker and drop its caches so the
 * dev server is reached directly. No-op in production (the PWA stays intact) and
 * during SSR/prerender (no `navigator`).
 */
if (
  import.meta.env.DEV &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator
) {
  navigator.serviceWorker
    .getRegistrations()
    .then(async (regs) => {
      if (!regs.length) return;
      await Promise.all(regs.map((r) => r.unregister()));
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // The stale worker may have already served old JS for this load; reload
      // once (guarded against loops) so the app boots from the dev server.
      if (!sessionStorage.getItem("sw-guard-reloaded")) {
        sessionStorage.setItem("sw-guard-reloaded", "1");
        window.location.reload();
      }
    })
    .catch(() => {
      /* best-effort cleanup; never block app boot */
    });
}
