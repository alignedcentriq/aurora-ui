import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GreetingBotSVG } from "./GreetingBot";
import { useBuddyColors } from "@/lib/settings-store";
import { useBuddyStore } from "@/lib/buddy-store";

interface SplashOverlayProps {
  onComplete: () => void;
}

export function SplashOverlay({ onComplete }: SplashOverlayProps) {
  const colors = useBuddyColors();
  const { botState } = useBuddyStore();
  const [stage, setStage] = useState<"intro" | "vortex" | "fadeout">("intro");

  useEffect(() => {
    // Stage 0 -> 1 (vortex merge) at 1.8 seconds
    const vortexTimer = setTimeout(() => {
      setStage("vortex");
    }, 1800);

    // Stage 1 -> 2 (fadeout background) at 3.1 seconds
    const fadeoutTimer = setTimeout(() => {
      setStage("fadeout");
    }, 3100);

    // Stage 2 -> Complete at 3.8 seconds
    const completeTimer = setTimeout(() => {
      onComplete();
    }, 3800);

    return () => {
      clearTimeout(vortexTimer);
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
            {/* Rotating Logo Ring - Fades in during vortex merge */}
            <AnimatePresence>
              {stage === "vortex" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.7, rotate: -45 }}
                  animate={{ opacity: 1, scale: 1, rotate: 360 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    opacity: { duration: 0.5 },
                    scale: { type: "spring", stiffness: 150, damping: 15 },
                    rotate: { duration: 6, repeat: Infinity, ease: "linear" },
                  }}
                  className="absolute w-48 h-48 rounded-3xl flex items-center justify-center"
                  style={{
                    background:
                      "conic-gradient(from 0deg, var(--clarity), var(--connectivity), var(--collaboration), var(--capacity), var(--clarity))",
                    padding: "3px",
                  }}
                >
                  <div className="w-full h-full bg-[#020617] rounded-3xl" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Speech bubble container */}
            <AnimatePresence>
              {stage === "intro" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: -20 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={{ type: "spring", stiffness: 200, damping: 18 }}
                  className="absolute bottom-full mb-8 bg-white/10 border border-white/10 backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl text-center min-w-[220px]"
                >
                  <p className="text-white font-bold text-[13.5px] leading-snug">
                    Hey there! 👋 <br />
                    <span className="text-pink-400 font-extrabold text-[12px] uppercase tracking-widest mt-1 block">
                      Initializing Centriq
                    </span>
                  </p>
                  {/* Arrow pointing down */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white/10 border-r border-b border-white/10 backdrop-blur-md" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Buddy character wrapper */}
            <motion.div
              layoutId={stage === "intro" ? "sidebar-buddy-character" : undefined}
              animate={
                stage === "vortex"
                  ? {
                    scale: 0.0,
                    rotate: 720,
                    opacity: 0,
                  }
                  : {
                    scale: 1,
                    rotate: 0,
                    opacity: 1,
                  }
              }
              transition={{
                duration: 1.2,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="z-10"
            >
              <GreetingBotSVG
                colors={colors}
                expression={stage === "intro" ? "wink" : "happy"}
                isWaving={stage === "intro"}
                size={96}
              />
            </motion.div>

            {/* Centriq Inner Logo Image inside the Ring - Fades in as character merges */}
            <AnimatePresence>
              {stage === "vortex" && (
                <motion.img
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.6, duration: 0.5, ease: "easeOut" }}
                  src={`${import.meta.env.BASE_URL}logo.png`}
                  alt="Centriq AI"
                  className="absolute w-24 h-24 object-contain rounded-2xl pointer-events-none bg-[#020617] p-1.5"
                />
              )}
            </AnimatePresence>
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
