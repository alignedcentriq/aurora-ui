import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  flyBanner,
  subscribeFlyBanner,
  type FlyBannerItem,
} from "@/lib/fly-banner";

const LANE_HEIGHT = 64; // vertical spacing between concurrent flights

/**
 * Global overlay that renders celebratory "flying banner" notifications:
 * a plane crosses the top of the screen left→right trailing a fabric banner
 * with the message, then unmounts. Triggered imperatively via flyBanner().
 *
 * Mount once at the app root, alongside the Sonner <Toaster />.
 */
export function FlyingBanner() {
  const [flights, setFlights] = React.useState<FlyBannerItem[]>([]);

  React.useEffect(() => {
    const unsubscribe = subscribeFlyBanner((item) => {
      setFlights((prev) => [...prev, item]);
    });

    // Dev convenience: trigger from the browser console while testing.
    if (import.meta.env.DEV) {
      (window as unknown as { flyBanner?: typeof flyBanner }).flyBanner =
        flyBanner;
    }

    return unsubscribe;
  }, []);

  const remove = React.useCallback((id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      <AnimatePresence>
        {flights.map((item, index) => (
          <Flight
            key={item.id}
            item={item}
            lane={index}
            onDone={() => remove(item.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function BannerContents({ message }: { message: string }) {
  return (
    <div className="flex items-center drop-shadow-md">
      {/* Banner (trails behind the plane) */}
      <div
        className="animate-banner-wave flex h-12 items-center whitespace-nowrap rounded-md px-6 text-base font-extrabold tracking-wide text-white shadow-glow-violet"
        style={{
          background: "var(--gradient-brand)",
          textShadow: "0 1px 2px rgba(15, 23, 42, 0.35)",
        }}
      >
        {message}
      </div>

      {/* Tow line tying the banner to the plane's tail */}
      <span className="h-px w-5 shrink-0 bg-foreground/25" aria-hidden />

      {/* Plane — side view, facing right, leading the flight */}
      <PlaneSvg />
    </div>
  );
}

/**
 * Sleek private jet, side profile, nose pointing right.
 *
 * Colors are driven by the app's theme CSS variables so the jet flips
 * automatically: --foreground is near-white in dark mode (→ white jet) and
 * near-black in light mode (→ dark jet); --background gives contrasting
 * windows; --primary is the brand violet cheatline accent.
 */
function PlaneSvg() {
  const fg = "var(--foreground)";
  const bg = "var(--background)";
  const accent = "var(--primary)";
  return (
    <svg
      width="140"
      height="52"
      viewBox="0 0 140 52"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      {/* Swept T-tail */}
      <path d="M18 18 L30 2 L37 3 L28 20 Z" fill={fg} />
      <path d="M27 3 L45 0 L45 3 L30 6 Z" fill={fg} />
      {/* Swept wing */}
      <path d="M74 29 L44 45 L60 31 Z" fill={fg} opacity="0.78" />
      {/* Fuselage */}
      <path
        d="M133 27 C127 22 117 20 99 20 L40 20 C24 20 14 22 7 14 C5 12 5 16 7 18 C13 24 25 27 40 28 L100 30 C118 31 128 30 133 27 Z"
        fill={fg}
      />
      {/* Rear-mounted engine nacelle on pylon */}
      <path d="M44 19 L40 15 L52 15 L54 19 Z" fill={fg} opacity="0.78" />
      <rect x="36" y="9" width="22" height="7" rx="3.5" fill={fg} />
      <ellipse cx="57" cy="12.5" rx="1.3" ry="2.8" fill={bg} opacity="0.55" />
      {/* Cheatline accent */}
      <path
        d="M36 27.4 Q80 29.4 121 27.1"
        stroke={accent}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      {/* Cockpit windshield */}
      <path d="M118 23 L127 24 L125 27 L116 26 Z" fill={bg} opacity="0.9" />
      {/* Cabin windows */}
      <circle cx="72" cy="24.5" r="1.5" fill={bg} opacity="0.9" />
      <circle cx="80" cy="24.3" r="1.5" fill={bg} opacity="0.9" />
      <circle cx="88" cy="24.2" r="1.5" fill={bg} opacity="0.9" />
      <circle cx="96" cy="24.1" r="1.5" fill={bg} opacity="0.9" />
      <circle cx="104" cy="24.2" r="1.5" fill={bg} opacity="0.9" />
    </svg>
  );
}

function Flight({
  item,
  lane,
  onDone,
}: {
  item: FlyBannerItem;
  lane: number;
  onDone: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const measureRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number | null>(null);

  const top = 24 + lane * LANE_HEIGHT;

  React.useLayoutEffect(() => {
    if (measureRef.current) {
      setWidth(measureRef.current.offsetWidth);
    }
  }, []);

  // Reduced motion: fade the banner in place near the top, then dismiss.
  if (prefersReducedMotion) {
    return (
      <motion.div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ top }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: [0, 1, 1, 0], y: 0 }}
        transition={{ duration: 4, times: [0, 0.1, 0.85, 1] }}
        onAnimationComplete={onDone}
      >
        <BannerContents message={item.message} />
      </motion.div>
    );
  }

  // Measure pass: render hidden so we can compute a true off-screen start.
  if (width === null) {
    return (
      <div
        ref={measureRef}
        className="invisible absolute left-0 whitespace-nowrap"
        style={{ top }}
      >
        <BannerContents message={item.message} />
      </div>
    );
  }

  const start = -width - 40; // fully off the left edge
  const end = window.innerWidth + 40; // fully off the right edge

  return (
    <motion.div
      className="absolute left-0 whitespace-nowrap"
      style={{ top }}
      initial={{ x: start }}
      animate={{ x: end }}
      transition={{ duration: item.duration / 1000, ease: "linear" }}
      onAnimationComplete={onDone}
    >
      <BannerContents message={item.message} />
    </motion.div>
  );
}
