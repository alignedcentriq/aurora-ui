import { motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Centriq 4C Premium Background
 * Unique: Floating geometric shapes (hexagons, diamonds) + flowing particles
 * Color-coded by 4C tagline: Clarity(Blue) Connectivity(Teal) Collaboration(Green) Capacity(Deep Blue)
 */
export function AnimatedBackground() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base background */}
      <div className="absolute inset-0 bg-background" />

      {/* Mesh grid overlay */}
      <div className="absolute inset-0 mesh-accent opacity-60" />

      {/* 4C Orbs — each represents one C */}
      {/* Clarity — Corporate Blue, top-left */}
      <motion.div
        className="absolute rounded-full will-change-transform"
        style={{
          width: 480,
          height: 480,
          top: "-12%",
          left: "-6%",
          background: "radial-gradient(circle, color-mix(in oklab, var(--clarity) 22%, transparent), transparent 70%)",
          filter: "blur(80px)",
        }}
        animate={{ x: [0, 35, -20, 0], y: [0, 25, -12, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Connectivity — Teal, bottom-right */}
      <motion.div
        className="absolute rounded-full will-change-transform"
        style={{
          width: 560,
          height: 560,
          bottom: "-16%",
          right: "-8%",
          background: "radial-gradient(circle, color-mix(in oklab, var(--connectivity) 20%, transparent), transparent 70%)",
          filter: "blur(95px)",
        }}
        animate={{ x: [0, -28, 18, 0], y: [0, -35, 14, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Collaboration — Green, center-right */}
      <motion.div
        className="absolute rounded-full will-change-transform"
        style={{
          width: 350,
          height: 350,
          top: "35%",
          right: "15%",
          background: "radial-gradient(circle, color-mix(in oklab, var(--collaboration) 14%, transparent), transparent 70%)",
          filter: "blur(75px)",
        }}
        animate={{ x: [0, -40, 25, 0], y: [0, 30, -20, 0] }}
        transition={{ duration: 35, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Capacity — Deep Blue, center-left */}
      <motion.div
        className="absolute rounded-full will-change-transform"
        style={{
          width: 300,
          height: 300,
          top: "55%",
          left: "5%",
          background: "radial-gradient(circle, color-mix(in oklab, var(--capacity) 16%, transparent), transparent 70%)",
          filter: "blur(70px)",
        }}
        animate={{ x: [0, 45, -15, 0], y: [0, -20, 30, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Unique: Floating geometric diamond shapes */}
      {[
        { size: 120, x: "15%", y: "20%", color: "var(--clarity)", delay: 0 },
        { size: 80, x: "75%", y: "15%", color: "var(--connectivity)", delay: 1.5 },
        { size: 60, x: "85%", y: "65%", color: "var(--collaboration)", delay: 0.8 },
        { size: 100, x: "8%", y: "70%", color: "var(--capacity)", delay: 2 },
        { size: 50, x: "50%", y: "8%", color: "var(--clarity)", delay: 1.2 },
      ].map((shape, i) => (
        <motion.div
          key={i}
          className="absolute will-change-transform"
          style={{
            width: shape.size,
            height: shape.size,
            left: shape.x,
            top: shape.y,
            transform: "rotate(45deg)",
            border: `1px solid color-mix(in oklab, ${shape.color} 18%, transparent)`,
            background: `color-mix(in oklab, ${shape.color} 3%, transparent)`,
          }}
          animate={{
            rotate: [45, 90, 45],
            scale: [1, 1.08, 1],
            opacity: [0.4, 0.7, 0.4],
          }}
          transition={{
            duration: 8 + i * 2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: shape.delay,
          }}
        />
      ))}

      {/* Unique: Thin diagonal circuit lines */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.04] dark:opacity-[0.06]"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="circuit-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--clarity)" />
            <stop offset="50%" stopColor="var(--connectivity)" />
            <stop offset="100%" stopColor="var(--collaboration)" />
          </linearGradient>
        </defs>
        {/* Horizontal circuit paths */}
        <line x1="0" y1="30%" x2="100%" y2="30%" stroke="url(#circuit-grad)" strokeWidth="0.5" strokeDasharray="8 16" />
        <line x1="0" y1="60%" x2="100%" y2="60%" stroke="url(#circuit-grad)" strokeWidth="0.5" strokeDasharray="6 20" />
        <line x1="0" y1="80%" x2="100%" y2="80%" stroke="url(#circuit-grad)" strokeWidth="0.5" strokeDasharray="10 14" />
        {/* Vertical connectors */}
        <line x1="25%" y1="0" x2="25%" y2="100%" stroke="url(#circuit-grad)" strokeWidth="0.5" strokeDasharray="4 24" />
        <line x1="70%" y1="0" x2="70%" y2="100%" stroke="url(#circuit-grad)" strokeWidth="0.5" strokeDasharray="6 18" />
        {/* Diagonal accent */}
        <line x1="0" y1="0" x2="40%" y2="100%" stroke="var(--clarity)" strokeWidth="0.5" strokeDasharray="5 30" />
        <line x1="60%" y1="0" x2="100%" y2="70%" stroke="var(--collaboration)" strokeWidth="0.5" strokeDasharray="5 30" />
      </svg>

      {/* Noise texture overlay for premium feel */}
      <div
        className="absolute inset-0 opacity-[0.018] dark:opacity-[0.04]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
    </div>
  );
}
