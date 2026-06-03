import { motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Premium animated background with floating gradient orbs
 * that respond subtly to the brand palette (violet / cyan / indigo)
 * GPU-accelerated, low CPU usage
 */
export function AnimatedBackground() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base */}
      <div className="absolute inset-0 bg-background" />

      {/* Mesh gradient surface */}
      <div
        className="absolute inset-0 opacity-30 dark:opacity-20"
        style={{
          background: "var(--gradient-surface)",
        }}
      />

      {/* Floating orbs */}
      <motion.div
        className="absolute rounded-full will-change-transform"
        style={{
          width: 500,
          height: 500,
          top: "-10%",
          left: "-8%",
          background: "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 30%, transparent), transparent 70%)",
          filter: "blur(80px)",
        }}
        animate={{
          x: [0, 40, -20, 0],
          y: [0, 30, -10, 0],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <motion.div
        className="absolute rounded-full will-change-transform"
        style={{
          width: 600,
          height: 600,
          bottom: "-15%",
          right: "-10%",
          background: "radial-gradient(circle, color-mix(in oklab, var(--accent-cyan) 25%, transparent), transparent 70%)",
          filter: "blur(100px)",
        }}
        animate={{
          x: [0, -30, 20, 0],
          y: [0, -40, 15, 0],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <motion.div
        className="absolute rounded-full will-change-transform"
        style={{
          width: 400,
          height: 400,
          top: "40%",
          left: "50%",
          background: "radial-gradient(circle, color-mix(in oklab, var(--accent-indigo) 15%, transparent), transparent 70%)",
          filter: "blur(90px)",
        }}
        animate={{
          x: [0, 50, -30, 0],
          y: [0, -25, 35, 0],
        }}
        transition={{
          duration: 30,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Noise texture overlay for premium feel */}
      <div
        className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
    </div>
  );
}
