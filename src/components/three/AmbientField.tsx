import { lazy, Suspense, useEffect, useState } from "react";
import { useDeviceTier } from "@/hooks/use-device-tier";
import { cn } from "@/lib/utils";

// The three.js/r3f scene is only fetched over the network when a device actually
// qualifies to render it — devices on the "low" tier (reduced-motion, save-data,
// no WebGL, weak hardware) never pay for this chunk at all.
const AmbientFieldScene = lazy(() => import("./AmbientFieldScene"));

interface AmbientFieldProps {
  className?: string;
  /** [particle color, wireframe color] — tuned for dark backgrounds; automatically
   * darkened + boosted in opacity for light theme (see useIsDarkMode below). */
  colors?: [string, string];
}

function darken(hex: string, amount: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.round(v * (1 - amount)));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Tracks the resolved light/dark theme via the `dark` class the app's theme
// manager toggles on <html> (see src/hooks/use-theme.tsx) — observed directly
// rather than re-reading theme storage, so this stays correct regardless of
// which surface actually flipped the toggle.
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

/**
 * Cheap decorative WebGL particle/wireframe backdrop, auto-degraded by device
 * tier (see useDeviceTier): fewer particles and a capped pixel ratio on
 * mobile, skipped entirely on low-power/reduced-motion devices — those
 * surfaces simply keep whatever CSS background sits beneath this component.
 * Colors/opacity/blending also adapt to the resolved theme — additive
 * blending at low opacity reads nicely as a glow on dark backgrounds but
 * nearly disappears on light ones, so light mode uses darker, more saturated
 * colors with normal blending at higher opacity instead.
 * Absolutely positioned, pointer-events disabled, so it never intercepts
 * touch/scroll.
 */
export function AmbientField({ className, colors = ["#6366f1", "#06b6d4"] }: AmbientFieldProps) {
  const { tier, canRender3D } = useDeviceTier();
  const isDark = useIsDarkMode();
  if (!canRender3D) return null;

  const particleCount = tier === "high" ? 220 : 90;
  const dpr = tier === "high" ? 1.5 : 1;
  const speed = tier === "high" ? 1 : 0.7;

  const particleColor = isDark ? colors[0] : darken(colors[0], 0.35);
  const wireColor = isDark ? colors[1] : darken(colors[1], 0.4);
  const particleOpacity = isDark ? 0.55 : 0.8;
  const wireOpacity = isDark ? 0.16 : 0.35;

  return (
    <div className={cn("absolute inset-0 pointer-events-none overflow-hidden", className)}>
      <Suspense fallback={null}>
        <AmbientFieldScene
          particleCount={particleCount}
          dpr={dpr}
          particleColor={particleColor}
          wireColor={wireColor}
          particleOpacity={particleOpacity}
          wireOpacity={wireOpacity}
          additive={isDark}
          speed={speed}
        />
      </Suspense>
    </div>
  );
}
