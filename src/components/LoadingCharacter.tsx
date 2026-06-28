import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "@/lib/settings-store";

/** The customizable loading character presets */
export const LOADING_CHARACTERS = [
  { id: "centriq", label: "Centriq Logo", char: null, isLogo: true, isRobot: false },
  { id: "robot", label: "Classic Bot 🤖", char: "🤖", isLogo: false, isRobot: true },
  { id: "diamond", label: "Diamond", char: "◆", isLogo: false, isRobot: false },
  { id: "infinity", label: "Infinity", char: "∞", isLogo: false, isRobot: false },
  { id: "circuit", label: "Circuit", char: "⬡", isLogo: false, isRobot: false },
  { id: "spark", label: "Spark", char: "⚡", isLogo: false, isRobot: false },
  { id: "atom", label: "Atom", char: "⊕", isLogo: false, isRobot: false },
  { id: "custom", label: "Custom...", char: null, isLogo: false, isRobot: false },
] as const;

type CharId = (typeof LOADING_CHARACTERS)[number]["id"];

interface LoadingCharacterDisplayProps {
  charId?: string;
  customChar?: string;
  size?: "sm" | "md" | "lg";
}

export function LoadingCharacterDisplay({
  charId = "centriq",
  customChar = "",
  size = "md",
}: LoadingCharacterDisplayProps) {
  const sizes = { sm: 32, md: 52, lg: 80 };
  const s = sizes[size];

  if (charId === "centriq") {
    return (
      <motion.div
        className="relative flex items-center justify-center"
        style={{ width: s, height: s }}
      >
        {/* Outer rotating ring */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
        {/* Inner white circle */}
        <div className="absolute rounded-full bg-background" style={{ inset: 3 }} />
        {/* Logo inside */}
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="Centriq"
          className="relative z-10 object-contain"
          style={{ width: s * 0.55, height: s * 0.55 }}
        />
      </motion.div>
    );
  }

  const found = LOADING_CHARACTERS.find((c) => c.id === charId) || LOADING_CHARACTERS[0];
  const displayChar = charId === "custom" ? customChar || "★" : (found?.char ?? "◆");

  return (
    <motion.div
      className="relative flex items-center justify-center select-none"
      style={{ width: s, height: s }}
      animate={{
        scale: [1, 1.15, 1],
        filter: [
          "drop-shadow(0 0 6px var(--clarity))",
          "drop-shadow(0 0 14px var(--connectivity))",
          "drop-shadow(0 0 6px var(--collaboration))",
          "drop-shadow(0 0 6px var(--clarity))",
        ],
      }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
    >
      {/* Rotating outer ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute rounded-full bg-background" style={{ inset: 3 }} />
      <span className="relative z-10 font-black text-gradient" style={{ fontSize: s * 0.42 }}>
        {displayChar}
      </span>
    </motion.div>
  );
}

/** Animated loading dots with per-C colors */
export function LoadingDots() {
  const colors = [
    "var(--clarity)",
    "var(--connectivity)",
    "var(--collaboration)",
    "var(--capacity)",
  ];
  return (
    <div className="flex items-center gap-1.5">
      {colors.map((color, i) => (
        <motion.div
          key={i}
          className="rounded-full"
          style={{ width: 6, height: 6, background: color }}
          animate={{ scale: [0.6, 1.3, 0.6], opacity: [0.4, 1, 0.4] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
