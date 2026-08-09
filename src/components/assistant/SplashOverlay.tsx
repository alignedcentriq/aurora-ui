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
            {/* Breathing ambient glow — pulses gently instead of a hard spin, reads as "alive" not "loading" */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0.35, 0.6, 0.35], scale: [0.95, 1.08, 0.95] }}
              transition={{
                opacity: { delay: 0.15, duration: 3.2, repeat: Infinity, ease: "easeInOut" },
                scale: { delay: 0.15, duration: 3.2, repeat: Infinity, ease: "easeInOut" },
              }}
              className="absolute w-64 h-64 rounded-full blur-3xl pointer-events-none"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
              }}
            />

            {/* Orbiting satellite dots — a slim rotating ring carrying two glints around the bezel */}
            <motion.div
              initial={{ opacity: 0, rotate: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              transition={{
                opacity: { duration: 0.6 },
                rotate: { duration: 10, repeat: Infinity, ease: "linear" },
              }}
              className="absolute w-56 h-56 pointer-events-none"
            >
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
                style={{ background: "var(--connectivity)", boxShadow: "0 0 10px 2px var(--connectivity)" }}
              />
              <span
                className="absolute bottom-2 right-3 w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--capacity)", boxShadow: "0 0 8px 2px var(--capacity)" }}
              />
            </motion.div>

            {/* Static gradient bezel — a fixed glowing ring frame, not a spinner */}
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ scale: { type: "spring", stiffness: 150, damping: 15 }, opacity: { duration: 0.5 } }}
              className="relative w-48 h-48 rounded-full flex items-center justify-center overflow-hidden"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
                padding: "4px",
                boxShadow:
                  "0 25px 50px -12px rgba(0,0,0,0.6), 0 0 60px -10px color-mix(in oklab, var(--connectivity) 50%, transparent)",
              }}
            >
              <div className="relative w-full h-full bg-black rounded-full overflow-hidden flex items-center justify-center">
                {/* Slowly-spinning mandala mark — the logo's own geometry becomes the motion, not a generic ring */}
                <motion.img
                  initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
                  animate={{ opacity: 1, scale: 1, rotate: 360 }}
                  transition={{
                    opacity: { delay: 0.25, duration: 0.5 },
                    scale: { delay: 0.25, duration: 0.6, ease: "easeOut" },
                    rotate: { duration: 24, repeat: Infinity, ease: "linear" },
                  }}
                  src={`${import.meta.env.BASE_URL}logo.png`}
                  alt="Centriq AI"
                  className="w-[92%] h-[92%] object-contain pointer-events-none"
                />
              </div>
              {/* Fixed specular highlight painted on the ring surface, like light catching a curved rim */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.28), transparent 45%)",
                  mixBlendMode: "screen",
                }}
              />
            </motion.div>
          </div>

          {/* Centriq AI text label below the logo */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="absolute bottom-12 flex flex-col items-center gap-2.5"
          >
            <h1
              className="text-2xl font-black tracking-wider uppercase bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, #fff, var(--connectivity), #fff)",
              }}
            >
              Centriq AI
            </h1>
            <p className="text-white/40 text-[11px] font-bold uppercase tracking-[0.25em]">
              Workspace Concierge
            </p>
            {/* Slim progress shimmer — signals activity without another spinning element */}
            <div className="relative w-32 h-[3px] rounded-full bg-white/10 overflow-hidden mt-1">
              <motion.div
                className="absolute inset-y-0 w-1/3 rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, var(--connectivity), transparent)",
                }}
                initial={{ x: "-100%" }}
                animate={{ x: "300%" }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

