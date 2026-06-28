/**
 * Helpers for launching a native app from the Centriq web app.
 *
 * The browser cannot run programs directly — it can only ask the OS to hand
 * off to an app that is already registered for a URL scheme / link. These
 * helpers cover the two realistic cases:
 *
 *  1. `openApp`          — launch *our own* app and fall back to the app store
 *                          when it isn't installed (Android Intent URL +
 *                          iOS Universal Link).
 *  2. `openInstalledApp` — launch a *third-party* app (Teams, Zoom, …) via its
 *                          URL scheme, with an optional web fallback.
 */

export type MobilePlatform = "ios" | "android" | "other";

/**
 * Best-effort device detection from the user agent.
 * iPadOS 13+ masquerades as macOS, so we additionally treat a "Macintosh"
 * UA with touch points as iOS.
 */
export function getMobilePlatform(): MobilePlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  return "other";
}

export type OpenAppOptions = {
  /** Custom URL scheme without "://", e.g. "centriq". Used to build the Android intent. */
  scheme: string;
  /** Android application id, e.g. "com.centriq.app". Required for the intent fallback. */
  androidPackage: string;
  /** Play Store URL opened on Android when the app isn't installed. */
  playStoreUrl: string;
  /**
   * iOS Universal Link (https). Opens the app if installed; otherwise iOS just
   * loads this URL in Safari — point it at a page that redirects to the App
   * Store (or that hosts an "open in App Store" button).
   */
  iosUniversalLink: string;
  /** Host/path after the scheme, e.g. "open/approval/123". Optional. */
  path?: string;
  /**
   * Where to send desktop / unknown platforms. Defaults to `iosUniversalLink`
   * (a normal https URL works everywhere).
   */
  webFallbackUrl?: string;
};

/**
 * Build an Android Intent URL with a built-in store fallback. When the app is
 * installed the OS opens it; otherwise it navigates the browser to
 * `browser_fallback_url` (the Play Store). No JavaScript timing tricks needed.
 */
export function buildAndroidIntentUrl(opts: OpenAppOptions): string {
  const target = opts.path ?? "";
  const fallback = encodeURIComponent(opts.playStoreUrl);
  return (
    `intent://${target}#Intent;` +
    `scheme=${opts.scheme};` +
    `package=${opts.androidPackage};` +
    `S.browser_fallback_url=${fallback};` +
    `end;`
  );
}

/**
 * Launch our own app, falling back to the app store when it isn't installed.
 *
 * - Android: Intent URL — the OS handles the store fallback natively.
 * - iOS: Universal Link — the OS opens the app if installed, else loads the
 *   https URL (which should redirect to the App Store).
 * - Desktop / unknown: navigates to `webFallbackUrl` (or the Universal Link).
 *
 * Returns the platform that was targeted, mostly for logging/analytics.
 */
export function openApp(opts: OpenAppOptions): MobilePlatform {
  if (typeof window === "undefined") return "other";
  const platform = getMobilePlatform();

  switch (platform) {
    case "android":
      window.location.href = buildAndroidIntentUrl(opts);
      break;
    case "ios":
      window.location.href = opts.iosUniversalLink;
      break;
    default:
      window.location.href = opts.webFallbackUrl ?? opts.iosUniversalLink;
      break;
  }
  return platform;
}

/**
 * Launch a third-party app already installed on the device via its URL scheme
 * (e.g. "msteams://…", "zoommtg://…", "tel:…"). If `webFallbackUrl` is given and
 * nothing handles the scheme within `timeoutMs`, the browser is redirected
 * there instead (typically the app's web version).
 *
 * The fallback is heuristic: when the app launches, the page is backgrounded and
 * the timer is throttled/cleared, so the redirect doesn't fire. Browsers vary,
 * so prefer a Universal Link / Intent URL for apps you control.
 */
export function openInstalledApp(appUrl: string, webFallbackUrl?: string, timeoutMs = 1200): void {
  if (typeof window === "undefined") return;

  if (!webFallbackUrl) {
    window.location.href = appUrl;
    return;
  }

  const start = Date.now();
  const timer = window.setTimeout(() => {
    // If we're still here (and not just slow), the scheme wasn't handled.
    if (Date.now() - start < timeoutMs + 800) {
      window.location.href = webFallbackUrl;
    }
  }, timeoutMs);

  // If the app opens, the tab loses visibility — cancel the fallback.
  const onHide = () => {
    if (document.hidden) window.clearTimeout(timer);
  };
  document.addEventListener("visibilitychange", onHide, { once: true });

  window.location.href = appUrl;
}
