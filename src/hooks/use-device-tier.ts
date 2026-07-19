import * as React from "react";
import { useIsMobile } from "./use-mobile";

export type DeviceTier = "high" | "medium" | "low";

interface DeviceTierInfo {
  tier: DeviceTier;
  isMobile: boolean;
  prefersReducedMotion: boolean;
  /** Convenience flag — true when any 3D/WebGL feature should render at all. */
  canRender3D: boolean;
}

function detectTier(isMobile: boolean, prefersReducedMotion: boolean): DeviceTier {
  if (typeof window === "undefined") return "medium";
  if (prefersReducedMotion) return "low";

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as any).deviceMemory as number | undefined; // Chrome-only, undefined elsewhere
  const saveData = (navigator as any).connection?.saveData === true;

  if (saveData) return "low";

  // Quick WebGL capability probe — a device that can't even create a context
  // (old browser, disabled GPU, some in-app webviews) gets the CSS-only path.
  let hasWebGL = false;
  try {
    const canvas = document.createElement("canvas");
    hasWebGL = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    hasWebGL = false;
  }
  if (!hasWebGL) return "low";

  if (isMobile) {
    // Most phones handle a light particle field fine; only throttle further on
    // genuinely constrained hardware (old/budget devices report low core counts
    // and/or <=2GB reported memory).
    if (cores <= 2 || (memory !== undefined && memory <= 2)) return "low";
    return "medium";
  }

  if (cores <= 2) return "medium";
  return "high";
}

/**
 * Detects a coarse device capability tier so 3D/WebGL UI can auto-degrade
 * instead of assuming every visitor has a desktop GPU. "low" means skip
 * WebGL entirely (respects prefers-reduced-motion, save-data, no-WebGL, or
 * clearly underpowered hardware); "medium" is the default mobile budget
 * (fewer particles, capped pixel ratio, no postprocessing); "high" is
 * desktop-class.
 */
export function useDeviceTier(): DeviceTierInfo {
  const isMobile = useIsMobile();
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setPrefersReducedMotion(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const tier = React.useMemo(
    () => detectTier(isMobile, prefersReducedMotion),
    [isMobile, prefersReducedMotion],
  );

  return { tier, isMobile, prefersReducedMotion, canRender3D: tier !== "low" };
}
