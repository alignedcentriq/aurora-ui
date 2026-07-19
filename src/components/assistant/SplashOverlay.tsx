import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface SplashOverlayProps {
  onComplete: () => void;
}

export function SplashOverlay({ onComplete }: SplashOverlayProps) {
  const [stage, setStage] = useState<"intro" | "fadeout">("intro");

  useEffect(() => {
    // Stage 1 -> 2 (fadeout background) at 3.1 seconds
    const fadeoutTimer = setTimeout(() => {
      setStage("fadeout");
    }, 3100);

    // Stage 2 -> Complete at 3.8 seconds
    const completeTimer = setTimeout(() => {
      onComplete();
    }, 3800);

    return () => {
      clearTimeout(fadeoutTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {stage !== "fadeout" && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center select-none pointer-events-auto"
          style={{
            background: "radial-gradient(circle at center, #0f172a 0%, #020617 100%)",
          }}
        >
          {/* Animated Background Mesh */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0-6l22-13V19L28 6 6 19v28l22 13z' fill='none' stroke='%233B8FE8' stroke-width='0.5'/%3E%3C/svg%3E")`,
              backgroundSize: "56px 100px",
            }}
          />

          <div className="relative flex flex-col items-center justify-center">
            {/* Soft ambient glow beneath the ring — sells it as an object floating in space, not a flat sticker */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.55 }}
              transition={{ delay: 0.15, duration: 0.8 }}
              className="absolute w-56 h-56 rounded-full blur-3xl pointer-events-none"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
              }}
            />

            {/* Rotating Logo Ring */}
            <motion.div
              initial={{ opacity: 0, scale: 0.7, rotate: -45 }}
              animate={{ opacity: 1, scale: 1, rotate: 360 }}
              transition={{
                opacity: { duration: 0.5 },
                scale: { type: "spring", stiffness: 150, damping: 15 },
                rotate: { duration: 6, repeat: Infinity, ease: "linear" },
              }}
              className="relative w-48 h-48 rounded-full flex items-center justify-center"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
                padding: "3px",
                boxShadow:
                  "0 25px 50px -12px rgba(0,0,0,0.6), 0 0 60px -10px color-mix(in oklab, var(--connectivity) 50%, transparent)",
              }}
            >
              <div className="w-full h-full bg-[#020617] rounded-full" />
              {/* Fixed specular highlight painted on the ring surface, like light catching a curved rim */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.35), transparent 45%)",
                  mixBlendMode: "screen",
                }}
              />
            </motion.div>

            {/* Centriq Inner Logo Image inside the Ring — masked circular so no square backdrop peeks through */}
            <motion.img
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Centriq AI"
              className="absolute w-24 h-24 object-contain rounded-full pointer-events-none bg-[#020617] p-1.5"
              style={{
                boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)",
              }}
            />
          </div>

          {/* Centriq AI text label below the logo */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="absolute bottom-12 flex flex-col items-center gap-1.5"
          >
            <h1 className="text-white text-2xl font-black tracking-wider uppercase">Centriq AI</h1>
            <p className="text-white/40 text-[11px] font-bold uppercase tracking-[0.25em]">
              Workspace Concierge
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

