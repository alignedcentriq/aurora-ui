/**
 * Imperative API for the flying-plane banner notification.
 *
 * Mirrors how Sonner exposes `toast(...)`: a module-level pub-sub store so
 * `flyBanner(...)` can be called from anywhere (event handlers, services)
 * without needing a React context. The <FlyingBanner /> component mounted at
 * the app root subscribes and renders the flights.
 */

export type FlyBannerItem = {
  id: number;
  message: string;
  /** Total time the plane takes to cross the screen, in ms. Higher = slower. */
  duration: number;
};

export type FlyBannerOptions = {
  /** Override the cross-screen duration (ms). Higher = slower. Defaults to 12000. */
  duration?: number;
};

const DEFAULT_DURATION = 12000;

const listeners = new Set<(item: FlyBannerItem) => void>();
let nextId = 1;

/** Launch a plane that flies a banner with `message` across the top of the screen. */
export function flyBanner(message: string, opts: FlyBannerOptions = {}): void {
  const item: FlyBannerItem = {
    id: nextId++,
    message,
    duration: opts.duration ?? DEFAULT_DURATION,
  };
  listeners.forEach((listener) => listener(item));
}

/** Subscribe to launched banners. Returns an unsubscribe function. */
export function subscribeFlyBanner(
  listener: (item: FlyBannerItem) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
