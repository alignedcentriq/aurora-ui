import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { BuddyColorPreset } from "@/lib/settings-store";

/* ── Robot Thinking ── */
export function RobotThinking({ colors }: { colors: BuddyColorPreset }) {
  const [phase, setPhase] = useState<"typing" | "glance">("typing");
  const [handFrame, setHandFrame] = useState(0);

  useEffect(() => {
    let t: number;
    const cycle = () => {
      setPhase("glance");
      t = window.setTimeout(() => {
        setPhase("typing");
        t = window.setTimeout(cycle, 2400);
      }, 1000);
    };
    t = window.setTimeout(cycle, 2400);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase !== "typing") return;
    const id = setInterval(() => setHandFrame((f) => (f + 1) % 2), 280);
    return () => clearInterval(id);
  }, [phase]);

  const typing = phase === "typing";
  const lx = typing ? 0 : 2,
    ly = typing ? 3 : -4;
  const rx = typing ? 0 : 2,
    ry = typing ? 3 : -4;

  return (
    <motion.div
      className="shrink-0"
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 4px 12px ${colors.shadow})` }}
    >
      <svg
        width="38"
        height="52"
        viewBox="0 0 50 68"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line
          x1="25"
          y1="4"
          x2="25"
          y2="13"
          stroke={colors.primary}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <motion.circle
          cx="25"
          cy="3.5"
          r="4.5"
          fill={colors.light}
          animate={{ scale: [1, 1.35, 1], opacity: [0.9, 0.5, 0.9] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <circle cx="26.5" cy="2" r="1.6" fill="white" opacity="0.65" />
        <rect x="3" y="12" width="44" height="38" rx="14" fill={colors.primary} />
        <text
          x="25"
          y="21"
          textAnchor="middle"
          fontSize="5.5"
          fontWeight="800"
          fill="white"
          opacity="0.8"
          letterSpacing="1"
          fontFamily="system-ui, sans-serif"
        >
          BUDDY
        </text>
        <circle cx="2.5" cy="31" r="5" fill={colors.primary} opacity="0.7" />
        <circle cx="47.5" cy="31" r="5" fill={colors.primary} opacity="0.7" />
        <ellipse
          cx="17"
          cy="29"
          rx="7.5"
          ry={typing ? 8 : 9.5}
          fill="white"
          style={{ transition: "ry 0.3s ease" }}
        />
        <ellipse
          cx="35"
          cy="29"
          rx="7.5"
          ry={typing ? 8 : 9.5}
          fill="white"
          style={{ transition: "ry 0.3s ease" }}
        />
        <circle
          cx={17}
          cy={31}
          r="4.2"
          fill="#1e1b4b"
          style={{
            transform: `translate(${lx}px, ${ly}px)`,
            transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
          }}
        />
        <circle
          cx={35}
          cy={31}
          r="4.2"
          fill="#1e1b4b"
          style={{
            transform: `translate(${rx}px, ${ry}px)`,
            transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
          }}
        />
        <circle
          cx={17 + lx + 1.5}
          cy={31 + ly - 2}
          r="1.4"
          fill="white"
          style={{ transition: "cx 0.35s ease, cy 0.35s ease" }}
        />
        <circle
          cx={35 + rx + 1.5}
          cy={31 + ry - 2}
          r="1.4"
          fill="white"
          style={{ transition: "cx 0.35s ease, cy 0.35s ease" }}
        />
        {typing ? (
          <line
            x1="19"
            y1="42"
            x2="33"
            y2="42"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.75"
          />
        ) : (
          <path
            d="M 17 41 Q 26 48 35 41"
            stroke="white"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
        )}
        <ellipse cx="8" cy="37" rx="5" ry="3" fill="#fca5a5" opacity="0.45" />
        <ellipse cx="44" cy="37" rx="5" ry="3" fill="#fca5a5" opacity="0.45" />
        {typing && (
          <>
            <ellipse
              cx="17"
              cy="55"
              rx="4"
              ry="2.5"
              fill={colors.accent}
              style={{
                transform: handFrame === 0 ? "translateY(-3px)" : "translateY(0px)",
                transition: "transform 0.14s ease",
              }}
            />
            <ellipse
              cx="35"
              cy="55"
              rx="4"
              ry="2.5"
              fill={colors.accent}
              style={{
                transform: handFrame === 1 ? "translateY(-3px)" : "translateY(0px)",
                transition: "transform 0.14s ease",
              }}
            />
            <rect x="7" y="58" width="36" height="7" rx="2.5" fill={colors.accent} opacity="0.7" />
            <rect x="10" y="60" width="5" height="2.5" rx="1" fill={colors.glow} opacity="0.9" />
            <rect x="17" y="60" width="5" height="2.5" rx="1" fill={colors.glow} opacity="0.9" />
            <rect x="24" y="60" width="5" height="2.5" rx="1" fill={colors.glow} opacity="0.9" />
            <rect x="31" y="60" width="5" height="2.5" rx="1" fill={colors.glow} opacity="0.9" />
          </>
        )}
        {!typing && (
          <>
            <text x="38" y="20" fontSize="8" fill="#22d3ee" opacity="0.9">
              ✦
            </text>
            <text x="41" y="28" fontSize="5" fill="#22d3ee" opacity="0.7">
              ✦
            </text>
          </>
        )}
      </svg>
    </motion.div>
  );
}

/* ── Robot Listening ── */
export function RobotListening({ colors }: { colors: BuddyColorPreset }) {
  const [earPulse, setEarPulse] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setEarPulse((p) => (p + 1) % 2), 600);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      className="shrink-0 select-none"
      animate={{ y: [0, -4, 0], rotate: [0, -2, 0, 2, 0] }}
      transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: `drop-shadow(0 6px 16px ${colors.shadow})` }}
    >
      <svg
        width="56"
        height="72"
        viewBox="0 0 72 88"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line
          x1="36"
          y1="6"
          x2="36"
          y2="16"
          stroke={colors.primary}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <motion.circle
          cx="36"
          cy="5"
          r="4.5"
          fill={colors.light}
          animate={{ scale: [1, 1.5, 1], opacity: [0.9, 0.4, 0.9] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
        />
        <circle cx="37.5" cy="3.5" r="1.6" fill="white" opacity="0.6" />
        <rect x="12" y="15" width="48" height="42" rx="16" fill={colors.primary} />
        <text
          x="36"
          y="26"
          textAnchor="middle"
          fontSize="7.5"
          fontWeight="800"
          fill="white"
          opacity="0.85"
          letterSpacing="1.2"
          fontFamily="system-ui, sans-serif"
        >
          BUDDY
        </text>
        <motion.circle
          cx="10"
          cy="36"
          r={earPulse === 0 ? 7 : 5.5}
          fill={colors.primary}
          style={{ transition: "r 0.3s ease" }}
          opacity="0.85"
        />
        <motion.circle
          cx="62"
          cy="36"
          r={earPulse === 1 ? 7 : 5.5}
          fill={colors.primary}
          style={{ transition: "r 0.3s ease" }}
          opacity="0.85"
        />
        <circle cx="10" cy="35" r="3" fill={colors.light} opacity="0.4" />
        <circle cx="62" cy="35" r="3" fill={colors.light} opacity="0.4" />
        {/* Hands */}
        <motion.g
          animate={{ rotate: [0, -6, 0, -3, 0], x: [0, -1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "10px 36px" }}
        >
          <ellipse cx="6" cy="36" rx="7.5" ry="10" fill={colors.accent} />
          <ellipse cx="6" cy="36" rx="5.5" ry="8" fill={colors.primary} />
          <ellipse cx="3" cy="29" rx="2.5" ry="4" fill={colors.accent} />
          <ellipse cx="7" cy="28" rx="2.2" ry="3.5" fill={colors.accent} />
          <ellipse cx="11" cy="29.5" rx="2" ry="3" fill={colors.accent} />
          <ellipse cx="3" cy="43" rx="2.2" ry="3" fill={colors.accent} />
        </motion.g>
        <motion.g
          animate={{ rotate: [0, 6, 0, 3, 0], x: [0, 1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
          style={{ transformOrigin: "62px 36px" }}
        >
          <ellipse cx="66" cy="36" rx="7.5" ry="10" fill={colors.accent} />
          <ellipse cx="66" cy="36" rx="5.5" ry="8" fill={colors.primary} />
          <ellipse cx="69" cy="29" rx="2.5" ry="4" fill={colors.accent} />
          <ellipse cx="65" cy="28" rx="2.2" ry="3.5" fill={colors.accent} />
          <ellipse cx="61" cy="29.5" rx="2" ry="3" fill={colors.accent} />
          <ellipse cx="69" cy="43" rx="2.2" ry="3" fill={colors.accent} />
        </motion.g>
        {/* Sound waves */}
        <motion.path
          d="M 3 28 Q -3 36 3 44"
          stroke={colors.glow}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.9, 0], x: [0, -4, 0] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M -1 25 Q -8 36 -1 47"
          stroke={colors.glow}
          strokeWidth="1.3"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.6, 0], x: [0, -5, 0] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut", delay: 0.25 }}
        />
        <motion.path
          d="M 69 28 Q 75 36 69 44"
          stroke={colors.glow}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.9, 0], x: [0, 4, 0] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M 73 25 Q 80 36 73 47"
          stroke={colors.glow}
          strokeWidth="1.3"
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.6, 0], x: [0, 5, 0] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut", delay: 0.25 }}
        />
        {/* Eyes */}
        <ellipse cx="27" cy="38" rx="7.5" ry="9" fill="white" />
        <ellipse cx="45" cy="38" rx="7.5" ry="9" fill="white" />
        <motion.circle
          cx="27"
          cy="35"
          r="4.2"
          fill="#1e1b4b"
          animate={{ cx: [27, 25, 27, 29, 27], cy: [35, 34, 35] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="45"
          cy="35"
          r="4.2"
          fill="#1e1b4b"
          animate={{ cx: [45, 43, 45, 47, 45], cy: [35, 34, 35] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="29"
          cy="33"
          r="1.5"
          fill="white"
          animate={{ cx: [29, 27, 29, 31, 29] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="47"
          cy="33"
          r="1.5"
          fill="white"
          animate={{ cx: [47, 45, 47, 49, 47] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Eyebrows */}
        <motion.line
          x1="21"
          y1="28"
          x2="33"
          y2="27"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.6"
          animate={{ y1: [28, 26, 28], y2: [27, 25, 27] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.line
          x1="39"
          y1="27"
          x2="51"
          y2="28"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.6"
          animate={{ y1: [27, 25, 27], y2: [28, 26, 28] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Mouth */}
        <ellipse cx="36" cy="50" rx="4" ry="3.5" fill="white" opacity="0.25" />
        <motion.ellipse
          cx="36"
          cy="50"
          rx="3"
          ry="2.5"
          fill="#1e1b4b"
          opacity="0.35"
          animate={{ ry: [2.5, 3.2, 2.5], rx: [3, 3.5, 3] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <ellipse cx="18" cy="48" rx="4.5" ry="2.5" fill="#fca5a5" opacity="0.4" />
        <ellipse cx="54" cy="48" rx="4.5" ry="2.5" fill="#fca5a5" opacity="0.4" />
        {/* Body */}
        <rect x="22" y="57" width="28" height="14" rx="7" fill={colors.accent} />
        <rect x="22" y="57" width="28" height="14" rx="7" fill={colors.primary} opacity="0.5" />
        <motion.text
          x="36"
          y="67"
          textAnchor="middle"
          fontSize="6"
          fontWeight="700"
          fill="white"
          opacity="0.7"
          animate={{ opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        >
          ♪ ♫ ♪
        </motion.text>
        <ellipse cx="29" cy="72" rx="5" ry="3" fill={colors.accent} />
        <ellipse cx="43" cy="72" rx="5" ry="3" fill={colors.accent} />
        {/* Sparkles */}
        <motion.text
          x="55"
          y="20"
          fontSize="7"
          fill="#22d3ee"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          ✦
        </motion.text>
        <motion.text
          x="9"
          y="18"
          fontSize="8"
          fill="#f472b6"
          animate={{ opacity: [0.2, 0.8, 0.2], y: [18, 15, 18] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        >
          ♪
        </motion.text>
      </svg>
    </motion.div>
  );
}
