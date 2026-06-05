import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { BuddyColorPreset } from "@/lib/settings-store";

/* ── Chip Thinking ──
   A CPU/microchip character with circuit trace patterns, pin legs,
   and a glowing core. When thinking, data flows through circuit traces. */
export function ChipThinking({ colors }: { colors: BuddyColorPreset }) {
  const [dataFlow, setDataFlow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setDataFlow((f) => (f + 1) % 4), 350);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      className="shrink-0"
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 4px 14px ${colors.shadow})` }}
    >
      <svg width="40" height="50" viewBox="0 0 52 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Pin legs — left */}
        {[14, 22, 30, 38].map((y, i) => (
          <motion.line key={`l${i}`} x1="0" y1={y} x2="8" y2={y} stroke={colors.glow} strokeWidth="2" strokeLinecap="round"
            animate={{ opacity: dataFlow === i ? 1 : 0.4 }}
            transition={{ duration: 0.15 }}
          />
        ))}
        {/* Pin legs — right */}
        {[14, 22, 30, 38].map((y, i) => (
          <motion.line key={`r${i}`} x1="52" y1={y} x2="44" y2={y} stroke={colors.glow} strokeWidth="2" strokeLinecap="round"
            animate={{ opacity: dataFlow === (3 - i) ? 1 : 0.4 }}
            transition={{ duration: 0.15 }}
          />
        ))}
        {/* Pin legs — top */}
        {[18, 26, 34].map((x, i) => (
          <motion.line key={`t${i}`} x1={x} y1="0" x2={x} y2="6" stroke={colors.glow} strokeWidth="2" strokeLinecap="round"
            animate={{ opacity: dataFlow === (i + 1) ? 1 : 0.4 }}
            transition={{ duration: 0.15 }}
          />
        ))}
        {/* Pin legs — bottom */}
        {[18, 26, 34].map((x, i) => (
          <motion.line key={`b${i}`} x1={x} y1="64" x2={x} y2="58" stroke={colors.glow} strokeWidth="2" strokeLinecap="round"
            animate={{ opacity: dataFlow === (2 - i) ? 1 : 0.4 }}
            transition={{ duration: 0.15 }}
          />
        ))}

        {/* Chip body */}
        <rect x="8" y="6" width="36" height="52" rx="4" fill={colors.primary} />
        <rect x="10" y="8" width="32" height="48" rx="3" fill={colors.accent} opacity="0.5" />

        {/* Circuit traces */}
        <motion.line x1="12" y1="16" x2="22" y2="16" stroke={colors.glow} strokeWidth="1" opacity="0.5"
          animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0 }}
        />
        <motion.line x1="22" y1="16" x2="22" y2="22" stroke={colors.glow} strokeWidth="1" opacity="0.5"
          animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }}
        />
        <motion.line x1="30" y1="12" x2="30" y2="20" stroke={colors.glow} strokeWidth="1" opacity="0.5"
          animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }}
        />
        <motion.line x1="30" y1="20" x2="38" y2="20" stroke={colors.glow} strokeWidth="1" opacity="0.5"
          animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.6 }}
        />

        {/* "BUDDY" label */}
        <text x="26" y="16" textAnchor="middle" fontSize="5" fontWeight="800" fill="white" opacity="0.7" letterSpacing="0.8" fontFamily="system-ui, sans-serif">BUDDY</text>

        {/* Face area — darker inset */}
        <rect x="14" y="20" width="24" height="28" rx="3" fill="#0f172a" opacity="0.5" />

        {/* Eyes — digital/square style */}
        <motion.rect x="16" y="24" width="8" height="7" rx="1.5" fill={colors.light}
          animate={{ height: [7, 2, 7] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", times: [0, 0.48, 0.52] }}
        />
        <motion.rect x="28" y="24" width="8" height="7" rx="1.5" fill={colors.light}
          animate={{ height: [7, 2, 7] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", times: [0, 0.48, 0.52] }}
        />
        {/* Pixel pupils */}
        <rect x="20" y="26" width="3" height="3" rx="0.5" fill="white" opacity="0.9" />
        <rect x="32" y="26" width="3" height="3" rx="0.5" fill="white" opacity="0.9" />

        {/* Mouth — digital bar */}
        <motion.rect x="20" y="38" width="12" height="2" rx="1" fill={colors.light} opacity="0.6"
          animate={{ width: [12, 8, 12] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Core glow — processing indicator */}
        <motion.circle cx="26" cy="50" r="3" fill={colors.light}
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.2, 0.9] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <circle cx="26" cy="50" r="1.5" fill="white" opacity="0.6" />

        {/* Sparkle */}
        <motion.text x="40" y="6" fontSize="6" fill="#22d3ee"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >✦</motion.text>
      </svg>
    </motion.div>
  );
}

/* ── Chip Listening ── */
export function ChipListening({ colors }: { colors: BuddyColorPreset }) {
  const [signalPulse, setSignalPulse] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSignalPulse((p) => (p + 1) % 3), 400);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      className="shrink-0 select-none"
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 6px 16px ${colors.shadow})` }}
    >
      <svg width="56" height="68" viewBox="0 0 72 82" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Pin legs — left/right animated */}
        {[20, 30, 40, 50].map((y, i) => (
          <motion.line key={`l${i}`} x1="0" y1={y} x2="10" y2={y} stroke={colors.glow} strokeWidth="2" strokeLinecap="round"
            animate={{ opacity: signalPulse === (i % 3) ? 1 : 0.3 }}
            transition={{ duration: 0.2 }}
          />
        ))}
        {[20, 30, 40, 50].map((y, i) => (
          <motion.line key={`r${i}`} x1="72" y1={y} x2="62" y2={y} stroke={colors.glow} strokeWidth="2" strokeLinecap="round"
            animate={{ opacity: signalPulse === ((2 - i + 3) % 3) ? 1 : 0.3 }}
            transition={{ duration: 0.2 }}
          />
        ))}

        {/* Chip body */}
        <rect x="10" y="8" width="52" height="66" rx="5" fill={colors.primary} />
        <rect x="13" y="11" width="46" height="60" rx="4" fill={colors.accent} opacity="0.4" />

        {/* Antenna / receiver dishes */}
        <motion.g animate={{ rotate: [0, -5, 0] }} transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "18px 20px" }}>
          <line x1="18" y1="11" x2="10" y2="2" stroke={colors.light} strokeWidth="2" strokeLinecap="round" />
          <motion.circle cx="10" cy="2" r="3" fill={colors.glow}
            animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0.3, 0.8] }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.g>
        <motion.g animate={{ rotate: [0, 5, 0] }} transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: 0.1 }} style={{ transformOrigin: "54px 20px" }}>
          <line x1="54" y1="11" x2="62" y2="2" stroke={colors.light} strokeWidth="2" strokeLinecap="round" />
          <motion.circle cx="62" cy="2" r="3" fill={colors.glow}
            animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0.3, 0.8] }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
          />
        </motion.g>

        {/* Sound waves left */}
        <motion.path d="M 6 30 Q -1 40 6 50" stroke={colors.glow} strokeWidth="1.8" fill="none" strokeLinecap="round" animate={{ opacity: [0, 0.9, 0], x: [0, -3, 0] }} transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }} />
        <motion.path d="M 2 27 Q -6 40 2 53" stroke={colors.glow} strokeWidth="1.2" fill="none" strokeLinecap="round" animate={{ opacity: [0, 0.5, 0], x: [0, -5, 0] }} transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} />

        {/* Sound waves right */}
        <motion.path d="M 66 30 Q 73 40 66 50" stroke={colors.glow} strokeWidth="1.8" fill="none" strokeLinecap="round" animate={{ opacity: [0, 0.9, 0], x: [0, 3, 0] }} transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }} />
        <motion.path d="M 70 27 Q 78 40 70 53" stroke={colors.glow} strokeWidth="1.2" fill="none" strokeLinecap="round" animate={{ opacity: [0, 0.5, 0], x: [0, 5, 0] }} transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} />

        {/* "BUDDY" label */}
        <text x="36" y="22" textAnchor="middle" fontSize="6.5" fontWeight="800" fill="white" opacity="0.8" letterSpacing="1" fontFamily="system-ui, sans-serif">BUDDY</text>

        {/* Face inset */}
        <rect x="18" y="26" width="36" height="34" rx="4" fill="#0f172a" opacity="0.5" />

        {/* Eyes — wide open, digital */}
        <motion.rect x="22" y="32" width="10" height="9" rx="2" fill={colors.light}
          animate={{ height: [9, 11, 9] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.rect x="40" y="32" width="10" height="9" rx="2" fill={colors.light}
          animate={{ height: [9, 11, 9] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.rect x="26" y="34" width="4" height="4" rx="1" fill="white" opacity="0.9"
          animate={{ x: [26, 24, 26, 28, 26] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.rect x="44" y="34" width="4" height="4" rx="1" fill="white" opacity="0.9"
          animate={{ x: [44, 42, 44, 46, 44] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Mouth — animated waveform */}
        <motion.path d="M 26 50 L 30 48 L 34 52 L 38 46 L 42 50 L 46 48" stroke={colors.light} strokeWidth="1.5" fill="none" strokeLinecap="round"
          animate={{
            d: [
              "M 26 50 L 30 48 L 34 52 L 38 46 L 42 50 L 46 48",
              "M 26 49 L 30 52 L 34 47 L 38 51 L 42 48 L 46 50",
              "M 26 50 L 30 48 L 34 52 L 38 46 L 42 50 L 46 48",
            ]
          }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Active recording indicator */}
        <motion.circle cx="36" cy="66" r="3" fill="#ef4444"
          animate={{ opacity: [1, 0.3, 1], scale: [1, 1.2, 1] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Sparkles */}
        <motion.text x="58" y="10" fontSize="6" fill="#22d3ee" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}>✦</motion.text>
        <motion.text x="6" y="10" fontSize="7" fill="#f472b6" animate={{ opacity: [0.3, 0.8, 0.3], y: [10, 7, 10] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}>♪</motion.text>
      </svg>
    </motion.div>
  );
}
