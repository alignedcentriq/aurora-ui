import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { BuddyColorPreset } from "@/lib/settings-store";

/* ── Drone Thinking ──
   A small quadcopter drone with spinning propellers, a central camera eye,
   and LED status lights. When thinking it hovers with scanning eye. */
export function DroneThinking({ colors }: { colors: BuddyColorPreset }) {
  const [scanDir, setScanDir] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setScanDir((d) => (d + 1) % 3), 900);
    return () => clearInterval(id);
  }, []);

  const scanX = [24, 20, 28][scanDir];

  return (
    <motion.div
      className="shrink-0"
      animate={{ y: [0, -6, 0], rotate: [0, 1, -1, 0] }}
      transition={{ duration: 2.0, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 6px 14px ${colors.shadow})` }}
    >
      <svg
        width="42"
        height="48"
        viewBox="0 0 52 58"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Propeller arms */}
        <line
          x1="10"
          y1="14"
          x2="26"
          y2="18"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <line
          x1="42"
          y1="14"
          x2="26"
          y2="18"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Propellers — spinning */}
        <motion.ellipse
          cx="10"
          cy="12"
          rx="9"
          ry="2.5"
          fill={colors.glow}
          opacity="0.6"
          animate={{ ry: [2.5, 0.5, 2.5] }}
          transition={{ duration: 0.3, repeat: Infinity, ease: "linear" }}
        />
        <motion.ellipse
          cx="42"
          cy="12"
          rx="9"
          ry="2.5"
          fill={colors.glow}
          opacity="0.6"
          animate={{ ry: [0.5, 2.5, 0.5] }}
          transition={{ duration: 0.3, repeat: Infinity, ease: "linear" }}
        />
        {/* Propeller hubs */}
        <circle cx="10" cy="12" r="2.5" fill={colors.accent} />
        <circle cx="42" cy="12" r="2.5" fill={colors.accent} />

        {/* Main body */}
        <rect x="10" y="16" width="32" height="24" rx="8" fill={colors.primary} />

        {/* "BUDDY" label */}
        <text
          x="26"
          y="24"
          textAnchor="middle"
          fontSize="5"
          fontWeight="800"
          fill="white"
          opacity="0.75"
          letterSpacing="0.8"
          fontFamily="system-ui, sans-serif"
        >
          BUDDY
        </text>

        {/* Camera eye — scanning */}
        <circle cx="26" cy="30" r="8" fill="#0f172a" />
        <circle cx="26" cy="30" r="6.5" fill="#1e293b" />
        <motion.circle
          cx={scanX}
          cy="30"
          r="3.5"
          fill={colors.light}
          style={{ transition: "cx 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}
        />
        <motion.circle
          cx={scanX}
          cy="30"
          r="3.5"
          fill={colors.glow}
          opacity="0.4"
          animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          style={{ transition: "cx 0.4s ease" }}
        />
        <circle cx={scanX + 1} cy="29" r="1" fill="white" opacity="0.8" />

        {/* Lens ring */}
        <circle
          cx="26"
          cy="30"
          r="8"
          stroke={colors.light}
          strokeWidth="1"
          fill="none"
          opacity="0.4"
        />

        {/* Status LEDs */}
        <motion.circle
          cx="14"
          cy="36"
          r="1.5"
          fill="#22c55e"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="38"
          cy="36"
          r="1.5"
          fill="#f59e0b"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Landing gear */}
        <line
          x1="14"
          y1="40"
          x2="12"
          y2="46"
          stroke={colors.accent}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="38"
          y1="40"
          x2="40"
          y2="46"
          stroke={colors.accent}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="8"
          y1="46"
          x2="18"
          y2="46"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <line
          x1="34"
          y1="46"
          x2="44"
          y2="46"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Processing indicator under body */}
        <motion.rect
          x="18"
          y="48"
          width="16"
          height="2"
          rx="1"
          fill={colors.glow}
          opacity="0.6"
          animate={{ opacity: [0.3, 0.8, 0.3], width: [16, 10, 16] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Sparkle */}
        <motion.text
          x="40"
          y="8"
          fontSize="6"
          fill="#22d3ee"
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          ✦
        </motion.text>
      </svg>
    </motion.div>
  );
}

/* ── Drone Listening ── */
export function DroneListening({ colors }: { colors: BuddyColorPreset }) {
  return (
    <motion.div
      className="shrink-0 select-none"
      animate={{ y: [0, -5, 0], rotate: [0, -2, 0, 2, 0] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 6px 16px ${colors.shadow})` }}
    >
      <svg
        width="56"
        height="68"
        viewBox="0 0 72 82"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Propeller arms */}
        <line
          x1="14"
          y1="18"
          x2="36"
          y2="24"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <line
          x1="58"
          y1="18"
          x2="36"
          y2="24"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Propellers — fast spin */}
        <motion.ellipse
          cx="14"
          cy="16"
          rx="12"
          ry="3"
          fill={colors.glow}
          opacity="0.5"
          animate={{ ry: [3, 0.5, 3] }}
          transition={{ duration: 0.2, repeat: Infinity, ease: "linear" }}
        />
        <motion.ellipse
          cx="58"
          cy="16"
          rx="12"
          ry="3"
          fill={colors.glow}
          opacity="0.5"
          animate={{ ry: [0.5, 3, 0.5] }}
          transition={{ duration: 0.2, repeat: Infinity, ease: "linear" }}
        />
        <circle cx="14" cy="16" r="3" fill={colors.accent} />
        <circle cx="58" cy="16" r="3" fill={colors.accent} />

        {/* Body */}
        <rect x="14" y="22" width="44" height="32" rx="10" fill={colors.primary} />
        <text
          x="36"
          y="32"
          textAnchor="middle"
          fontSize="6.5"
          fontWeight="800"
          fill="white"
          opacity="0.8"
          letterSpacing="1"
          fontFamily="system-ui, sans-serif"
        >
          BUDDY
        </text>

        {/* Microphone dishes — extended from sides */}
        <motion.g
          animate={{ rotate: [0, -4, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "14px 38px" }}
        >
          <path d="M 14 34 Q 4 34 2 38 Q 4 42 14 42" fill={colors.accent} />
          <path d="M 10 35 Q 4 35 3 38 Q 4 41 10 41" fill={colors.light} opacity="0.3" />
          <circle cx="4" cy="38" r="2" fill={colors.glow} />
        </motion.g>
        <motion.g
          animate={{ rotate: [0, 4, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.1 }}
          style={{ transformOrigin: "58px 38px" }}
        >
          <path d="M 58 34 Q 68 34 70 38 Q 68 42 58 42" fill={colors.accent} />
          <path d="M 62 35 Q 68 35 69 38 Q 68 41 62 41" fill={colors.light} opacity="0.3" />
          <circle cx="68" cy="38" r="2" fill={colors.glow} />
        </motion.g>

        {/* Sound waves left */}
        <motion.path
          d="M 2 32 Q -4 38 2 44"
          stroke={colors.glow}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.9, 0], x: [0, -3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M -2 29 Q -9 38 -2 47"
          stroke={colors.glow}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.5, 0], x: [0, -5, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
        />

        {/* Sound waves right */}
        <motion.path
          d="M 70 32 Q 76 38 70 44"
          stroke={colors.glow}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.9, 0], x: [0, 3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M 74 29 Q 81 38 74 47"
          stroke={colors.glow}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.5, 0], x: [0, 5, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
        />

        {/* Camera eye — big, alert */}
        <circle cx="36" cy="42" r="9" fill="#0f172a" />
        <circle cx="36" cy="42" r="7.5" fill="#1e293b" />
        <motion.circle
          cx="36"
          cy="42"
          r="5"
          fill={colors.light}
          animate={{ r: [5, 6, 5], opacity: [1, 0.7, 1] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <circle cx="38" cy="40" r="1.5" fill="white" opacity="0.8" />
        <circle
          cx="36"
          cy="42"
          r="9"
          stroke={colors.light}
          strokeWidth="1"
          fill="none"
          opacity="0.5"
        />

        {/* Active recording LED */}
        <motion.circle
          cx="36"
          cy="26"
          r="2.5"
          fill="#ef4444"
          animate={{ opacity: [1, 0.2, 1], scale: [1, 1.2, 1] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Landing gear */}
        <line
          x1="20"
          y1="54"
          x2="18"
          y2="62"
          stroke={colors.accent}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="52"
          y1="54"
          x2="54"
          y2="62"
          stroke={colors.accent}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="12"
          y1="62"
          x2="26"
          y2="62"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <line
          x1="46"
          y1="62"
          x2="60"
          y2="62"
          stroke={colors.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Sparkles */}
        <motion.text
          x="60"
          y="10"
          fontSize="6"
          fill="#22d3ee"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          ✦
        </motion.text>
        <motion.text
          x="6"
          y="12"
          fontSize="7"
          fill="#f472b6"
          animate={{ opacity: [0.2, 0.8, 0.2], y: [12, 9, 12] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          ♪
        </motion.text>
      </svg>
    </motion.div>
  );
}
