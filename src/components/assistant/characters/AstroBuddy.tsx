import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { BuddyColorPreset } from "@/lib/settings-store";

/* ── Astro Thinking ──
   An astronaut helmet character with a visor, comm antenna,
   status lights, and a reflective visor glow. */
export function AstroThinking({ colors }: { colors: BuddyColorPreset }) {
  const [visorGlow, setVisorGlow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setVisorGlow((g) => (g + 1) % 3), 1200);
    return () => clearInterval(id);
  }, []);

  const glowOpacity = [0.15, 0.35, 0.15][visorGlow];

  return (
    <motion.div
      className="shrink-0"
      animate={{ y: [0, -5, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 4px 14px ${colors.shadow})` }}
    >
      <svg
        width="40"
        height="52"
        viewBox="0 0 52 66"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Comm antenna */}
        <line
          x1="38"
          y1="6"
          x2="38"
          y2="14"
          stroke={colors.accent}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <motion.circle
          cx="38"
          cy="4"
          r="3"
          fill={colors.light}
          animate={{ scale: [1, 1.4, 1], opacity: [0.9, 0.4, 0.9] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <circle cx="39" cy="3" r="1" fill="white" opacity="0.5" />

        {/* Helmet */}
        <ellipse cx="26" cy="28" rx="22" ry="20" fill={colors.primary} />
        <ellipse cx="26" cy="28" rx="20" ry="18" fill={colors.accent} opacity="0.3" />

        {/* Helmet rim */}
        <ellipse
          cx="26"
          cy="28"
          rx="22"
          ry="20"
          fill="none"
          stroke={colors.light}
          strokeWidth="1.5"
          opacity="0.3"
        />

        {/* "BUDDY" label on helmet */}
        <text
          x="26"
          y="16"
          textAnchor="middle"
          fontSize="5"
          fontWeight="800"
          fill="white"
          opacity="0.7"
          letterSpacing="0.8"
          fontFamily="system-ui, sans-serif"
        >
          BUDDY
        </text>

        {/* Visor */}
        <rect x="10" y="20" width="32" height="18" rx="6" fill="#0f172a" />
        <rect
          x="10"
          y="20"
          width="32"
          height="18"
          rx="6"
          fill={colors.light}
          opacity={glowOpacity}
          style={{ transition: "opacity 0.6s ease" }}
        />

        {/* Visor reflection */}
        <motion.line
          x1="13"
          y1="23"
          x2="20"
          y2="23"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.3"
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Eyes inside visor */}
        <ellipse cx="20" cy="28" rx="4.5" ry="5" fill={colors.light} opacity="0.9" />
        <ellipse cx="34" cy="28" rx="4.5" ry="5" fill={colors.light} opacity="0.9" />
        <motion.circle
          cx="20"
          cy="29"
          r="2.5"
          fill="white"
          animate={{ cy: [29, 27, 29] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="34"
          cy="29"
          r="2.5"
          fill="white"
          animate={{ cy: [29, 27, 29] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Mouth — small digital readout */}
        <motion.rect
          x="22"
          y="33"
          width="8"
          height="2"
          rx="1"
          fill={colors.light}
          opacity="0.5"
          animate={{ width: [8, 5, 8] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Status LEDs on helmet */}
        <motion.circle
          cx="8"
          cy="28"
          r="1.5"
          fill="#22c55e"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="44"
          cy="28"
          r="1.5"
          fill="#f59e0b"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Suit body */}
        <rect x="14" y="46" width="24" height="14" rx="6" fill={colors.primary} />
        <rect x="14" y="46" width="24" height="14" rx="6" fill={colors.accent} opacity="0.3" />

        {/* Suit details */}
        <circle cx="22" cy="52" r="2" fill={colors.light} opacity="0.4" />
        <circle cx="30" cy="52" r="2" fill={colors.light} opacity="0.4" />
        <rect x="24" y="55" width="4" height="3" rx="1" fill={colors.glow} opacity="0.5" />

        {/* Boots */}
        <ellipse cx="20" cy="62" rx="5" ry="3" fill={colors.accent} />
        <ellipse cx="32" cy="62" rx="5" ry="3" fill={colors.accent} />

        {/* Sparkle */}
        <motion.text
          x="42"
          y="10"
          fontSize="6"
          fill="#22d3ee"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          ✦
        </motion.text>
      </svg>
    </motion.div>
  );
}

/* ── Astro Listening ── */
export function AstroListening({ colors }: { colors: BuddyColorPreset }) {
  return (
    <motion.div
      className="shrink-0 select-none"
      animate={{ y: [0, -4, 0], rotate: [0, -1, 0, 1, 0] }}
      transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 6px 16px ${colors.shadow})` }}
    >
      <svg
        width="56"
        height="68"
        viewBox="0 0 72 84"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Comm antennas — both sides, receiving */}
        <motion.g
          animate={{ rotate: [0, -5, 0] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "16px 16px" }}
        >
          <line
            x1="16"
            y1="16"
            x2="6"
            y2="4"
            stroke={colors.accent}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <motion.circle
            cx="6"
            cy="4"
            r="3.5"
            fill={colors.glow}
            animate={{ scale: [1, 1.5, 1], opacity: [0.9, 0.3, 0.9] }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.g>
        <motion.g
          animate={{ rotate: [0, 5, 0] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: 0.1 }}
          style={{ transformOrigin: "56px 16px" }}
        >
          <line
            x1="56"
            y1="16"
            x2="66"
            y2="4"
            stroke={colors.accent}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <motion.circle
            cx="66"
            cy="4"
            r="3.5"
            fill={colors.glow}
            animate={{ scale: [1, 1.5, 1], opacity: [0.9, 0.3, 0.9] }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
          />
        </motion.g>

        {/* Sound waves left */}
        <motion.path
          d="M 4 24 Q -3 34 4 44"
          stroke={colors.glow}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.9, 0], x: [0, -3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M 0 21 Q -8 34 0 47"
          stroke={colors.glow}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.5, 0], x: [0, -5, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
        />

        {/* Sound waves right */}
        <motion.path
          d="M 68 24 Q 75 34 68 44"
          stroke={colors.glow}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.9, 0], x: [0, 3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M 72 21 Q 80 34 72 47"
          stroke={colors.glow}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.5, 0], x: [0, 5, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
        />

        {/* Helmet */}
        <ellipse cx="36" cy="34" rx="26" ry="24" fill={colors.primary} />
        <ellipse cx="36" cy="34" rx="24" ry="22" fill={colors.accent} opacity="0.3" />
        <ellipse
          cx="36"
          cy="34"
          rx="26"
          ry="24"
          fill="none"
          stroke={colors.light}
          strokeWidth="1.5"
          opacity="0.3"
        />
        <text
          x="36"
          y="18"
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

        {/* Ear pads / receivers */}
        <motion.ellipse
          cx="10"
          cy="34"
          rx="5"
          ry="8"
          fill={colors.accent}
          animate={{ rx: [5, 6, 5] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.ellipse
          cx="62"
          cy="34"
          rx="5"
          ry="8"
          fill={colors.accent}
          animate={{ rx: [5, 6, 5] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
        />
        <circle cx="10" cy="34" r="2" fill={colors.glow} opacity="0.5" />
        <circle cx="62" cy="34" r="2" fill={colors.glow} opacity="0.5" />

        {/* Visor */}
        <rect x="16" y="24" width="40" height="22" rx="7" fill="#0f172a" />
        <motion.rect
          x="16"
          y="24"
          width="40"
          height="22"
          rx="7"
          fill={colors.light}
          animate={{ opacity: [0.1, 0.3, 0.1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Visor reflection */}
        <motion.line
          x1="20"
          y1="28"
          x2="30"
          y2="28"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.25"
          animate={{ opacity: [0.15, 0.4, 0.15] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Eyes — wide alert */}
        <ellipse cx="28" cy="34" rx="5.5" ry="6" fill={colors.light} opacity="0.9" />
        <ellipse cx="44" cy="34" rx="5.5" ry="6" fill={colors.light} opacity="0.9" />
        <motion.circle
          cx="28"
          cy="33"
          r="3"
          fill="white"
          animate={{ cy: [33, 32, 33], cx: [28, 26, 28, 30, 28] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="44"
          cy="33"
          r="3"
          fill="white"
          animate={{ cy: [33, 32, 33], cx: [44, 42, 44, 46, 44] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Mouth — waveform */}
        <motion.path
          d="M 30 40 L 33 38 L 36 42 L 39 38 L 42 40"
          stroke={colors.light}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          animate={{
            d: [
              "M 30 40 L 33 38 L 36 42 L 39 38 L 42 40",
              "M 30 39 L 33 42 L 36 38 L 39 41 L 42 39",
              "M 30 40 L 33 38 L 36 42 L 39 38 L 42 40",
            ],
          }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Recording LED */}
        <motion.circle
          cx="36"
          cy="22"
          r="2"
          fill="#ef4444"
          animate={{ opacity: [1, 0.2, 1], scale: [1, 1.3, 1] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Suit body */}
        <rect x="20" y="56" width="32" height="16" rx="7" fill={colors.primary} />
        <rect x="20" y="56" width="32" height="16" rx="7" fill={colors.accent} opacity="0.3" />
        <circle cx="30" cy="64" r="2" fill={colors.light} opacity="0.4" />
        <circle cx="42" cy="64" r="2" fill={colors.light} opacity="0.4" />

        {/* Boots */}
        <ellipse cx="28" cy="74" rx="6" ry="3" fill={colors.accent} />
        <ellipse cx="44" cy="74" rx="6" ry="3" fill={colors.accent} />

        {/* Sparkles */}
        <motion.text
          x="60"
          y="12"
          fontSize="6"
          fill="#22d3ee"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          ✦
        </motion.text>
        <motion.text
          x="4"
          y="60"
          fontSize="7"
          fill="#f472b6"
          animate={{ opacity: [0.3, 0.8, 0.3], y: [60, 57, 60] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          ♪
        </motion.text>
      </svg>
    </motion.div>
  );
}
